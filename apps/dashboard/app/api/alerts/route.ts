// GET /api/alerts — current alert inbox, newest first.
import { NextResponse } from 'next/server';
import { recentAlerts } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const alerts = await recentAlerts(100);
  return NextResponse.json(alerts);
}
