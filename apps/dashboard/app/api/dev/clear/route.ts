// POST /api/dev/clear — DEV ONLY. Truncates spans + alerts tables.
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const { conn } = await getDb();

  const sRows = (
    await conn.runAndReadAll('SELECT COUNT(*) AS c FROM spans')
  ).getRowObjects();
  const aRows = (
    await conn.runAndReadAll('SELECT COUNT(*) AS c FROM alerts')
  ).getRowObjects();
  const nSpans = Number((sRows[0] as any)?.c ?? 0);
  const nAlerts = Number((aRows[0] as any)?.c ?? 0);

  await conn.run('DELETE FROM spans');
  await conn.run('DELETE FROM alerts');

  return NextResponse.json({
    ok: true,
    spans_deleted: nSpans,
    alerts_deleted: nAlerts,
  });
}
