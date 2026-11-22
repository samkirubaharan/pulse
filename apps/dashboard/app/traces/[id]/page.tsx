'use client';

// Debug surface — vertical timeline of all spans in one trace. Shows the full
// user query, response, and judge score at the top. "Back to alert" link
// visible when ?from=alert is in the URL.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Card,
  Title,
  Text,
  Badge,
} from '@tremor/react';
import type { Span } from '@/lib/types';

interface TraceResponse {
  trace: { id: string; started_at: string | null };
  spans: Span[];
}

const KIND_COLOR: Record<Span['kind'], 'blue' | 'violet' | 'indigo' | 'emerald'> =
  {
    retrieval: 'violet',
    tool_call: 'indigo',
    llm_call: 'blue',
    judge: 'emerald',
  };

export default function TracePage({ params }: { params: { id: string } }) {
  const [data, setData] = useState<TraceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fromAlert, setFromAlert] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const p = new URLSearchParams(window.location.search);
      setFromAlert(p.get('from') === 'alert');
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/traces/${params.id}`, {
          cache: 'no-store',
        });
        if (!res.ok) throw new Error(`${res.status}`);
        const body = (await res.json()) as TraceResponse;
        if (!cancelled) setData(body);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? 'fetch failed');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  if (error) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
        failed to load trace: {error}
      </div>
    );
  }
  if (!data) return <div className="text-sm text-gray-500">Loading trace…</div>;
  if (data.spans.length === 0) {
    return (
      <Card>
        <Title>Trace {params.id}</Title>
        <Text>No spans recorded for this trace.</Text>
      </Card>
    );
  }

  const start = data.trace.started_at
    ? new Date(data.trace.started_at).getTime()
    : new Date(data.spans[0].start_ts).getTime();

  // Try to extract the human-readable header fields.
  const llm = data.spans.find((s) => s.kind === 'llm_call');
  const judge = data.spans.find((s) => s.kind === 'judge');
  const userQuery = (llm?.attrs?.['user.query'] as string | undefined) ?? null;
  const responseText =
    (llm?.attrs?.['response.text'] as string | undefined) ?? null;
  const judgeScore =
    judge && judge.attrs
      ? (judge.attrs['judge.score'] ?? judge.attrs.score)
      : null;
  const judgeRationale =
    (judge?.attrs?.['judge.rationale'] as string | undefined) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <Title>Trace {params.id.slice(0, 8)}…</Title>
          <Text>
            {data.spans.length} spans ·{' '}
            {new Date(start).toLocaleString()}
          </Text>
        </div>
        {fromAlert && (
          <Link
            href="/alerts"
            className="rounded border border-gray-200 px-3 py-1.5 text-sm text-blue-700 hover:bg-blue-50"
          >
            ← Back to alert
          </Link>
        )}
      </div>

      {/* Query / Response / Judge header */}
      <Card>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <Text>User query</Text>
            <div className="mt-1 text-sm text-gray-900">
              {userQuery ?? <span className="text-gray-400">—</span>}
            </div>
          </div>
          <div>
            <Text>Response</Text>
            <div className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-sm text-gray-900">
              {responseText ?? <span className="text-gray-400">—</span>}
            </div>
          </div>
          <div>
            <Text>Judge</Text>
            <div className="mt-1 flex items-center gap-2">
              {judgeScore != null ? (
                <Badge color="emerald">score {Number(judgeScore).toFixed(2)}</Badge>
              ) : (
                <span className="text-sm text-gray-400">—</span>
              )}
            </div>
            {judgeRationale && (
              <div className="mt-2 text-xs italic text-gray-600">
                {judgeRationale}
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* Timeline */}
      <Card>
        <Title>Timeline</Title>
        <div className="mt-4 flex flex-col gap-2">
          {data.spans.map((s) => {
            const offset =
              new Date(s.start_ts).getTime() - start;
            return (
              <div
                key={s.span_id}
                className="flex items-start gap-3 rounded-md border border-gray-100 p-3 hover:bg-gray-50"
              >
                <div className="w-20 shrink-0 text-right text-xs tabular-nums text-gray-500">
                  +{offset} ms
                </div>
                <div className="w-24 shrink-0">
                  <Badge color={KIND_COLOR[s.kind]}>{s.kind}</Badge>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-gray-900">
                    {summariseSpan(s)}
                  </div>
                  <div className="mt-0.5 text-xs text-gray-500">
                    duration {s.latency_ms} ms ·{' '}
                    span <code className="text-gray-400">{s.span_id.slice(0, 8)}</code>
                  </div>
                  <AttrsPreview attrs={s.attrs} />
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function summariseSpan(s: Span): string {
  if (s.kind === 'retrieval') {
    const hits = s.attrs?.['retrieval.hits'] as
      | Array<{ doc_id?: string; score?: number }>
      | undefined;
    const top = hits?.[0];
    return top
      ? `retrieval → ${top.doc_id} (score ${(top.score ?? 0).toFixed(2)})`
      : 'retrieval';
  }
  if (s.kind === 'tool_call') {
    return `tool_call → ${s.attrs?.['tool.name'] ?? 'unknown'}`;
  }
  if (s.kind === 'llm_call') {
    return `llm_call → ${s.attrs?.model ?? 'unknown'} · in=${s.attrs?.input_tokens ?? '?'} out=${s.attrs?.output_tokens ?? '?'}`;
  }
  if (s.kind === 'judge') {
    return `judge → score ${(s.attrs?.['judge.score'] ?? s.attrs?.score ?? 0).toString()}`;
  }
  return s.kind;
}

function AttrsPreview({ attrs }: { attrs: Record<string, any> }) {
  const keys = Object.keys(attrs).filter(
    (k) => !['user.query', 'response.text'].includes(k),
  );
  if (keys.length === 0) return null;
  return (
    <details className="mt-1 text-xs text-gray-600">
      <summary className="cursor-pointer text-gray-500">attrs</summary>
      <pre className="mt-1 overflow-auto rounded bg-gray-50 p-2 text-[11px]">
        {JSON.stringify(attrs, null, 2)}
      </pre>
    </details>
  );
}
