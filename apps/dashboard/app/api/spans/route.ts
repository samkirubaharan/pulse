// POST /api/spans — zod-validate and bulk-insert spans.
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { insertSpans } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SpanSchema = z.object({
  trace_id: z.string().min(1),
  span_id: z.string().min(1),
  parent_span_id: z.string().nullable(),
  kind: z.enum(['retrieval', 'tool_call', 'llm_call', 'judge']),
  start_ts: z.string().min(1),
  end_ts: z.string().min(1),
  latency_ms: z.number().nonnegative(),
  attrs: z.record(z.any()).default({}),
});

const BodySchema = z.object({ spans: z.array(SpanSchema) });

export async function POST(req: NextRequest) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'invalid-json' },
      { status: 400 },
    );
  }
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'validation', issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const inserted = await insertSpans(parsed.data.spans);
  return NextResponse.json({ ok: true, inserted });
}
