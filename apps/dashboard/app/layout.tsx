import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'LLM Drift Dashboard',
  description:
    'Observe / Alerts / Debug — a three-surface dashboard for silent LLM drift.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900">
        <header className="sticky top-0 z-20 border-b border-gray-200 bg-white/80 backdrop-blur">
          <div className="mx-auto flex w-full max-w-[1600px] items-center justify-between px-6 py-3">
            <div className="flex items-center gap-3">
              <div className="h-7 w-7 rounded-md bg-gradient-to-br from-blue-500 to-indigo-600" />
              <div>
                <div className="text-sm font-semibold leading-none">
                  LLM Drift Dashboard
                </div>
                <div className="mt-0.5 text-xs text-gray-500">
                  Observe · Alert · Debug
                </div>
              </div>
            </div>
            <nav className="flex items-center gap-1 text-sm">
              <Link
                href="/"
                className="rounded-md px-3 py-1.5 text-gray-700 hover:bg-gray-100"
              >
                Observe
              </Link>
              <Link
                href="/alerts"
                className="rounded-md px-3 py-1.5 text-gray-700 hover:bg-gray-100"
              >
                Alerts
              </Link>
              <span
                className="rounded-md px-3 py-1.5 text-gray-400"
                title="Debug opens from an alert or trace link"
              >
                Debug
              </span>
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1600px] px-6 py-6">
          {children}
        </main>
      </body>
    </html>
  );
}
