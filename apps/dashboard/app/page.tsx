'use client';

// Observe surface — the demo showpiece.
//
// Layout (desktop):
//   ┌────────────── Phase indicator ────────────────┐
//   │  Hero traditional strip  (4 emerald metrics)  │ ← stays green
//   │  "What drift looks like" — 5 drift tiles       │ ← pops during drift
//   │  Semantic row — Grounding %  +  Novel-Intent  │
//
// Polls /api/stats every 5s. First paint shows skeletons that match the
// final tile shape so there's no layout jump. Once connected, if the request
// count is still zero we swap to a friendly "Waiting for spans" empty state.
import { useEffect, useMemo, useState } from 'react';
import { BarChart } from '@tremor/react';
import BandChart from '@/components/BandChart';
import Sparkline from '@/components/Sparkline';
import Tile, { type TileState } from '@/components/Tile';
import EmptyState from '@/components/EmptyState';
import TileSkeleton from '@/components/TileSkeleton';
import type { StatsResponse, TilePoint, TileStat } from '@/lib/types';

const REFRESH_MS = 5000;
const MIN_SAMPLES_FOR_BAND = 10;

// ---- Helpers ---------------------------------------------------------------

function fmt(n: number | null | undefined, digits = 0): string {
  if (n == null || Number.isNaN(n)) return '—';
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** Returns the current (last) point's value, or null if the series is empty. */
function current(stat: TileStat | undefined): number | null {
  if (!stat || stat.points.length === 0) return null;
  return stat.points[stat.points.length - 1].value;
}

/** Count out-of-band points in a series, k sigmas wide. */
function breachCount(stat: TileStat | undefined, k = 2): number {
  if (!stat || stat.band.n < MIN_SAMPLES_FOR_BAND) return 0;
  const { mean, stddev } = stat.band;
  const hi = mean + k * stddev;
  const lo = Math.max(0, mean - k * stddev);
  let c = 0;
  for (const p of stat.points) if (p.value > hi || p.value < lo) c++;
  return c;
}

/** Derive a tile's visual state from recent points vs its band. */
function stateOf(
  stat: TileStat | undefined,
  k = 2,
  tailN = 3,
): TileState {
  if (!stat) return 'muted';
  if (stat.band.n < MIN_SAMPLES_FOR_BAND) return 'muted';
  const tail = stat.points.slice(-tailN);
  if (tail.length === 0) return 'ok';
  const { mean, stddev } = stat.band;
  const hi = mean + k * stddev;
  const lo = Math.max(0, mean - k * stddev);
  const out = tail.filter((p) => p.value > hi || p.value < lo).length;
  if (out >= Math.min(2, tail.length)) return 'breach';
  if (out >= 1) return 'warn';
  return 'ok';
}

type Phase = 'awaiting' | 'seeding' | 'healthy' | 'drift' | 'novel' | 'adversarial';

function derivePhase(stats: StatsResponse | null): Phase {
  if (!stats || stats.traffic.request_count === 0) return 'awaiting';
  const ready = stats.output_tokens.band.n >= MIN_SAMPLES_FOR_BAND;
  if (!ready) return 'seeding';
  const drift = [
    stateOf(stats.output_tokens),
    stateOf(stats.tool_call_count),
    stateOf(stats.turn_count),
    stateOf(stats.input_vs_cache),
    stateOf(stats.latency_ms, 3),
  ].filter((s) => s === 'breach' || s === 'warn').length;
  if (drift >= 2) return 'drift';
  if ((stats.novel_intent?.length ?? 0) >= 3) return 'novel';
  return 'healthy';
}

const PHASE_META: Record<Phase, { label: string; dot: string; text: string; bg: string }> = {
  awaiting: {
    label: '— awaiting spans',
    dot: 'bg-gray-400',
    text: 'text-gray-600',
    bg: 'bg-gray-100 ring-gray-200',
  },
  seeding: {
    label: 'Seeding baselines',
    dot: 'bg-sky-500',
    text: 'text-sky-700',
    bg: 'bg-sky-50 ring-sky-200',
  },
  healthy: {
    label: 'Healthy',
    dot: 'bg-emerald-500',
    text: 'text-emerald-700',
    bg: 'bg-emerald-50 ring-emerald-200',
  },
  drift: {
    label: 'Change detected',
    dot: 'bg-rose-500',
    text: 'text-rose-700',
    bg: 'bg-rose-50 ring-rose-200',
  },
  novel: {
    label: 'Novel intents rising',
    dot: 'bg-violet-500',
    text: 'text-violet-700',
    bg: 'bg-violet-50 ring-violet-200',
  },
  adversarial: {
    label: 'Adversarial',
    dot: 'bg-rose-600',
    text: 'text-rose-800',
    bg: 'bg-rose-50 ring-rose-300',
  },
};

// ---- Page ------------------------------------------------------------------

export default function ObservePage() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [firstLoad, setFirstLoad] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch('/api/stats', { cache: 'no-store' });
        if (!res.ok) throw new Error(`${res.status}`);
        const body = (await res.json()) as StatsResponse;
        if (!cancelled) {
          setStats(body);
          setError(null);
          setFirstLoad(false);
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message ?? 'fetch failed');
          setFirstLoad(false);
        }
      }
    };
    tick();
    const id = setInterval(tick, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const empty = !stats || stats.traffic.request_count === 0;
  const phase = useMemo(() => derivePhase(stats), [stats]);

  return (
    <div className="flex flex-col gap-8">
      {/* ======================= Page header ========================= */}
      <PageHeader phase={phase} lastUpdated={stats ? new Date() : null} />

      {/* ======================= Hero: traditional strip ============= */}
      <HeroStrip stats={stats} firstLoad={firstLoad} />

      {error && (
        <div
          role="status"
          className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800"
        >
          <span className="font-semibold">stats fetch error:</span> {error}
        </div>
      )}

      {/* ======================= Drift tiles ========================= */}
      <section aria-labelledby="drift-heading">
        <SectionHeading
          id="drift-heading"
          eyebrow="Below the green strip"
          title="What your dashboard misses"
          subtitle="Five σ-banded signals every LLM call emits. When one moves out of band, usually several move together — that's the fingerprint."
        />

        <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
          {/* 1. Turn count per task */}
          <DriftTile
            title="Turn count"
            subtitle="Per-trace iterations with σ-band"
            factor="factor #1"
            unit="turns/trace"
            stat={stats?.turn_count}
            firstLoad={firstLoad}
            empty={empty}
          />

          {/* 2. Output tokens per call */}
          <DriftTile
            title="Output tokens"
            subtitle="Chattiness detector; cost overlay below"
            factor="factor #2"
            unit="tokens/call"
            stat={stats?.output_tokens}
            firstLoad={firstLoad}
            empty={empty}
            extra={
              stats && stats.output_cost.length > 0 ? (
                <div className="mt-3 rounded-md border border-gray-100 bg-gray-50/80 p-2">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                      $ per call
                    </span>
                    <span className="text-xs tabular-nums text-gray-700">
                      $
                      {fmt(
                        stats.output_cost[stats.output_cost.length - 1]
                          ?.value ?? 0,
                        4,
                      )}
                    </span>
                  </div>
                  <Sparkline
                    points={stats.output_cost}
                    color="#10b981"
                    fill="#10b981"
                    height={36}
                  />
                </div>
              ) : null
            }
          />

          {/* 3. Input + cache_read paired tile */}
          <DriftTile
            title="Input + cache_read tokens"
            subtitle="Paired signal — both must move together"
            factor="factor #3 · paired"
            unit="tokens/call"
            stat={stats?.input_vs_cache}
            firstLoad={firstLoad}
            empty={empty}
            paired
            companionLabel="cache_read"
          />

          {/* 4. Latency */}
          <DriftTile
            title="Latency"
            subtitle="Wider σ-band (k=3), fires after 3 consecutive breaches"
            factor="factor #4"
            unit="ms"
            k={3}
            stat={stats?.latency_ms}
            firstLoad={firstLoad}
            empty={empty}
            extraBadge={
              stats && (
                <span
                  className={[
                    'inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1',
                    stats.latency_ms.consecutive_breaches >= 3
                      ? 'bg-rose-50 text-rose-700 ring-rose-200'
                      : stats.latency_ms.consecutive_breaches > 0
                      ? 'bg-amber-50 text-amber-700 ring-amber-200'
                      : 'bg-emerald-50 text-emerald-700 ring-emerald-200',
                  ].join(' ')}
                >
                  streak {stats.latency_ms.consecutive_breaches}
                </span>
              )
            }
          />

          {/* 5. Tool calls per task + composition  (spans 2 cols on desktop) */}
          <ToolCallsTile stats={stats} firstLoad={firstLoad} empty={empty} />
        </div>
      </section>

      {/* ======================= Semantic row ======================== */}
      <section aria-labelledby="semantic-heading">
        <SectionHeading
          id="semantic-heading"
          eyebrow="Semantic add-ons"
          title="What customers actually asked"
          subtitle="It's not only your model that changes — the world shifts under you too."
        />
        <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-4">
          <GroundingTile stats={stats} firstLoad={firstLoad} empty={empty} />
          <JudgeScoreTile stats={stats} firstLoad={firstLoad} empty={empty} />
          <NovelIntentTile stats={stats} firstLoad={firstLoad} empty={empty} />
        </div>
      </section>

      <footer className="mt-2 flex items-center justify-between text-xs text-gray-400">
        <span>refreshes every 5 s · last 15 minutes of spans</span>
        <span className="tabular-nums">
          {stats
            ? `${fmt(stats.traffic.request_count)} traces observed`
            : ''}
        </span>
      </footer>
    </div>
  );
}

