import { describe, expect, test } from "bun:test";
import crypto from "crypto";
import {
  verifyPaystackSignature,
  verifyStripeSignature,
} from "@/lib/webhook-signatures";

describe("Paystack webhook signatures", () => {
  test("accepts the exact HMAC-SHA512 signature", () => {
    const body = JSON.stringify({ event: "charge.success", data: { reference: "VID-123" } });
    const secret = "paystack-test-secret";
    const signature = crypto.createHmac("sha512", secret).update(body).digest("hex");
    expect(verifyPaystackSignature(body, signature, secret)).toBe(true);
  });

  test("rejects tampered payloads and malformed signatures", () => {
    const body = JSON.stringify({ event: "charge.success", data: { reference: "VID-123" } });
    const secret = "paystack-test-secret";
    const signature = crypto.createHmac("sha512", secret).update(body).digest("hex");
    expect(verifyPaystackSignature(`${body} `, signature, secret)).toBe(false);
    expect(verifyPaystackSignature(body, "not-hex", secret)).toBe(false);
    expect(verifyPaystackSignature(body, "", secret)).toBe(false);
  });
});

describe("Stripe webhook signatures", () => {
  test("accepts a valid v1 signature within tolerance", () => {
    const now = 1_800_000_000;
    const body = JSON.stringify({ type: "checkout.session.completed" });
    const secret = "whsec_test_secret";
    const digest = crypto
      .createHmac("sha256", secret)
      .update(`${now}.${body}`)
      .digest("hex");
    expect(verifyStripeSignature(body, `t=${now},v1=${digest}`, secret, now)).toBe(true);
  });

  test("rejects stale signatures, tampering, and wrong secrets", () => {
    const now = 1_800_000_000;
    const timestamp = now - 301;
    const body = JSON.stringify({ type: "checkout.session.completed" });
    const secret = "whsec_test_secret";
    const digest = crypto
      .createHmac("sha256", secret)
      .update(`${timestamp}.${body}`)
      .digest("hex");

    expect(verifyStripeSignature(body, `t=${timestamp},v1=${digest}`, secret, now)).toBe(false);
    expect(verifyStripeSignature(`${body} `, `t=${timestamp},v1=${digest}`, secret, timestamp)).toBe(false);
    expect(verifyStripeSignature(body, `t=${timestamp},v1=${digest}`, "wrong-secret", timestamp)).toBe(false);
  });
});
