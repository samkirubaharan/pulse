import type { Metadata } from 'next';
import { Suspense } from 'react';
import './globals.css';
import Nav from '@/components/Nav';
import FlowFilter from '@/components/FlowFilter';

export const metadata: Metadata = {
  title: 'Pulse — Observability for LLMs',
  description:
    'Pulse: observability for LLMs. Observe / Alerts / Debug on top of a single stream of agent spans.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased">
        <header className="sticky top-0 z-20 border-b border-gray-200 bg-white/85 backdrop-blur-md">
          <div className="mx-auto flex w-full max-w-[1600px] items-center justify-between px-6 py-3">
            <div className="flex items-center gap-3">
              <span className="relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-50">
                <svg
                  className="h-5 w-5 text-sky-600"
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
              </span>
              <div>
                <div className="text-sm font-semibold leading-none tracking-tight text-gray-900">
                  Pulse
                </div>
                <div className="mt-1 text-[11px] font-medium uppercase tracking-wider text-gray-500">
                  Observability for LLMs
                </div>
              </div>
            </div>
            <Suspense fallback={<div className="h-7 w-40" />}>
              <Nav />
            </Suspense>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1600px] px-6 py-6">
          <div className="mb-6">
            <Suspense fallback={<div className="h-16 rounded-xl border border-gray-200 bg-white" />}>
              <FlowFilter />
            </Suspense>
          </div>
          <Suspense fallback={<div className="h-64 rounded-xl border border-gray-200 bg-white" />}>
            {children}
          </Suspense>
        </main>
      </body>
    </html>
  );
}
