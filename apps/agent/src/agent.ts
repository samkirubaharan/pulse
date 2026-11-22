import Anthropic from '@anthropic-ai/sdk';
import {
  startTrace,
  createSpan,
  flushSpans,
} from '@pulse/telemetry';
import { retrieve } from './retrieval';
import { runTool, TOOL_SCHEMAS } from './tools';
import { HEALTHY_PROMPT, NERFED_PROMPT } from './prompts';
import { judgeResponse } from './judge';

export type SystemPromptMode = 'healthy' | 'nerfed';

export interface AgentOptions {
  systemPromptMode?: SystemPromptMode;
}

export interface AgentResponse {
  trace_id: string;
  response: string;
  turns: number;
  spans_emitted: number;
}

const DEFAULT_AGENT_MODEL = 'claude-haiku-4-5';
const MAX_TURNS = 5;

// Rough price points for Haiku 4.5 (USD per 1M tokens). These are placeholder
// estimates — the dashboard only needs a consistent cost_usd signal.
// TODO: confirm exact Haiku 4.5 list price when finalising demo numbers.
const PRICE_IN_PER_MTOK = 1.0;    // $/1M input tokens (estimate)
const PRICE_OUT_PER_MTOK = 5.0;   // $/1M output tokens (estimate)
const PRICE_CACHE_READ_PER_MTOK = 0.1; // $/1M cached read tokens (estimate)

