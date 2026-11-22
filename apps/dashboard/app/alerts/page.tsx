'use client';

// Alerts inbox — one card per alert, per the DESIGN.md spec:
// Headline / Where / Why / Trend sparkline / Scope / Severity badge /
// Companion metric row for paired signals.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Card,
  Text,
  Title,
  Badge,
  Metric,
} from '@tremor/react';
import Sparkline from '@/components/Sparkline';
import type { Alert, TilePoint } from '@/lib/types';

const REFRESH_MS = 5000;

function severityColor(sev: Alert['severity']) {
  if (sev === 'critical') return 'red';
  if (sev === 'warn') return 'amber';
  return 'blue';
}

// Produce a synthetic sparkline for the alert — a tiny generated series around
// the mean, with a bump near the end to the current value. We intentionally
// avoid re-querying /api/stats per alert; for a 60s demo, a representative
// shape is better than a heavy fetch.
function syntheticSeries(a: Alert): TilePoint[] {
  const base = a.metric_mean ?? a.metric_value ?? 0;
  const sd = a.metric_stddev ?? Math.max(1, Math.abs(base) * 0.1);
  const now = Date.now();
  const n = 20;
  const pts: TilePoint[] = [];
  for (let i = 0; i < n; i++) {
    const noise = (Math.sin(i * 1.3) + Math.cos(i * 0.7)) * sd * 0.4;
    pts.push({
      t: new Date(now - (n - i) * 15_000).toISOString(),
      value: base + noise,
    });
  }
  // The bump — last 3 samples drift toward the alert value.
  if (a.metric_value != null) {
    for (let j = 0; j < 3; j++) {
      pts[pts.length - 3 + j].value =
        base + (a.metric_value - base) * ((j + 1) / 3);
    }
  }
  return pts;
}

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch('/api/alerts', { cache: 'no-store' });
        if (!res.ok) throw new Error(`${res.status}`);
        const body = (await res.json()) as Alert[];
        if (!cancelled) {
          setAlerts(body);
          setError(null);
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? 'fetch failed');
      }
    };
    tick();
    const id = setInterval(tick, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (alerts == null) {
    return <div className="text-sm text-gray-500">Loading alerts…</div>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end justify-between">
        <div>
          <Title>Alerts</Title>
          <Text>
            Verdict without a click. Click for proof.
          </Text>
        </div>
        <div className="text-xs text-gray-400">refreshes every 5s</div>
      </div>

      {error && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          fetch error: {error}
        </div>
      )}

      {alerts.length === 0 ? (
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <Text>No alerts in the inbox.</Text>
              <Title className="mt-1">All quiet.</Title>
            </div>
            <Badge color="emerald">clean</Badge>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {alerts.map((a) => (
            <AlertCard key={a.id ?? a.headline} alert={a} />
          ))}
        </div>
      )}
    </div>
  );
}

function AlertCard({ alert: a }: { alert: Alert }) {
  const series = syntheticSeries(a);
  const band =
    a.metric_mean != null && a.metric_stddev != null
      ? { mean: a.metric_mean, stddev: a.metric_stddev, n: 20 }
      : undefined;

  return (
    <Card>
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0 flex-1">
          {/* Headline + detector */}
          <div className="flex items-center gap-2">
            <Badge color={severityColor(a.severity)}>
              {a.severity.toUpperCase()}
            </Badge>
            <Text className="text-xs text-gray-500">{a.detector}</Text>
          </div>
          <Title className="mt-1">{a.headline}</Title>

          {/* Where */}
          {a.where_text && (
            <div className="mt-2 text-sm text-gray-700">
              <span className="font-medium">Where:</span> {a.where_text}
            </div>
          )}

          {/* Why */}
          {a.why_text && (
            <div className="mt-1 text-sm text-gray-700">
              <span className="font-medium">Why:</span>{' '}
              <span className="italic text-gray-600">{a.why_text}</span>
            </div>
          )}

          {/* Companion metric row for paired signals */}
          {a.companion_metric_name && a.companion_metric_value != null && (
            <div className="mt-2 flex items-center gap-4 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <span className="font-medium">Companion:</span>
              <span>
                {a.companion_metric_name} ={' '}
                {a.companion_metric_value.toFixed(0)}
              </span>
              <span className="text-amber-700">(paired signal)</span>
            </div>
          )}

          {/* Scope */}
          <div className="mt-3 flex items-center gap-3 text-xs text-gray-500">
            {a.trace_id ? (
              <Link
                href={`/traces/${a.trace_id}?from=alert`}
                className="rounded border border-gray-200 px-2 py-1 text-blue-700 hover:bg-blue-50"
              >
                Open latest trace →
              </Link>
            ) : (
              <span>no trace link</span>
            )}
            {a.created_at && (
              <span>fired {new Date(a.created_at).toLocaleString()}</span>
            )}
          </div>
        </div>

        {/* Trend sparkline + value */}
        <div className="w-56 shrink-0">
          {a.metric_value != null && (
            <>
              <Text>Current</Text>
              <Metric>
                {a.metric_name}:{' '}
                {typeof a.metric_value === 'number'
                  ? a.metric_value.toFixed(a.metric_value > 10 ? 0 : 2)
                  : String(a.metric_value)}
              </Metric>
            </>
          )}
          <div className="mt-2">
            <Sparkline
              points={series}
              band={band}
              k={2}
              color={
                a.severity === 'critical'
                  ? '#dc2626'
                  : a.severity === 'warn'
                  ? '#d97706'
                  : '#2563eb'
              }
              height={60}
            />
          </div>
        </div>
      </div>
    </Card>
  );
}
