// GET /api/dev/export?minutes=120 — DEV ONLY.
// Returns { spans: Span[] } for the last N minutes so a sibling dashboard can
// ingest them via POST /api/spans. N defaults to 120.
import { NextRequest, NextResponse } from 'next/server';
import { recentSpans } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const minutes = Math.max(1, Math.min(10080, Number(url.searchParams.get('minutes') ?? 120)));
  const spans = await recentSpans(minutes);
  // Return ONLY the ingestion-ready payload so a receiver can pipe the body
  // straight into POST /api/spans without any transformation.
  return NextResponse.json({ spans });
}
