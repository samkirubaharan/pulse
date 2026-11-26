'use client';

// Alerts surface — on-call inbox.
//
// Verdict without a click. Click for proof.
//
// Enhancements:
//   - ack / resolve actions on every card (persisted via PATCH /api/alerts/[id])
//   - status, time-window, severity, detector filters
//   - grouped-by-detector view (default) or flat list
//   - bulk resolve + CSV export
//   - "Promote to eval" directly from an alert → routes to /verify

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Card, Text, Title, Badge, Metric } from '@tremor/react';
import Sparkline from '@/components/Sparkline';
import { useFlow } from '@/lib/flowClient';
import { FLOW_LABELS } from '@/lib/flows';
import type { Alert, TilePoint } from '@/lib/types';

const REFRESH_MS = 5000;

type SeverityFilter = 'all' | 'critical' | 'warn' | 'info';
type StatusFilter = 'open' | 'all' | 'acked' | 'resolved';
type ViewMode = 'grouped' | 'flat';

const DETECTOR_FILTERS = [
  'All',
  'Chattiness',
  'Cache',
  'Latency',
  'Behavioural',
  'Turn',
  'Retrieval Bypass',
  'Low-Grounding',
  'Injection',
] as const;
type DetectorFilter = (typeof DETECTOR_FILTERS)[number];

const DETECTOR_KEYWORDS: Record<Exclude<DetectorFilter, 'All'>, string[]> = {
  Chattiness: ['chatt'],
  Cache: ['cache'],
  Latency: ['latency', 'backend'],
  Behavioural: ['behav', 'composition'],
  Turn: ['turn'],
  'Retrieval Bypass': ['kb', 'bypass'],
  'Low-Grounding': ['ground', 'novel'],
  Injection: ['inject', 'prompt-inj', 'prompt_inj'],
};

function isPairedSignal(detector: string, alert: Alert): boolean {
  if (alert.companion_metric_name && alert.companion_metric_value != null)
    return true;
  return /cache/i.test(detector);
}

function severityColor(sev: Alert['severity']) {
  if (sev === 'critical') return 'red';
  if (sev === 'warn') return 'amber';
  return 'blue';
}

function severityStripe(sev: Alert['severity'], status: string): string {
  if (status === 'resolved') return 'border-l-4 border-l-emerald-500 opacity-70';
  if (status === 'acked') return 'border-l-4 border-l-slate-500 opacity-85';
  if (sev === 'critical') return 'border-l-4 border-l-red-500';
  if (sev === 'warn') return 'border-l-4 border-l-amber-500';
  return 'border-l-4 border-l-sky-500';
}

function syntheticSeries(a: Alert): TilePoint[] {
  const base = a.metric_mean ?? a.metric_value ?? 0;
  const sd = a.metric_stddev ?? Math.max(1, Math.abs(base) * 0.1);
  const now = Date.now();
  const n = 24;
  const pts: TilePoint[] = [];
  for (let i = 0; i < n; i++) {
    const noise = (Math.sin(i * 1.3) + Math.cos(i * 0.7)) * sd * 0.4;
    pts.push({
      t: new Date(now - (n - i) * 15_000).toISOString(),
      value: base + noise,
    });
  }
  if (a.metric_value != null) {
    for (let j = 0; j < 4; j++) {
      pts[pts.length - 4 + j].value =
        base + (a.metric_value - base) * ((j + 1) / 4);
    }
  }
  return pts;
}

function syntheticCompanionSeries(
  a: Alert,
  primary: TilePoint[],
): TilePoint[] | null {
  if (a.companion_metric_value == null) return null;
  const companionBase = a.companion_metric_value * 1.4;
  const n = primary.length;
  const out: TilePoint[] = [];
  for (let i = 0; i < n; i++) {
    const t = primary[i].t;
    const drift = i >= n - 4 ? (i - (n - 5)) / 4 : 0;
    const v =
      companionBase + (a.companion_metric_value - companionBase) * drift;
    out.push({ t, value: v });
  }
  return out;
}

function PulseECG({ className = '' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 16h5l2-7 4 14 3-10 2 4h10" />
    </svg>
  );
}

