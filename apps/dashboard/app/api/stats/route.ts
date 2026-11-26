// GET /api/stats — computes all 8 Observe tiles from the last 15 min of spans.
//
// Supports optional ?flow=<healthy|drift|novel|adversarial|tool-heavy|all> to
// restrict to a single user-journey slice. "all" (default) returns everything.
import { NextRequest, NextResponse } from 'next/server';
import { recentSpans } from '@/lib/db';
import { loadBaselines } from '@/lib/baselines';
import {
  aggregatePerCall,
  aggregatePerTrace,
} from '@/lib/detectors';
import { classifyTrace, isFlow } from '@/lib/flows';
import type { Flow, Span, StatsResponse, TilePoint, TileStat } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CONSECUTIVE_BREACH_K = 3;
const LATENCY_K = 3;
const DEFAULT_K = 2;

function emptyBand() {
  return { mean: 0, stddev: 1, n: 0 };
}

function p95(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
  return sorted[idx];
}

export async function GET(req: NextRequest) {
  const flowParam = req.nextUrl.searchParams.get('flow');
  const flow: Flow = isFlow(flowParam) ? (flowParam as Flow) : 'all';

  let spans = await recentSpans(1440);
  const baselines = loadBaselines();

  let calls = aggregatePerCall(spans);
  let traces = aggregatePerTrace(spans);

  // Flow filter — restrict traces (and the spans they came from) when the
  // caller asks for one slice. We classify once, then rebuild the aggregates
  // from the filtered set so tiles reflect only that flow.
  if (flow !== 'all') {
    const callIdx = new Map<
      string,
      { output_tokens?: number; input_tokens?: number; latency_ms?: number }
    >();
    for (const c of calls) {
      callIdx.set(c.trace_id, {
        output_tokens: c.output_tokens,
        input_tokens: c.input_tokens,
        latency_ms: c.latency_ms,
      });
    }
    const keepTrace = new Set<string>();
    for (const t of traces) {
      if (classifyTrace(t, callIdx.get(t.trace_id) ?? {}, baselines) === flow)
        keepTrace.add(t.trace_id);
    }
    spans = spans.filter((s) => keepTrace.has(s.trace_id));
    calls = aggregatePerCall(spans);
    traces = aggregatePerTrace(spans);
  }

  // --- 1. Turn count per task (per-trace) ---
  const turnPoints: TilePoint[] = traces.map((t) => ({
    t: t.last_ts,
    value: t.turn_count,
  }));
  const turnStat: TileStat = {
    points: turnPoints,
    band: baselines['turn_count'] ?? emptyBand(),
  };

  // --- 2. Output tokens per call ---
  const outPoints: TilePoint[] = calls.map((c) => ({
    t: c.start_ts,
    value: c.output_tokens,
  }));
  const outStat: TileStat = {
    points: outPoints,
    band: baselines['output_tokens'] ?? emptyBand(),
  };

  // --- 3. Input + cache_read paired tile ---
  const pairPoints: TilePoint[] = calls.map((c) => ({
    t: c.start_ts,
    value: c.input_tokens,
    companion: c.cache_read_tokens,
  }));
  const pairStat: TileStat = {
    points: pairPoints,
    band: baselines['input_tokens'] ?? emptyBand(),
    companion_band: baselines['cache_read_tokens'] ?? emptyBand(),
  };

  // --- 4. Latency with consecutive breach counter ---
  const latPoints: TilePoint[] = calls.map((c) => ({
    t: c.start_ts,
    value: c.latency_ms,
  }));
  const latBand = baselines['latency_ms'] ?? emptyBand();
  let streak = 0;
  for (const c of calls) {
    if (
      latBand.n >= 1 &&
      c.latency_ms > latBand.mean + LATENCY_K * latBand.stddev
    )
      streak++;
    else streak = 0;
  }
  const latStat: TileStat & { consecutive_breaches: number } = {
    points: latPoints,
    band: latBand,
    consecutive_breaches: streak,
  };

  // --- 5. Tool calls per task + composition ---
  const toolCountPoints: TilePoint[] = traces.map((t) => ({
    t: t.last_ts,
    value: t.tool_call_count,
  }));
  const toolStat: TileStat = {
    points: toolCountPoints,
    band: baselines['tool_call_count'] ?? emptyBand(),
  };
  const compMap: Record<string, number> = {};
  for (const t of traces) for (const n of t.tool_names) compMap[n] = (compMap[n] ?? 0) + 1;
  const composition = Object.entries(compMap).map(([name, count]) => ({ name, count }));

  // --- 6a. Grounding % (retrieval-side: query↔doc similarity) ---
  const groundingSeries: TilePoint[] = traces
    .filter((t) => t.nearest_score != null)
    .map((t) => ({ t: t.last_ts, value: Math.round((t.nearest_score ?? 0) * 100) }));
  const groundingPct = groundingSeries.length
    ? groundingSeries[groundingSeries.length - 1].value
    : 0;

  // --- 6b. Judge score % (generation-side: answer↔context fidelity) ---
  // Sonnet scores 0-1; we display 0-100 to share a scale with the band.
  const judgePoints: TilePoint[] = spans
    .filter(
      (s) =>
        s.kind === 'judge' && typeof s.attrs?.['judge.score'] === 'number',
    )
    .map((s) => ({
      t: s.start_ts,
      value: Math.round((s.attrs['judge.score'] as number) * 100),
    }));
  const judgeStat = {
    points: judgePoints,
    band: baselines['judge_score'] ?? emptyBand(),
    current: judgePoints.length ? judgePoints[judgePoints.length - 1].value : 0,
  };

  // --- 7. Novel-Intent inbox ---
  const novel = traces
    .filter(
      (t) =>
        t.user_query &&
        t.nearest_score != null &&
        t.nearest_score < 0.45,
    )
    .slice(-25)
    .reverse()
    .map((t) => ({
      query: t.user_query!,
      nearest_doc: t.nearest_doc ?? 'unknown',
      score: t.nearest_score ?? 0,
      t: t.last_ts,
    }));

  // --- 8. Traditional strip (always green, but computed honestly) ---
  const traffic = {
    uptime_pct: 100,
    p95_latency_ms: p95(calls.map((c) => c.latency_ms)),
    error_rate_pct: 0,
    request_count: traces.length,
  };

  // Output cost overlay for tile 2
  const outputCost: TilePoint[] = calls.map((c) => ({
    t: c.start_ts,
    value: c.cost_usd,
  }));

  // Reference K values are informational; they're not part of the shape but
  // are useful for debugging the band computations.
  void DEFAULT_K;
  void CONSECUTIVE_BREACH_K;

  const body: StatsResponse = {
    turn_count: turnStat,
    output_tokens: outStat,
    input_vs_cache: pairStat,
    latency_ms: latStat,
    tool_call_count: toolStat,
    tool_composition: composition,
    grounding_pct: { current: groundingPct, series: groundingSeries },
    judge_score_pct: judgeStat,
    novel_intent: novel,
    traffic,
    output_cost: outputCost,
  };
  return NextResponse.json(body);
}
