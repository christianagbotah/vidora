"use client";

import { useCallback, useEffect, useRef } from "react";
import { useAppStore, type AIHealthStatus } from "@/store/useAppStore";

interface HealthResponse {
  status: "ok" | "degraded" | "down";
  message: string;
  checkedAt: number;
  cached?: boolean;
}

interface UseAIHealthOptions {
  /** Polling interval in ms. Default 60_000 (60s). */
  intervalMs?: number;
  /** Master switch — set to false to pause polling. Default true. */
  enabled?: boolean;
}

interface UseAIHealthResult {
  status: AIHealthStatus;
  message: string;
  checkedAt: number | null;
  lastTransitionAt: number | null;
  /** Force an immediate re-check, ignoring the server-side cache TTL. */
  refresh: () => void;
}

/**
 * Shared AI service health check.
 *
 * Polls /api/ai/health on mount + every `intervalMs`, and pushes the result
 * into the Zustand store so any component (AIStatusBadge, Create view,
 * action buttons, etc.) can subscribe.
 *
 * Only call this ONCE per page — typically at the VidoraApp root. Multiple
 * callers will share the same store state but each would spawn its own
 * poller. A useRef guard below prevents accidental double-polling on
 * StrictMode remount.
 */
export function useAIHealth(options: UseAIHealthOptions = {}): UseAIHealthResult {
  const { intervalMs = 60_000, enabled = true } = options;
  const setAIHealth = useAppStore((s) => s.setAIHealth);
  const pollingRef = useRef(false);

  const check = useCallback(async () => {
    try {
      const res = await fetch("/api/ai/health", { cache: "no-store" });
      if (!res.ok) {
        setAIHealth({
          status: "down",
          message: "AI service unreachable",
        });
        return;
      }
      const data: HealthResponse = await res.json();
      setAIHealth({
        status: data.status,
        message: data.message,
        checkedAt: data.checkedAt,
      });
    } catch {
      setAIHealth({
        status: "down",
        message: "Failed to reach AI service. Please check your connection.",
      });
    }
  }, [setAIHealth]);

  useEffect(() => {
    if (!enabled) return;
    if (pollingRef.current) return; // guard against StrictMode double-mount
    pollingRef.current = true;

    // Immediate first check
    check();

    // Regular polling
    const interval = setInterval(check, intervalMs);

    // Re-check when the tab becomes visible again (after switching back)
    const onVisibility = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisibility);

    // Re-check when the browser comes back online
    const onOnline = () => check();
    window.addEventListener("online", onOnline);

    return () => {
      pollingRef.current = false;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
    };
  }, [check, enabled, intervalMs]);

  // Read the live values back from the store so callers re-render on changes
  const status = useAppStore((s) => s.aiHealth.status);
  const message = useAppStore((s) => s.aiHealth.message);
  const checkedAt = useAppStore((s) => s.aiHealth.checkedAt);
  const lastTransitionAt = useAppStore((s) => s.aiHealth.lastTransitionAt);

  return { status, message, checkedAt, lastTransitionAt, refresh: check };
}
