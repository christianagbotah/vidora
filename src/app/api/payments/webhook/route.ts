import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// Webhook handler for all payment gateways
// - Paystack:  x-paystack-signature header
// - Stripe:    stripe-signature header
// - Hubtel:    body contains ResponseCode + Data.ClientReference (no signature header)
//
// IMPORTANT: Hubtel docs recommend whitelisting their callback IP: 108.129.40.25
export async function POST(req: NextRequest) {
  try {
    const body = await req.text();
    const signature =
      req.headers.get("x-paystack-signature") ||
      req.headers.get("stripe-signature") ||
      "";

    let parsedBody: Record<string, unknown>;
    try {
      parsedBody = JSON.parse(body);
    } catch {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }

    // Detect gateway from headers or body structure
    let gateway = "unknown";
    if (req.headers.get("x-paystack-signature")) {
      gateway = "paystack";
    } else if (req.headers.get("stripe-signature")) {
      gateway = "stripe";
    } else if (parsedBody.ResponseCode || parsedBody.Data?.ClientReference) {
      gateway = "hubtel";
    }

    console.log(`[Webhook] ${gateway} callback received`, {
      gateway,
      body: body.substring(0, 500),
    });

    let reference = "";

    // ─── Paystack Webhook ──────────────────────────────────
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
          console.log(`[Webhook] Paystack: credited ${payment.tokensPurchased} tokens to ${payment.userId}`);
        }
      }
    }

    // ─── Hubtel Online Checkout Callback (2026) ────────────
    // Format:
    // {
    //   ResponseCode: "0000",
    //   Status: "Success",
    //   Data: {
    //     CheckoutId: "...",
    //     SalesInvoiceId: "...",
    //     ClientReference: "...",      ← our payment reference
    //     Status: "Success" | "Failed",
    //     Amount: 0.5,
    //     CustomerPhoneNumber: "233...",
    //     PaymentDetails: { MobileMoneyNumber, PaymentType, Channel },
    //     Description: "..."
    //   }
    // }
    else if (gateway === "hubtel" && parsedBody.Data) {
      const hubtelData = parsedBody.Data as Record<string, unknown>;
      reference = (hubtelData.ClientReference || "") as string;
      const responseCode = String(parsedBody.ResponseCode || "");
      const callbackStatus = String(hubtelData.Status || "").toLowerCase();
      const amount = typeof hubtelData.Amount === "number" ? hubtelData.Amount : null;
      const checkoutId = String(hubtelData.CheckoutId || "");
      const customerPhone = String(hubtelData.CustomerPhoneNumber || "");
      const description = String(hubtelData.Description || "");

      // Extract payment details (mobile money, card, etc.)
      const paymentDetails = hubtelData.PaymentDetails as Record<string, unknown> | undefined;
      const paymentType = String(paymentDetails?.PaymentType || "");
      const channel = String(paymentDetails?.Channel || "");
      const mobileNumber = String(paymentDetails?.MobileMoneyNumber || "");

      if (reference) {
        const payment = await db.payment.findFirst({ where: { gatewayRef: reference } });

        if (payment) {
          // Only process if not already completed
          if (payment.status !== "completed") {
            if (responseCode === "0000" && callbackStatus === "success") {
              // Payment successful — credit tokens
              await db.payment.update({
                where: { id: payment.id },
                data: {
                  status: "completed",
                  metadata: JSON.stringify({
                    hubtelCheckoutId: checkoutId,
                    hubtelSalesInvoiceId: hubtelData.SalesInvoiceId || "",
                    customerPhone,
                    paymentType,
                    channel,
                    mobileNumber,
                    description,
                    callbackRaw: { ResponseCode: responseCode, Status: hubtelData.Status, Amount: amount },
                  }),
                },
              });

              await db.user.update({
                where: { id: payment.userId },
                data: { tokens: { increment: payment.tokensPurchased } },
              });

              await db.tokenTransaction.create({
                data: {
                  userId: payment.userId,
                  type: "purchase",
                  amount: payment.tokensPurchased,
                  description: `Purchased ${payment.tokensPurchased} tokens via Hubtel ${paymentType ? `(${paymentType}/${channel})` : "(webhook)"}`,
                  referenceId: payment.id,
                  operationType: "purchase",
                },
              });

              console.log(
                `[Webhook] Hubtel: credited ${payment.tokensPurchased} tokens to ${payment.userId}` +
                  (paymentType ? ` [${paymentType}/${channel}]` : "")
              );
            } else {
              // Payment failed
              await db.payment.update({
                where: { id: payment.id },
                data: {
                  status: "failed",
                  metadata: JSON.stringify({
                    hubtelCheckoutId: checkoutId,
                    callbackStatus,
                    responseCode,
                    description,
                    failed: true,
                  }),
                },
              });
              console.log(`[Webhook] Hubtel: payment failed for ref ${reference}`, {
                callbackStatus,
                responseCode,
                description,
              });
            }
          } else {
            console.log(`[Webhook] Hubtel: payment ${reference} already completed, skipping`);
          }
        } else {
          console.warn(`[Webhook] Hubtel: no payment found for reference ${reference}`);
        }
      }
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("[Webhook] Error:", error);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
