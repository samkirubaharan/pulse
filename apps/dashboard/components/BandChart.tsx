'use client';

// BandChart — a small Recharts wrapper that renders a line (and optional
// companion line) over a shaded σ-band area. Tremor's LineChart doesn't expose
// custom bands, so we drop to Recharts directly to get the shading right.
//
// Colours:
//   band fill         sky-300 @ ~0.28 opacity
//   band stroke       sky-200
//   primary line      sky-600, 2px (flips to rose-500 when `breach`)
//   companion line    amber-500, 2px dashed
import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
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
  /** When true, the primary line draws in rose to signal BREACH. */
  breach?: boolean;
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
  breach = false,
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

  const primaryStroke = breach ? '#e11d48' /* rose-600 */ : '#0284c7' /* sky-600 */;

  return (
    <div
      style={{ width: '100%', height }}
      className="text-xs tabular-nums"
      role="img"
      aria-label={`${primaryLabel} chart with sigma band`}
    >
      <ResponsiveContainer>
        <ComposedChart
          data={data}
          margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: '#9ca3af' }}
            tickLine={false}
            axisLine={{ stroke: '#e5e7eb' }}
            interval="preserveStartEnd"
            minTickGap={24}
          />
          <YAxis
            tick={{ fontSize: 10, fill: '#9ca3af' }}
            tickLine={false}
            axisLine={false}
            width={34}
          />
          <Tooltip
            contentStyle={{
              fontSize: 12,
              borderRadius: 8,
              border: '1px solid #e5e7eb',
              boxShadow: '0 4px 12px rgba(0,0,0,0.06)',
            }}
            labelStyle={{ color: '#111827', fontWeight: 500 }}
            cursor={{ stroke: '#cbd5e1', strokeWidth: 1 }}
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
                stroke="#bae6fd"
                strokeWidth={0.5}
                fill="#7dd3fc"
                fillOpacity={0.28}
                isAnimationActive={false}
                name={`±${k}σ band`}
              />
              <ReferenceLine
                y={band.mean}
                stroke="#94a3b8"
                strokeDasharray="4 4"
                strokeWidth={1}
                ifOverflow="extendDomain"
              />
            </>
          )}
          <Line
            type="monotone"
            dataKey="value"
            stroke={primaryStroke}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 3, strokeWidth: 0, fill: primaryStroke }}
            name={primaryLabel}
            isAnimationActive={false}
          />
          {companionBand && (
            <Line
              type="monotone"
              dataKey="companion"
              stroke="#f59e0b"
              strokeWidth={1.75}
              strokeDasharray="4 3"
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