// ---- Page header ----------------------------------------------------------

function PageHeader({
  phase,
  lastUpdated,
}: {
  phase: Phase;
  lastUpdated: Date | null;
}) {
  const meta = PHASE_META[phase];
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">
          Observe
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          Your dashboard is green. Your LLM is slipping. Your customer already
          knows.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <span
          className={[
            'inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ring-1',
            meta.bg,
            meta.text,
          ].join(' ')}
          aria-label={`Phase: ${meta.label}`}
        >
          <span className="relative inline-flex h-2 w-2">
            <span
              className={[
                'absolute inline-flex h-full w-full rounded-full opacity-60',
                meta.dot,
                phase === 'healthy' || phase === 'drift' ? 'animate-pulse-ring' : '',
              ].join(' ')}
              aria-hidden
            />
            <span
              className={['relative inline-flex h-2 w-2 rounded-full', meta.dot].join(' ')}
              aria-hidden
            />
          </span>
          Phase · {meta.label}
        </span>
        {lastUpdated && (
          <span className="hidden text-[11px] tabular-nums text-gray-400 sm:inline">
            updated{' '}
            {lastUpdated.toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            })}
          </span>
        )}
      </div>
    </div>
  );
}

// ---- Hero top strip --------------------------------------------------------

function HeroStrip({
  stats,
  firstLoad,
}: {
  stats: StatsResponse | null;
  firstLoad: boolean;
}) {
  // Build fake flatline sparkline points so the "always green" argument has a
  // visible shape — in healthy state the lines look placidly flat.
  const flatline: TilePoint[] = useMemo(() => {
    const now = Date.now();
    return Array.from({ length: 24 }, (_, i) => ({
      t: new Date(now - (24 - i) * 30_000).toISOString(),
      value: 1 + Math.sin(i / 3) * 0.05,
    }));
  }, []);

  return (
    <section
      aria-label="Traditional dashboard strip"
      className="relative overflow-hidden rounded-2xl border border-emerald-200/70 bg-gradient-to-br from-emerald-50 via-emerald-50/70 to-white p-5 shadow-sm"
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <span className="relative inline-flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 animate-pulse-ring" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
          </span>
          <span className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
            Traditional metrics — all healthy
          </span>
        </div>
        <span className="hidden text-[11px] text-emerald-700/70 sm:inline">
          the baseline lie you're about to see broken
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
        <TopStat
          label="Uptime"
          value="100.0%"
          sub="last 15 min"
          sparkline={flatline}
          loading={firstLoad}
        />
        <TopStat
          label="p95 Latency"
          value={
            stats
              ? `${fmt(stats.traffic.p95_latency_ms)} ms`
              : '—'
          }
          sub="clipped to green"
          sparkline={flatline}
          loading={firstLoad}
        />
        <TopStat
          label="Error rate"
          value="0.0%"
          sub="HTTP 200s"
          sparkline={flatline}
          loading={firstLoad}
        />
        <TopStat
          label="Requests"
          value={stats ? fmt(stats.traffic.request_count) : '—'}
          sub="traces, last 15 m"
          sparkline={flatline}
          loading={firstLoad}
        />
      </div>
    </section>
  );
}

