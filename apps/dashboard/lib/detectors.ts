// The 8 detectors — pure functions over (recent spans, baselines) → Alert[].
//
// Rules of the road (DESIGN.md):
//   - σ-band only. k=2 for most metrics, k=3 for latency.
//   - Minimum 10 samples before a σ-band is considered "active".
//   - No single-sample alerts: use distributional gates / consecutive-breach.
//   - Paired signals (factor #3) fire only when BOTH move in the expected
//     directions.
//
// The detectors are intentionally simple — working math, not clever math.
import type { Span, Baselines, Alert } from './types';

const K_DEFAULT = 2;
const K_LATENCY = 3;
const MIN_SAMPLES_FOR_BAND = 10;
const CONSECUTIVE_BREACH_THRESHOLD = 3;
const GROUNDING_FLOOR = 0.45;

// ---- Helpers ----------------------------------------------------------------

export interface PerCall {
  trace_id: string;
  span_id: string;
  start_ts: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  latency_ms: number;
  cost_usd: number;
}

export interface PerTrace {
  trace_id: string;
  turn_count: number;
  tool_call_count: number;
  tool_names: string[]; // one entry per tool_call
  retrieval_present: boolean;
  judge_score: number | null;
  judge_rationale: string | null;
  nearest_doc: string | null;
  nearest_score: number | null;
  user_query: string | null;
  has_factual_query: boolean;
  last_ts: string;
}

export function aggregatePerCall(spans: Span[]): PerCall[] {
  return spans
    .filter((s) => s.kind === 'llm_call')
    .map((s) => ({
      trace_id: s.trace_id,
      span_id: s.span_id,
      start_ts: s.start_ts,
      input_tokens: Number(s.attrs?.input_tokens ?? 0),
      output_tokens: Number(s.attrs?.output_tokens ?? 0),
      cache_read_tokens: Number(s.attrs?.cache_read_tokens ?? 0),
      latency_ms: s.latency_ms,
      cost_usd: Number(s.attrs?.cost_usd ?? 0),
    }))
    .sort((a, b) => a.start_ts.localeCompare(b.start_ts));
}

// Light factual-query heuristic — the "factual" bucket per DESIGN.md Phase 3.
const FACTUAL_RE = /\b(what|when|where|which|who|how|price|cost|refund|address|date|time|venue|register|pass|policy)\b/i;

export function aggregatePerTrace(spans: Span[]): PerTrace[] {
  const map = new Map<string, PerTrace>();

  for (const s of spans) {
    let agg = map.get(s.trace_id);
    if (!agg) {
      agg = {
        trace_id: s.trace_id,
        turn_count: 0,
        tool_call_count: 0,
        tool_names: [],
        retrieval_present: false,
        judge_score: null,
        judge_rationale: null,
        nearest_doc: null,
        nearest_score: null,
        user_query: null,
        has_factual_query: false,
        last_ts: s.start_ts,
      };
      map.set(s.trace_id, agg);
    }
    if (s.start_ts > agg.last_ts) agg.last_ts = s.start_ts;

    if (s.kind === 'retrieval') {
      agg.retrieval_present = true;
      const hits = s.attrs?.['retrieval.hits'] as
        | Array<{ doc_id?: string; score?: number }>
        | undefined;
      if (Array.isArray(hits) && hits.length > 0) {
        const top = hits.reduce(
          (best, h) =>
            (h.score ?? 0) > (best.score ?? 0) ? h : best,
          hits[0],
        );
        if (
          agg.nearest_score == null ||
          (top.score ?? 0) > (agg.nearest_score ?? 0)
        ) {
          agg.nearest_score = top.score ?? null;
          agg.nearest_doc = top.doc_id ?? null;
        }
      }
      if (typeof s.attrs?.nearest_doc === 'string' && !agg.nearest_doc) {
        agg.nearest_doc = s.attrs.nearest_doc;
      }
      if (typeof s.attrs?.nearest_score === 'number' && agg.nearest_score == null) {
        agg.nearest_score = s.attrs.nearest_score;
      }
    }
    if (s.kind === 'tool_call') {
      agg.tool_call_count += 1;
      const name = s.attrs?.['tool.name'];
      if (typeof name === 'string') agg.tool_names.push(name);
    }
    if (s.kind === 'llm_call') {
      const t = Number(s.attrs?.turns_this_trace ?? 0);
      if (t > agg.turn_count) agg.turn_count = t;
      else agg.turn_count += 1;
      if (typeof s.attrs?.['user.query'] === 'string') {
        agg.user_query = s.attrs['user.query'];
        if (FACTUAL_RE.test(s.attrs['user.query'])) agg.has_factual_query = true;
      }
      if (typeof s.attrs?.nearest_doc === 'string' && !agg.nearest_doc) {
        agg.nearest_doc = s.attrs.nearest_doc;
      }
      if (typeof s.attrs?.nearest_score === 'number' && agg.nearest_score == null) {
        agg.nearest_score = s.attrs.nearest_score;
      }
    }
    if (s.kind === 'judge') {
      agg.judge_score = Number(s.attrs?.['judge.score'] ?? s.attrs?.score ?? 0);
      agg.judge_rationale =
        (s.attrs?.['judge.rationale'] as string | undefined) ?? null;
    }
  }

  // Also honour per-trace turn_count stored as attrs if set on any span.
  for (const s of spans) {
    const t = Number(s.attrs?.turns_this_trace ?? 0);
    const agg = map.get(s.trace_id);
    if (agg && t > agg.turn_count) agg.turn_count = t;
  }

  return [...map.values()].sort((a, b) => a.last_ts.localeCompare(b.last_ts));
}

