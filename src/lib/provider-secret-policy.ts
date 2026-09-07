export const WEB_WRITABLE_PROVIDER_SECRET_KEYS = new Set([
  "zai_tts_api_key",
  "qwen_tts_api_key",
  "elevenlabs_api_key",
]);

const MASKED_SECRET_RE = /^\*{4,}[^*]{0,4}$/;
const MAX_PROVIDER_SECRET_LENGTH = 4096;

export function normalizeWebProviderSecret(
  key: string,
  raw: unknown,
): string | null {
  if (!WEB_WRITABLE_PROVIDER_SECRET_KEYS.has(key)) {
    throw new Error(`${key} cannot be changed from the web admin`);
  }

  const value = String(raw ?? "").trim();
  if (!value) return null;

  if (MASKED_SECRET_RE.test(value)) {
    throw new Error(`${key} must be a real API key, not a masked placeholder`);
  }

  if (value.length > MAX_PROVIDER_SECRET_LENGTH) {
    throw new Error(`${key} is too long`);
  }

  return value;
}