function TopStat({
  label,
  value,
  sub,
  sparkline,
  loading,
}: {
  label: string;
  value: string;
  sub?: string;
  sparkline?: TilePoint[];
  loading?: boolean;
}) {
  return (
    <div className="rounded-xl border border-emerald-100 bg-white/70 p-4 backdrop-blur-sm transition-all duration-150 hover:bg-white">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <div className="text-[11px] font-medium uppercase tracking-wider text-emerald-700/80">
            {label}
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-gray-900">
            {loading ? (
              <span className="shimmer inline-block h-7 w-20 rounded align-middle" />
            ) : (
              value
            )}
          </div>
          {sub && (
            <div className="mt-0.5 text-[11px] text-gray-500">{sub}</div>
          )}
        </div>
        <span
          className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 ring-1 ring-emerald-200"
          aria-label="healthy"
        >
          OK
        </span>
      </div>
      {sparkline && (
        <div className="mt-2 h-8">
          <Sparkline
            points={sparkline}
            color="#10b981"
            fill="#10b981"
            height={32}
          />
        </div>
      )}
    </div>
  );
}

// ---- Section heading ------------------------------------------------------

function SectionHeading({
  id,
  eyebrow,
  title,
  subtitle,
}: {
  id?: string;
  eyebrow?: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      {eyebrow && (
        <span className="text-[11px] font-semibold uppercase tracking-wider text-sky-600">
          {eyebrow}
        </span>
      )}
      <h2 id={id} className="text-lg font-semibold tracking-tight text-gray-900">
        {title}
      </h2>
      {subtitle && (
        <p className="max-w-2xl text-sm text-gray-500">{subtitle}</p>
      )}
    </div>
  );
}

