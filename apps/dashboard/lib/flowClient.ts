'use client';

// Flow filter state — shared across Observe / Alerts / Debug / Verify via URL
// query param (?flow=<flow>) so a filtered view survives navigation.
//
// Using URL state rather than a context/provider keeps every tab's "copy this
// link" link honest, and avoids a hydration flash.
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import type { Flow } from './types';
import { FLOW_ORDER, isFlow } from './flows';

export function useFlow(): [Flow, (f: Flow) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const raw = sp.get('flow');
  const current: Flow = isFlow(raw) ? (raw as Flow) : 'all';
  const setFlow = useCallback(
    (f: Flow) => {
      const next = new URLSearchParams(sp.toString());
      if (f === 'all') next.delete('flow');
      else next.set('flow', f);
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    },
    [router, pathname, sp],
  );
  return [current, setFlow];
}

export function flowQuery(f: Flow): string {
  return f === 'all' ? '' : `?flow=${encodeURIComponent(f)}`;
}

export { FLOW_ORDER, isFlow };
