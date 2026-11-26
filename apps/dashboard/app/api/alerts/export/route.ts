// GET /api/alerts/export?format=csv|json — download all alerts.
import { NextRequest, NextResponse } from 'next/server';
import { recentAlerts } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function csvEscape(v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  if (/[,"\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET(req: NextRequest) {
  const format = req.nextUrl.searchParams.get('format') ?? 'csv';
  const alerts = await recentAlerts(500);
  if (format === 'json') {
    return new NextResponse(JSON.stringify(alerts, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': 'attachment; filename="pulse-alerts.json"',
      },
    });
  }
  const header = [
    'id',
    'created_at',
    'detector',
    'severity',
    'status',
    'headline',
    'where_text',
    'why_text',
    'metric_name',
    'metric_value',
    'metric_mean',
    'metric_stddev',
    'companion_metric_name',
    'companion_metric_value',
    'trace_id',
    'acked_at',
    'resolved_at',
    'resolution_note',
    'flow',
  ];
  const rows = alerts.map((a) =>
    header
      .map((k) => csvEscape((a as unknown as Record<string, unknown>)[k]))
      .join(','),
  );
  const body = [header.join(','), ...rows].join('\n');
  return new NextResponse(body, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="pulse-alerts.csv"',
    },
  });
}
