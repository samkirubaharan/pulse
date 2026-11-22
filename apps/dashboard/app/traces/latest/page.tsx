// /traces/latest — resolves to the most recent trace in DuckDB and redirects.
// Lets the Debug nav link always be clickable even when the user hasn't come
// in from an alert.
import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function LatestTracePage() {
  const { conn } = await getDb();
  const reader = await conn.runAndReadAll(
    `SELECT trace_id FROM spans ORDER BY start_ts DESC LIMIT 1`,
  );
  const rows = reader.getRowObjects();
  const id = (rows[0] as any)?.trace_id;
  if (!id) redirect('/alerts');
  redirect(`/traces/${id}`);
}
