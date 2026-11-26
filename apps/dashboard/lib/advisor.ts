// AI Advisor — generates grounded suggestions from the observed signal.
//
// Deliberately *not* an LLM — stage-safe, deterministic, auditable. Each note
// cites the metric and numbers it fired on. The three buckets:
//
//   - Things to note        → the raw signal, surfaced earlier than a human
//                              would notice ("judge score down 8 points vs
//                              the last window").
//   - Things to internalise → baseline rebase candidates ("turn count held at
//                              3 for 30 traces — plateau; consider rebase").
//   - Things to enhance      → eval candidates, KB gaps, drift signatures.
//
// Notes are deduplicated on (kind, title) via upsertAdvisorNote().

import type { Span, Baselines, AdvisorNote } from './types';
import { aggregatePerCall, aggregatePerTrace } from './detectors';
import { classifyTrace } from './flows';

const MIN_SAMPLES_FOR_BAND = 10;
const K = 2;
const K_LATENCY = 3;
const GROUNDING_FLOOR = 0.45;

function pct(delta: number, mean: number): string {
  if (mean === 0) return delta > 0 ? '+∞%' : '0%';
  const v = Math.round((delta / Math.abs(mean)) * 100);
  return `${v > 0 ? '+' : ''}${v}%`;
}

export function generateAdvisorNotes(
  spans: Span[],
  baselines: Baselines,
): AdvisorNote[] {
  const notes: AdvisorNote[] = [];
  const calls = aggregatePerCall(spans);
  const traces = aggregatePerTrace(spans);

  // ── NOTE #1 ─────────────────────────────────────────────────────────────
  // Output tokens creeping up — baseline violation at a sub-alert threshold.
  // Alert fires at >2σ on 40% of recent calls. Advisor flags earlier: mean
  // over the last 10 calls > μ+σ (one sigma, lighter touch).
  const outB = baselines['output_tokens'];
  if (outB && outB.n >= MIN_SAMPLES_FOR_BAND && calls.length >= 10) {
    const recent = calls.slice(-10);
    const m = recent.reduce((a, c) => a + c.output_tokens, 0) / recent.length;
    if (m > outB.mean + outB.stddev && m <= outB.mean + K * outB.stddev) {
      notes.push({
        kind: 'drift_signature',
        severity: 'warn',
        metric_name: 'output_tokens',
        title: 'Output tokens creeping up (pre-alert)',
        body: `Recent 10-call mean ${m.toFixed(0)} tokens — within 1σ–2σ of baseline (μ=${outB.mean.toFixed(0)}, σ=${outB.stddev.toFixed(1)}). ${pct(m - outB.mean, outB.mean)} vs baseline. Early chattiness signature — watch the output-tokens tile for the σ-band breach.`,
      });
    }
  }

  // ── NOTE #2 ─────────────────────────────────────────────────────────────
  // Cache-read dropping — pre-paired-signal warning.
  const cacheB = baselines['cache_read_tokens'];
  if (cacheB && cacheB.n >= MIN_SAMPLES_FOR_BAND && calls.length >= 10) {
    const recent = calls.slice(-10);
    const m =
      recent.reduce((a, c) => a + c.cache_read_tokens, 0) / recent.length;
    if (m < cacheB.mean - cacheB.stddev && cacheB.mean > 0) {
      notes.push({
        kind: 'drift_signature',
        severity: 'warn',
        metric_name: 'cache_read_tokens',
        title: 'Cache-read volume softening',
        body: `Recent 10-call mean ${m.toFixed(0)} cache-read tokens (baseline μ=${cacheB.mean.toFixed(0)}). If input_tokens also moves up, this becomes a Cache Invalidation alert. Investigate: prompt change? cache TTL?`,
      });
    }
  }

  // ── NOTE #3 ─────────────────────────────────────────────────────────────
  // Latency variance widening — a wobble that hasn't yet broken σ³.
  const latB = baselines['latency_ms'];
  if (latB && latB.n >= MIN_SAMPLES_FOR_BAND && calls.length >= 20) {
    const recent = calls.slice(-20);
    const m = recent.reduce((a, c) => a + c.latency_ms, 0) / recent.length;
    const v =
      recent.reduce((a, c) => a + (c.latency_ms - m) * (c.latency_ms - m), 0) /
      (recent.length - 1);
    const sd = Math.sqrt(Math.max(0, v));
    if (sd > latB.stddev * 1.5 && m < latB.mean + K_LATENCY * latB.stddev) {
      notes.push({
        kind: 'drift_signature',
        severity: 'info',
        metric_name: 'latency_ms',
        title: 'Latency variance widening',
        body: `Recent σ ${sd.toFixed(0)}ms vs baseline σ ${latB.stddev.toFixed(0)}ms. Mean is still inside μ+3σ — not a Backend Regression alert yet, but the wobble is broadening. Check backend p95 upstream.`,
      });
    }
  }

  // ── NOTE #4 ─────────────────────────────────────────────────────────────
  // Baseline rebase candidate — turn count new plateau. A clean step-change
  // (not jitter) that has stabilised for ≥30 traces is a rebase candidate.
  const turnB = baselines['turn_count'];
  if (turnB && turnB.n >= MIN_SAMPLES_FOR_BAND && traces.length >= 30) {
    const recent = traces.slice(-30).map((t) => t.turn_count);
    const m = recent.reduce((a, c) => a + c, 0) / recent.length;
    const sd = Math.sqrt(
      recent.reduce((a, x) => a + (x - m) * (x - m), 0) / (recent.length - 1),
    );
    if (m > turnB.mean + K * turnB.stddev && sd < turnB.stddev * 1.5) {
      notes.push({
        kind: 'baseline_rebase',
        severity: 'info',
        metric_name: 'turn_count',
        title: 'Turn-count plateau — candidate for baseline rebase',
        body: `30-trace mean ${m.toFixed(1)} turns held stable (σ ${sd.toFixed(2)}). Baseline is ${turnB.mean.toFixed(1)}±${turnB.stddev.toFixed(2)}. If this plateau is intentional (e.g. new tool was added), reseed baselines so Turn Stickiness stops paging.`,
      });
    }
  }

  // ── NOTE #5 ─────────────────────────────────────────────────────────────
  // KB gap cluster — multiple novel-intent queries pointing at the same doc.
  // These are the strongest "promote to eval" candidates.
  const low = traces.filter(
    (t) =>
      t.nearest_score != null &&
      t.nearest_score < GROUNDING_FLOOR &&
      t.user_query,
  );
  if (low.length >= 2) {
    const byDoc: Record<string, { count: number; examples: string[] }> = {};
    for (const t of low) {
      const d = t.nearest_doc ?? 'unknown';
      if (!byDoc[d]) byDoc[d] = { count: 0, examples: [] };
      byDoc[d].count++;
      if (byDoc[d].examples.length < 3 && t.user_query)
        byDoc[d].examples.push(t.user_query);
    }
    const ranked = Object.entries(byDoc).sort((a, b) => b[1].count - a[1].count);
    for (const [doc, info] of ranked.slice(0, 3)) {
      if (info.count < 2) continue;
      notes.push({
        kind: 'kb_gap',
        severity: info.count >= 5 ? 'warn' : 'info',
        metric_name: 'grounding',
        title: `KB gap near ${doc} — ${info.count} queries landed low`,
        body: `${info.count} queries fell below the grounding floor (0.45) with ${doc} as their nearest match. Example queries: ${info.examples.map((e) => `"${e.length > 60 ? e.slice(0, 60) + '…' : e}"`).join(', ')}. Author KB coverage near this topic, or accept the gap — then promote these queries to eval cases so the next prompt/model change can't regress them silently.`,
      });
    }
  }

  // ── NOTE #6 ─────────────────────────────────────────────────────────────
  // Judge-score dip — generation-side regression, not retrieval-side.
  const judgeB = baselines['judge_score'];
  if (judgeB && judgeB.n >= MIN_SAMPLES_FOR_BAND) {
    const judgeSpans = spans.filter(
      (s) => s.kind === 'judge' && typeof s.attrs?.['judge.score'] === 'number',
    );
    const recent = judgeSpans.slice(-20);
    if (recent.length >= 10) {
      const m =
        (recent.reduce((a, s) => a + (s.attrs['judge.score'] as number), 0) /
          recent.length) *
        100;
      if (m < judgeB.mean - judgeB.stddev) {
        notes.push({
          kind: 'drift_signature',
          severity: m < judgeB.mean - K * judgeB.stddev ? 'warn' : 'info',
          metric_name: 'judge_score',
          title: 'Judge score drifting down',
          body: `Last 20 judged responses averaged ${m.toFixed(1)}% (baseline ${judgeB.mean.toFixed(1)}±${judgeB.stddev.toFixed(1)}). This is a *generation-side* dip — grounding may still be fine. Pull the five worst traces and see if the pattern is in the response shape (confident-but-wrong) or the framing (off-topic). These should become eval cases.`,
        });
      }
    }
  }

  // ── NOTE #7 ─────────────────────────────────────────────────────────────
  // Flow-distribution shift — adversarial or novel climbing against healthy.
  const perCallIdx = new Map<string, {
    output_tokens?: number;
    input_tokens?: number;
    latency_ms?: number;
  }>();
  for (const c of calls) {
    perCallIdx.set(c.trace_id, {
      output_tokens: c.output_tokens,
      input_tokens: c.input_tokens,
      latency_ms: c.latency_ms,
    });
  }
  const distro: Record<string, number> = {};
  for (const t of traces) {
    const f = classifyTrace(t, perCallIdx.get(t.trace_id) ?? {}, baselines);
    distro[f] = (distro[f] ?? 0) + 1;
  }
  const total = Object.values(distro).reduce((a, b) => a + b, 0) || 1;
  const nonHealthy = total - (distro['healthy'] ?? 0);
  if (nonHealthy / total >= 0.4 && total >= 10) {
    const breakdown = Object.entries(distro)
      .filter(([k]) => k !== 'healthy')
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ${v}`)
      .join(' · ');
    notes.push({
      kind: 'coverage_gap',
      severity: 'warn',
      metric_name: 'flow_distribution',
      title: `${Math.round((nonHealthy / total) * 100)}% of traces are not "healthy"`,
      body: `Flow mix — ${breakdown}. Treat the non-healthy flows as a backlog: adversarial → security evals, novel → KB coverage, drift → regression evals, tool-heavy → cost/behaviour evals. Promote the examples from the Verify tab.`,
    });
  }

  // ── NOTE #8 ─────────────────────────────────────────────────────────────
  // Cost creep — $/trace pushed by chattiness without correctness change.
  if (calls.length >= 20) {
    const recent = calls.slice(-20);
    const earlier = calls.slice(-40, -20);
    if (earlier.length >= 10) {
      const rA = recent.reduce((a, c) => a + c.cost_usd, 0) / recent.length;
      const rB = earlier.reduce((a, c) => a + c.cost_usd, 0) / earlier.length;
      if (rB > 0 && rA > rB * 1.25) {
        notes.push({
          kind: 'cost_optimisation',
          severity: 'info',
          metric_name: 'cost_usd',
          title: 'Cost per call rising',
          body: `Recent 20-call mean $${rA.toFixed(4)} vs previous $${rB.toFixed(4)} — ${pct(rA - rB, rB)}. Confirm this isn't a regression in judge-score: if the extra tokens buy correctness, keep. If not, cost drift — revisit the system prompt or add a length cap.`,
        });
      }
    }
  }

  // ── NOTE #9 ─────────────────────────────────────────────────────────────
  // Novel-intent batch → eval candidate (the Priya loop, surfaced on Observe).
  const novelExamples = low.slice(-5).map((t) => t.user_query).filter(Boolean) as string[];
  if (novelExamples.length >= 3) {
    notes.push({
      kind: 'eval_candidate',
      severity: 'info',
      metric_name: 'novel_intent',
      title: `${novelExamples.length} novel-intent queries → promote to evals`,
      body: `These queries landed below the grounding floor and are not in your test suite today: ${novelExamples
        .map((q) => `"${q.length > 50 ? q.slice(0, 50) + '…' : q}"`)
        .join(', ')}. Promote from the Novel-Intent inbox to a Verify case so the next release can't regress on them.`,
    });
  }

  return notes;
}
