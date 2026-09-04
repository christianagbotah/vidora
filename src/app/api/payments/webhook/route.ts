import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getConfigValue } from "@/lib/secure-config";
import { verifyAndSettleByReference } from "@/lib/payment-settlement";

function safeHexEqual(a: string, b: string): boolean {
  if (!/^[a-f0-9]+$/i.test(a) || !/^[a-f0-9]+$/i.test(b)) return false;
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

async function verifyPaystack(rawBody: string, signature: string): Promise<boolean> {
  const secret = await getConfigValue("paystack_secret_key", "PAYSTACK_SECRET_KEY");
  if (!secret || !signature) return false;
  const expected = crypto.createHmac("sha512", secret).update(rawBody, "utf8").digest("hex");
  return safeHexEqual(expected, signature.trim());
}

async function verifyStripe(rawBody: string, signatureHeader: string): Promise<boolean> {
  const secret = await getConfigValue("stripe_webhook_secret", "STRIPE_WEBHOOK_SECRET");
  if (!secret || !signatureHeader) return false;

  const parts = signatureHeader.split(",").map((part) => part.trim());
  const timestamp = parts.find((part) => part.startsWith("t="))?.slice(2);
  const signatures = parts.filter((part) => part.startsWith("v1=")).map((part) => part.slice(3));
  if (!timestamp || signatures.length === 0 || !/^\d+$/.test(timestamp)) return false;

  const timestampSeconds = Number(timestamp);
  if (!Number.isSafeInteger(timestampSeconds)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - timestampSeconds) > 300) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest("hex");
  return signatures.some((candidate) => safeHexEqual(expected, candidate));
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    let body: Record<string, any>;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const paystackSignature = req.headers.get("x-paystack-signature");
    const stripeSignature = req.headers.get("stripe-signature");
    let gateway: "paystack" | "stripe" | "hubtel" | null = null;
    let reference = "";

    if (paystackSignature) {
      gateway = "paystack";
      if (!(await verifyPaystack(rawBody, paystackSignature))) {
        return NextResponse.json({ error: "Invalid Paystack signature" }, { status: 401 });
      }
      if (body.event !== "charge.success") {
        return NextResponse.json({ received: true, ignored: true });
      }
      reference = String(body.data?.reference || "");
    } else if (stripeSignature) {
      gateway = "stripe";
      if (!(await verifyStripe(rawBody, stripeSignature))) {
        return NextResponse.json({ error: "Invalid Stripe signature" }, { status: 401 });
      }
      const supported = new Set(["checkout.session.completed", "checkout.session.async_payment_succeeded"]);
      if (!supported.has(String(body.type || ""))) {
        return NextResponse.json({ received: true, ignored: true });
      }
      reference = String(body.data?.object?.client_reference_id || "");
    } else if (body?.Data?.ClientReference) {
      // Hubtel callbacks do not provide a signing header in this integration.
      // The callback is NEVER accepted as proof of payment: it only triggers a
      // server-to-server status query before settlement.
      gateway = "hubtel";
      reference = String(body.Data.ClientReference || "");
    }

    if (!gateway || !reference) {
      return NextResponse.json({ error: "Unsupported webhook payload" }, { status: 400 });
    }

    const result = await verifyAndSettleByReference(reference);
    if (!result.success) {
      console.warn("Payment webhook did not settle", { gateway, reference, status: result.status });
      return NextResponse.json({ received: true, settled: false, error: result.error }, { status: result.status >= 500 ? 500 : 422 });
    }

    return NextResponse.json({
      received: true,
      settled: true,
      alreadySettled: result.alreadySettled,
    });
  } catch (error) {
    console.error("Payment webhook processing failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