// ---- Generic drift tile wrapper ------------------------------------------

function DriftTile({
  title,
  subtitle,
  factor,
  unit,
  stat,
  firstLoad,
  empty,
  k = 2,
  paired = false,
  companionLabel,
  extra,
  extraBadge,
  className,
}: {
  title: string;
  subtitle?: string;
  factor: string;
  unit: string;
  stat: TileStat | undefined;
  firstLoad: boolean;
  empty: boolean;
  k?: number;
  paired?: boolean;
  companionLabel?: string;
  extra?: React.ReactNode;
  extraBadge?: React.ReactNode;
  className?: string;
}) {
  const state = stateOf(stat, k);
  const breaches = breachCount(stat, k);
  const cur = current(stat);

  return (
    <Tile
      title={title}
      subtitle={subtitle}
      state={empty ? 'muted' : state}
      className={className}
      badge={
        <>
          {extraBadge}
          <span className="inline-flex items-center rounded-md bg-sky-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-700 ring-1 ring-sky-200">
            {factor}
          </span>
        </>
      }
      footer={
        stat && stat.band.n >= MIN_SAMPLES_FOR_BAND ? (
          <div className="flex flex-wrap gap-x-5 gap-y-1 tabular-nums">
            <FooterStat label="mean" value={fmt(stat.band.mean, 1)} />
            <FooterStat label="σ" value={fmt(stat.band.stddev, 2)} />
            <FooterStat
              label="breaches"
              value={fmt(breaches)}
              tone={breaches > 0 ? 'warn' : undefined}
            />
            <FooterStat label="n" value={fmt(stat.band.n)} />
          </div>
        ) : stat && stat.band.n > 0 ? (
          <span className="text-[11px] text-gray-500">
            seeding baseline — {stat.band.n}/{MIN_SAMPLES_FOR_BAND} samples
          </span>
        ) : null
      }
      srDescription={
        cur != null
          ? `${title} current value ${fmt(cur, 1)} ${unit}, ${breaches} breaches of ±${k}σ band.`
          : `${title} has no data yet.`
      }
    >
      {firstLoad ? (
        <TileSkeleton height={200} />
      ) : empty ? (
        <EmptyState height={200} />
      ) : (
        <>
          <CurrentValue value={cur} unit={unit} state={state} />
          <BandChart
            points={stat!.points}
            band={stat!.band}
            k={k}
            breach={state === 'breach'}
            primaryLabel={title.toLowerCase()}
            companionBand={paired ? stat!.companion_band : undefined}
            companionLabel={companionLabel}
            height={160}
          />
          {extra}
        </>
      )}
    </Tile>
  );
}

