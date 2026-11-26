'use client';

// AI Advisor panel — three grouped buckets of grounded suggestions:
//   Things to note        → raw signals, surfaced earlier than a human notices
//   Things to internalise → baseline rebase candidates (step-changes)
//   Things to enhance     → eval candidates, KB gaps, cost tweaks
//
// Each note cites its metric and reads like a sentence a tech lead would say
// after reading the dashboard for 30 seconds. Dismissable; dedupes on the
// server so it doesn't come back a minute later.
//
// This is where Pulse answers Priya's question: "how do observations connect
// back to the test cases you run before the next release?"

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { AdvisorKind, AdvisorNote } from '@/lib/types';

const REFRESH_MS = 15_000;

const KIND_BUCKET: Record<AdvisorKind, 'note' | 'internalise' | 'enhance'> = {
  drift_signature: 'note',
  coverage_gap: 'note',
  baseline_rebase: 'internalise',
  kb_gap: 'enhance',
  eval_candidate: 'enhance',
  cost_optimisation: 'enhance',
};

const KIND_TITLES: Record<AdvisorKind, string> = {
  drift_signature: 'Drift signature',
  coverage_gap: 'Coverage gap',
  baseline_rebase: 'Baseline rebase',
  kb_gap: 'KB gap',
  eval_candidate: 'Eval candidate',
  cost_optimisation: 'Cost signal',
};

const BUCKETS: Array<{
  key: 'note' | 'internalise' | 'enhance';
  heading: string;
  blurb: string;
  accent: string;
}> = [
  {
    key: 'note',
    heading: 'Things to note',
    blurb:
      'Signals that are moving, but haven’t yet crossed an alert threshold. Watch, don’t act.',
    accent: 'sky',
  },
  {
    key: 'internalise',
    heading: 'Things to internalise',
    blurb:
      'Step-changes that have stabilised. Candidates for baseline rebase so the detectors stop firing.',
    accent: 'indigo',
  },
  {
    key: 'enhance',
    heading: 'Things to enhance',
    blurb:
      'Close the loop. Each one is a promotable artifact — eval case, KB doc, or prompt tweak.',
    accent: 'emerald',
  },
];

const ACCENT_CLS: Record<string, string> = {
  sky: 'border-sky-200 bg-sky-50/40',
  indigo: 'border-indigo-200 bg-indigo-50/40',
  emerald: 'border-emerald-200 bg-emerald-50/40',
};

const ACCENT_CHIP: Record<string, string> = {
  sky: 'bg-sky-100 text-sky-800 ring-sky-200',
  indigo: 'bg-indigo-100 text-indigo-800 ring-indigo-200',
  emerald: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
};

export default function AdvisorPanel() {
  const [notes, setNotes] = useState<AdvisorNote[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const refresh = async () => {
    try {
      const res = await fetch('/api/advisor', { cache: 'no-store' });
      if (!res.ok) return;
      const body = (await res.json()) as AdvisorNote[];
      setNotes(body);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  const buckets = useMemo(() => {
    const out: Record<'note' | 'internalise' | 'enhance', AdvisorNote[]> = {
      note: [],
      internalise: [],
      enhance: [],
    };
    for (const n of notes ?? []) {
      if (n.status && n.status !== 'open') continue;
      out[KIND_BUCKET[n.kind]].push(n);
    }
    return out;
  }, [notes]);

  const dismiss = async (id: number | undefined) => {
    if (!id) return;
    setBusy(id);
    try {
      await fetch('/api/advisor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action: 'dismiss' }),
      });
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const total = (notes ?? []).filter((n) => !n.status || n.status === 'open')
    .length;

  return (
    <section
      aria-labelledby="advisor-heading"
      className="rounded-2xl border border-sky-200 bg-gradient-to-br from-sky-50/80 via-white to-white p-5 shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="relative inline-flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-60 animate-pulse-ring" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-sky-500" />
            </span>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-sky-700">
              AI Advisor
            </span>
            <span className="text-[11px] text-sky-700/70">
              grounded in observed metrics
            </span>
          </div>
          <h2
            id="advisor-heading"
            className="mt-1 text-lg font-semibold tracking-tight text-gray-900"
          >
            What to note, internalise, and enhance
          </h2>
          <p className="max-w-3xl text-sm text-gray-500">
            Three buckets. Each line cites the metric it fired on and the
            action that matches. Promote any “Enhance” into a Verify case to
            close the loop — observations → evals.
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-400">
          <span className="rounded-full bg-sky-100 px-2 py-0.5 font-medium text-sky-800 ring-1 ring-sky-200 tabular-nums">
            {total} open
          </span>
          <button
            type="button"
            onClick={refresh}
            className="rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-50"
          >
            refresh
          </button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
        {BUCKETS.map((b) => (
          <div
            key={b.key}
            className={[
              'flex flex-col rounded-xl border p-4',
              ACCENT_CLS[b.accent],
            ].join(' ')}
          >
            <div className="mb-2">
              <div
                className={[
                  'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1',
                  ACCENT_CHIP[b.accent],
                ].join(' ')}
              >
                {b.heading}
              </div>
              <p className="mt-1.5 text-[11px] leading-4 text-gray-600">
                {b.blurb}
              </p>
            </div>
            {buckets[b.key].length === 0 ? (
              <div className="rounded-md border border-dashed border-gray-200 bg-white/60 p-3 text-center text-[11px] text-gray-500">
                {notes == null ? 'reading signal…' : 'nothing to surface'}
              </div>
            ) : (
              <ul className="flex flex-col gap-2">
                {buckets[b.key].map((n) => (
                  <AdvisorCard
                    key={n.id ?? `${n.kind}-${n.title}`}
                    note={n}
                    busy={busy === n.id}
                    onDismiss={() => dismiss(n.id)}
                  />
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function AdvisorCard({
  note,
  onDismiss,
  busy,
}: {
  note: AdvisorNote;
  onDismiss: () => void;
  busy: boolean;
}) {
  const sev = note.severity ?? 'info';
  const sevCls =
    sev === 'critical'
      ? 'bg-red-50 text-red-700 ring-red-200'
      : sev === 'warn'
      ? 'bg-amber-50 text-amber-800 ring-amber-200'
      : 'bg-gray-50 text-gray-700 ring-gray-200';
  const promotable =
    note.kind === 'eval_candidate' ||
    note.kind === 'kb_gap' ||
    note.kind === 'drift_signature';
  return (
    <li className="rounded-lg border border-gray-100 bg-white p-3 shadow-[0_1px_0_rgba(0,0,0,0.02)]">
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className={[
            'inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ring-1',
            sevCls,
          ].join(' ')}
        >
          {sev}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
          {KIND_TITLES[note.kind]}
        </span>
        {note.metric_name && (
          <code className="rounded bg-gray-100 px-1 py-0.5 text-[10px] text-gray-700">
            {note.metric_name}
          </code>
        )}
      </div>
      <div className="mt-1 text-sm font-medium leading-snug text-gray-900">
        {note.title}
      </div>
      <p className="mt-1 text-xs leading-5 text-gray-600">{note.body}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
        {promotable && (
          <Link
            href={`/verify?from=advisor&kind=${note.kind}&title=${encodeURIComponent(note.title)}&body=${encodeURIComponent(note.body)}`}
            className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700 hover:bg-emerald-100"
          >
            Promote to eval →
          </Link>
        )}
        <button
          type="button"
          onClick={onDismiss}
          disabled={busy}
          className="rounded-md border border-gray-200 bg-white px-2 py-0.5 font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
        >
          {busy ? 'dismissing…' : 'dismiss'}
        </button>
      </div>
    </li>
  );
}