function overBand(x: number, mean: number, stddev: number, k: number): boolean {
  if (stddev <= 0) return false;
  return Math.abs(x - mean) > k * stddev;
}

function pctChange(value: number, mean: number): number {
  if (mean === 0) return value > 0 ? 100 : 0;
  return ((value - mean) / Math.abs(mean)) * 100;
}

// ---- Detectors --------------------------------------------------------------

// 1. Chattiness — factor #2. Output tokens drift above baseline σ-band.
export function detectChattiness(
  spans: Span[],
  baselines: Baselines,
): Alert[] {
  const b = baselines['output_tokens'];
  if (!b || b.n < MIN_SAMPLES_FOR_BAND) return [];
  const calls = aggregatePerCall(spans);
  if (calls.length < 5) return [];
  const recent = calls.slice(-10);
  const breaches = recent.filter(
    (c) => c.output_tokens > b.mean + K_DEFAULT * b.stddev,
  );
  if (breaches.length < Math.ceil(recent.length * 0.4)) return [];
  const last = recent[recent.length - 1];
  const delta = pctChange(last.output_tokens, b.mean);
  return [
    {
      detector: 'Chattiness',
      severity: delta > 50 ? 'critical' : 'warn',
      headline: `Output tokens ${delta > 0 ? '+' : ''}${delta.toFixed(0)}% over baseline σ-band`,
      where_text: null,
      why_text: 'Model is producing more tokens per call without a corresponding content change.',
      metric_name: 'output_tokens',
      metric_value: last.output_tokens,
      metric_mean: b.mean,
      metric_stddev: b.stddev,
      trace_id: last.trace_id,
    },
  ];
}

// 2. Cache invalidation — factor #3 PAIRED breach: input ↑ AND cache_reads ↓.
export function detectCacheInvalidation(
  spans: Span[],
  baselines: Baselines,
): Alert[] {
  const bi = baselines['input_tokens'];
  const bc = baselines['cache_read_tokens'];
  if (!bi || !bc) return [];
  if (bi.n < MIN_SAMPLES_FOR_BAND || bc.n < MIN_SAMPLES_FOR_BAND) return [];
  const calls = aggregatePerCall(spans);
  if (calls.length < 5) return [];
  const recent = calls.slice(-10);
  const paired = recent.filter(
    (c) =>
      c.input_tokens > bi.mean + K_DEFAULT * bi.stddev &&
      c.cache_read_tokens < bc.mean - K_DEFAULT * bc.stddev,
  );
  if (paired.length < Math.ceil(recent.length * 0.4)) return [];
  const last = paired[paired.length - 1];
  return [
    {
      detector: 'Cache Invalidation',
      severity: 'warn',
      headline: `Input tokens up AND cache_read tokens down (paired σ-breach)`,
      where_text: null,
      why_text: 'Both halves of the cache-pair moved together — this is a real cache miss, not final-turn noise.',
      metric_name: 'input_tokens',
      metric_value: last.input_tokens,
      metric_mean: bi.mean,
      metric_stddev: bi.stddev,
      companion_metric_name: 'cache_read_tokens',
      companion_metric_value: last.cache_read_tokens,
      trace_id: last.trace_id,
    },
  ];
}

