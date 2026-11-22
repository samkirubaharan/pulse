// Singleton DuckDB connection + idempotent schema init.
//
// We lazily open the database on first use and memoize the instance / connection
// on globalThis so that Next.js' dev-mode hot reload doesn't leak handles.
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import path from 'node:path';
import fs from 'node:fs';
import type { Span, Alert } from './types';

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
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE SEQUENCE IF NOT EXISTS seq_alerts_id START 1;
`;

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
  const sql = `
    SELECT trace_id, span_id, parent_span_id, kind,
           start_ts, end_ts, latency_ms, attrs
    FROM spans
    WHERE start_ts >= (CURRENT_TIMESTAMP - INTERVAL ${minutes} MINUTE)
    ORDER BY start_ts ASC
  `;
  const rows = await runQuery(sql);
  return rows.map(rowToSpan);
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

export async function recentAlerts(limit = 50): Promise<Alert[]> {
  const rows = await runQuery(
    `SELECT id, detector, severity, headline, where_text, why_text,
            metric_name, metric_value, metric_mean, metric_stddev,
            companion_metric_name, companion_metric_value,
            trace_id, created_at
     FROM alerts ORDER BY created_at DESC LIMIT ${limit}`,
  );
  return rows.map((r) => ({
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
  }));
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
