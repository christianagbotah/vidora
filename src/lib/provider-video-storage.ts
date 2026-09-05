import { saveGeneratedFile } from "@/lib/generated-store";

const MAX_PROVIDER_VIDEO_BYTES = 256 * 1024 * 1024;
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
          "User-Agent": "Vidora-Media-Archiver/1.0",
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

/**
 * Copy a provider-hosted MP4 into Vidora's persistent generated store.
 * The returned URL is same-origin and survives provider cache/URL expiry.
 */
export async function persistProviderVideo(sceneId: string, url: string): Promise<string> {
  if (url.startsWith("/")) return url;
  const response = await fetchProviderVideo(url);
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PROVIDER_VIDEO_BYTES) {
    throw new Error("Provider video is larger than Vidora's 256 MB ingestion limit");
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0) throw new Error("Provider returned an empty video file");
  if (bytes.length > MAX_PROVIDER_VIDEO_BYTES) {
    throw new Error("Provider video is larger than Vidora's 256 MB ingestion limit");
  }
  const stamp = Date.now();
  return saveGeneratedFile(`provider-videos/${sceneId}_${stamp}.mp4`, bytes);
}
