'use client';

// Verify (V&V) — the destination for observed → tested.
//
// Pulse is observability *and* validation/verification. Observe tells you
// what's moving; Verify locks it in as a regression you can't fall for
// again. Every eval case here was promoted from an Alert, Novel-Intent
// query, or an Advisor suggestion — or typed in manually.
//
// This is the direct answer to Priya's question: observations in a live
// workflow become the cases you test *before* the next release. Export as
// JSONL and pipe into any external eval harness, or keep them here for
// the status pulse.

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import type { EvalCase, EvalPriority, EvalStatus, EvalSource } from '@/lib/types';

const REFRESH_MS = 15_000;

const STATUS_FILTERS: Array<{ k: 'all' | EvalStatus; label: string }> = [
  { k: 'all', label: 'All' },
  { k: 'draft', label: 'Draft' },
  { k: 'ready', label: 'Ready' },
  { k: 'passing', label: 'Passing' },
  { k: 'failing', label: 'Failing' },
  { k: 'archived', label: 'Archived' },
];

const SOURCE_FILTERS: Array<{ k: 'all' | EvalSource; label: string }> = [
  { k: 'all', label: 'All sources' },
  { k: 'alert', label: 'From alerts' },
  { k: 'novel_intent', label: 'Novel intents' },
  { k: 'injection', label: 'Injection' },
  { k: 'manual', label: 'Manual' },
];

const STATUS_CHIP: Record<EvalStatus, string> = {
  draft: 'bg-gray-100 text-gray-700 ring-gray-200',
  ready: 'bg-sky-50 text-sky-700 ring-sky-200',
  passing: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  failing: 'bg-rose-50 text-rose-700 ring-rose-200',
  archived: 'bg-slate-100 text-slate-500 ring-slate-200',
};

const PRIORITY_CHIP: Record<EvalPriority, string> = {
  low: 'bg-gray-50 text-gray-600 ring-gray-200',
  medium: 'bg-amber-50 text-amber-700 ring-amber-200',
  high: 'bg-red-50 text-red-700 ring-red-200',
};

const SOURCE_LABEL: Record<EvalSource, string> = {
  alert: 'Alert',
  novel_intent: 'Novel intent',
  injection: 'Injection',
  manual: 'Manual',
};

const SOURCE_CHIP: Record<EvalSource, string> = {
  alert: 'bg-rose-50 text-rose-700 ring-rose-200',
  novel_intent: 'bg-violet-50 text-violet-700 ring-violet-200',
  injection: 'bg-red-50 text-red-800 ring-red-300',
  manual: 'bg-gray-100 text-gray-700 ring-gray-200',
};

