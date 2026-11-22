'use client';

import {
  LineChart,
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
}

export default function Sparkline({
  points,
  band,
  k = 2,
  height = 48,
  color = '#2563eb',
}: Props) {
  if (points.length === 0) {
    return (
      <div
        style={{ height }}
        className="flex items-center text-xs text-gray-400"
      >
        no data yet
      </div>
    );
  }
  const bandActive = band && band.n >= 10;
  const data = points.map((p) => ({
    value: p.value,
    bandLow: bandActive ? Math.max(0, band!.mean - k * band!.stddev) : null,
    bandSpan: bandActive ? 2 * k * band!.stddev : null,
  }));
  return (
    <div style={{ width: '100%', height }}>
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
          <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={1.75}
            dot={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