function CurrentValue({
  value,
  unit,
  state,
}: {
  value: number | null;
  unit: string;
  state: TileState;
}) {
  const valueColor =
    state === 'breach'
      ? 'text-rose-700'
      : state === 'warn'
      ? 'text-amber-700'
      : 'text-gray-900';
  return (
    <div className="mb-2 flex items-baseline gap-2">
      <span
        className={['text-3xl font-semibold tabular-nums leading-none', valueColor].join(
          ' ',
        )}
      >
        {fmt(value, 0)}
      </span>
      <span className="text-xs text-gray-500">{unit}</span>
    </div>
  );
}

function FooterStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'warn';
}) {
  return (
    <span className="inline-flex items-baseline gap-1 text-[11px]">
      <span className="font-medium uppercase tracking-wide text-gray-400">
        {label}
      </span>
      <span
        className={[
          'text-xs',
          tone === 'warn' ? 'font-semibold text-amber-700' : 'text-gray-700',
        ].join(' ')}
      >
        {value}
      </span>
    </span>
  );
}

// ---- Tool calls tile (count + composition) -------------------------------

function ToolCallsTile({
  stats,
  firstLoad,
  empty,
}: {
  stats: StatsResponse | null;
  firstLoad: boolean;
  empty: boolean;
}) {
  const stat = stats?.tool_call_count;
  const state = stateOf(stat);
  const breaches = breachCount(stat);
  const cur = current(stat);
  const comp = stats?.tool_composition ?? [];

  return (
    <Tile
      title="Tool calls per task"
      subtitle="σ-band on count (left) + composition over tool.name (right)"
      state={empty ? 'muted' : state}
      className="lg:col-span-2"
      badge={
        <span className="inline-flex items-center rounded-md bg-sky-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-700 ring-1 ring-sky-200">
          factor #5
        </span>
      }
      footer={
        stat && stat.band.n >= MIN_SAMPLES_FOR_BAND ? (
          <div className="flex flex-wrap gap-x-5 gap-y-1 tabular-nums">
            <FooterStat label="mean" value={fmt(stat.band.mean, 1)} />
            <FooterStat label="σ" value={fmt(stat.band.stddev, 2)} />
            <FooterStat
              label="breaches"
              value={fmt(breaches)}
              tone={breaches > 0 ? 'warn' : undefined}
            />
            <FooterStat
              label="distinct tools"
              value={fmt(comp.length)}
            />
          </div>
        ) : null
      }
      srDescription={
        cur != null
          ? `Tool calls per task, current ${fmt(cur, 1)}, ${breaches} breaches, ${comp.length} distinct tools in use.`
          : 'Tool calls per task, no data yet.'
      }
    >
      {firstLoad ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <TileSkeleton height={200} showFooter={false} />
          <TileSkeleton height={200} showFooter={false} />
        </div>
      ) : empty ? (
        <EmptyState height={200} />
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <div>
            <CurrentValue value={cur} unit="tool calls/trace" state={state} />
            <BandChart
              points={stat!.points}
              band={stat!.band}
              k={2}
              breach={state === 'breach'}
              primaryLabel="tool calls"
              height={160}
            />
          </div>
          <div>
            <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-gray-500">
              Composition
            </div>
            {comp.length === 0 ? (
              <EmptyState
                title="No tool invocations yet"
                subtitle="Composition appears once the agent uses a tool."
                command=""
                height={160}
              />
            ) : (
              <BarChart
                data={comp}
                index="name"
                categories={['count']}
                colors={['sky']}
                showLegend={false}
                yAxisWidth={30}
                className="h-44"
              />
            )}
          </div>
        </div>
      )}
    </Tile>
  );
}

