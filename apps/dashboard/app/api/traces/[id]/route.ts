// GET /api/traces/[id] — all spans for one trace, sorted by start_ts.
import { NextRequest, NextResponse } from 'next/server';
import { spansByTrace } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const spans = await spansByTrace(params.id);
  const started_at = spans[0]?.start_ts ?? null;
  return NextResponse.json({
    trace: { id: params.id, started_at },
    spans,
  });
}
