import crypto from "crypto";
import { db } from "@/lib/db";

const PREFIX = "enc:v1:";

export const SECRET_CONFIG_KEYS = new Set([
  "paystack_secret_key",
  "paystack_webhook_secret",
  "hubtel_client_id",
  "hubtel_client_secret",
  "hubtel_api_key",
  "stripe_secret_key",
  "stripe_webhook_secret",
  "zai_api_key",
  "xai_api_key",
  "elevenlabs_api_key",
  "compatible_api_key",
]);

function encryptionKey(): Buffer | null {
  const raw = process.env.CONFIG_ENCRYPTION_KEY?.trim();
  if (!raw) return null;

  if (/^[a-f0-9]{64}$/i.test(raw)) return Buffer.from(raw, "hex");
  try {
    const decoded = Buffer.from(raw, "base64");
    if (decoded.length === 32) return decoded;
  } catch {
    // handled below
  }
  throw new Error(
    "CONFIG_ENCRYPTION_KEY must be exactly 32 bytes encoded as base64 or 64 hex characters"
  );
}

export function assertSecretConfigReady(): void {
  if (process.env.NODE_ENV !== "production") return;
  if (!encryptionKey()) {
    throw new Error(
      "FATAL: CONFIG_ENCRYPTION_KEY is required in production for DB-backed provider secrets"
    );
  }
}

export function encryptConfigValue(value: string): string {
  const key = encryptionKey();
  if (!key) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("CONFIG_ENCRYPTION_KEY is required to store production secrets");
    }
    return value;
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX.slice(0, -1), iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(":");
}

export function decryptConfigValue(value: string): string {
  if (!value.startsWith(PREFIX)) return value;
  const key = encryptionKey();
  if (!key) throw new Error("CONFIG_ENCRYPTION_KEY is required to decrypt provider secrets");

  const parts = value.split(":");
  if (parts.length !== 5 || parts[0] !== "enc" || parts[1] !== "v1") {
    throw new Error("Invalid encrypted config format");
  }

  const iv = Buffer.from(parts[2], "base64url");
  const tag = Buffer.from(parts[3], "base64url");
  const ciphertext = Buffer.from(parts[4], "base64url");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export async function getConfigValue(
  key: string,
  envName?: string
): Promise<string> {
  const row = await db.systemConfig.findUnique({ where: { key } });
  if (row?.value) {
    const plaintext = decryptConfigValue(row.value).trim();

    // Transparently upgrade legacy plaintext secret rows after a successful read.
    if (
      SECRET_CONFIG_KEYS.has(key) &&
      !row.value.startsWith(PREFIX) &&
      plaintext &&
      encryptionKey()
    ) {
      const encrypted = encryptConfigValue(plaintext);
      void db.systemConfig
        .update({ where: { key }, data: { value: encrypted } })
        .catch(() => undefined);
    }
    return plaintext;
  }
  return envName ? (process.env[envName] || "").trim() : "";
}

export async function setConfigValue(
  key: string,
  value: string,
  description?: string
): Promise<void> {
  const stored = SECRET_CONFIG_KEYS.has(key) && value
    ? encryptConfigValue(value)
    : value;
  await db.systemConfig.upsert({
    where: { key },
    update: { value: stored, ...(description ? { description } : {}) },
    create: { key, value: stored, description },
  });
}

export function maskSecret(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "********";
  return `${"*".repeat(Math.min(12, value.length - 4))}${value.slice(-4)}`;
}

export function isMaskedSecret(value: string): boolean {
  return /^\*{4,}[^*]{0,4}$/.test(value.trim());
}
