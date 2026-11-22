'use client';

// Debug surface — the Alert → Trace hop.
//
// Not a full IDE. The alpha is the *behavioural context* pinned next to the
// trace: baseline mean±σ vs this trace's values for turns / output_tokens /
// latency / grounding. Engineers see *why this trace was pulled* without
// leaving the page.
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Card,
  Title,
  Text,
  Badge,
} from '@tremor/react';
import type { Span, StatsResponse } from '@/lib/types';

interface TraceResponse {
  trace: { id: string; started_at: string | null };
  spans: Span[];
}

// Color per span kind — matches DESIGN.md §Debug view:
//   retrieval=indigo, tool_call=amber, llm_call=sky, judge=emerald
const KIND_COLOR: Record<
  Span['kind'],
  'indigo' | 'amber' | 'sky' | 'emerald'
> = {
  retrieval: 'indigo',
  tool_call: 'amber',
  llm_call: 'sky',
  judge: 'emerald',
};

const KIND_BAR_RGB: Record<Span['kind'], string> = {
  retrieval: '#6366f1',
  tool_call: '#f59e0b',
  llm_call: '#0284c7',
  judge: '#10b981',
};

export default function TracePage({ params }: { params: { id: string } }) {
  const [data, setData] = useState<TraceResponse | null>(null);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Load trace + stats in parallel. Stats powers the behavioural-context
        // panel (we read baselines straight off the Observe endpoint rather
        // than re-querying the DB). Stats failure degrades gracefully — the
        // trace still renders.
        const [traceRes, statsRes] = await Promise.all([
          fetch(`/api/traces/${params.id}`, { cache: 'no-store' }),
          fetch('/api/stats', { cache: 'no-store' }).catch(() => null),
        ]);
        if (!traceRes.ok) throw new Error(`${traceRes.status}`);
        const body = (await traceRes.json()) as TraceResponse;
        if (!cancelled) setData(body);
        if (statsRes && statsRes.ok) {
          const sbody = (await statsRes.json()) as StatsResponse;
          if (!cancelled) setStats(sbody);
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? 'fetch failed');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  const traceSummary = useMemo(
    () => (data ? summariseTrace(data) : null),
    [data],
  );

  if (error) {
    return (
      <div className="flex flex-col gap-3">
        <BackLink />
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          failed to load trace: {error}
        </div>
      </div>
    );
  }
  if (!data || !traceSummary) {
    return (
      <div className="flex flex-col gap-3">
        <BackLink />
        <div className="text-sm text-gray-500">Loading trace…</div>
      </div>
    );
  }
  if (data.spans.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <BackLink />
        <Card>
          <Title>Trace {params.id}</Title>
          <Text>No spans recorded for this trace.</Text>
        </Card>
      </div>
    );
  }

  const traceStart = data.trace.started_at
    ? new Date(data.trace.started_at).getTime()
    : new Date(data.spans[0].start_ts).getTime();

  return (
    <div className="flex flex-col gap-4">
      {/* Back link — always visible, no query-param detection. */}
      <div className="flex items-center justify-between">
        <BackLink />
        <div className="text-xs text-gray-400">
          trace <code className="text-gray-500">{params.id}</code>
        </div>
      </div>

      {/* ---- Summary block ---------------------------------------------- */}
      <SummaryBlock summary={traceSummary} traceStart={traceStart} />

      {/* ---- Two-column: timeline + sticky behavioural context ---------- */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* Left column: query/response, judge, timeline */}
        <div className="flex min-w-0 flex-col gap-4">
          <QueryResponseCard summary={traceSummary} />
          <TimelineCard
            spans={data.spans}
            traceStart={traceStart}
            totalMs={traceSummary.totalMs}
          />
        </div>

        {/* Right column: sticky behavioural context panel */}
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <BehaviouralContextPanel
            summary={traceSummary}
            stats={stats}
          />
        </aside>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function BackLink() {
  return (
    <Link
      href="/alerts"
      className="inline-flex items-center gap-1 self-start rounded-md border border-sky-200 bg-sky-50 px-3 py-1.5 text-sm font-medium text-sky-700 hover:bg-sky-100"
    >
      <span aria-hidden>←</span>
      Back to alerts
    </Link>
  );
}

// --- Summary block ----------------------------------------------------------

interface TraceSummary {
  traceId: string;
  startedAt: number;
  totalMs: number;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
  judgeScore: number | null;
  judgeRationale: string | null;
  userQuery: string | null;
  responseText: string | null;
  topRetrievalScore: number | null;
  model: string | null;
}

function summariseTrace(data: TraceResponse): TraceSummary {
  const spans = data.spans;
  const start = data.trace.started_at
    ? new Date(data.trace.started_at).getTime()
    : new Date(spans[0].start_ts).getTime();
  const end = spans.reduce(
    (acc, s) => Math.max(acc, new Date(s.end_ts).getTime()),
    start,
  );

  const llm = spans.find((s) => s.kind === 'llm_call');
  const judge = spans.find((s) => s.kind === 'judge');

  let input = 0;
  let output = 0;
  let cache = 0;
  let cost = 0;
  let model: string | null = null;
  for (const s of spans) {
    if (s.kind !== 'llm_call') continue;
    input += Number(s.attrs?.input_tokens ?? 0);
    output += Number(s.attrs?.output_tokens ?? 0);
    cache += Number(s.attrs?.cache_read_tokens ?? 0);
    cost += Number(s.attrs?.cost_usd ?? 0);
    model = model ?? (s.attrs?.model as string | undefined) ?? null;
  }

  // turns_this_trace is stamped on any span; fall back to counting llm_calls.
  const turns =
    Number(
      spans.find((s) => s.attrs?.turns_this_trace != null)?.attrs
        ?.turns_this_trace,
    ) || spans.filter((s) => s.kind === 'llm_call').length;

  const judgeScore =
    (judge?.attrs?.['judge.score'] as number | undefined) ??
    (judge?.attrs?.score as number | undefined) ??
    null;
  const judgeRationale =
    (judge?.attrs?.['judge.rationale'] as string | undefined) ?? null;

  const userQuery =
    (llm?.attrs?.['user.query'] as string | undefined) ??
    (spans.find((s) => s.attrs?.['user.query'])?.attrs?.['user.query'] as
      | string
      | undefined) ??
    null;
  const responseText =
    (llm?.attrs?.['response.text'] as string | undefined) ??
    (spans.find((s) => s.attrs?.['response.text'])?.attrs?.['response.text'] as
      | string
      | undefined) ??
    null;

  // Top retrieval similarity — mapped to "grounding" for the context panel.
  let topRetrieval: number | null = null;
  for (const s of spans) {
    if (s.kind !== 'retrieval') continue;
    const hits = s.attrs?.['retrieval.hits'] as
      | Array<{ doc_id?: string; score?: number }>
      | undefined;
    const score = hits?.[0]?.score;
    if (typeof score === 'number')
      topRetrieval = Math.max(topRetrieval ?? 0, score);
  }

  return {
    traceId: data.trace.id,
    startedAt: start,
    totalMs: Math.max(1, end - start),
    turns,
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: cache,
    costUsd: cost,
    judgeScore: judgeScore != null ? Number(judgeScore) : null,
    judgeRationale,
    userQuery,
    responseText,
    topRetrievalScore: topRetrieval,
    model,
  };
}

function SummaryBlock({
  summary,
  traceStart,
}: {
  summary: TraceSummary;
  traceStart: number;
}) {
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Title>Trace {summary.traceId.slice(0, 8)}…</Title>
          <Text>
            started {new Date(traceStart).toLocaleString()} ·{' '}
            {summary.model ?? 'model —'}
          </Text>
        </div>
        {summary.judgeScore != null && (
          <Badge
            color={
              summary.judgeScore >= 0.8
                ? 'emerald'
                : summary.judgeScore >= 0.5
                ? 'amber'
                : 'red'
            }
          >
            judge {summary.judgeScore.toFixed(2)}
          </Badge>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-6">
        <Stat label="Total latency" value={`${formatMs(summary.totalMs)}`} />
        <Stat label="Turns" value={String(summary.turns)} />
        <Stat label="Input tokens" value={formatInt(summary.inputTokens)} />
        <Stat label="Output tokens" value={formatInt(summary.outputTokens)} />
        <Stat label="Cache reads" value={formatInt(summary.cacheReadTokens)} />
        <Stat
          label="Cost est."
          value={summary.costUsd > 0 ? `$${summary.costUsd.toFixed(4)}` : '—'}
        />
      </div>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-gray-500">
        {label}
      </div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums text-gray-900">
        {value}
      </div>
    </div>
  );
}

// --- Query / Response card --------------------------------------------------

function QueryResponseCard({ summary }: { summary: TraceSummary }) {
  return (
    <Card>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            User query
          </div>
          <div className="mt-1.5 rounded-md bg-sky-50 px-3 py-2 text-sm text-gray-900">
            {summary.userQuery ?? (
              <span className="text-gray-400">—</span>
            )}
          </div>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Final response
          </div>
          <div className="mt-1.5 max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-900">
            {summary.responseText ?? (
              <span className="text-gray-400">—</span>
            )}
          </div>
        </div>
      </div>
      {summary.judgeRationale && (
        <blockquote className="mt-4 border-l-4 border-emerald-300 bg-emerald-50/50 px-4 py-2 text-sm italic text-emerald-900">
          <span className="not-italic text-xs font-semibold uppercase tracking-wide text-emerald-700">
            Judge rationale ·{' '}
          </span>
          {summary.judgeRationale}
        </blockquote>
      )}
    </Card>
  );
}

// --- Timeline --------------------------------------------------------------

function TimelineCard({
  spans,
  traceStart,
  totalMs,
}: {
  spans: Span[];
  traceStart: number;
  totalMs: number;
}) {
  return (
    <Card>
      <div className="flex items-center justify-between">
        <Title>Timeline</Title>
        <div className="flex flex-wrap items-center gap-3 text-[10px] text-gray-500">
          {(Object.keys(KIND_BAR_RGB) as Span['kind'][]).map((k) => (
            <span key={k} className="inline-flex items-center gap-1">
              <span
                className="inline-block h-2 w-3 rounded-sm"
                style={{ backgroundColor: KIND_BAR_RGB[k] }}
                aria-hidden
              />
              {k}
            </span>
          ))}
        </div>
      </div>
      <Text>Duration bars are proportional to total trace length ({formatMs(totalMs)}).</Text>

      <div className="mt-4 flex flex-col gap-2">
        {spans.map((s) => {
          const offset = Math.max(
            0,
            new Date(s.start_ts).getTime() - traceStart,
          );
          const leftPct = (offset / totalMs) * 100;
          const widthPct = Math.max(1, (s.latency_ms / totalMs) * 100);
          return (
            <div
              key={s.span_id}
              className="rounded-md border border-gray-100 p-3 hover:bg-gray-50"
            >
              <div className="flex flex-wrap items-center gap-3">
                <div className="w-20 shrink-0 text-right text-xs tabular-nums text-gray-500">
                  +{formatMs(offset)}
                </div>
                <div className="w-24 shrink-0">
                  <Badge color={KIND_COLOR[s.kind]}>{s.kind}</Badge>
                </div>
                <div className="min-w-0 flex-1 text-sm font-medium text-gray-900">
                  {summariseSpan(s)}
                </div>
                <div className="w-20 shrink-0 text-right text-xs tabular-nums text-gray-500">
                  {formatMs(s.latency_ms)}
                </div>
              </div>

              {/* Proportional duration bar */}
              <div className="relative mt-2 h-2 rounded-full bg-gray-100">
                <div
                  className="absolute h-2 rounded-full"
                  style={{
                    left: `${leftPct}%`,
                    width: `${widthPct}%`,
                    backgroundColor: KIND_BAR_RGB[s.kind],
                  }}
                  aria-label={`${s.kind} span, ${formatMs(s.latency_ms)}`}
                />
              </div>

              {/* Kind-specific detail */}
              <SpanDetail span={s} />
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function summariseSpan(s: Span): string {
  if (s.kind === 'retrieval') {
    const hits = s.attrs?.['retrieval.hits'] as
      | Array<{ doc_id?: string; score?: number }>
      | undefined;
    const top = hits?.[0];
    return top
      ? `retrieval → ${top.doc_id} (sim ${(top.score ?? 0).toFixed(2)})`
      : 'retrieval';
  }
  if (s.kind === 'tool_call') {
    return `tool_call → ${s.attrs?.['tool.name'] ?? 'unknown'}`;
  }
  if (s.kind === 'llm_call') {
    const model = s.attrs?.model ?? 'unknown';
    const inp = s.attrs?.input_tokens ?? '?';
    const out = s.attrs?.output_tokens ?? '?';
    return `llm_call → ${model} · in=${inp} out=${out}`;
  }
  if (s.kind === 'judge') {
    const score = s.attrs?.['judge.score'] ?? s.attrs?.score ?? 0;
    return `judge → score ${Number(score).toFixed(2)}`;
  }
  return s.kind;
}

// --- Per-kind detail -------------------------------------------------------

function SpanDetail({ span: s }: { span: Span }) {
  if (s.kind === 'retrieval') return <RetrievalDetail span={s} />;
  if (s.kind === 'tool_call') return <ToolCallDetail span={s} />;
  if (s.kind === 'llm_call') return <LLMCallDetail span={s} />;
  return null;
}

function RetrievalDetail({ span: s }: { span: Span }) {
  const hits = (s.attrs?.['retrieval.hits'] as
    | Array<{ doc_id?: string; score?: number }>
    | undefined) ?? [];
  if (hits.length === 0) return null;
  const maxScore = Math.max(...hits.map((h) => h.score ?? 0), 1);
  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer text-indigo-600 hover:text-indigo-800">
        top hits ({hits.length})
      </summary>
      <div className="mt-2 flex flex-col gap-1">
        {hits.map((h, i) => (
          <div key={i} className="flex items-center gap-2">
            <code className="w-48 shrink-0 truncate text-[11px] text-gray-700">
              {h.doc_id ?? '—'}
            </code>
            <div className="relative h-2 flex-1 rounded-full bg-gray-100">
              <div
                className="absolute h-2 rounded-full bg-indigo-400"
                style={{
                  width: `${((h.score ?? 0) / maxScore) * 100}%`,
                }}
                aria-label={`similarity ${(h.score ?? 0).toFixed(2)}`}
              />
            </div>
            <span className="w-12 shrink-0 text-right tabular-nums text-gray-500">
              {(h.score ?? 0).toFixed(2)}
            </span>
          </div>
        ))}
      </div>
    </details>
  );
}

function ToolCallDetail({ span: s }: { span: Span }) {
  const name = s.attrs?.['tool.name'] as string | undefined;
  const args = s.attrs?.['tool.args'] ?? s.attrs?.args;
  const result =
    s.attrs?.['tool.result'] ?? s.attrs?.result ?? s.attrs?.['tool.output'];
  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer text-amber-700 hover:text-amber-900">
        {name ? `${name} args / result` : 'args / result'}
      </summary>
      <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-gray-500">args</div>
          <pre className="mt-1 overflow-auto rounded bg-gray-50 p-2 text-[11px] text-gray-800">
{args == null ? '—' : typeof args === 'string' ? args : JSON.stringify(args, null, 2)}
          </pre>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-gray-500">
            result (snippet)
          </div>
          <pre className="mt-1 max-h-32 overflow-auto rounded bg-gray-50 p-2 text-[11px] text-gray-800">
{result == null ? '—' : truncate(typeof result === 'string' ? result : JSON.stringify(result, null, 2), 400)}
          </pre>
        </div>
      </div>
    </details>
  );
}

function LLMCallDetail({ span: s }: { span: Span }) {
  const model = s.attrs?.model as string | undefined;
  const inTok = s.attrs?.input_tokens as number | undefined;
  const outTok = s.attrs?.output_tokens as number | undefined;
  const cacheTok = s.attrs?.cache_read_tokens as number | undefined;
  const cost = s.attrs?.cost_usd as number | undefined;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-600">
      <span>
        model <code className="text-gray-800">{model ?? '—'}</code>
      </span>
      <span>
        in <span className="tabular-nums text-gray-800">{inTok ?? '—'}</span>
      </span>
      <span>
        out <span className="tabular-nums text-gray-800">{outTok ?? '—'}</span>
      </span>
      <span>
        cache_read{' '}
        <span className="tabular-nums text-gray-800">{cacheTok ?? '—'}</span>
      </span>
      <span>
        cost{' '}
        <span className="tabular-nums text-gray-800">
          {cost != null ? `$${cost.toFixed(4)}` : '—'}
        </span>
      </span>
      <span>
        latency <span className="tabular-nums text-gray-800">{formatMs(s.latency_ms)}</span>
      </span>
    </div>
  );
}

// --- Behavioural context panel ---------------------------------------------

interface BandRow {
  label: string;
  value: number | null;
  mean: number | null;
  stddev: number | null;
  k: number;
  format: (v: number) => string;
  invertBreach?: boolean; // for grounding, low = bad
}

function BehaviouralContextPanel({
  summary,
  stats,
}: {
  summary: TraceSummary;
  stats: StatsResponse | null;
}) {
  const rows: BandRow[] = useMemo(() => {
    const groundingThisTrace =
      summary.topRetrievalScore != null
        ? Math.round(summary.topRetrievalScore * 100)
        : null;
    const groundingBaseline = stats?.grounding_pct.series ?? [];
    // Baseline mean for grounding derived from the recent Observe series —
    // /api/stats doesn't publish a band for grounding directly.
    // TODO(api): expose grounding_pct.band so we don't have to derive this
    // on the client.
    const gmean =
      groundingBaseline.length > 0
        ? groundingBaseline.reduce((a, b) => a + b.value, 0) /
          groundingBaseline.length
        : null;
    const gstd =
      groundingBaseline.length > 1
        ? Math.sqrt(
            groundingBaseline.reduce(
              (a, b) => a + Math.pow(b.value - (gmean ?? 0), 2),
              0,
            ) / groundingBaseline.length,
          )
        : null;

    return [
      {
        label: 'Turns',
        value: summary.turns,
        mean: stats?.turn_count.band.mean ?? null,
        stddev: stats?.turn_count.band.stddev ?? null,
        k: 2,
        format: (v) => v.toFixed(0),
      },
      {
        label: 'Output tokens',
        value: summary.outputTokens || null,
        mean: stats?.output_tokens.band.mean ?? null,
        stddev: stats?.output_tokens.band.stddev ?? null,
        k: 2,
        format: (v) => v.toFixed(0),
      },
      {
        label: 'Latency',
        value: summary.totalMs,
        mean: stats?.latency_ms.band.mean ?? null,
        stddev: stats?.latency_ms.band.stddev ?? null,
        k: 3,
        format: (v) => formatMs(v),
      },
      {
        label: 'Grounding %',
        value: groundingThisTrace,
        mean: gmean,
        stddev: gstd,
        k: 2,
        format: (v) => `${v.toFixed(0)}%`,
        invertBreach: true,
      },
    ];
  }, [summary, stats]);

  return (
    <Card>
      <div className="flex items-center justify-between">
        <Title className="text-base">Behavioural context</Title>
        <Badge color="sky">this trace vs baseline</Badge>
      </div>
      <Text className="text-xs">
        Why this trace was pulled. Each row compares the trace against its
        σ-band baseline.
      </Text>

      <div className="mt-3 flex flex-col divide-y divide-gray-100">
        {rows.map((r) => (
          <BandRowView key={r.label} row={r} />
        ))}
      </div>

      {summary.judgeScore != null && (
        <div className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-900 ring-1 ring-emerald-200">
          Judge score for this trace:{' '}
          <span className="font-semibold tabular-nums">
            {summary.judgeScore.toFixed(2)}
          </span>
        </div>
      )}

      {!stats && (
        <div className="mt-3 rounded-md bg-gray-50 px-3 py-2 text-[11px] text-gray-500">
          baselines unavailable — Observe stats endpoint did not respond
        </div>
      )}
    </Card>
  );
}

function BandRowView({ row }: { row: BandRow }) {
  const hasBand = row.mean != null && row.stddev != null && row.stddev > 0;
  const hasValue = row.value != null && Number.isFinite(row.value);
  let breach = false;
  if (hasBand && hasValue) {
    const high = row.mean! + row.k * row.stddev!;
    const low = row.mean! - row.k * row.stddev!;
    breach = row.invertBreach
      ? row.value! < low
      : row.value! > high || row.value! < low;
  }

  // Position of the current value within the band for the visual marker.
  let markerPct: number | null = null;
  if (hasBand && hasValue) {
    const span = Math.max(
      row.k * row.stddev! * 2.5,
      Math.abs(row.value! - row.mean!) * 1.1,
      1,
    );
    const lo = row.mean! - span / 2;
    markerPct = Math.min(
      100,
      Math.max(0, ((row.value! - lo) / span) * 100),
    );
  }

  const bandLeftPct =
    hasBand && markerPct != null
      ? Math.max(
          0,
          markerPct - (((row.k * row.stddev!) / Math.max(1, row.stddev! * 2.5 * row.k)) * 50),
        )
      : null;
  const bandWidthPct =
    hasBand && markerPct != null
      ? Math.min(
          100,
          (((row.k * row.stddev!) * 2) /
            Math.max(1, row.stddev! * 2.5 * row.k)) *
            50,
        )
      : null;

  return (
    <div className="py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-gray-700">{row.label}</span>
        {hasValue ? (
          <Badge color={breach ? 'red' : 'emerald'}>
            {breach ? 'BREACH' : 'OK'}
          </Badge>
        ) : (
          <Badge color="gray">—</Badge>
        )}
      </div>

      <div className="mt-1.5 flex items-baseline justify-between gap-2 text-[11px] text-gray-500">
        <span>
          this:{' '}
          <span className="text-sm font-semibold tabular-nums text-gray-900">
            {hasValue ? row.format(row.value!) : '—'}
          </span>
        </span>
        <span className="tabular-nums">
          {hasBand
            ? `baseline μ ${row.format(row.mean!)} ± σ ${row.format(row.stddev!)}`
            : 'no baseline yet'}
        </span>
      </div>

      {/* Visual band + marker */}
      {hasBand && hasValue && (
        <div className="relative mt-2 h-2 rounded-full bg-gray-100">
          {bandWidthPct != null && bandLeftPct != null && (
            <div
              className="absolute h-2 rounded-full bg-sky-200/70"
              style={{ left: `${bandLeftPct}%`, width: `${bandWidthPct}%` }}
              aria-hidden
            />
          )}
          <div
            className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white ${
              breach ? 'bg-red-500' : 'bg-emerald-500'
            }`}
            style={{ left: `${markerPct}%` }}
            aria-label={`this trace: ${row.format(row.value!)}`}
          />
        </div>
      )}
    </div>
  );
}

// --- Formatters -------------------------------------------------------------

function formatMs(ms: number): string {
  if (!Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function formatInt(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n)}…`;
}
