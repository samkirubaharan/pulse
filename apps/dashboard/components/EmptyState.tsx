'use client';

// EmptyState — the "no spans yet" placeholder used inside every Observe tile
// before traffic lands. Pulsing ECG icon + title + subtitle + copy-friendly
// command hint, consistent across tiles so the layout doesn't jiggle when the
// first data arrives.
interface Props {
  title?: string;
  subtitle?: string;
  command?: string;
  height?: number;
}

export default function EmptyState({
  title = 'Waiting for spans',
  subtitle = 'Run the simulator to seed baselines.',
  command = 'pnpm --filter @pulse/simulator start -- --phase 1',
  height = 200,
}: Props) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-3 rounded-lg bg-gray-50/60 px-4 py-6 text-center"
      style={{ minHeight: height }}
    >
      <div className="relative flex h-10 w-10 items-center justify-center">
        <span
          className="absolute inset-0 rounded-full bg-sky-100 animate-pulse-ring"
          aria-hidden
        />
        <svg
          className="relative h-6 w-6 text-sky-600"
          viewBox="0 0 32 32"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M3 16h5l2-7 4 14 3-10 2 4h10" />
        </svg>
      </div>
      <div>
        <div className="text-sm font-medium text-gray-700">{title}</div>
        <div className="mt-0.5 text-xs text-gray-500">{subtitle}</div>
      </div>
      {command && (
        <code className="mt-1 inline-flex max-w-full items-center overflow-x-auto rounded-md border border-gray-200 bg-gray-100 px-2 py-1 font-mono text-[11px] text-gray-700">
          {command}
        </code>
      )}
    </div>
  );
}
