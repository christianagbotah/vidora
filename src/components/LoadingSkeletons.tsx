"use client";

export function StudioSkeleton() {
  return (
    <div className="flex h-full flex-col gap-4">
      {/* Header bar */}
      <div className="flex items-center gap-4 rounded-lg bg-muted p-4">
        <div className="shimmer h-8 w-48 rounded-md" />
        <div className="shimmer ml-auto h-8 w-24 rounded-md" />
        <div className="shimmer h-8 w-8 rounded-md" />
      </div>

      <div className="flex flex-1 gap-4 overflow-hidden">
        {/* Sidebar-like panel */}
        <div className="hidden w-64 flex-shrink-0 flex-col gap-3 rounded-lg bg-muted p-4 md:flex">
          <div className="shimmer h-5 w-24 rounded" />
          <div className="mt-2 flex flex-col gap-2">
            <div className="shimmer h-4 w-full rounded" />
            <div className="shimmer h-4 w-5/6 rounded" />
            <div className="shimmer h-4 w-4/6 rounded" />
          </div>
          <div className="shimmer mt-4 h-5 w-20 rounded" />
          <div className="mt-2 flex flex-col gap-2">
            <div className="shimmer h-4 w-full rounded" />
            <div className="shimmer h-4 w-3/4 rounded" />
          </div>
          <div className="shimmer mt-auto h-10 w-full rounded-md" />
        </div>

        {/* Main area with 3 scene card placeholders */}
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="flex flex-col gap-3 rounded-lg bg-muted p-4"
              >
                {/* Thumbnail area */}
                <div className="shimmer aspect-video w-full rounded-lg" />
                {/* Text lines */}
                <div className="shimmer h-4 w-3/4 rounded" />
                <div className="shimmer h-3 w-full rounded" />
                <div className="shimmer h-3 w-5/6 rounded" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function GallerySkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="flex flex-col gap-3 rounded-lg bg-muted p-4"
        >
          {/* Thumbnail area */}
          <div className="shimmer aspect-video w-full rounded-lg" />
          {/* Title line */}
          <div className="shimmer h-5 w-3/4 rounded" />
          {/* Metadata lines */}
          <div className="flex gap-3">
            <div className="shimmer h-3 w-16 rounded" />
            <div className="shimmer h-3 w-20 rounded" />
            <div className="shimmer h-3 w-14 rounded" />
          </div>
          <div className="shimmer h-3 w-1/2 rounded" />
        </div>
      ))}
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      {/* Stats cards row - 4 stat cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="flex flex-col gap-3 rounded-lg bg-muted p-4"
          >
            <div className="shimmer h-4 w-24 rounded" />
            <div className="shimmer h-8 w-16 rounded" />
            <div className="shimmer h-3 w-32 rounded" />
          </div>
        ))}
      </div>

      {/* Recent activity list - 5 placeholder rows */}
      <div className="flex flex-col gap-3 rounded-lg bg-muted p-4">
        <div className="shimmer mb-2 h-5 w-40 rounded" />
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 rounded-lg border border-border/50 bg-background/50 p-3"
          >
            <div className="shimmer h-10 w-10 flex-shrink-0 rounded-full" />
            <div className="flex flex-1 flex-col gap-2">
              <div className="shimmer h-4 w-3/4 rounded" />
              <div className="shimmer h-3 w-1/2 rounded" />
            </div>
            <div className="shimmer h-3 w-20 flex-shrink-0 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
