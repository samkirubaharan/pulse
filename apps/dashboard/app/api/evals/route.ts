// GET  /api/evals             — list all eval cases
// POST /api/evals             — create a new eval case (promote or manual)
import { NextRequest, NextResponse } from 'next/server';
import { listEvals, insertEval } from '@/lib/db';
import { z } from 'zod';
import type { EvalCase } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CreateSchema = z.object({
  title: z.string().min(1),
  user_query: z.string().min(1),
  expected_behavior: z.string().nullable().optional(),
  source: z.enum(['alert', 'novel_intent', 'manual', 'injection']),
  source_ref: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  trace_id: z.string().nullable().optional(),
});

export async function GET() {
  const evals = await listEvals();
  return NextResponse.json(evals);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json(
      { ok: false, error: 'validation', issues: parsed.error.issues },
      { status: 400 },
    );
  const row: EvalCase = {
    title: parsed.data.title,
    user_query: parsed.data.user_query,
    expected_behavior: parsed.data.expected_behavior ?? null,
    source: parsed.data.source,
    source_ref: parsed.data.source_ref ?? null,
    tags: parsed.data.tags ?? [],
    priority: parsed.data.priority ?? 'medium',
    status: 'draft',
    trace_id: parsed.data.trace_id ?? null,
  };
  const id = await insertEval(row);
  return NextResponse.json({ ok: true, id });
}
