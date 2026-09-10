"use client";

import { useEffect, useRef, useState } from "react";
import { GenerationCostDialog, type GenerationQuoteView } from "@/components/GenerationCostDialog";
import { useToast } from "@/hooks/use-toast";
import { useAppStore } from "@/store/useAppStore";

type JsonRecord = Record<string, unknown>;

type PendingGeneration = {
  input: RequestInfo | URL;
  init?: RequestInit;
  body: JsonRecord;
  resolve: (response: Response) => void;
  reject: (reason?: unknown) => void;
};

function jsonResponse(payload: JsonRecord, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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

async function requestBody(input: RequestInfo | URL, init?: RequestInit): Promise<JsonRecord | null> {
  try {
    if (typeof init?.body === "string") {
      const parsed: unknown = JSON.parse(init.body);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as JsonRecord
        : null;
    }
    if (typeof Request !== "undefined" && input instanceof Request) {
      const parsed: unknown = await input.clone().json();
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as JsonRecord
        : null;
    }
  } catch {
    return null;
  }
  return null;
}

function replayRequest(
  originalFetch: typeof window.fetch,
  pending: PendingGeneration,
  quoteId: string,
): Promise<Response> {
  const body = JSON.stringify({ ...pending.body, quoteId });
  if (typeof Request !== "undefined" && pending.input instanceof Request) {
    const request = new Request(pending.input, {
      ...pending.init,
      method: pending.init?.method || pending.input.method || "POST",
      body,
      headers: pending.init?.headers || pending.input.headers,
    });
    return originalFetch(request);
  }
  return originalFetch(pending.input, { ...pending.init, body });
}

export function GenerationBillingGate() {
  const { toast } = useToast();
  const selectedProjectId = useAppStore(
    (state) => state.currentProject?.id ?? state.persistedProjectId,
  );
  const selectedProjectIdRef = useRef<string | null>(selectedProjectId);
  const pendingRef = useRef<PendingGeneration | null>(null);
  const originalFetchRef = useRef<typeof window.fetch | null>(null);
  const [open, setOpen] = useState(false);
  const [quote, setQuote] = useState<GenerationQuoteView | null>(null);
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [toppingUp, setToppingUp] = useState(false);

  useEffect(() => {
    selectedProjectIdRef.current = selectedProjectId;
  }, [selectedProjectId]);

  const clearPending = () => {
    pendingRef.current = null;
    setQuote(null);
    setOpen(false);
    setLoading(false);
    setStarting(false);
    setToppingUp(false);
  };

  const failPending = (payload: JsonRecord, status: number) => {
    const pending = pendingRef.current;
    if (pending) pending.resolve(jsonResponse(payload, status));
    clearPending();
  };

  const loadQuote = async () => {
    const pending = pendingRef.current;
    const originalFetch = originalFetchRef.current;
    if (!pending || !originalFetch) return;

    const bodyProjectId = typeof pending.body.projectId === "string"
      ? pending.body.projectId.trim()
      : "";
    const projectId = bodyProjectId || selectedProjectIdRef.current || "";
    const sceneId = typeof pending.body.sceneId === "string" ? pending.body.sceneId.trim() : "";
    if (!projectId) {
      failPending({ success: false, error: "Project ID is required before generation can be priced." }, 400);
      return;
    }

    setLoading(true);
    setQuote(null);
    try {
      const response = await originalFetch(`/api/projects/${encodeURIComponent(projectId)}/cost-quote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sceneId ? { sceneId } : {}),
      });
      const data = await response.json().catch(() => null) as JsonRecord | null;
      if (!response.ok || data?.success !== true) {
        const error = typeof data?.error === "string" ? data.error : "Could not calculate the current generation cost.";
        toast({ title: "Generation pricing unavailable", description: error, variant: "destructive" });
        failPending({ success: false, error, code: data?.code || "COST_QUOTE_FAILED" }, response.status || 500);
        return;
      }
      setQuote(data as unknown as GenerationQuoteView);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not calculate the current generation cost.";
      toast({ title: "Generation pricing unavailable", description: message, variant: "destructive" });
      failPending({ success: false, error: message, code: "COST_QUOTE_FAILED" }, 500);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const previousFetch = window.fetch;
    const originalFetch = previousFetch.bind(window);
    originalFetchRef.current = originalFetch;

    // Bun augments typeof fetch with a static preconnect property that browser
    // window.fetch does not require for this callable request proxy. Keep the
    // proxy typed to the browser call signature and cast only at assignment.
    const gatedFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = requestUrl(input);
      const method = String(init?.method || (typeof Request !== "undefined" && input instanceof Request ? input.method : "GET")).toUpperCase();
      const isGenerationEndpoint = url?.origin === window.location.origin
        && (url.pathname === "/api/generate-video" || url.pathname === "/api/generate-video-scene");

      if (!isGenerationEndpoint || method !== "POST") {
        return originalFetch(input, init);
      }

      const body = await requestBody(input, init);
      if (!body) return originalFetch(input, init);

      // An explicit retry/resume reuses an already-funded durable GenerationRun.
      // A request with quoteId has already passed through this gate and must not
      // recursively open another confirmation dialog.
      if (body.retry === true || (typeof body.quoteId === "string" && body.quoteId.trim())) {
        return originalFetch(input, init);
      }

      if (pendingRef.current) {
        return jsonResponse({
          success: false,
          error: "Another generation cost confirmation is already open.",
          code: "BILLING_CONFIRMATION_BUSY",
        }, 409);
      }

      return new Promise<Response>((resolve, reject) => {
        pendingRef.current = { input, init, body, resolve, reject };
        setOpen(true);
        void loadQuote();
      });
    };

    window.fetch = gatedFetch as typeof window.fetch;
    return () => {
      window.fetch = previousFetch;
      originalFetchRef.current = null;
      const pending = pendingRef.current;
      if (pending) {
        pending.resolve(jsonResponse({
          success: false,
          error: "Generation confirmation was closed before the request started.",
          code: "GENERATION_CANCELLED",
        }, 499));
        pendingRef.current = null;
      }
    };
  }, []);

  const handleOpenChange = (next: boolean) => {
    if (next) {
      setOpen(true);
      return;
    }
    if (loading || starting || toppingUp) return;
    const pending = pendingRef.current;
    if (pending) {
      pending.resolve(jsonResponse({
        success: false,
        error: "Generation cancelled before any paid provider work started.",
        code: "GENERATION_CANCELLED",
      }, 499));
    }
    clearPending();
  };

  const handleConfirm = async () => {
    const pending = pendingRef.current;
    const originalFetch = originalFetchRef.current;
    if (!pending || !originalFetch || !quote) return;
    if (!quote.hasEnoughCredits || new Date(quote.expiresAt).getTime() <= Date.now()) return;

    setStarting(true);
    try {
      const response = await replayRequest(originalFetch, pending, quote.quoteId);
      pending.resolve(response);
      clearPending();
    } catch (error) {
      pending.reject(error);
      clearPending();
    }
  };

  const handleTopUp = async () => {
    const originalFetch = originalFetchRef.current;
    if (!originalFetch || !quote) return;
    setToppingUp(true);
    try {
      const response = await originalFetch("/api/payments/initialize-quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quoteId: quote.quoteId }),
      });
      const data = await response.json().catch(() => null) as JsonRecord | null;
      if (!response.ok || data?.success !== true) {
        throw new Error(typeof data?.error === "string" ? data.error : "Could not initialize Hubtel top-up.");
      }
      if (data.alreadyFunded === true) {
        await loadQuote();
        return;
      }
      const checkoutUrl = typeof data.directCheckoutUrl === "string" && data.directCheckoutUrl
        ? data.directCheckoutUrl
        : typeof data.authorizationUrl === "string" ? data.authorizationUrl : "";
      if (!checkoutUrl) throw new Error("Hubtel did not return a checkout URL.");
      const popup = window.open(checkoutUrl, "_blank", "noopener,noreferrer");
      if (!popup) {
        toast({
          title: "Popup blocked",
          description: "Allow popups for Vidora, then choose Top up again. Your project has not been charged.",
          variant: "destructive",
        });
        return;
      }
      toast({
        title: "Hubtel checkout opened",
        description: "Complete payment in the new tab, then return here and refresh the price.",
      });
    } catch (error) {
      toast({
        title: "Top-up unavailable",
        description: error instanceof Error ? error.message : "Could not initialize Hubtel top-up.",
        variant: "destructive",
      });
    } finally {
      setToppingUp(false);
    }
  };

  return (
    <GenerationCostDialog
      open={open}
      onOpenChange={handleOpenChange}
      quote={quote}
      loading={loading}
      starting={starting}
      toppingUp={toppingUp}
      onRefresh={loadQuote}
      onConfirm={handleConfirm}
      onTopUp={handleTopUp}
    />
  );
}