// 3. Backend regression — factor #4. Latency breach for N consecutive calls.
export function detectBackendRegression(
  spans: Span[],
  baselines: Baselines,
): Alert[] {
  const b = baselines['latency_ms'];
  if (!b || b.n < MIN_SAMPLES_FOR_BAND) return [];
  const calls = aggregatePerCall(spans);
  if (calls.length < CONSECUTIVE_BREACH_THRESHOLD) return [];
  let streak = 0;
  let maxStreak = 0;
  let last = calls[calls.length - 1];
  for (const c of calls) {
    if (c.latency_ms > b.mean + K_LATENCY * b.stddev) {
      streak += 1;
      maxStreak = Math.max(maxStreak, streak);
      last = c;
    } else {
      streak = 0;
    }
  }
  if (maxStreak < CONSECUTIVE_BREACH_THRESHOLD) return [];
  return [
    {
      detector: 'Backend Regression',
      severity: maxStreak >= 5 ? 'critical' : 'warn',
      headline: `Latency over σ-band for ${maxStreak} consecutive calls`,
      where_text: null,
      why_text: 'Sustained latency breach suggests backend regression, not jitter.',
      metric_name: 'latency_ms',
      metric_value: last.latency_ms,
      metric_mean: b.mean,
      metric_stddev: b.stddev,
      trace_id: last.trace_id,
    },
  ];
}

// 4. Behavioural shift — factor #5. Composition change over tool.name frequency.
// We use Jensen-Shannon divergence between the baseline (first half of the
// window) and the recent (last half) distributions.
export function detectBehaviouralShift(
  spans: Span[],
  _baselines: Baselines,
): Alert[] {
  const toolSpans = spans.filter((s) => s.kind === 'tool_call');
  if (toolSpans.length < 20) return [];
  const mid = Math.floor(toolSpans.length / 2);
  const baseWindow = toolSpans.slice(0, mid);
  const recentWindow = toolSpans.slice(mid);

  const freq = (xs: Span[]): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const s of xs) {
      const n = (s.attrs?.['tool.name'] as string | undefined) ?? 'unknown';
      out[n] = (out[n] ?? 0) + 1;
    }
    return out;
  };
  const toProb = (f: Record<string, number>, keys: string[]): number[] => {
    const total = Object.values(f).reduce((a, b) => a + b, 0) || 1;
    return keys.map((k) => (f[k] ?? 0) / total + 1e-9);
  };
  const fA = freq(baseWindow);
  const fB = freq(recentWindow);
  const keys = [...new Set([...Object.keys(fA), ...Object.keys(fB)])];
  const p = toProb(fA, keys);
  const q = toProb(fB, keys);
  // Jensen-Shannon divergence (log2, 0..1).
  const m = p.map((pi, i) => 0.5 * (pi + q[i]));
  const kl = (a: number[], b: number[]) =>
    a.reduce((acc, ai, i) => acc + ai * Math.log2(ai / b[i]), 0);
  const jsd = 0.5 * kl(p, m) + 0.5 * kl(q, m);
  if (jsd < 0.1) return [];

  // Find the most-shifted tool for the headline.
  let worst = { name: keys[0], delta: 0 };
  keys.forEach((k, i) => {
    const d = Math.abs(q[i] - p[i]);
    if (d > worst.delta) worst = { name: k, delta: d };
  });

  const lastTrace = toolSpans[toolSpans.length - 1]?.trace_id ?? null;
  return [
    {
      detector: 'Behavioural Shift',
      severity: jsd > 0.3 ? 'critical' : 'warn',
      headline: `Tool-call composition shifted (JSD=${jsd.toFixed(2)}); ${worst.name} usage changed most`,
      where_text: null,
      why_text:
        'Distribution over tool invocations has moved — the agent is reaching for different tools than before.',
      metric_name: 'tool_composition_jsd',
      metric_value: jsd,
      metric_mean: 0,
      metric_stddev: 0,
      trace_id: lastTrace,
    },
  ];
}

// 5. Turn stickiness — factor #1 step-up detector. Audit-only, not auto-alert.
// Returned as severity=info; the UI can treat these as log entries.
export function detectTurnStickiness(
  spans: Span[],
  baselines: Baselines,
): Alert[] {
  const b = baselines['turn_count'];
  if (!b || b.n < MIN_SAMPLES_FOR_BAND) return [];
  const traces = aggregatePerTrace(spans);
  if (traces.length < 10) return [];
  const recent = traces.slice(-10).map((t) => t.turn_count);
  const recentMean = recent.reduce((a, c) => a + c, 0) / recent.length;
  if (recentMean <= b.mean + K_DEFAULT * b.stddev) return [];
  const last = traces[traces.length - 1];
  return [
    {
      detector: 'Turn Stickiness',
      severity: 'info',
      headline: `Turn count plateau shifted up: recent mean ${recentMean.toFixed(1)} vs baseline ${b.mean.toFixed(1)}`,
      where_text: null,
      why_text: 'Step-change in turns-per-task. Logged for review; will rebase baseline if stable.',
      metric_name: 'turn_count',
      metric_value: recentMean,
      metric_mean: b.mean,
      metric_stddev: b.stddev,
      trace_id: last.trace_id,
    },
  ];
}