// ---- Grounding % tile -----------------------------------------------------

function GroundingTile({
  stats,
  firstLoad,
  empty,
}: {
  stats: StatsResponse | null;
  firstLoad: boolean;
  empty: boolean;
}) {
  const g = stats?.grounding_pct;
  const pct = g?.current ?? 0;
  const state: TileState = empty
    ? 'muted'
    : pct >= 65
    ? 'ok'
    : pct >= 45
    ? 'warn'
    : 'breach';
  const valueColor =
    state === 'breach'
      ? 'text-rose-700'
      : state === 'warn'
      ? 'text-amber-700'
      : state === 'ok'
      ? 'text-emerald-700'
      : 'text-gray-900';
  return (
    <Tile
      title="Grounding %"
      subtitle="Derived from retrieval top-hit similarity"
      state={state}
      badge={
        <span className="inline-flex items-center rounded-md bg-violet-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700 ring-1 ring-violet-200">
          semantic
        </span>
      }
      srDescription={`Grounding ${pct} percent.`}
    >
      {firstLoad ? (
        <TileSkeleton height={160} showFooter={false} />
      ) : empty || !g ? (
        <EmptyState height={160} />
      ) : (
        <div>
          <div className="flex items-baseline gap-2">
            <span
              className={[
                'text-4xl font-semibold tabular-nums leading-none',
                valueColor,
              ].join(' ')}
            >
              {pct}
            </span>
            <span className="text-sm text-gray-500">%</span>
          </div>
          <div className="mt-3 h-20">
            <Sparkline
              points={g.series}
              color={
                state === 'breach'
                  ? '#e11d48'
                  : state === 'warn'
                  ? '#d97706'
                  : '#7c3aed'
              }
              fill={
                state === 'breach'
                  ? '#e11d48'
                  : state === 'warn'
                  ? '#d97706'
                  : '#7c3aed'
              }
              height={80}
            />
          </div>
          <div className="mt-2 text-[11px] text-gray-500">
            floor 45% · healthy ≥ 65%
          </div>
        </div>
      )}
    </Tile>
  );
}

// ---- Novel-Intent inbox ---------------------------------------------------

