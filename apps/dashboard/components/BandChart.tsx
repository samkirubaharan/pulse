'use client';

// BandChart — a small Recharts wrapper that renders a line (and optional
// companion line) over a shaded σ-band area. Tremor's LineChart doesn't expose
// custom bands, so we drop to Recharts directly to get the shading right.
import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import type { TilePoint } from '@/lib/types';

interface Props {
  points: TilePoint[];
  band: { mean: number; stddev: number; n: number };
  k?: number;
  companionBand?: { mean: number; stddev: number; n: number };
  companionLabel?: string;
  primaryLabel?: string;
  height?: number;
}

const MIN_SAMPLES_FOR_BAND = 10;

export default function BandChart({
  points,
  band,
  k = 2,
  companionBand,
  companionLabel,
  primaryLabel = 'value',
  height = 180,
}: Props) {
  const bandActive = band.n >= MIN_SAMPLES_FOR_BAND;
  const data = points.map((p) => ({
    t: p.t,
    label: new Date(p.t).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }),
    value: p.value,
    companion: p.companion,
    bandLow: bandActive ? Math.max(0, band.mean - k * band.stddev) : null,
    bandSpan: bandActive ? 2 * k * band.stddev : null,
  }));

  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <ComposedChart
          data={data}
          margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: '#6b7280' }}
            interval="preserveStartEnd"
          />
          <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} width={36} />
          <Tooltip
            contentStyle={{ fontSize: 12, borderRadius: 8 }}
            labelStyle={{ color: '#111827' }}
          />
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
                fill="#60a5fa"
                fillOpacity={0.12}
                isAnimationActive={false}
                name={`±${k}σ band`}
              />
            </>
          )}
          <Line
            type="monotone"
            dataKey="value"
            stroke="#2563eb"
            strokeWidth={2}
            dot={false}
            name={primaryLabel}
            isAnimationActive={false}
          />
          {companionBand && (
            <Line
              type="monotone"
              dataKey="companion"
              stroke="#f59e0b"
              strokeWidth={2}
              dot={false}
              name={companionLabel ?? 'companion'}
              isAnimationActive={false}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
