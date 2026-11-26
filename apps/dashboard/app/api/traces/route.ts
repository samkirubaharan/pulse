// GET /api/traces — paginated trace summaries for the Debug tab.
//
// Query params:
//   ?flow=<flow>          filter to a specific flow
//   ?minutes=<n>          lookback window (default 1440 = 24h)
//   ?limit=<n>            cap results (default 200)
import { NextRequest, NextResponse } from 'next/server';
import { listTraces } from '@/lib/db';
import { loadBaselines } from '@/lib/baselines';
import { aggregatePerCall, aggregatePerTrace } from '@/lib/detectors';
import { classifyTrace, isFlow } from '@/lib/flows';
import { recentSpans } from '@/lib/db';
import type { Flow } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const flowParam = req.nextUrl.searchParams.get('flow');
  const flow: Flow = isFlow(flowParam) ? (flowParam as Flow) : 'all';
  const minutes = Number(req.nextUrl.searchParams.get('minutes') ?? 1440);
  const limit = Number(req.nextUrl.searchParams.get('limit') ?? 200);

  const summaries = await listTraces({ minutes, limit });

  // Classify each summary. Reuse the detectors aggregator for parity.
  const spans = await recentSpans(minutes);
  const baselines = loadBaselines();
  const calls = aggregatePerCall(spans);
  const traces = aggregatePerTrace(spans);
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
  const traceIdx = new Map(traces.map((t) => [t.trace_id, t]));

  const flagged = summaries.map((s) => {
    const t = traceIdx.get(s.trace_id);
    const f = t
      ? classifyTrace(t, callIdx.get(s.trace_id) ?? {}, baselines)
      : ('healthy' as Flow);
    return { ...s, flow: f };
  });

  const filtered =
    flow === 'all' ? flagged : flagged.filter((s) => s.flow === flow);
  return NextResponse.json(filtered);
}
