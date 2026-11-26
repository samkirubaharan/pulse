// POST /api/alerts/bulk — bulk resolve by ids. Body: { ids: number[] }
import { NextRequest, NextResponse } from 'next/server';
import { bulkResolveAlerts } from '@/lib/db';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Schema = z.object({ ids: z.array(z.number().int().positive()).min(1) });

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = Schema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json({ ok: false, error: 'validation' }, { status: 400 });
  const resolved = await bulkResolveAlerts(parsed.data.ids);
  return NextResponse.json({ ok: true, resolved });
}
