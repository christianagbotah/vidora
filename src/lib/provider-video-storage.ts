import { saveGeneratedFile } from "@/lib/generated-store";

const MAX_PROVIDER_VIDEO_BYTES = 256 * 1024 * 1024;
const RANGE_CHUNK_BYTES = 8 * 1024 * 1024;
const DEFAULT_PROVIDER_MEDIA_HOSTS = ["mfile.z.ai"];

function allowedProviderHosts(): Set<string> {
  const configured = (process.env.ZAI_MEDIA_HOSTS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return new Set([...DEFAULT_PROVIDER_MEDIA_HOSTS, ...configured]);
}

export function isTrustedProviderVideoUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    return allowedProviderHosts().has(host) || host.endsWith(".z.ai");
  } catch {
    return false;
  }
}

export async function fetchProviderVideo(
  url: string,
  options: { range?: string | null; maxAttempts?: number } = {},
): Promise<Response> {
  if (!isTrustedProviderVideoUrl(url)) {
    throw new Error("Refusing to fetch an untrusted remote video URL");
  }

  const maxAttempts = Math.max(1, Math.min(4, options.maxAttempts || 3));
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90_000);
    try {
      const response = await fetch(url, {
        cache: "no-store",
        redirect: "follow",
        signal: controller.signal,
        headers: {
          Accept: "video/mp4,video/*;q=0.9,application/octet-stream;q=0.5,*/*;q=0.1",
          "Accept-Encoding": "identity",
          "Cache-Control": "no-cache, no-store, max-age=0",
          Pragma: "no-cache",
          "User-Agent": "Vidora-Media-Archiver/1.1",
          ...(options.range ? { Range: options.range } : {}),
        },
      });
      if (!response.ok && response.status !== 206) {
        throw new Error(`Provider video returned HTTP ${response.status}`);
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 700 * attempt));
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Provider video download failed");
}

function contentRange(value: string | null): { start: number; end: number; total: number | null } | null {
  if (!value) return null;
  const match = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(value.trim());
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = match[3] === "*" ? null : Number(match[3]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) return null;
  if (total !== null && (!Number.isSafeInteger(total) || total <= end)) return null;
  return { start, end, total };
}

async function responseBytes(response: Response, maxBytes: number): Promise<Buffer> {
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error("Provider video response is larger than the allowed ingestion size");
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0) throw new Error("Provider returned an empty video response");
  if (bytes.length > maxBytes) throw new Error("Provider video response is larger than the allowed ingestion size");
  return bytes;
}

async function downloadProviderVideoBytes(url: string): Promise<Buffer> {
  // Range-first downloads are intentional. Some provider/CDN MP4 endpoints are
  // range-oriented and can produce browser cache failures when treated as a
  // normal cacheable whole-file response. Vidora assembles the complete file
  // server-side in bounded chunks instead.
  const firstEnd = RANGE_CHUNK_BYTES - 1;
  const first = await fetchProviderVideo(url, { range: `bytes=0-${firstEnd}` });

  // A provider may ignore Range and return the complete object with 200.
  if (first.status === 200) {
    return responseBytes(first, MAX_PROVIDER_VIDEO_BYTES);
  }

  const firstRange = contentRange(first.headers.get("content-range"));
  if (!firstRange || firstRange.start !== 0 || firstRange.total === null) {
    throw new Error("Provider returned an unusable partial-video response");
  }
  if (firstRange.total > MAX_PROVIDER_VIDEO_BYTES) {
    throw new Error("Provider video is larger than Vidora's 256 MB ingestion limit");
  }

  const parts: Buffer[] = [];
  const firstBytes = await responseBytes(first, Math.min(MAX_PROVIDER_VIDEO_BYTES, RANGE_CHUNK_BYTES + 64 * 1024));
  const firstExpected = firstRange.end - firstRange.start + 1;
  if (firstBytes.length !== firstExpected) {
    throw new Error("Provider returned an incomplete first video range");
  }
  parts.push(firstBytes);

  let nextStart = firstRange.end + 1;
  while (nextStart < firstRange.total) {
    const nextEnd = Math.min(nextStart + RANGE_CHUNK_BYTES - 1, firstRange.total - 1);
    const response = await fetchProviderVideo(url, { range: `bytes=${nextStart}-${nextEnd}` });

    // If the provider stops honoring Range and returns the complete object,
    // prefer that authoritative full body rather than concatenating duplicates.
    if (response.status === 200) {
      const full = await responseBytes(response, MAX_PROVIDER_VIDEO_BYTES);
      if (full.length !== firstRange.total) {
        throw new Error("Provider returned a whole video with an unexpected size");
      }
      return full;
    }

    const range = contentRange(response.headers.get("content-range"));
    if (!range || range.total !== firstRange.total || range.start !== nextStart || range.end > nextEnd) {
      throw new Error("Provider returned a mismatched video range");
    }
    const part = await responseBytes(response, Math.min(RANGE_CHUNK_BYTES + 64 * 1024, MAX_PROVIDER_VIDEO_BYTES));
    const expected = range.end - range.start + 1;
    if (part.length !== expected) {
      throw new Error("Provider returned an incomplete video range");
    }
    parts.push(part);
    nextStart = range.end + 1;
  }

  const complete = Buffer.concat(parts, firstRange.total);
  if (complete.length !== firstRange.total) {
    throw new Error("Provider video ranges did not assemble to the advertised file size");
  }
  return complete;
}

/**
 * Copy a provider-hosted MP4 into Vidora's persistent generated store.
 * The returned URL is same-origin and survives provider cache/URL expiry.
 */
export async function persistProviderVideo(sceneId: string, url: string): Promise<string> {
  if (url.startsWith("/")) return url;
  const bytes = await downloadProviderVideoBytes(url);
  const stamp = Date.now();
  return saveGeneratedFile(`provider-videos/${sceneId}_${stamp}.mp4`, bytes);
}
