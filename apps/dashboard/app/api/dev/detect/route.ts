// POST /api/dev/detect — DEV ONLY.
// Runs all detectors synchronously against the current recent-spans window
// and inserts any new alerts. Useful when the HMR cron has lost its closure
// or when you want to force-tick the pipeline without waiting 15s.
import { NextResponse } from 'next/server';
import { recentSpans, insertAlert, alertExistsRecently } from '@/lib/db';
import { loadBaselines } from '@/lib/baselines';
import { runAllDetectors } from '@/lib/detectors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const spans = await recentSpans(15);
  const baselines = loadBaselines();
  const alerts = runAllDetectors(spans, baselines);

  let inserted = 0;
  let skipped = 0;
  for (const a of alerts) {
    const dup = await alertExistsRecently(a.detector, a.metric_name ?? null, 5);
    if (dup) {
      skipped++;
      continue;
    }
    await insertAlert(a);
    inserted++;
  }

  return NextResponse.json({
    ok: true,
    span_count: spans.length,
    detectors_returned: alerts.length,
    inserted,
    skipped_dup: skipped,
    by_detector: alerts.reduce<Record<string, number>>((acc, a) => {
      acc[a.detector] = (acc[a.detector] ?? 0) + 1;
      return acc;
    }, {}),
  });
}
