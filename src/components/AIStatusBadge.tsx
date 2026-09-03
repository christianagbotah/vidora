"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, XCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type AIStatus = "checking" | "ok" | "degraded" | "down";

interface HealthResponse {
  status: "ok" | "degraded" | "down";
  message: string;
  checkedAt: number;
  cached?: boolean;
}

/**
 * AI Service Status Badge
 *
 * Polls /api/ai/health on mount (and every 5 min) to show users whether
 * the AI engine is operational before they attempt to generate content.
 *
 * States:
 *  - checking: grey spinner
 *  - ok: green dot + "AI Online"
 *  - degraded: amber dot + tooltip with the real message (e.g. "Insufficient balance")
 *  - down: red dot + tooltip
 */
export function AIStatusBadge({ compact = false }: { compact?: boolean }) {
  const [status, setStatus] = useState<AIStatus>("checking");
  const [message, setMessage] = useState<string>("");

  useEffect(() => {
    let mounted = true;
    // Single transient network blips shouldn't flash the badge red —
    // only show "down" after 2 consecutive failed checks.
    let consecutiveFailures = 0;

    async function check() {
      try {
        const res = await fetch("/api/ai/health", { cache: "no-store" });
        if (!res.ok) {
          consecutiveFailures++;
          if (mounted && consecutiveFailures >= 2) {
            setStatus("down");
            setMessage("AI service unreachable");
          }
          return;
        }
        const data: HealthResponse = await res.json();
        if (!mounted) return;
        consecutiveFailures = 0;
        setStatus(data.status);
        setMessage(data.message);
      } catch {
        consecutiveFailures++;
        if (mounted && consecutiveFailures >= 2) {
          setStatus("down");
          setMessage("Failed to reach AI service");
        }
        // Single blip: keep the previous status; the next 5-min tick
        // (or the badge remounting) re-checks automatically.
      }
    }

    check();
    // Re-check every 5 minutes
    const interval = setInterval(check, 5 * 60 * 1000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const config = {
    checking: {
      icon: Loader2,
      dot: "bg-slate-400",
      text: "Checking AI…",
      anim: "animate-spin",
      ring: "ring-slate-200 bg-slate-50",
    },
    ok: {
      icon: CheckCircle2,
      dot: "bg-emerald-500",
      text: "AI Online",
      anim: "",
      ring: "ring-emerald-200 bg-emerald-50",
    },
    degraded: {
      icon: AlertTriangle,
      dot: "bg-amber-500",
      text: "AI Limited",
      anim: "",
      ring: "ring-amber-200 bg-amber-50",
    },
    down: {
      icon: XCircle,
      dot: "bg-red-500",
      text: "AI Offline",
      anim: "",
      ring: "ring-red-200 bg-red-50",
    },
  }[status];

  const Icon = config.icon;

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition-colors",
        config.ring
      )}
      title={message || config.text}
      role="status"
      aria-label={`AI service status: ${config.text}`}
    >
      <span className={cn("relative flex h-2 w-2", !compact && "shrink-0")}>
        <span
          className={cn(
            "inline-flex h-2 w-2 rounded-full",
            config.dot,
            status === "ok" && "animate-pulse"
          )}
        />
      </span>
      {!compact && (
        <span className="hidden sm:inline text-foreground/80">{config.text}</span>
      )}
      <Icon className={cn("h-3 w-3 text-foreground/60", config.anim)} />
    </div>
  );
}
