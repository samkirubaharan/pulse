'use client';

// Nav — Observe / Alerts / Debug / Verify tabs.
// Verify is V&V (eval cases, test runs). Debug is the trace explorer.
// Flow filter lives below the nav as a cross-cutting chip bar.
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

interface NavItem {
  href: string;
  label: string;
  tagline?: string;
}

const ITEMS: NavItem[] = [
  { href: '/', label: 'Observe', tagline: 'Signal' },
  { href: '/alerts', label: 'Alerts', tagline: 'Act' },
  { href: '/debug', label: 'Debug', tagline: 'Zoom in' },
  { href: '/verify', label: 'Verify', tagline: 'Harden' },
];

export default function Nav() {
  const pathname = usePathname() ?? '/';
  const sp = useSearchParams();
  const qs = sp.toString();

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname === href || pathname.startsWith(href + '/');
  };

  // Preserve the flow filter across tabs.
  const withQs = (href: string) => (qs ? `${href}?${qs}` : href);

  return (
    <nav className="flex items-center gap-1 text-sm" aria-label="Primary">
      {ITEMS.map((it) => {
        const active = isActive(it.href);
        return (
          <Link
            key={it.href}
            href={withQs(it.href)}
            aria-current={active ? 'page' : undefined}
            className={[
              'relative rounded-md px-3 py-1.5 font-medium transition-colors duration-150',
              active
                ? 'bg-sky-50 text-sky-700'
                : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900',
            ].join(' ')}
            title={it.tagline}
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
    </nav>
  );
}
