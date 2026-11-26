// PATCH  /api/evals/[id]  — update status (draft → ready → passing/failing)
// DELETE /api/evals/[id]  — remove case (not archive — hard delete for simplicity)
import { NextRequest, NextResponse } from 'next/server';
import { updateEvalStatus, deleteEval } from '@/lib/db';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PatchSchema = z.object({
  status: z.enum(['draft', 'ready', 'passing', 'failing', 'archived']),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const id = Number(params.id);
  if (!Number.isFinite(id) || id <= 0)
    return NextResponse.json({ ok: false, error: 'bad-id' }, { status: 400 });
  const body = await req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json({ ok: false, error: 'validation' }, { status: 400 });
  await updateEvalStatus(id, parsed.data.status);
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const id = Number(params.id);
  if (!Number.isFinite(id) || id <= 0)
    return NextResponse.json({ ok: false, error: 'bad-id' }, { status: 400 });
  await deleteEval(id);
  return NextResponse.json({ ok: true });
}
