'use client';

// Observe surface — 8 tiles per DESIGN.md:
//   Top strip (always green): uptime / p95 latency / error rate / requests
//   5 primary drift tiles (grid)
//   Semantic tiles: Grounding %, Novel-Intent inbox
//
// Polls /api/stats every 5s. Shows skeletons + "Waiting for spans…" placeholders
// in each tile before any data arrives.
import { useEffect, useState } from 'react';
import {
  Card,
  Metric,
  Text,
  Title,
  Badge,
  BarChart,
  List,
  ListItem,
} from '@tremor/react';
import BandChart from '@/components/BandChart';
import Sparkline from '@/components/Sparkline';
import type { StatsResponse } from '@/lib/types';

const REFRESH_MS = 5000;

function Skeleton({ height = 180 }: { height?: number }) {
  return (
    <div
      className="flex items-center justify-center rounded-md bg-gray-50 text-xs text-gray-400"
      style={{ height }}
    >
      Waiting for spans…
    </div>
  );
}

export default function ObservePage() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch('/api/stats', { cache: 'no-store' });
        if (!res.ok) throw new Error(`${res.status}`);
        const body = (await res.json()) as StatsResponse;
        if (!cancelled) {
          setStats(body);
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

  const empty = !stats || stats.traffic.request_count === 0;

  return (
    <div className="flex flex-col gap-6">
      {/* ---- Top strip: traditional 4 (always green per DESIGN.md) -------- */}
      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <TopStat
          label="Uptime"
          value="100.0%"
          sub="last 15 min"
          tone="emerald"
        />
        <TopStat
          label="p95 Latency"
          value={
            stats ? `${Math.round(stats.traffic.p95_latency_ms)} ms` : '—'
          }
          sub="clipped to green"
          tone="emerald"
        />
        <TopStat label="Error rate" value="0.0%" sub="HTTP 200s" tone="emerald" />
        <TopStat
          label="Requests"
          value={stats ? String(stats.traffic.request_count) : '—'}
          sub="traces, last 15m"
          tone="emerald"
        />
      </section>

      {error && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          stats fetch error: {error}
        </div>
      )}

      {/* ---- Primary 5 drift tiles -------------------------------------- */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* 1. Turn count per task */}
        <Card>
          <div className="mb-1 flex items-center justify-between">
            <Title>Turn count per task</Title>
            <Badge color="blue">factor #1</Badge>
          </div>
          <Text>Per-trace iterations with σ-band.</Text>
          <div className="mt-3">
            {empty ? (
              <Skeleton />
            ) : (
              <BandChart
                points={stats!.turn_count.points}
                band={stats!.turn_count.band}
                k={2}
                primaryLabel="turns"
              />
            )}
          </div>
        </Card>

        {/* 2. Output tokens per call + $ overlay */}
        <Card>
          <div className="mb-1 flex items-center justify-between">
            <Title>Output tokens per call</Title>
            <Badge color="blue">factor #2</Badge>
          </div>
          <Text>
            σ-band on tokens; $ overlay below (cumulative recent cost).
          </Text>
          <div className="mt-3">
            {empty ? (
              <Skeleton />
            ) : (
              <>
                <BandChart
                  points={stats!.output_tokens.points}
                  band={stats!.output_tokens.band}
                  k={2}
                  primaryLabel="output tokens"
                />
                <div className="mt-2">
                  <div className="text-xs text-gray-500">$ per call</div>
                  <Sparkline
                    points={stats!.output_cost}
                    color="#10b981"
                    height={36}
                  />
                </div>
              </>
            )}
          </div>
        </Card>

        {/* 3. Input tokens + cache_read_tokens (paired) */}
        <Card>
          <div className="mb-1 flex items-center justify-between">
            <Title>Input + cache_read tokens</Title>
            <Badge color="blue">factor #3 · paired</Badge>
          </div>
          <Text>
            Both must move together to count as a real cache invalidation.
          </Text>
          <div className="mt-3">
            {empty ? (
              <Skeleton />
            ) : (
              <BandChart
                points={stats!.input_vs_cache.points}
                band={stats!.input_vs_cache.band}
                companionBand={stats!.input_vs_cache.companion_band}
                companionLabel="cache_read"
                primaryLabel="input tokens"
                k={2}
              />
            )}
          </div>
        </Card>

        {/* 4. Latency */}
        <Card>
          <div className="mb-1 flex items-center justify-between">
            <Title>Latency</Title>
            <div className="flex items-center gap-2">
              <Badge color="blue">factor #4</Badge>
              {stats && (
                <Badge
                  color={
                    stats.latency_ms.consecutive_breaches >= 3
                      ? 'red'
                      : stats.latency_ms.consecutive_breaches > 0
                      ? 'amber'
                      : 'emerald'
                  }
                >
                  consecutive: {stats.latency_ms.consecutive_breaches}
                </Badge>
              )}
            </div>
          </div>
          <Text>Wider σ-band (k=3); fires after 3 consecutive breaches.</Text>
          <div className="mt-3">
            {empty ? (
              <Skeleton />
            ) : (
              <BandChart
                points={stats!.latency_ms.points}
                band={stats!.latency_ms.band}
                k={3}
                primaryLabel="latency ms"
              />
            )}
          </div>
        </Card>

        {/* 5. Tool calls — count + composition */}
        <Card className="lg:col-span-2">
          <div className="mb-1 flex items-center justify-between">
            <Title>Tool calls per task</Title>
            <Badge color="blue">factor #5</Badge>
          </div>
          <Text>
            σ-band on count (left) + composition over tool.name (right).
          </Text>
          <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              {empty ? (
                <Skeleton />
              ) : (
                <BandChart
                  points={stats!.tool_call_count.points}
                  band={stats!.tool_call_count.band}
                  k={2}
                  primaryLabel="tool calls"
                />
              )}
            </div>
            <div>
              {empty || stats!.tool_composition.length === 0 ? (
                <Skeleton />
              ) : (
                <BarChart
                  data={stats!.tool_composition}
                  index="name"
                  categories={['count']}
                  colors={['indigo']}
                  showLegend={false}
                  yAxisWidth={30}
                  className="h-44"
                />
              )}
            </div>
          </div>
        </Card>
      </section>

      {/* ---- Semantic tiles -------------------------------------------- */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* 6. Grounding % */}
        <Card>
          <div className="mb-1 flex items-center justify-between">
            <Title>Grounding %</Title>
            <Badge color="violet">semantic</Badge>
          </div>
          <Text>Derived from retrieval top-hit similarity.</Text>
          <div className="mt-3">
            {empty ? (
              <Skeleton height={80} />
            ) : (
              <>
                <Metric>{stats!.grounding_pct.current}%</Metric>
                <div className="mt-2">
                  <Sparkline
                    points={stats!.grounding_pct.series}
                    color="#7c3aed"
                    height={60}
                  />
                </div>
              </>
            )}
          </div>
        </Card>

        {/* 7. Novel-Intent inbox */}
        <Card className="lg:col-span-2">
          <div className="mb-1 flex items-center justify-between">
            <Title>Novel-Intent inbox</Title>
            <Badge color="violet">semantic</Badge>
          </div>
          <Text>
            Queries whose top retrieval score fell below the grounding floor
            (0.45), grouped by nearest KB doc — newest first.
          </Text>
          <div className="mt-3">
            {empty || !stats || stats.novel_intent.length === 0 ? (
              <Skeleton height={120} />
            ) : (
              <List className="max-h-72 overflow-auto">
                {stats.novel_intent.map((q, i) => (
                  <ListItem key={i}>
                    <div className="flex w-full flex-col">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-900">
                          {q.query}
                        </span>
                        <Badge color="amber">
                          sim {q.score.toFixed(2)}
                        </Badge>
                      </div>
                      <span className="mt-0.5 text-xs text-gray-500">
                        nearest: {q.nearest_doc}
                      </span>
                    </div>
                  </ListItem>
                ))}
              </List>
            )}
          </div>
        </Card>
      </section>

      <div className="text-xs text-gray-400">
        refreshes every 5s · last 15 minutes of spans
      </div>
    </div>
  );
}

function TopStat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone: 'emerald' | 'amber' | 'red';
}) {
  return (
    <Card>
      <div className="flex items-start justify-between">
        <div>
          <Text>{label}</Text>
          <Metric>{value}</Metric>
          {sub && <Text className="mt-0.5 text-xs">{sub}</Text>}
        </div>
        <Badge color={tone}>OK</Badge>
      </div>
    </Card>
  );
}
