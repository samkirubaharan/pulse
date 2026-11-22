// Shared types for the dashboard. Mirrors the schema that the ingestion route
// (zod) accepts, plus derived views the detectors / UI need.

export type SpanKind = 'retrieval' | 'tool_call' | 'llm_call' | 'judge';

export interface Span {
  trace_id: string;
  span_id: string;
  parent_span_id: string | null;
  kind: SpanKind;
  start_ts: string; // ISO
  end_ts: string; // ISO
  latency_ms: number;
  attrs: Record<string, any>;
}

export interface Baseline {
  mean: number;
  stddev: number;
  n: number;
}

export type Baselines = Record<string, Baseline>;

export type Severity = 'info' | 'warn' | 'critical';

export interface Alert {
  id?: number;
  detector: string;
  severity: Severity;
  headline: string;
  where_text?: string | null;
  why_text?: string | null;
  metric_name?: string | null;
  metric_value?: number | null;
  metric_mean?: number | null;
  metric_stddev?: number | null;
  companion_metric_name?: string | null;
  companion_metric_value?: number | null;
  trace_id?: string | null;
  created_at?: string;
}

export interface TilePoint {
  t: string; // ISO timestamp
  value: number;
  companion?: number; // used for input vs cache_read pair
}

export interface TileStat {
  points: TilePoint[];
  band: { mean: number; stddev: number; n: number };
  companion_band?: { mean: number; stddev: number; n: number };
}

export interface StatsResponse {
  turn_count: TileStat;
  output_tokens: TileStat;
  input_vs_cache: TileStat; // value = input_tokens, companion = cache_read_tokens
  latency_ms: TileStat & { consecutive_breaches: number };
  tool_call_count: TileStat;
  tool_composition: { name: string; count: number }[];
  grounding_pct: { current: number; series: TilePoint[] }; // retrieval-side grounding
  judge_score_pct: TileStat & { current: number }; // generation-side grounding (Sonnet judge, 0-100)
  novel_intent: { query: string; nearest_doc: string; score: number; t: string }[];
  traffic: {
    uptime_pct: number;
    p95_latency_ms: number;
    error_rate_pct: number;
    request_count: number;
  };
  output_cost: TilePoint[]; // $ overlay on output tokens tile
}
