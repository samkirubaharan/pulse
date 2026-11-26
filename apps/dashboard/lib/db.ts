// Singleton DuckDB connection + idempotent schema init.
//
// We lazily open the database on first use and memoize the instance / connection
// on globalThis so that Next.js' dev-mode hot reload doesn't leak handles.
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import path from 'node:path';
import fs from 'node:fs';
import type { Span, Alert, EvalCase, AdvisorNote } from './types';

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS spans (
  trace_id TEXT,
  span_id TEXT PRIMARY KEY,
  parent_span_id TEXT,
  kind TEXT,
  start_ts TIMESTAMP,
  end_ts TIMESTAMP,
  latency_ms INTEGER,
  attrs JSON
);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY,
  detector TEXT,
  severity TEXT,
  headline TEXT,
  where_text TEXT,
  why_text TEXT,
  metric_name TEXT,
  metric_value DOUBLE,
  metric_mean DOUBLE,
  metric_stddev DOUBLE,
  companion_metric_name TEXT,
  companion_metric_value DOUBLE,
  trace_id TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  status TEXT DEFAULT 'open',
  acked_at TIMESTAMP,
  resolved_at TIMESTAMP,
  resolution_note TEXT,
  flow TEXT
);

CREATE SEQUENCE IF NOT EXISTS seq_alerts_id START 1;

