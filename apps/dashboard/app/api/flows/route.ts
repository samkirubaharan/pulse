// GET /api/flows — summarise each flow over the last 15 min of spans.
// Returns FlowSummary[] that drives the Flow filter chips' counts.
import { NextResponse } from 'next/server';
import { recentSpans, recentAlerts } from '@/lib/db';
import { loadBaselines } from '@/lib/baselines';
import { aggregatePerCall, aggregatePerTrace } from '@/lib/detectors';
import { classifyTrace, FLOW_LABELS } from '@/lib/flows';
import type { Flow, FlowSummary } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const spans = await recentSpans(1440);
  const baselines = loadBaselines();
  const calls = aggregatePerCall(spans);
  const traces = aggregatePerTrace(spans);

  const perCallIdx = new Map<string, {
    output_tokens?: number;
    input_tokens?: number;
    latency_ms?: number;
  }>();
  for (const c of calls) {
    perCallIdx.set(c.trace_id, {
      output_tokens: c.output_tokens,
      input_tokens: c.input_tokens,
      latency_ms: c.latency_ms,
    });
  }

  const counts: Record<Flow, number> = {
    all: traces.length,
    healthy: 0,
    drift: 0,
    novel: 0,
    adversarial: 0,
    'tool-heavy': 0,
  };
  const judgeByFlow: Record<Flow, number[]> = {
    all: [],
    healthy: [],
    drift: [],
    novel: [],
    adversarial: [],
    'tool-heavy': [],
  };
  const groundByFlow: Record<Flow, number[]> = {
    all: [],
    healthy: [],
    drift: [],
    novel: [],
    adversarial: [],
    'tool-heavy': [],
  };

  for (const t of traces) {
    const flow = classifyTrace(
      t,
      perCallIdx.get(t.trace_id) ?? {},
      baselines,
    );
    counts[flow] = (counts[flow] ?? 0) + 1;
    if (t.judge_score != null) {
      judgeByFlow[flow].push(t.judge_score * 100);
      judgeByFlow.all.push(t.judge_score * 100);
    }
    if (t.nearest_score != null) {
      groundByFlow[flow].push(t.nearest_score * 100);
      groundByFlow.all.push(t.nearest_score * 100);
    }
  }

  // Alert counts per flow (based on trace classification — lookup table).
  const flowByTrace = new Map<string, Flow>();
  for (const t of traces) {
    flowByTrace.set(
      t.trace_id,
      classifyTrace(t, perCallIdx.get(t.trace_id) ?? {}, baselines),
    );
  }
  const alerts = await recentAlerts(200);
  const alertCountByFlow: Record<Flow, number> = {
    all: alerts.length,
    healthy: 0,
    drift: 0,
    novel: 0,
    adversarial: 0,
    'tool-heavy': 0,
  };
  for (const a of alerts) {
    const f = a.trace_id ? flowByTrace.get(a.trace_id) : null;
    if (f) alertCountByFlow[f]++;
  }

  const summaries: FlowSummary[] = (Object.keys(counts) as Flow[]).map(
    (flow) => {
      const j = judgeByFlow[flow];
      const g = groundByFlow[flow];
      return {
        flow,
        label: FLOW_LABELS[flow],
        trace_count: counts[flow] ?? 0,
        mean_judge_score:
          j.length > 0 ? Math.round(j.reduce((a, b) => a + b, 0) / j.length) : null,
        mean_grounding:
          g.length > 0 ? Math.round(g.reduce((a, b) => a + b, 0) / g.length) : null,
        alert_count: alertCountByFlow[flow] ?? 0,
      };
    },
  );

  return NextResponse.json(summaries);
}
