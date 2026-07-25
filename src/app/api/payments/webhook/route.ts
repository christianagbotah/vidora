import { NextRequest, NextResponse } from "next/server";
import { getActiveGateway } from "@/lib/payments";
import { db } from "@/lib/db";

// Webhook handler for all payment gateways
export async function POST(req: NextRequest) {
  try {
    const body = await req.text();
    const signature = req.headers.get("x-paystack-signature") || req.headers.get("stripe-signature") || "";

    let parsedBody: Record<string, unknown>;
    try {
      parsedBody = JSON.parse(body);
    } catch {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }

    // Detect gateway from headers or body
    let gateway = "unknown";
    if (req.headers.get("x-paystack-signature")) {
      gateway = "paystack";
    } else if (req.headers.get("stripe-signature")) {
      gateway = "stripe";
    } else if (parsedBody.ResponseCode || parsedBody.Data?.ClientReference) {
      gateway = "hubtel";
    }

    let reference = "";

    if (gateway === "paystack" && parsedBody.data) {
      const data = parsedBody.data as Record<string, unknown>;
      reference = (data.reference || "") as string;
      const event = parsedBody.event as string;

      if (event === "charge.success" && reference) {
        const payment = await db.payment.findFirst({ where: { gatewayRef: reference } });
        if (payment && payment.status !== "completed") {
          await db.payment.update({ where: { id: payment.id }, data: { status: "completed" } });
          await db.user.update({
            where: { id: payment.userId },
            data: { tokens: { increment: payment.tokensPurchased } },
          });
          await db.tokenTransaction.create({
            data: {
              userId: payment.userId,
              type: "purchase",
              amount: payment.tokensPurchased,
              description: `Purchased ${payment.tokensPurchased} tokens via Paystack (webhook)`,
              referenceId: payment.id,
            },
          });
        }
      }
    } else if (gateway === "hubtel" && parsedBody.Data) {
      const hubtelData = parsedBody.Data as Record<string, unknown>;
      reference = (hubtelData.ClientReference || "") as string;
      const responseCode = parsedBody.ResponseCode as string;

      if (responseCode === "0000" && reference) {
        const payment = await db.payment.findFirst({ where: { gatewayRef: reference } });
        if (payment && payment.status !== "completed") {
          await db.payment.update({ where: { id: payment.id }, data: { status: "completed" } });
          await db.user.update({
            where: { id: payment.userId },
            data: { tokens: { increment: payment.tokensPurchased } },
          });
          await db.tokenTransaction.create({
            data: {
              userId: payment.userId,
              type: "purchase",
              amount: payment.tokensPurchased,
              description: `Purchased ${payment.tokensPurchased} tokens via Hubtel (webhook)`,
              referenceId: payment.id,
            },
          });
        }
      }
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Webhook error:", error);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
