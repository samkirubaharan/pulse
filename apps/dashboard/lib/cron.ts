// Detector cron. Runs every 15s inside the Next.js server process. Pulls the
// last 15 minutes of spans, runs all 8 detectors, inserts new alerts (deduped
// within a 5-min window on (detector, metric_name)).
import cron from 'node-cron';
import { recentSpans, insertAlert, alertExistsRecently } from './db';
import { loadBaselines } from './baselines';
import { runAllDetectors } from './detectors';

declare global {
  // eslint-disable-next-line no-var
  var __cronStarted: boolean | undefined;
}

export function startCron(): void {
  if (globalThis.__cronStarted) return;
  globalThis.__cronStarted = true;

  // node-cron accepts "*/15 * * * * *" for every-15-seconds (6-field form).
  cron.schedule('*/15 * * * * *', async () => {
    try {
      const spans = await recentSpans(15);
      if (spans.length === 0) return;
      const baselines = loadBaselines();
      const alerts = runAllDetectors(spans, baselines);
      for (const a of alerts) {
        const exists = await alertExistsRecently(a.detector, a.metric_name ?? null, 5);
        if (exists) continue;
        await insertAlert(a);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[cron] detector pass failed', err);
    }
  });

  // eslint-disable-next-line no-console
  console.log('[cron] detector loop started (every 15s)');
}
