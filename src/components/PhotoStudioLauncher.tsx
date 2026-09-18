"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ImagePlus } from "lucide-react";

export default function PhotoStudioLauncher() {
  const pathname = usePathname();
  if (pathname !== "/") return null;

  return (
    <Link
      href="/photo-studio"
      className="group fixed bottom-[calc(9rem+env(safe-area-inset-bottom))] left-4 z-40 inline-flex min-h-11 items-center gap-2 rounded-full border border-fuchsia-200 bg-white/95 px-3.5 py-2.5 text-sm font-semibold text-fuchsia-700 shadow-lg shadow-fuchsia-950/10 backdrop-blur transition hover:-translate-y-0.5 hover:border-fuchsia-300 hover:bg-fuchsia-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-500 focus-visible:ring-offset-2 dark:border-fuchsia-900 dark:bg-slate-950/95 dark:text-fuchsia-300 dark:hover:border-fuchsia-700 dark:hover:bg-fuchsia-950/70 sm:bottom-20 sm:left-6"
      aria-label="Open Vidora Photo and Character Studio"
      title="Photo & Character Studio"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-600 to-fuchsia-600 text-white shadow-sm">
        <ImagePlus className="h-4 w-4" />
      </span>
      <span className="whitespace-nowrap">Photo Studio</span>
    </Link>
  );
}
