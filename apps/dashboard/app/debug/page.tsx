'use client';

// Debug surface — trace explorer index.
//
// Enterprise-grade trace list that respects the cross-cutting Flow filter.
// Not a full IDE; the alpha is still the Alert → Trace hop (behavioural
// context pinned on the existing /traces/[id] page). This index gives
// engineers a filterable way *in* without needing an alert.
//
// Sorting + filtering on the client against /api/traces (which already
// applies the flow filter server-side).

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useFlow } from '@/lib/flowClient';
import { FLOW_LABELS } from '@/lib/flows';
import type { Flow } from '@/lib/types';

const REFRESH_MS = 10_000;

interface TraceRow {
  trace_id: string;
  started_at: string;
  last_ts: string;
  span_count: number;
  total_latency_ms: number;
  llm_latency_ms: number;
  output_tokens: number;
  input_tokens: number;
  cache_read_tokens: number;
  cost_usd: number;
  turn_count: number;
  tool_call_count: number;
  judge_score: number | null;
  nearest_doc: string | null;
  nearest_score: number | null;
  user_query: string | null;
  response_text: string | null;
  retrieval_present: boolean;
  tool_names: string[];
  flow: Flow;
}

type SortKey =
  | 'time'
  | 'latency'
  | 'tokens'
  | 'judge'
  | 'grounding'
  | 'turns'
  | 'cost';

const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: 'time', label: 'Most recent' },
  { key: 'latency', label: 'Slowest' },
  { key: 'tokens', label: 'Most tokens' },
  { key: 'judge', label: 'Worst judge' },
  { key: 'grounding', label: 'Lowest grounding' },
  { key: 'turns', label: 'Most turns' },
  { key: 'cost', label: 'Most expensive' },
];

const FLOW_DOT: Record<Flow, string> = {
  all: 'bg-gray-400',
  healthy: 'bg-emerald-500',
  drift: 'bg-rose-500',
  novel: 'bg-violet-500',
  adversarial: 'bg-red-600',
  'tool-heavy': 'bg-amber-500',
};

