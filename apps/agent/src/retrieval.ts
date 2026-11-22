import * as fs from 'fs';
import * as path from 'path';

// We lazy-import @xenova/transformers because the ESM package has side effects
// on load and we want retrieval.ts to be safe to import for code paths that
// never call retrieve().
type FeatureExtractor = (text: string, opts?: any) => Promise<any>;

interface KbDoc {
  doc_id: string;      // e.g. "kb/01-what-is-the-unconference.md"
  text: string;
  embedding: number[];
}

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
const KB_DIR = path.resolve(__dirname, '..', 'kb');

let cache: KbDoc[] | null = null;
let extractorPromise: Promise<FeatureExtractor> | null = null;

async function getExtractor(): Promise<FeatureExtractor> {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      // Dynamic import: @xenova/transformers is an ESM-only package.
      const { pipeline } = await import('@xenova/transformers');
      const extractor = await pipeline('feature-extraction', MODEL_ID);
      return extractor as unknown as FeatureExtractor;
    })();
  }
  return extractorPromise;
}

async function embed(text: string): Promise<number[]> {
  const extractor = await getExtractor();
  const output = await extractor(text, { pooling: 'mean', normalize: true });
  // Transformers.js returns a Tensor-like object; .data is Float32Array.
  return Array.from(output.data as Float32Array);
}

function cosine(a: number[], b: number[]): number {
  // Vectors come out of MiniLM already L2-normalized (normalize: true above),
  // so cosine reduces to dot product. We compute magnitudes anyway for safety.
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

async function loadKb(): Promise<KbDoc[]> {
  if (cache) return cache;

  if (!fs.existsSync(KB_DIR)) {
    // No KB yet — return empty rather than throwing so the agent can still
    // respond (albeit ungrounded).
    cache = [];
    return cache;
  }

  const files = fs
    .readdirSync(KB_DIR)
    .filter((f) => f.endsWith('.md'))
    .sort();

  const docs: KbDoc[] = [];
  for (const f of files) {
    const full = path.join(KB_DIR, f);
    const text = fs.readFileSync(full, 'utf-8');
    const embedding = await embed(text);
    docs.push({
      doc_id: `kb/${f}`,
      text,
      embedding,
    });
  }

  cache = docs;
  return cache;
}

export async function retrieve(
  query: string,
  topK = 4,
): Promise<Array<{ doc_id: string; score: number; text: string }>> {
  const docs = await loadKb();
  if (docs.length === 0) return [];

  const qEmb = await embed(query);
  const scored = docs.map((d) => ({
    doc_id: d.doc_id,
    score: cosine(qEmb, d.embedding),
    text: d.text,
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}