export default function VerifyPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const [evals, setEvals] = useState<EvalCase[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | EvalStatus>('all');
  const [sourceFilter, setSourceFilter] = useState<'all' | EvalSource>('all');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);

  // Pre-populate the composer from ?title=…&body=…&source=… if we were
  // routed from an Alert's "Promote to eval" or the Advisor panel.
  const prePopulated = useMemo(() => {
    const title = sp.get('title');
    const body = sp.get('body');
    const sourceParam = sp.get('source');
    const trace_id = sp.get('trace_id') ?? sp.get('traceId');
    const source_ref = sp.get('source_ref');
    const query = sp.get('user_query') ?? sp.get('query');
    const expected = sp.get('expected');
    if (!title && !body && !source_ref) return null;
    const source: EvalSource =
      sourceParam === 'alert'
        ? 'alert'
        : sourceParam === 'novel_intent'
        ? 'novel_intent'
        : sourceParam === 'injection'
        ? 'injection'
        : 'manual';
    return {
      title: title ?? body?.slice(0, 80) ?? 'Eval candidate',
      user_query: query ?? '',
      expected_behavior: expected ?? body ?? '',
      source,
      source_ref,
      trace_id,
    };
  }, [sp]);

  const refresh = async () => {
    try {
      const res = await fetch('/api/evals', { cache: 'no-store' });
      if (!res.ok) throw new Error(`${res.status}`);
      const body = (await res.json()) as EvalCase[];
      setEvals(body);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? 'fetch failed');
    }
  };

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (prePopulated) setShowForm(true);
  }, [prePopulated]);

  const filtered = useMemo(() => {
    if (!evals) return null;
    const needle = q.trim().toLowerCase();
    return evals.filter((e) => {
      if (statusFilter !== 'all' && (e.status ?? 'draft') !== statusFilter)
        return false;
      if (sourceFilter !== 'all' && e.source !== sourceFilter) return false;
      if (needle) {
        const hay = [e.title, e.user_query, e.expected_behavior ?? '']
          .join(' ')
          .toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [evals, statusFilter, sourceFilter, q]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {
      all: 0,
      draft: 0,
      ready: 0,
      passing: 0,
      failing: 0,
      archived: 0,
    };
    for (const e of evals ?? []) {
      c.all++;
      c[e.status ?? 'draft']++;
    }
    return c;
  }, [evals]);

  const sourceCounts = useMemo(() => {
    const c: Record<string, number> = {
      all: 0,
      alert: 0,
      novel_intent: 0,
      injection: 0,
      manual: 0,
    };
    for (const e of evals ?? []) {
      c.all++;
      c[e.source] = (c[e.source] ?? 0) + 1;
    }
    return c;
  }, [evals]);

  const create = async (row: Omit<EvalCase, 'id' | 'created_at'>) => {
    await fetch('/api/evals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(row),
    });
    setShowForm(false);
    // Clear the query string so refresh doesn't keep reopening the form.
    router.replace('/verify');
    await refresh();
  };

  const updateStatus = async (id: number, status: EvalStatus) => {
    setBusy(id);
    try {
      await fetch(`/api/evals/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: number) => {
    setBusy(id);
    try {
      await fetch(`/api/evals/${id}`, { method: 'DELETE' });
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">
            Verify
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-gray-500">
            Validation & verification. Each case here was promoted from an
            observation — an alert, a novel intent, or an advisor signal.
            Export to JSONL and pipe into your eval harness; or run them
            in-place and watch the status pulse.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="rounded-md border border-sky-300 bg-sky-50 px-3 py-1.5 text-sm font-medium text-sky-700 hover:bg-sky-100"
          >
            {showForm ? 'Cancel' : '+ New eval case'}
          </button>
          <a
            href="/api/evals/export?format=jsonl"
            className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Export JSONL
          </a>
          <a
            href="/api/evals/export?format=json"
            className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Export JSON
          </a>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          fetch error: {error}
        </div>
      )}

      {showForm && (
        <EvalForm
          prefill={prePopulated}
          onSubmit={create}
          onCancel={() => {
            setShowForm(false);
            router.replace('/verify');
          }}
        />
      )}

      {/* Summary strip */}
      <div className="grid grid-cols-2 gap-3 rounded-xl border border-gray-200 bg-white p-4 md:grid-cols-5">
        <SummaryStat label="Total" value={counts.all} tone="gray" />
        <SummaryStat label="Draft" value={counts.draft} tone="gray" />
        <SummaryStat label="Ready" value={counts.ready} tone="sky" />
        <SummaryStat label="Passing" value={counts.passing} tone="emerald" />
        <SummaryStat label="Failing" value={counts.failing} tone="rose" />
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-2 rounded-lg border border-gray-200 bg-white p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-16 text-xs font-medium uppercase tracking-wide text-gray-500">
            Status
          </span>
          {STATUS_FILTERS.map((s) => (
            <Chip
              key={s.k}
              active={statusFilter === s.k}
              onClick={() => setStatusFilter(s.k)}
              label={s.label}
              count={counts[s.k as string]}
            />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-16 text-xs font-medium uppercase tracking-wide text-gray-500">
            Source
          </span>
          {SOURCE_FILTERS.map((s) => (
            <Chip
              key={s.k}
              active={sourceFilter === s.k}
              onClick={() => setSourceFilter(s.k)}
              label={s.label}
              count={sourceCounts[s.k as string]}
            />
          ))}
          <span className="ml-4 w-16 text-xs font-medium uppercase tracking-wide text-gray-500">
            Search
          </span>
          <input
            type="search"
            placeholder="title, query, expected…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="flex-1 rounded-md border border-gray-200 bg-white px-3 py-1 text-sm text-gray-900 placeholder:text-gray-400"
          />
        </div>
      </div>

      {/* List */}
      {evals == null ? (
        <div className="text-sm text-gray-500">Loading eval cases…</div>
      ) : filtered?.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white px-6 py-10 text-center">
          <p className="text-sm text-gray-600">
            No cases match the current filter.
          </p>
          <p className="mt-1 text-xs text-gray-500">
            {evals.length === 0
              ? 'Promote your first case from the Alerts tab or the Novel-Intent inbox on Observe.'
              : null}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {filtered!.map((e) => (
            <EvalRow
              key={e.id}
              row={e}
              busy={busy === e.id}
              onStatus={(s) => e.id && updateStatus(e.id, s)}
              onDelete={() => e.id && remove(e.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SummaryStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'gray' | 'sky' | 'emerald' | 'rose';
}) {
  const cls =
    tone === 'rose'
      ? 'text-rose-700'
      : tone === 'emerald'
      ? 'text-emerald-700'
      : tone === 'sky'
      ? 'text-sky-700'
      : 'text-gray-900';
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wider text-gray-500">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${cls}`}>
        {value}
      </div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1 transition ${
        active
          ? 'bg-sky-50 text-sky-700 ring-sky-200'
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

function EvalForm({
  prefill,
  onSubmit,
  onCancel,
}: {
  prefill:
    | {
        title: string;
        user_query: string;
        expected_behavior: string;
        source: EvalSource;
        source_ref: string | null;
        trace_id: string | null;
      }
    | null;
  onSubmit: (row: Omit<EvalCase, 'id' | 'created_at'>) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(prefill?.title ?? '');
  const [userQuery, setUserQuery] = useState(prefill?.user_query ?? '');
  const [expected, setExpected] = useState(prefill?.expected_behavior ?? '');
  const [source, setSource] = useState<EvalSource>(prefill?.source ?? 'manual');
  const [priority, setPriority] = useState<EvalPriority>('medium');
  const [tags, setTags] = useState('');

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim() || !userQuery.trim()) return;
        onSubmit({
          title: title.trim(),
          user_query: userQuery.trim(),
          expected_behavior: expected.trim() || null,
          source,
          source_ref: prefill?.source_ref ?? null,
          tags: tags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
          priority,
          trace_id: prefill?.trace_id ?? null,
        });
      }}
      className="flex flex-col gap-3 rounded-xl border border-sky-200 bg-sky-50/60 p-4"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-sky-900">
          New eval case {prefill && <span className="text-xs text-sky-700/80">(from {SOURCE_LABEL[prefill.source]})</span>}
        </h2>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-sky-700 hover:underline"
        >
          cancel
        </button>
      </div>
      <label className="flex flex-col text-xs text-gray-600">
        Title
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          className="mt-1 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-900"
        />
      </label>
      <label className="flex flex-col text-xs text-gray-600">
        User query (the exact input the agent should handle)
        <textarea
          value={userQuery}
          onChange={(e) => setUserQuery(e.target.value)}
          required
          rows={2}
          className="mt-1 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-900"
        />
      </label>
      <label className="flex flex-col text-xs text-gray-600">
        Expected behavior
        <textarea
          value={expected}
          onChange={(e) => setExpected(e.target.value)}
          rows={3}
          placeholder="What the response should look like — grounding, tone, specific facts, or a refusal."
          className="mt-1 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-900"
        />
      </label>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <label className="flex flex-col text-xs text-gray-600">
          Source
          <select
            value={source}
            onChange={(e) => setSource(e.target.value as EvalSource)}
            className="mt-1 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-900"
          >
            <option value="alert">Alert</option>
            <option value="novel_intent">Novel intent</option>
            <option value="injection">Injection</option>
            <option value="manual">Manual</option>
          </select>
        </label>
        <label className="flex flex-col text-xs text-gray-600">
          Priority
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as EvalPriority)}
            className="mt-1 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-900"
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </label>
        <label className="flex flex-col text-xs text-gray-600">
          Tags (comma-separated)
          <input
            type="text"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="drift, refund, kb-gap"
            className="mt-1 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-900"
          />
        </label>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="submit"
          className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700"
        >
          Save case
        </button>
        <span className="text-[11px] text-gray-500">
          Status starts as “draft” — promote to “ready” once reviewed.
        </span>
      </div>
    </form>
  );
}

