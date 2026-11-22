// POST /api/dev/reseed — DEV ONLY.
// Recomputes baselines.json from the recent spans in DuckDB using the
// seedFromRecentSpans helper. Call this after Phase 1 to anchor the σ-bands
// to the actual healthy distribution before running drift phases.
import { NextResponse } from 'next/server';
import { seedFromRecentSpans } from '@/lib/baselines';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const baselines = await seedFromRecentSpans(200);
  return NextResponse.json({ ok: true, baselines });
}