// 6. KB Bypass — factual query reached llm_call without a retrieval span.
export function detectKBBypass(spans: Span[], _b: Baselines): Alert[] {
  const traces = aggregatePerTrace(spans);
  const bypasses = traces.filter(
    (t) => t.has_factual_query && !t.retrieval_present,
  );
  if (bypasses.length < 3) return [];
  const last = bypasses[bypasses.length - 1];
  return [
    {
      detector: 'KB Bypass',
      severity: 'critical',
      headline: `${bypasses.length} factual-looking traces answered with no retrieval span`,
      where_text: last.user_query
        ? `example query: "${last.user_query.slice(0, 80)}"`
        : null,
      why_text:
        'Agent produced answers on factual queries without consulting the knowledge base.',
      metric_name: 'kb_bypass_count',
      metric_value: bypasses.length,
      trace_id: last.trace_id,
    },
  ];
}

// 7. Low Grounding → Novel-Intent. Top retrieval score below floor.
export function detectLowGrounding(spans: Span[], _b: Baselines): Alert[] {
  const traces = aggregatePerTrace(spans);
  const low = traces.filter(
    (t) => t.nearest_score != null && t.nearest_score < GROUNDING_FLOOR,
  );
  if (low.length < 3) return [];
  const last = low[low.length - 1];
  // Cluster by nearest_doc for the headline.
  const byDoc: Record<string, number> = {};
  for (const t of low) {
    const k = t.nearest_doc ?? 'unknown';
    byDoc[k] = (byDoc[k] ?? 0) + 1;
  }
  const topCluster = Object.entries(byDoc).sort((a, b) => b[1] - a[1])[0];
  return [
    {
      detector: 'Low Grounding',
      severity: 'warn',
      headline: `${low.length} queries landed below grounding floor (<${GROUNDING_FLOOR})`,
      where_text: topCluster
        ? `cluster: ${topCluster[0]} (${topCluster[1]} queries, worst similarity ${last.nearest_score?.toFixed(2)})`
        : null,
      why_text:
        'Top retrieval similarity below floor — queries are outside what the KB covers. Feeds Novel-Intent inbox.',
      metric_name: 'nearest_score',
      metric_value: last.nearest_score ?? 0,
      metric_mean: GROUNDING_FLOOR,
      metric_stddev: 0,
      trace_id: last.trace_id,
    },
  ];
}

// 8. Prompt Injection — regex match over user.query.
const INJECTION_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'ignore-prior-instructions', re: /ignore\s+(all\s+)?(prior|previous|above)\s+(instructions|prompts)/i },
  { name: 'reveal-system-prompt', re: /(reveal|show|print|dump)\s+(the\s+)?(system|hidden)\s+prompt/i },
  { name: 'act-as-dan', re: /\b(act as|pretend to be|roleplay as)\s+(dan|an unrestricted|jailbroken|developer mode)\b/i },
  { name: 'exfil-secret', re: /\b(api[_\s-]?key|secret|password|token)\b.*\b(print|show|reveal|email|send)/i },
  { name: 'override-rules', re: /\b(override|bypass|disregard)\s+(all\s+)?(rules|safety|guardrails)/i },
];

export function detectPromptInjection(spans: Span[], _b: Baselines): Alert[] {
  const out: Alert[] = [];
  const seen = new Set<string>();
  for (const s of spans) {
    if (s.kind !== 'llm_call') continue;
    const q = s.attrs?.['user.query'];
    if (typeof q !== 'string') continue;
    for (const p of INJECTION_PATTERNS) {
      if (p.re.test(q)) {
        const key = `${p.name}:${s.trace_id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          detector: 'Prompt Injection',
          severity: 'critical',
          headline: `Prompt injection pattern matched: "${p.name}"`,
          where_text: `query: "${q.slice(0, 120)}"`,
          why_text:
            'User query matched a known injection pattern. Guardrails may have allowed it through.',
          metric_name: 'injection_pattern',
          metric_value: 1,
          trace_id: s.trace_id,
        });
        break; // one alert per span
      }
    }
  }
  return out;
}

// ---- Runner -----------------------------------------------------------------

export function runAllDetectors(spans: Span[], baselines: Baselines): Alert[] {
  return [
    ...detectChattiness(spans, baselines),
    ...detectCacheInvalidation(spans, baselines),
    ...detectBackendRegression(spans, baselines),
    ...detectBehaviouralShift(spans, baselines),
    ...detectTurnStickiness(spans, baselines),
    ...detectKBBypass(spans, baselines),
    ...detectLowGrounding(spans, baselines),
    ...detectPromptInjection(spans, baselines),
  ];
}
