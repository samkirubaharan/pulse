// Next.js calls this hook once on server boot (both dev and prod) when the
// `experimental.instrumentationHook` flag is on. We lazily start the detector
// cron here so that `next dev` boots it without any extra wiring.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startCron } = await import('./lib/cron');
    startCron();
  }
}