function estimateCost(
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
): number {
  const cost =
    (inputTokens * PRICE_IN_PER_MTOK) / 1_000_000 +
    (outputTokens * PRICE_OUT_PER_MTOK) / 1_000_000 +
    (cacheReadTokens * PRICE_CACHE_READ_PER_MTOK) / 1_000_000;
  // Round to 6 decimals — plenty for per-call cost tiles.
  return Math.round(cost * 1_000_000) / 1_000_000;
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

/**
 * Format retrieved docs into a readable context block that we inject as a
 * user-visible preamble for the LLM. Scores are kept so the model can weigh
 * them, and so the judge span sees them.
 */
function formatContext(
  hits: Array<{ doc_id: string; score: number; text: string }>,
): string {
  if (hits.length === 0) return '(no documents retrieved)';
  return hits
    .map(
      (h, i) =>
        `[${i + 1}] ${h.doc_id} (score=${h.score.toFixed(3)})\n${h.text.trim()}`,
    )
    .join('\n\n---\n\n');
}

export async function handleQuery(
  query: string,
  opts: AgentOptions = {},
): Promise<AgentResponse> {
  const mode: SystemPromptMode = opts.systemPromptMode ?? 'healthy';
  const systemPrompt = mode === 'nerfed' ? NERFED_PROMPT : HEALTHY_PROMPT;
  const model = process.env.AGENT_MODEL || DEFAULT_AGENT_MODEL;

  // --- 1. Start trace -------------------------------------------------------
  const trace_id = startTrace();

  // --- 2. Retrieval span ----------------------------------------------------
  const retrievalSpan = createSpan('retrieval', {
    'user.query': query,
    topK: 4,
  });
  let hits: Array<{ doc_id: string; score: number; text: string }> = [];
  try {
    hits = await retrieve(query, 4);
  } catch (err: any) {
    // Even if retrieval breaks we still want a span and we still want to try
    // calling the model so the demo doesn't dead-end.
    retrievalSpan.finish({
      error: err?.message ?? String(err),
      'retrieval.hits': [],
      nearest_doc: null,
      nearest_score: 0,
    });
  }
  if (hits.length > 0) {
    retrievalSpan.finish({
      'retrieval.hits': hits.map((h) => ({
        doc_id: h.doc_id,
        score: h.score,
      })),
      nearest_doc: hits[0].doc_id,
      nearest_score: hits[0].score,
    });
  } else {
    // Guard against double-finish from the catch block above.
    try {
      retrievalSpan.finish({
        'retrieval.hits': [],
        nearest_doc: null,
        nearest_score: 0,
      });
    } catch {
      // finish is idempotent in practice (it just pushes a span); this catch
      // exists only to protect against future SDK changes.
    }
  }

  const contextBlock = formatContext(hits);
  const nearestDoc = hits[0]?.doc_id ?? null;
  const nearestScore = hits[0]?.score ?? 0;

  // --- 3. Agent loop --------------------------------------------------------
  const messages: any[] = [
    {
      role: 'user',
      content: `User query:\n${query}\n\nRetrieved context:\n${contextBlock}`,
    },
  ];

  let turns = 0;
  let toolCallsInTrace = 0;
  let finalText = '';

  while (turns < MAX_TURNS) {
    turns += 1;

    const llmSpan = createSpan('llm_call', {
      model,
      turns_this_trace: turns,
      'tool.count_this_trace': toolCallsInTrace,
      system_prompt_mode: mode,
    });

    let res: any;
    try {
      res = await getClient().messages.create({
        model,
        max_tokens: 1024,
        system: systemPrompt,
        tools: TOOL_SCHEMAS as any,
        messages,
      });
    } catch (err: any) {
      llmSpan.finish({
        error: err?.message ?? String(err),
        input_tokens: 0,
        output_tokens: 0,
        cache_read_tokens: 0,
        cost_usd: 0,
      });
      // Bail out gracefully — surface the error as the response text.
      finalText = `(agent error: ${err?.message ?? String(err)})`;
      break;
    }

    const usage = res.usage ?? {};
    const inputTokens = usage.input_tokens ?? 0;
    const outputTokens = usage.output_tokens ?? 0;
    const cacheReadTokens =
      usage.cache_read_input_tokens ?? usage.cache_read_tokens ?? 0;
    const cost = estimateCost(inputTokens, outputTokens, cacheReadTokens);

    llmSpan.finish({
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_read_tokens: cacheReadTokens,
      cost_usd: cost,
      stop_reason: res.stop_reason,
      nearest_doc: nearestDoc,
      nearest_score: nearestScore,
    });

    // Append assistant message so the next turn has the full tool-use context.
    messages.push({ role: 'assistant', content: res.content });

    const toolUses = (res.content ?? []).filter(
      (b: any) => b.type === 'tool_use',
    );
    const textBlocks = (res.content ?? []).filter(
      (b: any) => b.type === 'text',
    );

    if (toolUses.length === 0 || res.stop_reason === 'end_turn') {
      // Final answer — collect text and exit loop.
      finalText = textBlocks.map((b: any) => b.text).join('\n').trim();
      break;
    }

    // Execute each tool_use block and build the tool_result user message.
    const toolResults: any[] = [];
    for (const tu of toolUses) {
      toolCallsInTrace += 1;
      const toolSpan = createSpan('tool_call', {
        'tool.name': tu.name,
        'tool.input': tu.input,
        'tool.count_this_trace': toolCallsInTrace,
        turns_this_trace: turns,
      });
      let result: unknown;
      try {
        result = runTool(tu.name, tu.input ?? {});
      } catch (err: any) {
        result = { error: err?.message ?? String(err) };
      }
      toolSpan.finish({ 'tool.result': result });

      toolResults.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: JSON.stringify(result),
      });
    }

    messages.push({ role: 'user', content: toolResults });

    // Loop back for next model turn.
  }

  if (!finalText) {
    finalText = '(agent exceeded max turns without producing a final answer)';
  }

  // --- 4. Fire-and-forget judge --------------------------------------------
  // Do not await — the judge span will flush on the next flushSpans() if it
  // completes in time; otherwise the dashboard picks it up on a later tick.
  // We swallow errors so an unhandled promise rejection can't take down the
  // simulator.
  void judgeResponse(query, contextBlock, finalText).catch((err) => {
    // eslint-disable-next-line no-console
    console.warn('[agent] judge failed', err);
  });

  // --- 5. Flush spans -------------------------------------------------------
  // We count spans emitted *before* flush because flushSpans drains the queue.
  // Retrieval + llm_call(s) + tool_call(s). Judge is async and flushed later.
  const spansEmitted = 1 + turns + toolCallsInTrace;

  await flushSpans();

  return {
    trace_id,
    response: finalText,
    turns,
    spans_emitted: spansEmitted,
  };
}
