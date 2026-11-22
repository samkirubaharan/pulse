'use client';

// Tile — one card chrome to rule every Observe tile.
// Variants:
//   state: 'ok' | 'warn' | 'breach' | 'muted'  → subtle border + status chip
//
// Layout slots:
//   title / subtitle / badge (right of title row)
//   icon  (small, left of title)
//   children (chart or content)
//   footer (stat row, e.g. mean / σ / breaches)
//
// Deliberately plain Tailwind (no Tremor <Card>) so we control padding,
// border, radius, and the breach outline precisely.
import type { ReactNode } from 'react';

export type TileState = 'ok' | 'warn' | 'breach' | 'muted';

interface Props {
  title: string;
  subtitle?: string;
  state?: TileState;
  badge?: ReactNode;
  icon?: ReactNode;
  footer?: ReactNode;
  className?: string;
  children: ReactNode;
  /** ARIA description for screen readers summarising the chart content. */
  srDescription?: string;
}

const STATE_RING: Record<TileState, string> = {
  ok: 'border-gray-200',
  warn: 'border-amber-300 ring-1 ring-amber-200',
  breach: 'border-rose-300 ring-1 ring-rose-200',
  muted: 'border-gray-200',
};

const STATE_CHIP: Record<TileState, { label: string; cls: string }> = {
  ok: {
    label: 'OK',
    cls: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  },
  warn: {
    label: 'WATCH',
    cls: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  },
  breach: {
    label: 'BREACH',
    cls: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200',
  },
  muted: {
    label: 'MUTED',
    cls: 'bg-gray-100 text-gray-500 ring-1 ring-gray-200',
  },
};

export default function Tile({
  title,
  subtitle,
  state = 'ok',
  badge,
  icon,
  footer,
  className = '',
  children,
  srDescription,
}: Props) {
  const chip = STATE_CHIP[state];
  return (
    <section
      className={[
        'group relative flex flex-col overflow-hidden rounded-xl border bg-white p-5 shadow-sm transition-all duration-150',
        STATE_RING[state],
        className,
      ].join(' ')}
      aria-label={title}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          {icon && (
            <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-sky-50 text-sky-600">
              {icon}
            </span>
          )}
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold leading-5 text-gray-900">
              {title}
            </h3>
            {subtitle && (
              <p className="mt-0.5 line-clamp-2 text-xs leading-4 text-gray-500">
                {subtitle}
              </p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {badge}
          <span
            className={[
              'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
              chip.cls,
            ].join(' ')}
          >
            {chip.label}
          </span>
        </div>
      </header>

      <div className="mt-4 flex-1">{children}</div>

      {footer && (
        <footer className="mt-4 border-t border-gray-100 pt-3 text-xs text-gray-600">
          {footer}
        </footer>
      )}

      {srDescription && <span className="sr-only">{srDescription}</span>}
    </section>
  );
}