function EvalRow({
  row,
  busy,
  onStatus,
  onDelete,
}: {
  row: EvalCase;
  busy: boolean;
  onStatus: (s: EvalStatus) => void;
  onDelete: () => void;
}) {
  const status = (row.status ?? 'draft') as EvalStatus;
  const source = row.source;
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-[0_1px_0_rgba(0,0,0,0.02)]">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={[
            'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1',
            STATUS_CHIP[status],
          ].join(' ')}
        >
          {status}
        </span>
        <span
          className={[
            'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1',
            SOURCE_CHIP[source],
          ].join(' ')}
        >
          {SOURCE_LABEL[source]}
        </span>
        {row.priority && (
          <span
            className={[
              'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1',
              PRIORITY_CHIP[row.priority],
            ].join(' ')}
          >
            {row.priority} priority
          </span>
        )}
        {(row.tags ?? []).map((t) => (
          <span
            key={t}
            className="inline-flex items-center rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600"
          >
            {t}
          </span>
        ))}
      </div>
      <div className="mt-2 text-sm font-semibold text-gray-900">{row.title}</div>
      <p className="mt-1 text-xs text-gray-500">
        <span className="font-medium text-gray-700">Query: </span>
        <code className="rounded bg-gray-50 px-1.5 py-0.5 text-gray-800">
          {row.user_query}
        </code>
      </p>
      {row.expected_behavior && (
        <p className="mt-1 text-xs text-gray-600">
          <span className="font-medium text-gray-700">Expected: </span>
          {row.expected_behavior}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {row.trace_id && (
          <Link
            href={`/traces/${row.trace_id}`}
            className="rounded-md border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700 hover:bg-sky-100"
          >
            Open source trace →
          </Link>
        )}
        <select
          value={status}
          disabled={busy}
          onChange={(e) => onStatus(e.target.value as EvalStatus)}
          className="rounded-md border border-gray-200 bg-white px-2 py-0.5 text-xs text-gray-700"
        >
          <option value="draft">draft</option>
          <option value="ready">ready</option>
          <option value="passing">passing</option>
          <option value="failing">failing</option>
          <option value="archived">archived</option>
        </select>
        <button
          type="button"
          onClick={onDelete}
          disabled={busy}
          className="rounded-md border border-gray-200 bg-white px-2 py-0.5 text-xs font-medium text-gray-600 hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
        >
          delete
        </button>
        {row.created_at && (
          <span className="ml-auto text-[10px] text-gray-400 tabular-nums">
            created {new Date(row.created_at).toLocaleString()}
          </span>
        )}
      </div>
    </div>
  );
}
