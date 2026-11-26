// GET /api/evals/export?format=jsonl|json
// Exports eval cases in a format you can pipe into an external eval harness.
import { NextRequest, NextResponse } from 'next/server';
import { listEvals } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const format = req.nextUrl.searchParams.get('format') ?? 'jsonl';
  const rows = await listEvals();
  if (format === 'json') {
    return new NextResponse(JSON.stringify(rows, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': 'attachment; filename="pulse-evals.json"',
      },
    });
  }
  const body = rows.map((r) => JSON.stringify(r)).join('\n');
  return new NextResponse(body, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Content-Disposition': 'attachment; filename="pulse-evals.jsonl"',
    },
  });
}
