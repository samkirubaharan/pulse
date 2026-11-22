import Anthropic from '@anthropic-ai/sdk';
import { createSpan } from '@pulse/telemetry';

const DEFAULT_JUDGE_MODEL = 'claude-sonnet-4-6';

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

export interface JudgeResult {
  score: number;      // 0..1
  rationale: string;  // one sentence
}

/**
 * Judge an agent response against the retrieved context. Emits a `judge` span.
 * Callers in the agent typically fire-and-forget this (do not await).
 */
export async function judgeResponse(
  query: string,
  context: string,
  response: string,
): Promise<JudgeResult> {
  const model = process.env.JUDGE_MODEL || DEFAULT_JUDGE_MODEL;

  const span = createSpan('judge', {
    model,
    'user.query': query,
    'response.text': response,
  });

  const systemPrompt = `You are a grounding judge. Given a user query, the retrieved context the agent had access to, and the agent's response, score how well the response is grounded in the retrieved context on a scale of 0 to 1 (1 = fully grounded, 0 = unsupported or contradicted). Reply as strict JSON on a single line: {"score": <0..1>, "rationale": "<one sentence>"}`;

  const userMsg = `USER QUERY:\n${query}\n\nRETRIEVED CONTEXT:\n${context}\n\nAGENT RESPONSE:\n${response}\n\nReturn only the JSON object.`;

  let score = 0;
  let rationale = '';

  try {
    const res = await getClient().messages.create({
      model,
      max_tokens: 200,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMsg }],
    });

    // Flatten any text blocks into a single string.
    const text = res.content
      .map((b: any) => (b.type === 'text' ? b.text : ''))
      .join('')
      .trim();

    // Judge is instructed to return a single-line JSON object. Be defensive
    // about stray prose by extracting the first {...} block.
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        score = typeof parsed.score === 'number' ? parsed.score : 0;
        rationale = typeof parsed.rationale === 'string' ? parsed.rationale : '';
      } catch {
        rationale = `judge parse error; raw="${text.slice(0, 120)}"`;
      }
    } else {
      rationale = `judge returned no JSON; raw="${text.slice(0, 120)}"`;
    }
  } catch (err: any) {
    rationale = `judge call failed: ${err?.message ?? String(err)}`;
  }

  span.finish({
    'judge.score': score,
    'judge.rationale': rationale,
  });

  return { score, rationale };
}
