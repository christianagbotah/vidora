import crypto from "crypto";
import {
  captureImmediateProviderOperation,
  releaseImmediateProviderOperation,
  reserveImmediateProviderOperation,
} from "@/lib/immediate-provider-billing";
import { getConfigValue } from "@/lib/secure-config";

export const ZAI_WEB_SEARCH_MODEL_ID = "search-prime";
const DEFAULT_ZAI_BASE_URL = "https://api.z.ai/api/paas/v4";
const MAX_QUERY_CHARS = 600;
const MAX_RESULT_COUNT = 10;

export type ZaiSearchRecency = "oneDay" | "oneWeek" | "oneMonth" | "oneYear" | "noLimit";

export interface ZaiWebSearchSource {
  title: string;
  summary: string;
  url: string;
  siteName: string | null;
  iconUrl: string | null;
  publishDate: string | null;
}

export interface BilledZaiWebSearchResult {
  providerRequestId: string | null;
  query: string;
  sources: ZaiWebSearchSource[];
  creditsCharged: number;
  reservationId: string;
}

function cleanText(value: unknown, max = 1_200): string {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, max)
    : "";
}

function safeHttpsUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function safeCount(value: number | undefined): number {
  const parsed = Math.floor(Number(value ?? 5));
  if (!Number.isFinite(parsed)) return 5;
  return Math.min(MAX_RESULT_COUNT, Math.max(1, parsed));
}

function pseudonymousProviderUserId(userId: string): string {
  return `vidora_${crypto.createHash("sha256").update(userId).digest("hex").slice(0, 32)}`;
}

function parseSources(payload: Record<string, unknown>, count: number): ZaiWebSearchSource[] {
  const rows = Array.isArray(payload.search_result) ? payload.search_result : [];
  return rows.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const row = raw as Record<string, unknown>;
    const url = safeHttpsUrl(row.link);
    const title = cleanText(row.title, 300);
    if (!url || !title) return [];
    return [{
      title,
      summary: cleanText(row.content),
      url,
      siteName: cleanText(row.media, 180) || null,
      iconUrl: safeHttpsUrl(row.icon),
      publishDate: cleanText(row.publish_date, 100) || null,
    }];
  }).slice(0, count);
}

export async function billedZaiWebSearch(opts: {
  userId: string;
  projectId?: string | null;
  referenceId: string;
  idempotencyKey: string;
  query: string;
  count?: number;
  recency?: ZaiSearchRecency;
}): Promise<BilledZaiWebSearchResult> {
  const query = opts.query.replace(/\s+/g, " ").trim().slice(0, MAX_QUERY_CHARS);
  if (!query) throw new Error("Web research query is required");
  const count = safeCount(opts.count);
  const lineKey = `web-search:${opts.referenceId}`;

  const billing = await reserveImmediateProviderOperation({
    userId: opts.userId,
    projectId: opts.projectId ?? null,
    referenceId: opts.referenceId,
    provider: "zai",
    model: ZAI_WEB_SEARCH_MODEL_ID,
    operation: "web_search",
    quantity: 1,
    lineKey,
    label: "Source-backed creative research web search",
    idempotencyKey: opts.idempotencyKey,
  });

  const releaseBeforeProvider = async (reason: string) => {
    await releaseImmediateProviderOperation({
      reservationId: billing.reservation.id,
      userId: opts.userId,
      reason,
    });
  };

  let apiKey: string;
  try {
    apiKey = await getConfigValue("zai_api_key", "ZAI_API_KEY");
  } catch (error) {
    await releaseBeforeProvider("Z.ai credential lookup failed before provider boundary");
    throw error;
  }
  if (!apiKey) {
    await releaseBeforeProvider("Z.ai API key is not configured; provider boundary was not crossed");
    throw new Error("Z.ai API key is not configured for creative research");
  }

  const baseUrl = (process.env.ZAI_BASE_URL || DEFAULT_ZAI_BASE_URL).trim().replace(/\/+$/, "");
  if (!/^https:\/\//i.test(baseUrl)) {
    await releaseBeforeProvider("Invalid Z.ai HTTPS base URL; provider boundary was not crossed");
    throw new Error("Z.ai base URL must use HTTPS");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  let receivedHttpResponse = false;
  try {
    const response = await fetch(`${baseUrl}/web_search`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        search_engine: ZAI_WEB_SEARCH_MODEL_ID,
        search_query: query,
        count,
        ...(opts.recency && opts.recency !== "noLimit"
          ? { search_recency_filter: opts.recency }
          : {}),
        request_id: opts.referenceId.slice(0, 128),
        user_id: pseudonymousProviderUserId(opts.userId),
      }),
      signal: controller.signal,
    });
    receivedHttpResponse = true;
    const bodyText = await response.text();

    if (!response.ok) {
      await releaseImmediateProviderOperation({
        reservationId: billing.reservation.id,
        userId: opts.userId,
        reason: `Z.ai Web Search returned HTTP ${response.status}`,
      });
      throw new Error(`Z.ai Web Search failed with HTTP ${response.status}: ${bodyText.slice(0, 240)}`);
    }

    const captured = await captureImmediateProviderOperation({
      reservationId: billing.reservation.id,
      lineKey,
      userId: opts.userId,
      projectId: opts.projectId ?? null,
      providerTaskId: response.headers.get("x-request-id"),
    });

    let payload: Record<string, unknown>;
    try {
      payload = bodyText ? JSON.parse(bodyText) as Record<string, unknown> : {};
    } catch {
      throw new Error("Z.ai Web Search returned an invalid JSON response");
    }

    return {
      providerRequestId: cleanText(payload.id, 180) || response.headers.get("x-request-id"),
      query,
      sources: parseSources(payload, count),
      creditsCharged: captured.creditsCaptured,
      reservationId: billing.reservation.id,
    };
  } catch (error) {
    if (!receivedHttpResponse) {
      const message = error instanceof Error ? error.message : "unknown network error";
      throw new Error(`Creative research provider result is indeterminate; the reservation is held for reconciliation: ${message}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