export default function DebugPage() {
  const [flow] = useFlow();
  const [rows, setRows] = useState<TraceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortKey>('time');
  const [minutes, setMinutes] = useState(1440);

  useEffect(() => {
    let cancelled = false;
    const qs = new URLSearchParams();
    if (flow !== 'all') qs.set('flow', flow);
    qs.set('minutes', String(minutes));
    const tick = async () => {
      try {
        const res = await fetch(`/api/traces?${qs.toString()}`, {
          cache: 'no-store',
        });
        if (!res.ok) throw new Error(`${res.status}`);
        const body = (await res.json()) as TraceRow[];
        if (!cancelled) {
          setRows(body);
          setError(null);
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? 'fetch failed');
      }
    };
    tick();
    const id = setInterval(tick, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [flow, minutes]);

  const filtered = useMemo(() => {
    if (!rows) return null;
    const needle = q.trim().toLowerCase();
    let out = rows.filter((r) => {
      if (!needle) return true;
      return (
        r.trace_id.toLowerCase().includes(needle) ||
        (r.user_query ?? '').toLowerCase().includes(needle) ||
        (r.nearest_doc ?? '').toLowerCase().includes(needle)
      );
    });
    switch (sort) {
      case 'latency':
        out.sort((a, b) => b.total_latency_ms - a.total_latency_ms);
        break;
      case 'tokens':
        out.sort((a, b) => b.output_tokens - a.output_tokens);
        break;
      case 'judge':
        out.sort(
          (a, b) =>
            (a.judge_score ?? 1) - (b.judge_score ?? 1),
        );
        break;
      case 'grounding':
        out.sort(
          (a, b) =>
            (a.nearest_score ?? 1) - (b.nearest_score ?? 1),
        );
        break;
      case 'turns':
        out.sort((a, b) => b.turn_count - a.turn_count);
        break;
      case 'cost':
        out.sort((a, b) => b.cost_usd - a.cost_usd);
        break;
      case 'time':
      default:
        out.sort((a, b) => b.started_at.localeCompare(a.started_at));
    }
    return out;
  }, [rows, q, sort]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">
          Debug
          {flow !== 'all' && (
            <span className="ml-3 align-middle text-sm font-normal text-gray-500">
              · <span className="font-medium text-gray-700">{FLOW_LABELS[flow]}</span> slice
            </span>
          )}
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-gray-500">
          Trace list for the current flow filter. Sort by the signal you’re
          chasing (latency, judge, grounding); open any row to pin
          behavioural context against its baseline.
        </p>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-3">
        <label className="flex min-w-[220px] flex-1 flex-col text-xs text-gray-500">
          <span className="font-medium uppercase tracking-wide text-gray-500">
            Search
          </span>
          <input
            type="search"
            placeholder="query text, trace id, kb doc…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="mt-1 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </label>
        <label className="flex flex-col text-xs text-gray-500">
          <span className="font-medium uppercase tracking-wide text-gray-500">
            Sort by
          </span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="mt-1 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs text-gray-500">
          <span className="font-medium uppercase tracking-wide text-gray-500">
            Window
          </span>
          <select
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
            className="mt-1 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            <option value={15}>Last 15 min</option>
            <option value={60}>Last hour</option>
            <option value={360}>Last 6 hours</option>
            <option value={1440}>Last 24 hours</option>
            <option value={10080}>Last 7 days</option>
          </select>
        </label>
      </div>

      {error && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          fetch error: {error}
        </div>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr className="text-left">
              <th className="px-3 py-2 font-medium">Trace</th>
              <th className="px-3 py-2 font-medium">Flow</th>
              <th className="px-3 py-2 font-medium">Query</th>
              <th className="px-3 py-2 text-right font-medium">Latency</th>
              <th className="px-3 py-2 text-right font-medium">Turns</th>
              <th className="px-3 py-2 text-right font-medium">Tokens</th>
              <th className="px-3 py-2 text-right font-medium">Judge</th>
              <th className="px-3 py-2 text-right font-medium">Grounding</th>
              <th className="px-3 py-2 text-right font-medium">Cost</th>
            </tr>
          </thead>
          <tbody>
            {rows == null ? (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-gray-500">
                  loading…
                </td>
              </tr>
            ) : (filtered?.length ?? 0) === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-gray-500">
                  No traces match the current filter.
                </td>
              </tr>
            ) : (
              filtered!.map((r) => <Row key={r.trace_id} row={r} />)
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between text-xs text-gray-400">
        <span>refreshes every 10 s</span>
        <span className="tabular-nums">
          {filtered?.length ?? 0} of {rows?.length ?? 0} traces shown
        </span>
      </div>
    </div>
  );
}

function Row({ row: r }: { row: TraceRow }) {
  const judgePct = r.judge_score != null ? Math.round(r.judge_score * 100) : null;
  const groundPct =
    r.nearest_score != null ? Math.round(r.nearest_score * 100) : null;
  const judgeTone =
    judgePct == null
      ? 'text-gray-400'
      : judgePct >= 80
      ? 'text-emerald-700'
      : judgePct >= 50
      ? 'text-amber-700'
      : 'text-rose-700';
  const groundTone =
    groundPct == null
      ? 'text-gray-400'
      : groundPct >= 65
      ? 'text-emerald-700'
      : groundPct >= 45
      ? 'text-amber-700'
      : 'text-rose-700';
  return (
    <tr className="border-t border-gray-100 hover:bg-gray-50/70">
      <td className="px-3 py-2">
        <Link
          href={`/traces/${r.trace_id}`}
          className="font-mono text-xs text-sky-700 hover:underline"
        >
          {r.trace_id.slice(0, 10)}…
        </Link>
        <div className="mt-0.5 text-[10px] text-gray-400 tabular-nums">
          {new Date(r.started_at).toLocaleString(undefined, {
            hour: '2-digit',
            minute: '2-digit',
            month: 'short',
            day: '2-digit',
          })}
        </div>
      </td>
      <td className="px-3 py-2">
        <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-700">
          <span
            className={[
              'inline-block h-1.5 w-1.5 rounded-full',
              FLOW_DOT[r.flow],
            ].join(' ')}
            aria-hidden
          />
          {r.flow}
        </span>
      </td>
      <td className="px-3 py-2 max-w-[360px]">
        <div className="truncate text-sm text-gray-800">
          {r.user_query ?? <span className="text-gray-400">—</span>}
        </div>
        {r.nearest_doc && (
          <div className="mt-0.5 truncate text-[10px] text-gray-500">
            nearest:{' '}
            <code className="text-gray-600">{r.nearest_doc}</code>
          </div>
        )}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {formatMs(r.total_latency_ms)}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">{r.turn_count}</td>
      <td className="px-3 py-2 text-right tabular-nums">
        <div>{r.output_tokens}</div>
        <div className="text-[10px] text-gray-400">out / in {r.input_tokens}</div>
      </td>
      <td className={`px-3 py-2 text-right tabular-nums ${judgeTone}`}>
        {judgePct != null ? `${judgePct}%` : '—'}
      </td>
      <td className={`px-3 py-2 text-right tabular-nums ${groundTone}`}>
        {groundPct != null ? `${groundPct}%` : '—'}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {r.cost_usd > 0 ? `$${r.cost_usd.toFixed(4)}` : '—'}
      </td>
    </tr>
  );
}

function formatMs(ms: number): string {
  if (!Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}
