'use client';

// Nav — client component so we can read the active path and highlight the
// correct tab. Kept small and self-contained; the layout stays server-rendered
// (metadata lives there).
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface NavItem {
  href: string;
  label: string;
  /** When true, this link is disabled unless a trace is active. */
  conditional?: boolean;
  title?: string;
}

const ITEMS: NavItem[] = [
  { href: '/', label: 'Observe' },
  { href: '/alerts', label: 'Alerts' },
];

export default function Nav() {
  const pathname = usePathname() ?? '/';

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname === href || pathname.startsWith(href + '/');
  };
  const traceActive = pathname.startsWith('/traces/');

  return (
    <nav className="flex items-center gap-1 text-sm" aria-label="Primary">
      {ITEMS.map((it) => {
        const active = isActive(it.href);
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={active ? 'page' : undefined}
            className={[
              'relative rounded-md px-3 py-1.5 font-medium transition-colors duration-150',
              active
                ? 'bg-sky-50 text-sky-700'
                : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900',
            ].join(' ')}
          >
            {it.label}
            {active && (
              <span
                aria-hidden
                className="absolute inset-x-2 -bottom-[11px] h-0.5 rounded-full bg-sky-500"
              />
            )}
          </Link>
        );
      })}
      <Link
        href={traceActive ? pathname : '/traces/latest'}
        aria-current={traceActive ? 'page' : undefined}
        className={[
          'relative rounded-md px-3 py-1.5 font-medium transition-colors duration-150',
          traceActive
            ? 'bg-sky-50 text-sky-700'
            : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900',
        ].join(' ')}
        title={traceActive ? undefined : 'Open the most recent trace'}
      >
        Debug
        {traceActive && (
          <span
            aria-hidden
            className="absolute inset-x-2 -bottom-[11px] h-0.5 rounded-full bg-sky-500"
          />
        )}
      </Link>
    </nav>
  );
}
