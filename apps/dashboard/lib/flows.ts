// Flow taxonomy & classifier.
//
// A "flow" is the observable shape a trace takes. Pulse's filter dimension is
// not the agent app or the user — it's the *behavioural slice*: is this
// agent run healthy, drifting, novel-intent, adversarial, or tool-heavy?
//
// Classification is heuristic over the aggregated per-trace features we
// already compute in detectors.ts. No ML — predictable, demo-friendly, and
// easy to explain on stage ("flow = drift because tokens are above σ-band").

import type { Flow } from './types';
import type { PerTrace } from './detectors';
import type { Baselines } from './types';

const K = 2;
const MIN_SAMPLES_FOR_BAND = 10;
const GROUNDING_FLOOR = 0.45;

const INJECTION_RE =
  /(ignore\s+(all\s+)?(prior|previous|above)|reveal\s+(the\s+)?system|act as (dan|jailbroken)|override\s+(all\s+)?(rules|safety))/i;

export const FLOW_LABELS: Record<Flow, string> = {
  all: 'All flows',
  healthy: 'Healthy',
  drift: 'Drift',
  novel: 'Novel intent',
  adversarial: 'Adversarial',
  'tool-heavy': 'Tool-heavy',
};

export const FLOW_DESCRIPTIONS: Record<Flow, string> = {
  all: 'Every trace in the window.',
  healthy:
    'Grounded, low turns, judge score high, no σ-band breaches. The baseline shape.',
  drift:
    'Output/input/latency metrics outside their σ-band — the agent is quietly slipping.',
  novel:
    'Top retrieval similarity fell below the grounding floor — your KB has a hole.',
  adversarial:
    'Prompt-injection or jailbreak patterns in the user query — attack surface active.',
  'tool-heavy':
    'Elevated tool calls per trace — more loops, more cost, more places to go wrong.',
};

/**
 * Classify one trace into exactly one flow. Priority order is deliberate —
 * adversarial beats novel beats drift beats tool-heavy. Healthy is the fallback.
 */
export function classifyTrace(
  t: PerTrace,
  perCallFor: {
    output_tokens?: number;
    input_tokens?: number;
    latency_ms?: number;
  },
  baselines: Baselines,
): Flow {
  // 1. Adversarial — query matches an injection pattern.
  if (t.user_query && INJECTION_RE.test(t.user_query)) return 'adversarial';

  // 2. Novel intent — low grounding.
  if (t.nearest_score != null && t.nearest_score < GROUNDING_FLOOR)
    return 'novel';

  // 3. Drift — upward σ-band breach on the metrics that matter when they
  //    rise (tokens, latency, turns). A *below*-band sample on input_tokens
  //    just means "quieter query than baseline" and shouldn't paint a trace
  //    red on a healthy dashboard.
  const checks: Array<[string, number | undefined, 'up' | 'both']> = [
    ['output_tokens', perCallFor.output_tokens, 'up'],
    ['input_tokens', perCallFor.input_tokens, 'up'],
    ['latency_ms', perCallFor.latency_ms, 'up'],
    ['turn_count', t.turn_count, 'up'],
  ];
  let driftBreaches = 0;
  for (const [metric, value, dir] of checks) {
    if (value == null) continue;
    const b = baselines[metric];
    if (!b || b.n < MIN_SAMPLES_FOR_BAND || b.stddev <= 0) continue;
    const kK = metric === 'latency_ms' ? 3 : K;
    const hi = b.mean + kK * b.stddev;
    const lo = b.mean - kK * b.stddev;
    const breach = dir === 'up' ? value > hi : value > hi || value < lo;
    if (breach) driftBreaches++;
  }
  if (driftBreaches >= 1) return 'drift';

  // 4. Tool-heavy — count exceeds μ+σ of tool_call_count baseline.
  const toolBand = baselines['tool_call_count'];
  if (
    toolBand &&
    toolBand.n >= MIN_SAMPLES_FOR_BAND &&
    t.tool_call_count > toolBand.mean + toolBand.stddev
  )
    return 'tool-heavy';

  return 'healthy';
}

export const FLOW_ORDER: Flow[] = [
  'all',
  'healthy',
  'drift',
  'novel',
  'adversarial',
  'tool-heavy',
];

export function isFlow(x: string | null | undefined): x is Flow {
  return !!x && FLOW_ORDER.includes(x as Flow);
}
