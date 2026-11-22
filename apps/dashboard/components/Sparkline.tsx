'use client';

import {
  Line,
  ResponsiveContainer,
  YAxis,
  Area,
  ComposedChart,
} from 'recharts';
import type { TilePoint } from '@/lib/types';

interface Props {
  points: TilePoint[];
  band?: { mean: number; stddev: number; n: number };
  k?: number;
  height?: number;
  color?: string;
  /** Optional soft fill under the main line (small sparklines look better with
   * a subtle area wash). Defaults to the line color at 0.12 opacity. */
  fill?: string;
  // Optional companion line — rendered when any point carries a `companion`
  // value. Used by the Alerts page to show paired signals (e.g. cache
  // invalidation: input_tokens + cache_read_tokens on one sparkline).
  companionColor?: string;
}

export default function Sparkline({
  points,
  band,
  k = 2,
  height = 48,
  color = '#2563eb',
  fill,
  companionColor = '#f59e0b',
}: Props) {
  if (points.length === 0) {
    return (
      <div
        style={{ height }}
        className="flex items-center justify-start text-[10px] text-gray-400"
      >
        no data yet
      </div>
    );
  }
  const bandActive = band && band.n >= 10;
  const hasCompanion = points.some((p) => p.companion != null);
  const data = points.map((p) => ({
    value: p.value,
    companion: p.companion,
    bandLow: bandActive ? Math.max(0, band!.mean - k * band!.stddev) : null,
    bandSpan: bandActive ? 2 * k * band!.stddev : null,
  }));
  const showSoftArea = fill != null && !bandActive;
  const areaFill = fill ?? color;
  return (
    <div style={{ width: '100%', height }} aria-hidden>
      <ResponsiveContainer>
        <ComposedChart
          data={data}
          margin={{ top: 2, right: 2, left: 2, bottom: 2 }}
        >
          <YAxis hide domain={['auto', 'auto']} />
          {bandActive && (
            <>
              <Area
                type="monotone"
                dataKey="bandLow"
                stackId="band"
                stroke="none"
                fill="transparent"
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                dataKey="bandSpan"
                stackId="band"
                stroke="none"
                fill={color}
                fillOpacity={0.12}
                isAnimationActive={false}
              />
            </>
          )}
          {showSoftArea && (
            <Area
              type="monotone"
              dataKey="value"
              stroke="none"
              fill={areaFill}
              fillOpacity={0.1}
              isAnimationActive={false}
            />
          )}
          <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={1.75}
            dot={false}
            isAnimationActive={false}
          />
          {hasCompanion && (
            <Line
              type="monotone"
              dataKey="companion"
              stroke={companionColor}
              strokeWidth={1.5}
              strokeDasharray="3 2"
              dot={false}
              isAnimationActive={false}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
