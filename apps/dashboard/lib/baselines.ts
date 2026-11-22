// Baselines store — persisted as JSON at BASELINES_PATH.
//
// Each metric has {mean, stddev, n}; we expose load/save helpers plus a
// seedFromRecentSpans() that recomputes from DuckDB.
import fs from 'node:fs';
import path from 'node:path';
import type { Baselines, Span } from './types';
import { recentSpans } from './db';

const DEFAULT_METRICS = [
  'turn_count',
  'output_tokens',
  'input_tokens',
  'cache_read_tokens',
  'latency_ms',
  'tool_call_count',
  'judge_score',
];

function baselinesPath(): string {
  return process.env.BASELINES_PATH ?? './data/baselines.json';
}

function emptyBaselines(): Baselines {
  const b: Baselines = {};
  for (const m of DEFAULT_METRICS) b[m] = { mean: 0, stddev: 1, n: 0 };
  return b;
}

export function loadBaselines(): Baselines {
  const p = baselinesPath();
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw) as Baselines;
    // Fill in any missing metrics so downstream can .mean/.stddev without undefined.
    for (const m of DEFAULT_METRICS) {
      if (!parsed[m]) parsed[m] = { mean: 0, stddev: 1, n: 0 };
    }
    return parsed;
  } catch {
    const b = emptyBaselines();
    saveBaselines(b);
    return b;
  }
}

export function saveBaselines(b: Baselines): void {
  const p = baselinesPath();
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(p, JSON.stringify(b, null, 2));
}

function meanStd(xs: number[]): { mean: number; stddev: number; n: number } {
  const n = xs.length;
  if (n === 0) return { mean: 0, stddev: 1, n: 0 };
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  if (n === 1) return { mean, stddev: Math.max(1, Math.abs(mean) * 0.1), n };
  const variance =
    xs.reduce((a, x) => a + (x - mean) * (x - mean), 0) / (n - 1);
  const stddev = Math.max(1e-6, Math.sqrt(variance));
  return { mean, stddev, n };
}

/**
 * Reduce spans into the metric vectors each baseline needs. Per-call metrics
 * (tokens, latency) use one sample per llm_call; per-trace metrics (turn_count,
 * tool_call_count) use one sample per distinct trace_id; judge_score comes from
 * judge spans (0-1 → 0-100 scale for display consistency with the tile).
 */
function metricsFromSpans(spans: Span[]): Record<string, number[]> {
  const out: Record<string, number[]> = {
    turn_count: [],
    output_tokens: [],
    input_tokens: [],
    cache_read_tokens: [],
    latency_ms: [],
    tool_call_count: [],
    judge_score: [],
  };

  // Per-trace aggregation containers.
  const perTrace: Record<
    string,
    { turns: number; toolCalls: number }
  > = {};

  for (const s of spans) {
    const trace = (perTrace[s.trace_id] ??= { turns: 0, toolCalls: 0 });
    if (s.kind === 'llm_call') {
      const a = s.attrs ?? {};
      if (typeof a.output_tokens === 'number')
        out.output_tokens.push(a.output_tokens);
      if (typeof a.input_tokens === 'number')
        out.input_tokens.push(a.input_tokens);
      if (typeof a.cache_read_tokens === 'number')
        out.cache_read_tokens.push(a.cache_read_tokens);
      out.latency_ms.push(s.latency_ms);
      if (typeof a.turns_this_trace === 'number') {
        trace.turns = Math.max(trace.turns, a.turns_this_trace);
      } else {
        trace.turns += 1;
      }
    }
    if (s.kind === 'tool_call') {
      trace.toolCalls += 1;
    }
    if (s.kind === 'judge') {
      const score = s.attrs?.['judge.score'];
      if (typeof score === 'number') {
        // store as percentage so the tile/baseline share a single scale
        out.judge_score.push(score * 100);
      }
    }
  }

  for (const t of Object.values(perTrace)) {
    out.turn_count.push(t.turns);
    out.tool_call_count.push(t.toolCalls);
  }

  return out;
}

export async function seedFromRecentSpans(n = 50): Promise<Baselines> {
  // n is interpreted as "look at up to the last ~60 minutes but only keep the
  // most recent n samples per metric". For a hackathon this is honest enough.
  const spans = await recentSpans(60);
  const vectors = metricsFromSpans(spans);
  const b = emptyBaselines();
  for (const [metric, xs] of Object.entries(vectors)) {
    const keep = xs.slice(-n);
    b[metric] = meanStd(keep);
  }
  saveBaselines(b);
  return b;
}