function NovelIntentTile({
  stats,
  firstLoad,
  empty,
}: {
  stats: StatsResponse | null;
  firstLoad: boolean;
  empty: boolean;
}) {
  const items = stats?.novel_intent ?? [];
  const state: TileState = empty ? 'muted' : items.length >= 3 ? 'warn' : 'ok';
  return (
    <Tile
      title="Novel-Intent inbox"
      subtitle="Queries whose top retrieval score fell below the grounding floor (0.45), grouped by nearest knowledge-base doc — newest first."
      state={state}
      className="lg:col-span-2"
      badge={
        <>
          {items.length > 0 && (
            <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-amber-700 ring-1 ring-amber-200">
              {items.length} new
            </span>
          )}
          <span className="inline-flex items-center rounded-md bg-violet-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700 ring-1 ring-violet-200">
            semantic
          </span>
        </>
      }
      srDescription={`${items.length} novel-intent queries in inbox.`}
    >
      {firstLoad ? (
        <TileSkeleton height={220} />
      ) : empty ? (
        <EmptyState height={220} />
      ) : items.length === 0 ? (
        <div className="flex h-44 flex-col items-center justify-center rounded-lg bg-gray-50/60 text-center">
          <div className="text-sm font-medium text-gray-700">
            Inbox clear
          </div>
          <div className="mt-1 text-xs text-gray-500">
            Every recent query grounded above the 0.45 floor.
          </div>
        </div>
      ) : (
        <ul className="max-h-72 divide-y divide-gray-100 overflow-auto rounded-md border border-gray-100">
          {items.map((q, i) => (
            <li
              key={i}
              className="flex items-start justify-between gap-3 px-3 py-2.5 transition-colors hover:bg-gray-50"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-gray-900">{q.query}</p>
                <p className="mt-0.5 text-[11px] text-gray-500">
                  nearest:{' '}
                  <span className="font-mono text-gray-600">
                    {q.nearest_doc}
                  </span>
                </p>
              </div>
              <span className="inline-flex shrink-0 items-center rounded-md bg-amber-50 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-amber-700 ring-1 ring-amber-200">
                sim {q.score.toFixed(2)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Tile>
  );
}

// ---- Judge score % tile (generation-side grounding) ----------------------

function JudgeScoreTile({
  stats,
  firstLoad,
  empty,
}: {
  stats: StatsResponse | null;
  firstLoad: boolean;
  empty: boolean;
}) {
  const j = stats?.judge_score_pct;
  const pct = j?.current ?? 0;
  const hasBand = !!j && j.band.n >= MIN_SAMPLES_FOR_BAND;
  const state: TileState = empty
    ? 'muted'
    : !hasBand || !j
    ? 'muted'
    : pct >= j.band.mean - 2 * j.band.stddev
    ? 'ok'
    : pct >= j.band.mean - 3 * j.band.stddev
    ? 'warn'
    : 'breach';
  const valueColor =
    state === 'breach'
      ? 'text-rose-700'
      : state === 'warn'
      ? 'text-amber-700'
      : state === 'ok'
      ? 'text-emerald-700'
      : 'text-gray-900';
  return (
    <Tile
      title="Judge score %"
      subtitle="Sonnet 4.6 scores answer ↔ context fidelity (generation-side)"
      state={state}
      badge={
        <span className="inline-flex items-center rounded-md bg-violet-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700 ring-1 ring-violet-200">
          semantic
        </span>
      }
      footer={
        hasBand && j ? (
          <div className="flex flex-wrap gap-x-5 gap-y-1 tabular-nums">
            <FooterStat label="mean" value={fmt(j.band.mean, 1)} />
            <FooterStat label="σ" value={fmt(j.band.stddev, 2)} />
            <FooterStat label="n" value={fmt(j.band.n)} />
          </div>
        ) : j && j.band.n > 0 ? (
          <span className="text-[11px] text-gray-500">
            seeding baseline — {j.band.n}/{MIN_SAMPLES_FOR_BAND} samples
          </span>
        ) : null
      }
      srDescription={`Judge score ${pct} percent.`}
    >
      {firstLoad ? (
        <TileSkeleton height={160} showFooter={false} />
      ) : empty || !j ? (
        <EmptyState height={160} />
      ) : (
        <div>
          <div className="flex items-baseline gap-2">
            <span
              className={[
                'text-4xl font-semibold tabular-nums leading-none',
                valueColor,
              ].join(' ')}
            >
              {pct}
            </span>
            <span className="text-sm text-gray-500">%</span>
          </div>
          <div className="mt-3 h-20">
            <Sparkline
              points={j.points}
              color={
                state === 'breach'
                  ? '#e11d48'
                  : state === 'warn'
                  ? '#d97706'
                  : '#7c3aed'
              }
              fill={
                state === 'breach'
                  ? '#e11d48'
                  : state === 'warn'
                  ? '#d97706'
                  : '#7c3aed'
              }
              height={80}
            />
          </div>
          <div className="mt-2 text-[11px] text-gray-500">
            answer ↔ context fidelity
          </div>
        </div>
      )}
    </Tile>
  );
}
