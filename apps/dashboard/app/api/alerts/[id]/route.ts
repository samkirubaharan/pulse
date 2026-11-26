// PATCH /api/alerts/[id] — update alert status (open | acked | resolved).
import { NextRequest, NextResponse } from 'next/server';
import { updateAlertStatus } from '@/lib/db';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Schema = z.object({
  status: z.enum(['open', 'acked', 'resolved']),
  note: z.string().optional().nullable(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const id = Number(params.id);
  if (!Number.isFinite(id) || id <= 0)
    return NextResponse.json({ ok: false, error: 'bad-id' }, { status: 400 });
  const body = await req.json().catch(() => null);
  const parsed = Schema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json({ ok: false, error: 'validation' }, { status: 400 });
  await updateAlertStatus(id, parsed.data.status, parsed.data.note ?? null);
  return NextResponse.json({ ok: true });
}
