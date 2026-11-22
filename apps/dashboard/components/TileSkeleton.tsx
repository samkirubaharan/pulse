'use client';

// TileSkeleton — shimmer placeholder matching the eventual tile shape so the
// layout doesn't jump on first paint.
interface Props {
  height?: number;
  showFooter?: boolean;
}

export default function TileSkeleton({
  height = 200,
  showFooter = true,
}: Props) {
  return (
    <div
      className="flex flex-col gap-3 rounded-lg p-1"
      aria-hidden
      style={{ minHeight: height }}
    >
      <div className="shimmer h-24 w-full rounded-md" />
      <div className="shimmer h-24 w-full rounded-md opacity-70" />
      {showFooter && (
        <div className="flex gap-2">
          <div className="shimmer h-3 w-14 rounded" />
          <div className="shimmer h-3 w-14 rounded" />
          <div className="shimmer h-3 w-14 rounded" />
        </div>
      )}
    </div>
  );
}
