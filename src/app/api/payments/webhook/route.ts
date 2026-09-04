import { NextRequest, NextResponse } from "next/server";
import { getConfigValue } from "@/lib/secure-config";
import { verifyAndSettleByReference } from "@/lib/payment-settlement";
import { verifyPaystackSignature, verifyStripeSignature } from "@/lib/webhook-signatures";

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
      const secret = await getConfigValue("paystack_secret_key", "PAYSTACK_SECRET_KEY");
      if (!verifyPaystackSignature(rawBody, paystackSignature, secret)) {
        return NextResponse.json({ error: "Invalid Paystack signature" }, { status: 401 });
      }
      if (body.event !== "charge.success") {
        return NextResponse.json({ received: true, ignored: true });
      }
      reference = String(body.data?.reference || "");
    } else if (stripeSignature) {
      gateway = "stripe";
      const secret = await getConfigValue("stripe_webhook_secret", "STRIPE_WEBHOOK_SECRET");
      if (!verifyStripeSignature(rawBody, stripeSignature, secret)) {
        return NextResponse.json({ error: "Invalid Stripe signature" }, { status: 401 });
      }
      const supported = new Set([
        "checkout.session.completed",
        "checkout.session.async_payment_succeeded",
      ]);
      if (!supported.has(String(body.type || ""))) {
        return NextResponse.json({ received: true, ignored: true });
      }
      reference = String(body.data?.object?.client_reference_id || "");
    } else if (body?.Data?.ClientReference) {
      // Hubtel callbacks do not provide a signing header in this integration.
      // The callback is only a wake-up signal. Provider status is re-queried
      // server-to-server before exact amount/currency settlement.
      gateway = "hubtel";
      reference = String(body.Data.ClientReference || "");
    }

    if (!gateway || !reference) {
      return NextResponse.json({ error: "Unsupported webhook payload" }, { status: 400 });
    }

    const result = await verifyAndSettleByReference(reference);
    if (!result.success) {
      console.warn("Payment webhook did not settle", {
        gateway,
        reference,
        status: result.status,
      });
      return NextResponse.json(
        { received: true, settled: false, error: result.error },
        { status: result.status >= 500 ? 500 : 422 }
      );
    }

    return NextResponse.json({
      received: true,
      settled: true,
      alreadySettled: result.alreadySettled,
    });
  } catch (error) {
    console.error(
      "Payment webhook processing failed",
      error instanceof Error ? error.message : "unknown error"
    );
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