export default function AlertsPage() {
  const [flow] = useFlow();
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');
  const [detectorFilter, setDetectorFilter] = useState<DetectorFilter>('All');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open');
  const [minutes, setMinutes] = useState(1440);
  const [view, setView] = useState<ViewMode>('grouped');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<Record<number, 'ack' | 'resolve' | 'reopen'>>({});

  const refresh = async () => {
    try {
      const qs = new URLSearchParams();
      if (flow !== 'all') qs.set('flow', flow);
      if (statusFilter !== 'all') qs.set('status', statusFilter);
      qs.set('minutes', String(minutes));
      const res = await fetch(`/api/alerts?${qs.toString()}`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const body = (await res.json()) as Alert[];
      const sorted = [...body].sort((a, b) => {
        const ta = a.created_at ? Date.parse(a.created_at) : 0;
        const tb = b.created_at ? Date.parse(b.created_at) : 0;
        return tb - ta;
      });
      setAlerts(sorted);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? 'fetch failed');
    }
  };

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow, statusFilter, minutes]);

  const filtered = useMemo(() => {
    if (!alerts) return null;
    return alerts.filter((a) => {
      if (severityFilter !== 'all' && a.severity !== severityFilter)
        return false;
      if (detectorFilter !== 'All') {
        const kws = DETECTOR_KEYWORDS[detectorFilter];
        const hay = a.detector.toLowerCase();
        if (!kws.some((k) => hay.includes(k))) return false;
      }
      return true;
    });
  }, [alerts, severityFilter, detectorFilter]);

  const sevCounts = useMemo(() => {
    const counts = { all: 0, critical: 0, warn: 0, info: 0 } as Record<
      SeverityFilter,
      number
    >;
    for (const a of alerts ?? []) {
      counts.all++;
      counts[a.severity]++;
    }
    return counts;
  }, [alerts]);

  const grouped = useMemo(() => {
    if (!filtered) return null;
    const m = new Map<string, Alert[]>();
    for (const a of filtered) {
      const k = a.detector;
      let arr = m.get(k);
      if (!arr) {
        arr = [];
        m.set(k, arr);
      }
      arr.push(a);
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [filtered]);

  const toggleSelect = (id?: number) => {
    if (!id) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const act = async (
    a: Alert,
    action: 'ack' | 'resolve' | 'reopen',
  ) => {
    if (!a.id) return;
    setBusy((prev) => ({ ...prev, [a.id!]: action }));
    try {
      await fetch(`/api/alerts/${a.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status:
            action === 'ack' ? 'acked' : action === 'resolve' ? 'resolved' : 'open',
        }),
      });
      await refresh();
    } finally {
      setBusy((prev) => {
        const next = { ...prev };
        delete next[a.id!];
        return next;
      });
    }
  };

  const bulkResolve = async () => {
    if (selected.size === 0) return;
    await fetch('/api/alerts/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [...selected] }),
    });
    setSelected(new Set());
    await refresh();
  };

  if (alerts == null) {
    return <div className="text-sm text-gray-500">Loading alerts…</div>;
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <Title>
            Alerts
            {flow !== 'all' && (
              <span className="ml-3 text-sm font-normal text-gray-500">
                · <span className="font-medium text-gray-700">{FLOW_LABELS[flow]}</span>{' '}
                slice
              </span>
            )}
          </Title>
          <Text className="italic text-sky-700">
            Verdict without a click. Click for proof.
          </Text>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/api/alerts/export?format=csv"
            className="rounded-md border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            Export CSV
          </a>
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-sky-500" />
            </span>
            refreshes every 5s
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          fetch error: {error}
        </div>
      )}

      {/* Filter bar */}
      <div className="flex flex-col gap-2 rounded-lg border border-gray-200 bg-white p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-16 text-xs font-medium uppercase tracking-wide text-gray-500">
            Status
          </span>
          {(['open', 'acked', 'resolved', 'all'] as const).map((s) => (
            <Chip
              key={s}
              active={statusFilter === s}
              onClick={() => setStatusFilter(s)}
              tone={
                s === 'resolved' ? 'green' : s === 'acked' ? 'slate' : 'sky'
              }
              label={s[0].toUpperCase() + s.slice(1)}
            />
          ))}
          <span className="ml-4 w-16 text-xs font-medium uppercase tracking-wide text-gray-500">
            Window
          </span>
          <select
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
            className="rounded-md border border-gray-200 bg-white px-3 py-1 text-xs text-gray-700"
          >
            <option value={15}>15 min</option>
            <option value={60}>1 hour</option>
            <option value={360}>6 hours</option>
            <option value={1440}>24 hours</option>
            <option value={10080}>7 days</option>
          </select>
          <span className="ml-4 w-16 text-xs font-medium uppercase tracking-wide text-gray-500">
            View
          </span>
          <Chip
            active={view === 'grouped'}
            onClick={() => setView('grouped')}
            tone="sky"
            label="Grouped"
          />
          <Chip
            active={view === 'flat'}
            onClick={() => setView('flat')}
            tone="sky"
            label="Flat"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-16 text-xs font-medium uppercase tracking-wide text-gray-500">
            Severity
          </span>
          {(['all', 'critical', 'warn', 'info'] as const).map((s) => (
            <Chip
              key={s}
              active={severityFilter === s}
              onClick={() => setSeverityFilter(s)}
              tone={
                s === 'critical'
                  ? 'red'
                  : s === 'warn'
                  ? 'amber'
                  : s === 'info'
                  ? 'sky'
                  : 'gray'
              }
              label={`${s[0].toUpperCase()}${s.slice(1)}`}
              count={sevCounts[s]}
            />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-16 text-xs font-medium uppercase tracking-wide text-gray-500">
            Detector
          </span>
          {DETECTOR_FILTERS.map((d) => (
            <Chip
              key={d}
              active={detectorFilter === d}
              onClick={() => setDetectorFilter(d)}
              tone="sky"
              label={d}
            />
          ))}
        </div>
        {selected.size > 0 && (
          <div className="flex items-center gap-2 rounded-md bg-sky-50 px-3 py-2 ring-1 ring-sky-200">
            <span className="text-xs font-medium text-sky-800">
              {selected.size} selected
            </span>
            <button
              type="button"
              onClick={bulkResolve}
              className="rounded-md border border-sky-200 bg-white px-2 py-0.5 text-xs font-medium text-sky-700 hover:bg-sky-100"
            >
              Resolve selected
            </button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="text-xs text-sky-700/80 hover:underline"
            >
              clear
            </button>
          </div>
        )}
      </div>

      {(filtered?.length ?? 0) === 0 ? (
        <Card className="mx-auto max-w-xl">
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <div className="rounded-full bg-sky-50 p-3 text-sky-600">
              <PulseECG className="h-10 w-10" />
            </div>
            <Title>All quiet.</Title>
            <Text className="max-w-sm">
              {alerts.length === 0
                ? 'No detectors have tripped. σ-bands holding across all five signals.'
                : 'No alerts match the current filters.'}
            </Text>
            <Badge color="emerald">clean</Badge>
          </div>
        </Card>
      ) : view === 'grouped' ? (
        <div className="flex flex-col gap-5">
          {grouped!.map(([detector, items]) => (
            <section key={detector}>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-600">
                  {detector}
                  <span className="ml-2 inline-flex min-w-[1.5rem] justify-center rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] tabular-nums text-gray-600">
                    {items.length}
                  </span>
                </h3>
                <span className="text-xs text-gray-400">
                  worst: {items[0]?.severity ?? '—'}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-4">
                {items.map((a) => (
                  <AlertCard
                    key={a.id ?? `${a.detector}-${a.created_at}`}
                    alert={a}
                    selected={!!a.id && selected.has(a.id)}
                    onToggleSelect={() => toggleSelect(a.id)}
                    onAct={act}
                    busyAction={a.id ? busy[a.id] : undefined}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {filtered!.map((a) => (
            <AlertCard
              key={a.id ?? `${a.detector}-${a.created_at}`}
              alert={a}
              selected={!!a.id && selected.has(a.id)}
              onToggleSelect={() => toggleSelect(a.id)}
              onAct={act}
              busyAction={a.id ? busy[a.id] : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Chip({
  active,
  onClick,
  label,
  count,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
  tone: 'red' | 'amber' | 'sky' | 'gray' | 'green' | 'slate';
}) {
  const activeCls =
    tone === 'red'
      ? 'bg-red-50 text-red-700 ring-red-200'
      : tone === 'amber'
      ? 'bg-amber-50 text-amber-800 ring-amber-200'
      : tone === 'green'
      ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
      : tone === 'slate'
      ? 'bg-slate-100 text-slate-800 ring-slate-300'
      : tone === 'sky'
      ? 'bg-sky-50 text-sky-700 ring-sky-200'
      : 'bg-gray-100 text-gray-800 ring-gray-300';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1 transition ${
        active
          ? activeCls
          : 'bg-white text-gray-600 ring-gray-200 hover:bg-gray-50'
      }`}
    >
      <span>{label}</span>
      {count != null && (
        <span
          className={`inline-flex min-w-[1.25rem] justify-center rounded-full px-1 text-[10px] ${
            active ? 'bg-white/70' : 'bg-gray-100'
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}

function AlertCard({
  alert: a,
  selected,
  onToggleSelect,
  onAct,
  busyAction,
}: {
  alert: Alert;
  selected: boolean;
  onToggleSelect: () => void;
  onAct: (a: Alert, action: 'ack' | 'resolve' | 'reopen') => void;
  busyAction?: 'ack' | 'resolve' | 'reopen';
}) {
  const series = syntheticSeries(a);
  const companion = syntheticCompanionSeries(a, series);
  const paired = isPairedSignal(a.detector, a);

  const band =
    a.metric_mean != null && a.metric_stddev != null
      ? { mean: a.metric_mean, stddev: a.metric_stddev, n: 20 }
      : undefined;

  const mergedSeries: TilePoint[] = companion
    ? series.map((p, i) => ({ ...p, companion: companion[i]?.value }))
    : series;

  const sparkColor =
    a.severity === 'critical'
      ? '#dc2626'
      : a.severity === 'warn'
      ? '#d97706'
      : '#0284c7';

  const deltaPct =
    a.metric_value != null && a.metric_mean != null && a.metric_mean !== 0
      ? Math.round(((a.metric_value - a.metric_mean) / a.metric_mean) * 100)
      : null;

  const status = a.status ?? 'open';

  // Build eval-promotion link
  const promoteParams = new URLSearchParams({
    from: 'alert',
    title: a.headline,
    body: a.why_text ?? '',
    source: 'alert',
    source_ref: a.id ? `alert:${a.id}` : a.detector,
  });
  if (a.trace_id) promoteParams.set('trace_id', a.trace_id);

  return (
    <Card
      className={`${severityStripe(a.severity, status)} transition hover:shadow-md`}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between lg:gap-6">
        <div className="min-w-0 flex-1">
          {/* Severity + status row */}
          <div className="flex flex-wrap items-center gap-2">
            {a.id && (
              <label className="inline-flex items-center gap-1 text-[11px] text-gray-500">
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={onToggleSelect}
                  className="h-3.5 w-3.5 rounded border-gray-300 text-sky-600 focus:ring-sky-500"
                />
                <span className="sr-only">select alert</span>
              </label>
            )}
            <Badge color={severityColor(a.severity)}>
              {a.severity.toUpperCase()}
            </Badge>
            <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
              {a.detector}
            </span>
            <StatusChip status={status} />
            {paired && <Badge color="amber">paired signal</Badge>}
            {deltaPct != null && (
              <span
                className={`text-xs tabular-nums ${
                  deltaPct > 0 ? 'text-red-600' : 'text-emerald-700'
                }`}
              >
                {deltaPct > 0 ? '+' : ''}
                {deltaPct}% vs baseline
              </span>
            )}
          </div>

          <Title className="mt-1.5 leading-snug">{a.headline}</Title>

          <div className="mt-3 flex flex-col gap-1.5">
            {a.where_text && <Row label="Where" value={a.where_text} />}
            {a.why_text && (
              <Row
                label="Why"
                value={<span className="italic text-gray-600">{a.why_text}</span>}
              />
            )}
          </div>

          {a.companion_metric_name && a.companion_metric_value != null && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">
              <span className="font-medium">Companion metric:</span>
              <code className="rounded bg-white/60 px-1.5 py-0.5">
                {a.companion_metric_name}
              </code>
              <span className="tabular-nums">
                = {formatValue(a.companion_metric_value)}
              </span>
              <span className="text-amber-700">
                · both must move together to fire
              </span>
            </div>
          )}

          {a.resolution_note && (
            <div className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-900 ring-1 ring-emerald-200">
              <span className="font-medium">Resolution: </span>
              {a.resolution_note}
            </div>
          )}

          {/* Actions */}
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
            {a.trace_id ? (
              <Link
                href={`/traces/${a.trace_id}?from=alert`}
                className="inline-flex items-center gap-1 rounded-md border border-sky-200 bg-sky-50 px-2.5 py-1 font-medium text-sky-700 hover:bg-sky-100"
              >
                Open trace
                <span aria-hidden>→</span>
              </Link>
            ) : (
              <span className="text-gray-400">no trace link</span>
            )}
            <Link
              href={`/verify?${promoteParams.toString()}`}
              className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-medium text-emerald-700 hover:bg-emerald-100"
            >
              Promote to eval
            </Link>
            {status === 'open' && (
              <>
                <button
                  type="button"
                  onClick={() => onAct(a, 'ack')}
                  disabled={!!busyAction}
                  className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                >
                  {busyAction === 'ack' ? 'acking…' : 'Ack'}
                </button>
                <button
                  type="button"
                  onClick={() => onAct(a, 'resolve')}
                  disabled={!!busyAction}
                  className="rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                >
                  {busyAction === 'resolve' ? 'resolving…' : 'Resolve'}
                </button>
              </>
            )}
            {status === 'acked' && (
              <button
                type="button"
                onClick={() => onAct(a, 'resolve')}
                disabled={!!busyAction}
                className="rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
              >
                {busyAction === 'resolve' ? 'resolving…' : 'Resolve'}
              </button>
            )}
            {status !== 'open' && (
              <button
                type="button"
                onClick={() => onAct(a, 'reopen')}
                disabled={!!busyAction}
                className="rounded-md border border-gray-200 bg-white px-2.5 py-1 font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                Reopen
              </button>
            )}
            {a.created_at && (
              <span className="text-gray-400">
                · fired {formatRelative(a.created_at)}
              </span>
            )}
          </div>
        </div>

        <div className="w-full shrink-0 lg:w-72">
          <div className="flex items-baseline justify-between">
            <Text className="text-xs uppercase tracking-wide">
              {a.metric_name ?? 'metric'}
            </Text>
            {band && (
              <span className="text-[10px] tabular-nums text-gray-400">
                μ {formatValue(band.mean)} · σ {formatValue(band.stddev)}
              </span>
            )}
          </div>
          {a.metric_value != null ? (
            <Metric className="mt-0.5 text-2xl">
              {formatValue(a.metric_value)}
            </Metric>
          ) : (
            <div className="mt-0.5 text-sm text-gray-400">—</div>
          )}
          <div className="mt-2">
            <Sparkline
              points={mergedSeries}
              band={band}
              k={2}
              color={sparkColor}
              height={72}
            />
          </div>
          {paired && companion && (
            <div className="mt-1 flex items-center gap-3 text-[10px] text-gray-500">
              <LegendSwatch color={sparkColor} label={a.metric_name ?? 'primary'} />
              <LegendSwatch
                color="#f59e0b"
                label={a.companion_metric_name ?? 'companion'}
              />
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function StatusChip({ status }: { status: string }) {
  const cls =
    status === 'resolved'
      ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
      : status === 'acked'
      ? 'bg-slate-50 text-slate-700 ring-slate-300'
      : 'bg-sky-50 text-sky-700 ring-sky-200';
  return (
    <span
      className={[
        'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1',
        cls,
      ].join(' ')}
    >
      {status}
    </span>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <span className="w-14 shrink-0 text-xs font-semibold uppercase tracking-wide text-gray-500">
        {label}
      </span>
      <span className="min-w-0 flex-1 text-gray-800">{value}</span>
    </div>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className="inline-block h-0.5 w-3 rounded-full"
        style={{ backgroundColor: color }}
        aria-hidden
      />
      <span>{label}</span>
    </span>
  );
}

function formatValue(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 1000) return v.toFixed(0);
  if (abs >= 10) return v.toFixed(1);
  if (abs >= 1) return v.toFixed(2);
  return v.toFixed(3);
}

function formatRelative(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return iso;
  const dsec = Math.max(0, (Date.now() - then) / 1000);
  if (dsec < 60) return `${Math.round(dsec)}s ago`;
  if (dsec < 3600) return `${Math.round(dsec / 60)}m ago`;
  if (dsec < 86400) return `${Math.round(dsec / 3600)}h ago`;
  return new Date(then).toLocaleString();
}
