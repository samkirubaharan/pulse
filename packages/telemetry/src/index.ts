import { v4 as uuid } from 'uuid';

export type SpanKind = 'retrieval' | 'tool_call' | 'llm_call' | 'judge';

export interface Span {
  trace_id: string;
  span_id: string;
  parent_span_id: string | null;
  kind: SpanKind;
  start_ts: string;
  end_ts: string;
  latency_ms: number;
  attrs: Record<string, any>;
}

// ---- Module-level state -----------------------------------------------------
// Current active trace_id. Simple single-trace-at-a-time model is fine for the
// demo — the simulator runs queries sequentially and startTrace() resets this.
let currentTraceId: string | null = null;

// Queue of finished spans awaiting flush.
const spanQueue: Span[] = [];

// Resolve the dashboard URL lazily so late-bound env vars (e.g. dotenv loaded
// after import) are still picked up at flush time.
function dashboardUrl(): string {
  if (process.env.DASHBOARD_URL && process.env.DASHBOARD_URL.length > 0) {
    return process.env.DASHBOARD_URL;
  }
  const port = process.env.DASHBOARD_PORT ?? '3000';
  return `http://localhost:${port}`;
}

// ---- Public API -------------------------------------------------------------

/** Start a new trace. Returns the new trace_id and sets it as current. */
export function startTrace(): string {
  currentTraceId = uuid();
  return currentTraceId;
}

/**
 * Create a new span of the given kind. Returns a handle with the span_id and
 * a `finish` callback that must be invoked when the work completes.
 */
export function createSpan(
  kind: SpanKind,
  attrs: Record<string, any>,
  parent_span_id?: string | null,
): { span_id: string; finish: (moreAttrs?: Record<string, any>) => void } {
  if (!currentTraceId) {
    // Auto-start a trace if someone forgets. The demo always calls startTrace,
    // but this keeps the SDK from throwing on misuse.
    currentTraceId = uuid();
  }

  const span_id = uuid();
  const start = Date.now();
  const start_ts = new Date(start).toISOString();
  // Capture trace_id at creation time so late-starting a new trace doesn't
  // reattribute in-flight spans.
  const trace_id = currentTraceId;
  const initialAttrs = { ...attrs };

  const finish = (moreAttrs: Record<string, any> = {}): void => {
    const end = Date.now();
    const end_ts = new Date(end).toISOString();
    const span: Span = {
      trace_id,
      span_id,
      parent_span_id: parent_span_id ?? null,
      kind,
      start_ts,
      end_ts,
      latency_ms: end - start,
      attrs: { ...initialAttrs, ...moreAttrs },
    };
    spanQueue.push(span);
  };

  return { span_id, finish };
}

/**
 * POST all queued spans to the dashboard ingestion endpoint and clear the
 * queue. Fetch failures are logged and swallowed so the agent is never taken
 * down by telemetry.
 */
export async function flushSpans(): Promise<void> {
  if (spanQueue.length === 0) return;

  // Drain first so concurrent finishes during the in-flight POST don't get
  // lost (they'll land in the queue for the next flush).
  const batch = spanQueue.splice(0, spanQueue.length);

  try {
    const url = `${dashboardUrl()}/api/spans`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spans: batch }),
    });
    if (!res.ok) {
      // Log, but do not re-enqueue — a broken dashboard shouldn't balloon
      // memory in a long-running agent process.
      // eslint-disable-next-line no-console
      console.warn(
        `[telemetry] flushSpans: non-OK response ${res.status} from ${url}`,
      );
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[telemetry] flushSpans: fetch failed', err);
  }
}