CREATE TABLE IF NOT EXISTS evals (
  id INTEGER PRIMARY KEY,
  title TEXT,
  user_query TEXT,
  expected_behavior TEXT,
  source TEXT,
  source_ref TEXT,
  tags TEXT,
  priority TEXT DEFAULT 'medium',
  status TEXT DEFAULT 'draft',
  trace_id TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE SEQUENCE IF NOT EXISTS seq_evals_id START 1;

CREATE TABLE IF NOT EXISTS advisor_notes (
  id INTEGER PRIMARY KEY,
  kind TEXT,
  title TEXT,
  body TEXT,
  metric_name TEXT,
  severity TEXT,
  status TEXT DEFAULT 'open',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE SEQUENCE IF NOT EXISTS seq_advisor_id START 1;
`;

// Columns that older DBs may be missing. Applied idempotently.
const SCHEMA_UPGRADES: string[] = [
  `ALTER TABLE alerts ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'open'`,
  `ALTER TABLE alerts ADD COLUMN IF NOT EXISTS acked_at TIMESTAMP`,
  `ALTER TABLE alerts ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP`,
  `ALTER TABLE alerts ADD COLUMN IF NOT EXISTS resolution_note TEXT`,
  `ALTER TABLE alerts ADD COLUMN IF NOT EXISTS flow TEXT`,
];

interface Handle {
  instance: DuckDBInstance;
  conn: DuckDBConnection;
}

declare global {
  // eslint-disable-next-line no-var
  var __duckdbHandle: Handle | undefined;
  // eslint-disable-next-line no-var
  var __duckdbInitPromise: Promise<Handle> | undefined;
}

function dbPath(): string {
  const p = process.env.SPANS_DB_PATH ?? './data/spans.duckdb';
  // Ensure the parent directory exists so DuckDB doesn't ENOENT on a clean
  // checkout.
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return p;
}

async function init(): Promise<Handle> {
  const instance = await DuckDBInstance.create(dbPath());
  const conn = await instance.connect();
  // Run the schema statements one at a time — DuckDB's run() accepts a single
  // statement per call.
  for (const stmt of SCHEMA_SQL.split(';').map((s) => s.trim()).filter(Boolean)) {
    await conn.run(stmt);
  }
  // Non-fatal migrations for existing databases (adds columns if missing).
  for (const stmt of SCHEMA_UPGRADES) {
    try {
      await conn.run(stmt);
    } catch {
      // ignore — ADD COLUMN IF NOT EXISTS on older DuckDB versions may error.
    }
  }
  return { instance, conn };
}

export async function getDb(): Promise<Handle> {
  if (globalThis.__duckdbHandle) return globalThis.__duckdbHandle;
  if (!globalThis.__duckdbInitPromise) {
    globalThis.__duckdbInitPromise = init().then((h) => {
      globalThis.__duckdbHandle = h;
      return h;
    });
  }
  return globalThis.__duckdbInitPromise;
}

// ---- Span helpers -----------------------------------------------------------

export async function insertSpans(spans: Span[]): Promise<number> {
  if (spans.length === 0) return 0;
  const { conn } = await getDb();

  // DuckDB's node API doesn't expose prepared statements uniformly across
  // versions; we fall back to parameterised single-row inserts in a loop. For
  // a hackathon volume (tens-to-hundreds per burst) this is fine.
  const insertSql = `
    INSERT OR REPLACE INTO spans
      (trace_id, span_id, parent_span_id, kind, start_ts, end_ts, latency_ms, attrs)
    VALUES (?, ?, ?, ?, CAST(? AS TIMESTAMP), CAST(? AS TIMESTAMP), ?, ?)
  `;

  let inserted = 0;
  for (const s of spans) {
    const prepared = await conn.prepare(insertSql);
    prepared.bindVarchar(1, s.trace_id);
    prepared.bindVarchar(2, s.span_id);
    if (s.parent_span_id == null) prepared.bindNull(3);
    else prepared.bindVarchar(3, s.parent_span_id);
    prepared.bindVarchar(4, s.kind);
    prepared.bindVarchar(5, s.start_ts);
    prepared.bindVarchar(6, s.end_ts);
    prepared.bindInteger(7, Math.round(s.latency_ms));
    prepared.bindVarchar(8, JSON.stringify(s.attrs ?? {}));
    await prepared.run();
    inserted++;
  }
  return inserted;
}

function rowToSpan(r: any): Span {
  const parseAttrs = (v: unknown): Record<string, any> => {
    if (v == null) return {};
    if (typeof v === 'string') {
      try {
        return JSON.parse(v);
      } catch {
        return {};
      }
    }
    if (typeof v === 'object') return v as Record<string, any>;
    return {};
  };
  // DuckDB returns TIMESTAMPs as either Date, bigint micros, or string
  // depending on driver version — normalise to ISO strings.
  const toIso = (v: unknown): string => {
    if (v == null) return '';
    if (v instanceof Date) return v.toISOString();
    if (typeof v === 'string') return v;
    if (typeof v === 'number') return new Date(v).toISOString();
    if (typeof v === 'bigint') return new Date(Number(v) / 1000).toISOString();
    try {
      return new Date(v as any).toISOString();
    } catch {
      return String(v);
    }
  };
  return {
    trace_id: String(r.trace_id ?? ''),
    span_id: String(r.span_id ?? ''),
    parent_span_id: r.parent_span_id == null ? null : String(r.parent_span_id),
    kind: r.kind as Span['kind'],
    start_ts: toIso(r.start_ts),
    end_ts: toIso(r.end_ts),
    latency_ms: Number(r.latency_ms ?? 0),
    attrs: parseAttrs(r.attrs),
  };
}

async function runQuery(sql: string): Promise<any[]> {
  const { conn } = await getDb();
  const reader = await conn.runAndReadAll(sql);
  const rows = reader.getRowObjects();
  return rows as any[];
}

export async function recentSpans(minutes = 15): Promise<Span[]> {
  // start_ts is stored as naive TIMESTAMP but the values we insert are UTC
  // wall-clocks from ISO "...Z" strings. CURRENT_TIMESTAMP is TIMESTAMPTZ.
  // Comparing the two directly causes DuckDB to re-interpret the naive value
  // in the server's local tz, shifting it hours into the past/future.
  // Anchor the stored value to UTC explicitly so the comparison is sound.
  const sql = `
    SELECT trace_id, span_id, parent_span_id, kind,
           start_ts, end_ts, latency_ms, attrs
    FROM spans
    WHERE (start_ts AT TIME ZONE 'UTC') >= (CURRENT_TIMESTAMP - INTERVAL ${minutes} MINUTE)
    ORDER BY start_ts ASC
  `;
  const rows = await runQuery(sql);
  return rows.map(rowToSpan);
}

export interface TraceSummaryRow {
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
}

export async function listTraces(opts: {
  limit?: number;
  minutes?: number;
} = {}): Promise<TraceSummaryRow[]> {
  const spans = await recentSpans(opts.minutes ?? 1440);
  const byId = new Map<string, Span[]>();
  for (const s of spans) {
    let arr = byId.get(s.trace_id);
    if (!arr) {
      arr = [];
      byId.set(s.trace_id, arr);
    }
    arr.push(s);
  }
  const out: TraceSummaryRow[] = [];
  for (const [trace_id, arr] of byId.entries()) {
    arr.sort((a, b) => a.start_ts.localeCompare(b.start_ts));
    const started_at = arr[0].start_ts;
    const last_ts = arr[arr.length - 1].end_ts;
    let total_latency = 0;
    let llm_latency = 0;
    let inp = 0;
    let out_t = 0;
    let cache = 0;
    let cost = 0;
    let turns = 0;
    let tool_calls = 0;
    const tool_names: string[] = [];
    let judge_score: number | null = null;
    let nearest_doc: string | null = null;
    let nearest_score: number | null = null;
    let user_query: string | null = null;
    let response_text: string | null = null;
    let retrieval_present = false;
    for (const s of arr) {
      total_latency = Math.max(total_latency, new Date(s.end_ts).getTime() - new Date(started_at).getTime());
      if (s.kind === 'llm_call') {
        llm_latency += Number(s.latency_ms ?? 0);
        inp += Number(s.attrs?.input_tokens ?? 0);
        out_t += Number(s.attrs?.output_tokens ?? 0);
        cache += Number(s.attrs?.cache_read_tokens ?? 0);
        cost += Number(s.attrs?.cost_usd ?? 0);
        const t = Number(s.attrs?.turns_this_trace ?? 0);
        if (t > turns) turns = t;
        if (typeof s.attrs?.['user.query'] === 'string' && !user_query)
          user_query = s.attrs['user.query'];
        if (typeof s.attrs?.['response.text'] === 'string' && !response_text)
          response_text = s.attrs['response.text'];
      }
      if (s.kind === 'tool_call') {
        tool_calls++;
        const name = s.attrs?.['tool.name'];
        if (typeof name === 'string') tool_names.push(name);
      }
      if (s.kind === 'retrieval') {
        retrieval_present = true;
        const hits = s.attrs?.['retrieval.hits'] as
          | Array<{ doc_id?: string; score?: number }>
          | undefined;
        const top = hits?.[0];
        if (top) {
          if (nearest_score == null || (top.score ?? 0) > nearest_score) {
            nearest_score = top.score ?? null;
            nearest_doc = top.doc_id ?? null;
          }
        }
        if (typeof s.attrs?.['user.query'] === 'string' && !user_query)
          user_query = s.attrs['user.query'];
      }
      if (s.kind === 'judge') {
        const sc = s.attrs?.['judge.score'];
        if (typeof sc === 'number') judge_score = sc;
      }
    }
    if (turns === 0) turns = arr.filter((s) => s.kind === 'llm_call').length;
    out.push({
      trace_id,
      started_at,
      last_ts,
      span_count: arr.length,
      total_latency_ms: Math.max(1, total_latency),
      llm_latency_ms: llm_latency,
      output_tokens: out_t,
      input_tokens: inp,
      cache_read_tokens: cache,
      cost_usd: cost,
      turn_count: turns,
      tool_call_count: tool_calls,
      judge_score,
      nearest_doc,
      nearest_score,
      user_query,
      response_text,
      retrieval_present,
      tool_names,
    });
  }
  out.sort((a, b) => b.started_at.localeCompare(a.started_at));
  const limit = opts.limit ?? 200;
  return out.slice(0, limit);
}

export async function spansByTrace(traceId: string): Promise<Span[]> {
  const { conn } = await getDb();
  const prep = await conn.prepare(
    `SELECT trace_id, span_id, parent_span_id, kind, start_ts, end_ts,
            latency_ms, attrs
     FROM spans WHERE trace_id = ? ORDER BY start_ts ASC`,
  );
  prep.bindVarchar(1, traceId);
  const reader = await prep.runAndReadAll();
  return reader.getRowObjects().map(rowToSpan);
}

// ---- Alert helpers ----------------------------------------------------------

export async function insertAlert(a: Alert): Promise<void> {
  const { conn } = await getDb();
  const prep = await conn.prepare(`
    INSERT INTO alerts (
      id, detector, severity, headline, where_text, why_text,
      metric_name, metric_value, metric_mean, metric_stddev,
      companion_metric_name, companion_metric_value, trace_id
    ) VALUES (
      nextval('seq_alerts_id'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `);
  prep.bindVarchar(1, a.detector);
  prep.bindVarchar(2, a.severity);
  prep.bindVarchar(3, a.headline);
  if (a.where_text == null) prep.bindNull(4);
  else prep.bindVarchar(4, a.where_text);
  if (a.why_text == null) prep.bindNull(5);
  else prep.bindVarchar(5, a.why_text);
  if (a.metric_name == null) prep.bindNull(6);
  else prep.bindVarchar(6, a.metric_name);
  if (a.metric_value == null) prep.bindNull(7);
  else prep.bindDouble(7, a.metric_value);
  if (a.metric_mean == null) prep.bindNull(8);
  else prep.bindDouble(8, a.metric_mean);
  if (a.metric_stddev == null) prep.bindNull(9);
  else prep.bindDouble(9, a.metric_stddev);
  if (a.companion_metric_name == null) prep.bindNull(10);
  else prep.bindVarchar(10, a.companion_metric_name);
  if (a.companion_metric_value == null) prep.bindNull(11);
  else prep.bindDouble(11, a.companion_metric_value);
  if (a.trace_id == null) prep.bindNull(12);
  else prep.bindVarchar(12, a.trace_id);
  await prep.run();
}

function rowToAlert(r: any): Alert {
  return {
    id: Number(r.id),
    detector: String(r.detector ?? ''),
    severity: (r.severity ?? 'info') as Alert['severity'],
    headline: String(r.headline ?? ''),
    where_text: r.where_text == null ? null : String(r.where_text),
    why_text: r.why_text == null ? null : String(r.why_text),
    metric_name: r.metric_name == null ? null : String(r.metric_name),
    metric_value: r.metric_value == null ? null : Number(r.metric_value),
    metric_mean: r.metric_mean == null ? null : Number(r.metric_mean),
    metric_stddev: r.metric_stddev == null ? null : Number(r.metric_stddev),
    companion_metric_name:
      r.companion_metric_name == null ? null : String(r.companion_metric_name),
    companion_metric_value:
      r.companion_metric_value == null ? null : Number(r.companion_metric_value),
    trace_id: r.trace_id == null ? null : String(r.trace_id),
    created_at:
      r.created_at instanceof Date
        ? r.created_at.toISOString()
        : String(r.created_at ?? ''),
    status: (r.status ?? 'open') as Alert['status'],
    acked_at:
      r.acked_at == null
        ? null
        : r.acked_at instanceof Date
        ? r.acked_at.toISOString()
        : String(r.acked_at),
    resolved_at:
      r.resolved_at == null
        ? null
        : r.resolved_at instanceof Date
        ? r.resolved_at.toISOString()
        : String(r.resolved_at),
    resolution_note:
      r.resolution_note == null ? null : String(r.resolution_note),
    flow: r.flow == null ? null : String(r.flow),
  };
}

export async function recentAlerts(limit = 50): Promise<Alert[]> {
  const rows = await runQuery(
    `SELECT id, detector, severity, headline, where_text, why_text,
            metric_name, metric_value, metric_mean, metric_stddev,
            companion_metric_name, companion_metric_value,
            trace_id, created_at, status, acked_at, resolved_at,
            resolution_note, flow
     FROM alerts ORDER BY created_at DESC LIMIT ${limit}`,
  );
  return rows.map(rowToAlert);
}

export async function updateAlertStatus(
  id: number,
  status: 'open' | 'acked' | 'resolved',
  note?: string | null,
): Promise<void> {
  const { conn } = await getDb();
  let sql: string;
  if (status === 'acked') {
    sql = `UPDATE alerts SET status='acked', acked_at=CURRENT_TIMESTAMP WHERE id=?`;
  } else if (status === 'resolved') {
    sql = `UPDATE alerts SET status='resolved', resolved_at=CURRENT_TIMESTAMP, resolution_note=? WHERE id=?`;
  } else {
    sql = `UPDATE alerts SET status='open', acked_at=NULL, resolved_at=NULL, resolution_note=NULL WHERE id=?`;
  }
  const prep = await conn.prepare(sql);
  if (status === 'resolved') {
    if (note == null) prep.bindNull(1);
    else prep.bindVarchar(1, note);
    prep.bindInteger(2, id);
  } else {
    prep.bindInteger(1, id);
  }
  await prep.run();
}

export async function bulkResolveAlerts(ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const { conn } = await getDb();
  let n = 0;
  for (const id of ids) {
    const prep = await conn.prepare(
      `UPDATE alerts SET status='resolved', resolved_at=CURRENT_TIMESTAMP WHERE id=?`,
    );
    prep.bindInteger(1, id);
    await prep.run();
    n++;
  }
  return n;
}

// ---- Eval helpers -----------------------------------------------------------

export async function insertEval(e: EvalCase): Promise<number> {
  const { conn } = await getDb();
  const prep = await conn.prepare(`
    INSERT INTO evals (
      id, title, user_query, expected_behavior, source, source_ref,
      tags, priority, status, trace_id
    ) VALUES (
      nextval('seq_evals_id'), ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
    RETURNING id
  `);
  prep.bindVarchar(1, e.title);
  prep.bindVarchar(2, e.user_query);
  if (e.expected_behavior == null) prep.bindNull(3);
  else prep.bindVarchar(3, e.expected_behavior);
  prep.bindVarchar(4, e.source);
  if (e.source_ref == null) prep.bindNull(5);
  else prep.bindVarchar(5, e.source_ref);
  prep.bindVarchar(6, (e.tags ?? []).join(','));
  prep.bindVarchar(7, e.priority ?? 'medium');
  prep.bindVarchar(8, e.status ?? 'draft');
  if (e.trace_id == null) prep.bindNull(9);
  else prep.bindVarchar(9, e.trace_id);
  const reader = await prep.runAndReadAll();
  const row = reader.getRowObjects()[0] as any;
  return Number(row?.id ?? 0);
}

export async function listEvals(): Promise<EvalCase[]> {
  const rows = await runQuery(
    `SELECT id, title, user_query, expected_behavior, source, source_ref,
            tags, priority, status, trace_id, created_at
     FROM evals ORDER BY created_at DESC LIMIT 500`,
  );
  return rows.map((r: any) => ({
    id: Number(r.id),
    title: String(r.title ?? ''),
    user_query: String(r.user_query ?? ''),
    expected_behavior:
      r.expected_behavior == null ? null : String(r.expected_behavior),
    source: (String(r.source ?? 'manual') as EvalCase['source']),
    source_ref: r.source_ref == null ? null : String(r.source_ref),
    tags:
      typeof r.tags === 'string' && r.tags.length > 0
        ? r.tags.split(',').map((s: string) => s.trim()).filter(Boolean)
        : [],
    priority: (r.priority ?? 'medium') as EvalCase['priority'],
    status: (r.status ?? 'draft') as EvalCase['status'],
    trace_id: r.trace_id == null ? null : String(r.trace_id),
    created_at:
      r.created_at instanceof Date
        ? r.created_at.toISOString()
        : String(r.created_at ?? ''),
  }));
}

export async function updateEvalStatus(
  id: number,
  status: NonNullable<EvalCase['status']>,
): Promise<void> {
  const { conn } = await getDb();
  const prep = await conn.prepare(`UPDATE evals SET status=? WHERE id=?`);
  prep.bindVarchar(1, status);
  prep.bindInteger(2, id);
  await prep.run();
}

export async function deleteEval(id: number): Promise<void> {
  const { conn } = await getDb();
  const prep = await conn.prepare(`DELETE FROM evals WHERE id=?`);
  prep.bindInteger(1, id);
  await prep.run();
}

// ---- Advisor helpers --------------------------------------------------------

export async function upsertAdvisorNote(a: AdvisorNote): Promise<void> {
  const { conn } = await getDb();
  // Dedupe on (kind, title) — the advisor re-emits the same notes each cron.
  const existing = await conn.prepare(
    `SELECT id FROM advisor_notes WHERE kind=? AND title=? AND status='open' LIMIT 1`,
  );
  existing.bindVarchar(1, a.kind);
  existing.bindVarchar(2, a.title);
  const er = await existing.runAndReadAll();
  const found = er.getRowObjects()[0] as any;
  if (found) {
    const upd = await conn.prepare(
      `UPDATE advisor_notes SET body=?, metric_name=?, severity=? WHERE id=?`,
    );
    upd.bindVarchar(1, a.body);
    if (a.metric_name == null) upd.bindNull(2);
    else upd.bindVarchar(2, a.metric_name);
    upd.bindVarchar(3, a.severity ?? 'info');
    upd.bindInteger(4, Number(found.id));
    await upd.run();
    return;
  }
  const prep = await conn.prepare(`
    INSERT INTO advisor_notes (id, kind, title, body, metric_name, severity)
    VALUES (nextval('seq_advisor_id'), ?, ?, ?, ?, ?)
  `);
  prep.bindVarchar(1, a.kind);
  prep.bindVarchar(2, a.title);
  prep.bindVarchar(3, a.body);
  if (a.metric_name == null) prep.bindNull(4);
  else prep.bindVarchar(4, a.metric_name);
  prep.bindVarchar(5, a.severity ?? 'info');
  await prep.run();
}

export async function listAdvisorNotes(): Promise<AdvisorNote[]> {
  const rows = await runQuery(
    `SELECT id, kind, title, body, metric_name, severity, status, created_at
     FROM advisor_notes ORDER BY created_at DESC LIMIT 100`,
  );
  return rows.map((r: any) => ({
    id: Number(r.id),
    kind: String(r.kind ?? '') as AdvisorNote['kind'],
    title: String(r.title ?? ''),
    body: String(r.body ?? ''),
    metric_name: r.metric_name == null ? null : String(r.metric_name),
    severity: (r.severity ?? 'info') as AdvisorNote['severity'],
    status: (r.status ?? 'open') as AdvisorNote['status'],
    created_at:
      r.created_at instanceof Date
        ? r.created_at.toISOString()
        : String(r.created_at ?? ''),
  }));
}

export async function dismissAdvisorNote(id: number): Promise<void> {
  const { conn } = await getDb();
  const prep = await conn.prepare(
    `UPDATE advisor_notes SET status='dismissed' WHERE id=?`,
  );
  prep.bindInteger(1, id);
  await prep.run();
}

/**
 * Dedupe: look for an identical (detector, metric_name) alert created within
 * the last `minutes` window. Used by the cron to avoid spamming.
 */
export async function alertExistsRecently(
  detector: string,
  metricName: string | null,
  minutes = 5,
): Promise<boolean> {
  const { conn } = await getDb();
  const prep = await conn.prepare(`
    SELECT COUNT(*) AS c FROM alerts
    WHERE detector = ?
      AND (metric_name = ? OR (metric_name IS NULL AND ? IS NULL))
      AND created_at >= (CURRENT_TIMESTAMP - INTERVAL ${minutes} MINUTE)
  `);
  prep.bindVarchar(1, detector);
  if (metricName == null) {
    prep.bindNull(2);
    prep.bindNull(3);
  } else {
    prep.bindVarchar(2, metricName);
    prep.bindVarchar(3, metricName);
  }
  const reader = await prep.runAndReadAll();
  const rows = reader.getRowObjects();
  const c = rows[0] ? Number((rows[0] as any).c ?? 0) : 0;
  return c > 0;
}
