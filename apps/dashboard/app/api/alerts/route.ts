// GET /api/alerts — current alert inbox, newest first.
//
// Query params:
//   ?flow=<flow>          filter alerts to traces in this flow
//   ?status=open|acked|resolved|all     default = all
//   ?minutes=<n>          lookback window
//
import { NextRequest, NextResponse } from 'next/server';
import { recentAlerts, recentSpans } from '@/lib/db';
import { loadBaselines } from '@/lib/baselines';
import { aggregatePerCall, aggregatePerTrace } from '@/lib/detectors';
import { classifyTrace, isFlow } from '@/lib/flows';
import type { Flow } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const flowParam = req.nextUrl.searchParams.get('flow');
  const flow: Flow = isFlow(flowParam) ? (flowParam as Flow) : 'all';
  const status = req.nextUrl.searchParams.get('status') ?? 'all';
  const minutes = Number(req.nextUrl.searchParams.get('minutes') ?? 1440);

  let alerts = await recentAlerts(200);

  if (status !== 'all') {
    alerts = alerts.filter((a) => (a.status ?? 'open') === status);
  }

  if (minutes > 0) {
    const cutoff = Date.now() - minutes * 60_000;
    alerts = alerts.filter((a) => {
      if (!a.created_at) return true;
      const t = Date.parse(a.created_at);
      if (!Number.isFinite(t)) return true;
      return t >= cutoff;
    });
  }

  if (flow !== 'all') {
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
    const flowByTrace = new Map<string, Flow>();
    for (const t of traces) {
      flowByTrace.set(
        t.trace_id,
        classifyTrace(t, callIdx.get(t.trace_id) ?? {}, baselines),
      );
    }
    alerts = alerts.filter(
      (a) => a.trace_id != null && flowByTrace.get(a.trace_id) === flow,
    );
  }

  return NextResponse.json(alerts);
}
