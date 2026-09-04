import { describe, expect, test } from "bun:test";
import {
  createShareAccessToken,
  shareAccessCookieName,
  verifyShareAccessToken,
} from "../../src/lib/share-access";

describe("protected share access capability", () => {
  test("accepts a freshly signed token only for its project", () => {
    const previous = process.env.NEXTAUTH_SECRET;
    process.env.NEXTAUTH_SECRET =
      "test-share-secret-0123456789abcdef0123456789abcdef";
    try {
      const { token, maxAge } = createShareAccessToken("project-alpha");
      expect(maxAge).toBeGreaterThan(0);
      expect(verifyShareAccessToken(token, "project-alpha")).toBe(true);
      expect(verifyShareAccessToken(token, "project-beta")).toBe(false);
    } finally {
      process.env.NEXTAUTH_SECRET = previous;
    }
  });

  test("rejects malformed and tampered tokens", () => {
    const previous = process.env.NEXTAUTH_SECRET;
    process.env.NEXTAUTH_SECRET =
      "test-share-secret-0123456789abcdef0123456789abcdef";
    try {
      const { token } = createShareAccessToken("project-alpha");
      const [payload, signature] = token.split(".");
      expect(verifyShareAccessToken(undefined, "project-alpha")).toBe(false);
      expect(verifyShareAccessToken("not-a-token", "project-alpha")).toBe(false);
      expect(
        verifyShareAccessToken(`${payload}.${signature.slice(0, -1)}x`, "project-alpha")
      ).toBe(false);
      expect(
        verifyShareAccessToken(`${payload}x.${signature}`, "project-alpha")
      ).toBe(false);
    } finally {
      process.env.NEXTAUTH_SECRET = previous;
    }
  });

  test("cookie names are scoped and sanitized", () => {
    expect(shareAccessCookieName("abc_123-xyz")).toBe(
      "vidora_share_abc_123-xyz"
    );
    expect(shareAccessCookieName("../unsafe/project")).toBe(
      "vidora_share_unsafeproject"
    );
  });
});
