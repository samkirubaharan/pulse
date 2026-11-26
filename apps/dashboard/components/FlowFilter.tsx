'use client';

// FlowFilter — the cross-cutting user-journey selector. Sits above every
// surface (Observe / Alerts / Debug / Verify). Writes to ?flow=<flow> on the
// URL so copying a filtered view link survives.
//
// Counts come from /api/flows; chips stay visible with 0 so the user never
// has to guess which journeys exist.
import { useEffect, useState } from 'react';
import type { Flow, FlowSummary } from '@/lib/types';
import { useFlow } from '@/lib/flowClient';
import { FLOW_DESCRIPTIONS, FLOW_LABELS, FLOW_ORDER } from '@/lib/flows';

const REFRESH_MS = 10_000;

const FLOW_TONE: Record<Flow, { active: string; dot: string }> = {
  all: {
    active: 'bg-gray-900 text-white ring-gray-900',
    dot: 'bg-gray-400',
  },
  healthy: {
    active: 'bg-emerald-600 text-white ring-emerald-600',
    dot: 'bg-emerald-500',
  },
  drift: {
    active: 'bg-rose-600 text-white ring-rose-600',
    dot: 'bg-rose-500',
  },
  novel: {
    active: 'bg-violet-600 text-white ring-violet-600',
    dot: 'bg-violet-500',
  },
  adversarial: {
    active: 'bg-red-700 text-white ring-red-700',
    dot: 'bg-red-600',
  },
  'tool-heavy': {
    active: 'bg-amber-600 text-white ring-amber-600',
    dot: 'bg-amber-500',
  },
};

export default function FlowFilter() {
  const [flow, setFlow] = useFlow();
  const [summaries, setSummaries] = useState<FlowSummary[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch('/api/flows', { cache: 'no-store' });
        if (!res.ok) return;
        const body = (await res.json()) as FlowSummary[];
        if (!cancelled) setSummaries(body);
      } catch {
        // tolerate; filter still works
      }
    };
    tick();
    const id = setInterval(tick, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const byFlow: Record<Flow, FlowSummary | undefined> = {
    all: undefined,
    healthy: undefined,
    drift: undefined,
    novel: undefined,
    adversarial: undefined,
    'tool-heavy': undefined,
  };
  for (const s of summaries ?? []) byFlow[s.flow] = s;

  const current = byFlow[flow];

  return (
    <section
      aria-label="Flow filter"
      className="rounded-xl border border-gray-200 bg-white p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-2 flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
            User journey
          </span>
          <span className="text-[11px] text-gray-400">
            (filter every surface)
          </span>
        </div>
        {FLOW_ORDER.map((f) => {
          const active = flow === f;
          const s = byFlow[f];
          const tone = FLOW_TONE[f];
          return (
            <button
              type="button"
              key={f}
              onClick={() => setFlow(f)}
              aria-pressed={active}
              title={FLOW_DESCRIPTIONS[f]}
              className={[
                'inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ring-1 transition',
                active
                  ? tone.active
                  : 'bg-white text-gray-700 ring-gray-200 hover:bg-gray-50',
              ].join(' ')}
            >
              <span
                className={[
                  'inline-block h-1.5 w-1.5 rounded-full',
                  active ? 'bg-white/80' : tone.dot,
                ].join(' ')}
                aria-hidden
              />
              <span>{FLOW_LABELS[f]}</span>
              {s && (
                <span
                  className={[
                    'inline-flex min-w-[1.5rem] justify-center rounded-full px-1.5 text-[10px] tabular-nums',
                    active ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-600',
                  ].join(' ')}
                >
                  {s.trace_count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {current && current.flow !== 'all' && (
        <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-gray-100 pt-2 text-[11px] text-gray-500">
          <span className="italic text-gray-500">
            {FLOW_DESCRIPTIONS[current.flow]}
          </span>
          <span className="tabular-nums">
            traces: <b className="text-gray-700">{current.trace_count}</b>
          </span>
          {current.mean_judge_score != null && (
            <span className="tabular-nums">
              judge: <b className="text-gray-700">{current.mean_judge_score}%</b>
            </span>
          )}
          {current.mean_grounding != null && (
            <span className="tabular-nums">
              grounding:{' '}
              <b className="text-gray-700">{current.mean_grounding}%</b>
            </span>
          )}
          <span className="tabular-nums">
            alerts: <b className="text-gray-700">{current.alert_count}</b>
          </span>
        </div>
      )}
    </section>
  );
}
