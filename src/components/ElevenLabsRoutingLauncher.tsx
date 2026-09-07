"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Mic2, Route } from "lucide-react";

export default function ElevenLabsRoutingLauncher() {
  const pathname = usePathname();
  if (pathname !== "/admin/providers") return null;

  return (
    <Link
      href="/admin/providers/voice-routing"
      className="fixed bottom-5 right-5 z-40 flex items-center gap-3 rounded-2xl border bg-background/95 px-4 py-3 shadow-xl backdrop-blur transition hover:-translate-y-0.5 hover:shadow-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:bottom-6 sm:right-6"
      aria-label="Open ElevenLabs voice routing editor"
    >
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground">
        <Route className="h-4 w-4" />
      </span>
      <span className="hidden sm:block">
        <span className="flex items-center gap-1.5 text-sm font-semibold">
          <Mic2 className="h-3.5 w-3.5" />Voice routing
        </span>
        <span className="block text-xs text-muted-foreground">Accent & language maps</span>
      </span>
    </Link>
  );
}
