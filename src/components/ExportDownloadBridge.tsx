"use client";

import { useEffect } from "react";
import { useToast } from "@/hooks/use-toast";

const STORAGE_KEY = "vidora:direct-export-jobs";

function loadTrackedJobs(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) || "[]") as unknown;
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

function saveTrackedJobs(jobs: Set<string>): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...jobs]));
  } catch {
    // Session storage is a convenience for reload recovery, not a requirement.
  }
}

function requestUrl(input: RequestInfo | URL): URL | null {
  try {
    if (typeof input === "string") return new URL(input, window.location.origin);
    if (input instanceof URL) return new URL(input.toString(), window.location.origin);
    return new URL(input.url, window.location.origin);
  } catch {
    return null;
  }
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase();
  if (typeof Request !== "undefined" && input instanceof Request) return input.method.toUpperCase();
  return "GET";
}

function beginBrowserDownload(url: string): void {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "";
  anchor.style.display = "none";
  anchor.setAttribute("aria-hidden", "true");
  document.body.appendChild(anchor);
  anchor.click();
  window.setTimeout(() => anchor.remove(), 1_000);
}

function closeProgressDialog(): void {
  // Radix dialogs honor Escape. This closes the old progress surface after the
  // direct stream reaches its terminal state without coupling this bridge to
  // page.tsx internals.
  document.dispatchEvent(new KeyboardEvent("keydown", {
    key: "Escape",
    code: "Escape",
    bubbles: true,
  }));
}

/**
 * Bridges the existing Studio export UI to the new one-time streaming endpoint.
 *
 * GenerationBillingGate already uses a narrow fetch interceptor for paid video
 * generation; this follows the same project convention but only touches the
 * final-export endpoints. The browser owns the download from the moment the
 * POST returns its authenticated one-time URL. When polling later observes
 * `done`, we mask that one terminal status as `downloaded` so legacy page logic
 * does not open the obsolete stored-export download gate a second time.
 */
export function ExportDownloadBridge() {
  const { toast } = useToast();

  useEffect(() => {
    const previousFetch = window.fetch;
    const originalFetch = previousFetch.bind(window);
    const tracked = loadTrackedJobs();
    const notified = new Set<string>();

    // Next/Bun augment typeof fetch with static members such as `preconnect`.
    // This interceptor only implements the browser callable request signature;
    // preserve the original function for delegation/restoration and cast only
    // at the assignment boundary, matching GenerationBillingGate.
    const wrappedFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const response = await originalFetch(input, init);
      const url = requestUrl(input);
      if (!url || url.origin !== window.location.origin) return response;

      const method = requestMethod(input, init);
      if (method === "POST" && url.pathname === "/api/export-video") {
        try {
          const data = await response.clone().json() as {
            success?: boolean;
            autoDownload?: boolean;
            jobId?: string;
            downloadUrl?: string | null;
          };
          if (
            data.success === true &&
            data.autoDownload === true &&
            typeof data.jobId === "string" &&
            typeof data.downloadUrl === "string" &&
            data.downloadUrl
          ) {
            tracked.add(data.jobId);
            saveTrackedJobs(tracked);
            beginBrowserDownload(data.downloadUrl);
            toast({
              title: "Export started",
              description: "Vidora is streaming the final video directly to this device.",
            });
          }
        } catch {
          // Preserve the caller's original response when it is not JSON.
        }
        return response;
      }

      if (method === "GET" && url.pathname === "/api/export-video") {
        const jobId = url.searchParams.get("jobId");
        if (!jobId || !tracked.has(jobId)) return response;

        try {
          const data = await response.clone().json() as {
            success?: boolean;
            job?: Record<string, unknown> & { status?: unknown; message?: unknown };
          };
          const status = typeof data.job?.status === "string" ? data.job.status : "";

          if (status === "failed") {
            tracked.delete(jobId);
            saveTrackedJobs(tracked);
            return response;
          }

          if (status === "done") {
            tracked.delete(jobId);
            saveTrackedJobs(tracked);
            if (!notified.has(jobId)) {
              notified.add(jobId);
              toast({
                title: "Download complete",
                description: typeof data.job?.message === "string"
                  ? data.job.message
                  : "The final video was delivered directly to this device.",
              });
              window.setTimeout(closeProgressDialog, 0);
            }

            const masked = {
              ...data,
              job: {
                ...data.job,
                status: "downloaded",
                progress: 100,
                step: "Downloaded to device",
              },
            };
            const headers = new Headers(response.headers);
            headers.set("Content-Type", "application/json; charset=utf-8");
            return new Response(JSON.stringify(masked), {
              status: response.status,
              statusText: response.statusText,
              headers,
            });
          }
        } catch {
          // If status parsing fails, let the normal Studio error handling run.
        }
      }

      return response;
    };

    const assignedFetch = wrappedFetch as typeof window.fetch;
    window.fetch = assignedFetch;
    return () => {
      if (window.fetch === assignedFetch) window.fetch = previousFetch;
    };
  }, [toast]);

  return null;
}
