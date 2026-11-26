// GET  /api/advisor — fresh AI-Advisor notes derived from last 15m of spans,
//                     merged with any persisted/open notes from DuckDB.
// POST /api/advisor  — { id, action: 'dismiss' | 'actioned' } state change.
import { NextRequest, NextResponse } from 'next/server';
import {
  recentSpans,
  listAdvisorNotes,
  upsertAdvisorNote,
  dismissAdvisorNote,
} from '@/lib/db';
import { loadBaselines } from '@/lib/baselines';
import { generateAdvisorNotes } from '@/lib/advisor';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const spans = await recentSpans(60);
  const baselines = loadBaselines();
  const fresh = generateAdvisorNotes(spans, baselines);
  // Persist (dedupes on kind+title+status).
  for (const n of fresh) await upsertAdvisorNote(n);
  const stored = await listAdvisorNotes();
  // Prefer the latest instance per (kind,title) — stored rows carry the id
  // we need for dismissal.
  return NextResponse.json(stored);
}

const PostSchema = z.object({
  id: z.number().int().positive(),
  action: z.enum(['dismiss', 'actioned']),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = PostSchema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json({ ok: false, error: 'validation' }, { status: 400 });
  if (parsed.data.action === 'dismiss') {
    await dismissAdvisorNote(parsed.data.id);
  } else {
    await dismissAdvisorNote(parsed.data.id); // same effect for now: hide
  }
  return NextResponse.json({ ok: true });
}
