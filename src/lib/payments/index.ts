import { db } from "@/lib/db";
import { getConfigValue } from "@/lib/secure-config";

export type GatewayName = "paystack" | "hubtel" | "stripe";

export interface PaymentResult {
  success: boolean;
  authorizationUrl?: string;
  directCheckoutUrl?: string;
  reference?: string;
  providerTransactionId?: string;
  error?: string;
}

export interface VerificationResult {
  success: boolean;
  verified: boolean;
  amount?: number;
  amountMinor?: number;
  currency?: string;
  reference?: string;
  providerTransactionId?: string;
  error?: string;
}

export interface PaymentGateway {
  getName(): GatewayName;
  initializePayment(params: {
    email: string;
    amount: number;
    currency: string;
    reference: string;
    callbackUrl: string;
    metadata?: Record<string, string>;
  }): Promise<PaymentResult>;
  verifyPayment(reference: string): Promise<VerificationResult>;
}

function normalizeCurrency(currency: unknown, fallback: string): string {
  const value = String(currency || fallback).trim().toUpperCase();
  return /^[A-Z]{3}$/.test(value) ? value : fallback;
}

function toMinor(amount: number): number {
  return Math.round(amount * 100);
}

async function nonSecretConfig(key: string, envName?: string): Promise<string> {
  const row = await db.systemConfig.findUnique({ where: { key } });
  return (row?.value || (envName ? process.env[envName] : "") || "").trim();
}

export class PaystackGateway implements PaymentGateway {
  getName(): GatewayName { return "paystack"; }

  private getSecretKey() {
    return getConfigValue("paystack_secret_key", "PAYSTACK_SECRET_KEY");
  }

  async initializePayment(params: {
    email: string; amount: number; currency: string; reference: string; callbackUrl: string;
    metadata?: Record<string, string>;
  }): Promise<PaymentResult> {
    try {
      const secretKey = await this.getSecretKey();
      if (!secretKey) return { success: false, error: "Paystack secret key not configured" };

      const res = await fetch("https://api.paystack.co/transaction/initialize", {
        method: "POST",
        headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          email: params.email,
          amount: toMinor(params.amount),
          currency: normalizeCurrency(params.currency, "GHS"),
          reference: params.reference,
          callback_url: params.callbackUrl,
          metadata: params.metadata,
        }),
      });
      const data = await res.json();
      if (res.ok && data.status && data.data?.authorization_url) {
        return { success: true, authorizationUrl: data.data.authorization_url, reference: params.reference };
      }
      return { success: false, error: String(data.message || "Paystack initialization failed") };
    } catch (error) {
      console.error("Paystack initialization failed", error instanceof Error ? error.message : "unknown error");
      return { success: false, error: "Paystack payment initialization failed" };
    }
  }

  async verifyPayment(reference: string): Promise<VerificationResult> {
    try {
      const secretKey = await this.getSecretKey();
      if (!secretKey) return { success: false, verified: false, error: "Paystack secret key not configured" };
      const res = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
        headers: { Authorization: `Bearer ${secretKey}` },
      });
      const data = await res.json();
      const txn = data?.data;
      if (res.ok && data.status && txn?.status === "success" && txn.reference === reference) {
        const amountMinor = Number(txn.amount);
        if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
          return { success: false, verified: false, error: "Paystack returned an invalid amount" };
        }
        return {
          success: true,
          verified: true,
          amountMinor,
          amount: amountMinor / 100,
          currency: normalizeCurrency(txn.currency, "GHS"),
          reference,
          providerTransactionId: txn.id != null ? String(txn.id) : undefined,
        };
      }
      return { success: true, verified: false, reference, error: String(data.message || "Payment not verified") };
    } catch (error) {
      console.error("Paystack verification failed", error instanceof Error ? error.message : "unknown error");
      return { success: false, verified: false, error: "Paystack verification failed" };
    }
  }
}

export class HubtelGateway implements PaymentGateway {
  getName(): GatewayName { return "hubtel"; }

  private async getCredentials() {
    const [clientId, clientSecret, merchantAccountNumber] = await Promise.all([
      getConfigValue("hubtel_client_id", "HUBTEL_CLIENT_ID"),
      getConfigValue("hubtel_client_secret", "HUBTEL_CLIENT_SECRET"),
      nonSecretConfig("hubtel_merchant_account_number", "HUBTEL_MERCHANT_ACCOUNT_NUMBER"),
    ]);
    return { clientId, clientSecret, merchantAccountNumber };
  }

  async initializePayment(params: {
    email: string; amount: number; currency: string; reference: string; callbackUrl: string;
    metadata?: Record<string, string>;
  }): Promise<PaymentResult> {
    try {
      const { clientId, clientSecret, merchantAccountNumber } = await this.getCredentials();
      if (!clientId || !clientSecret || !merchantAccountNumber) {
        return { success: false, error: "Hubtel payment credentials are not fully configured" };
      }
      if (normalizeCurrency(params.currency, "GHS") !== "GHS") {
        return { success: false, error: "Hubtel checkout currently supports GHS only" };
      }

      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXTAUTH_URL || "http://localhost:3000";
      const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
      const requestBody: Record<string, unknown> = {
        totalAmount: Number(params.amount.toFixed(2)),
        description: `Vidora Token Purchase - ${params.metadata?.tokens || ""} tokens`,
        callbackUrl: `${baseUrl}/api/payments/webhook`,
        returnUrl: `${baseUrl}/api/payments/verify?reference=${encodeURIComponent(params.reference)}&status=success`,
        cancellationUrl: `${baseUrl}/api/payments/verify?reference=${encodeURIComponent(params.reference)}&status=cancelled`,
        merchantAccountNumber,
        clientReference: params.reference,
        ...(params.email ? { payeeEmail: params.email } : {}),
        ...(params.metadata?.userName ? { payeeName: params.metadata.userName } : {}),
        ...(params.metadata?.phone ? { payeeMobileNumber: params.metadata.phone } : {}),
      };

      const res = await fetch("https://payproxyapi.hubtel.com/items/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}`, Accept: "application/json" },
        body: JSON.stringify(requestBody),
      });
      const text = await res.text();
      let data: Record<string, unknown>;
      try { data = JSON.parse(text); }
      catch { return { success: false, error: `Hubtel returned HTTP ${res.status}` }; }

      const responseCode = String(data.responseCode ?? data.response_code ?? "");
      const responseData = data.data as Record<string, unknown> | undefined;
      const checkoutUrl = String(responseData?.checkoutUrl ?? data.checkoutUrl ?? "");
      const directUrl = String(responseData?.checkoutDirectUrl ?? "");
      if (res.ok && (responseCode === "0000" || responseCode === "00") && (checkoutUrl || directUrl)) {
        return { success: true, authorizationUrl: checkoutUrl || directUrl, directCheckoutUrl: directUrl || checkoutUrl, reference: params.reference };
      }
      return { success: false, error: String(responseData?.message || data.message || "Hubtel initialization failed") };
    } catch (error) {
      console.error("Hubtel initialization failed", error instanceof Error ? error.message : "unknown error");
      return { success: false, error: "Hubtel payment initialization failed" };
    }
  }

  async verifyPayment(reference: string): Promise<VerificationResult> {
    try {
      const { clientId, clientSecret, merchantAccountNumber } = await this.getCredentials();
      if (!clientId || !clientSecret || !merchantAccountNumber) {
        return { success: false, verified: false, error: "Hubtel credentials are not fully configured" };
      }
      const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
      const url = new URL(`https://api-txnstatus.hubtel.com/transactions/${encodeURIComponent(merchantAccountNumber)}/status`);
      url.searchParams.set("clientReference", reference);
      const res = await fetch(url.toString(), { headers: { Authorization: `Basic ${auth}`, Accept: "application/json" } });
      const text = await res.text();
      let data: Record<string, unknown>;
      try { data = JSON.parse(text); }
      catch { return { success: false, verified: false, error: `Hubtel status API returned HTTP ${res.status}` }; }

      const responseData = data.data as Record<string, unknown> | undefined;
      const responseCode = String(data.responseCode ?? data.response_code ?? "");
      const status = String(responseData?.status ?? data.status ?? "").toLowerCase();
      const returnedRef = String(responseData?.clientReference ?? responseData?.client_reference ?? reference);
      const amount = Number(responseData?.amount ?? 0);
      const paid = (status === "paid" || status === "success") && (responseCode === "0000" || responseCode === "00");

      if (res.ok && paid && returnedRef === reference && Number.isFinite(amount) && amount >= 0) {
        return {
          success: true,
          verified: true,
          amount,
          amountMinor: toMinor(amount),
          currency: normalizeCurrency(responseData?.currency, "GHS"),
          reference,
          providerTransactionId: responseData?.transactionId != null ? String(responseData.transactionId) : undefined,
        };
      }
      return { success: true, verified: false, reference, error: String(data.message || responseData?.reason || "Payment not completed") };
    } catch (error) {
      console.error("Hubtel verification failed", error instanceof Error ? error.message : "unknown error");
      return { success: false, verified: false, error: "Hubtel verification failed" };
    }
  }
}

export class StripeGateway implements PaymentGateway {
  getName(): GatewayName { return "stripe"; }

  private getSecretKey() {
    return getConfigValue("stripe_secret_key", "STRIPE_SECRET_KEY");
  }

  async initializePayment(params: {
    email: string; amount: number; currency: string; reference: string; callbackUrl: string;
    metadata?: Record<string, string>;
  }): Promise<PaymentResult> {
    try {
      const secretKey = await this.getSecretKey();
      if (!secretKey) return { success: false, error: "Stripe secret key not configured" };
      const currency = normalizeCurrency(params.currency, "USD").toLowerCase();
      const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          "payment_method_types[0]": "card",
          "line_items[0][price_data][currency]": currency,
          "line_items[0][price_data][product_data][name]": "Vidora Token Package",
          "line_items[0][price_data][unit_amount]": String(toMinor(params.amount)),
          "line_items[0][quantity]": "1",
          mode: "payment",
          success_url: `${params.callbackUrl}?reference=${encodeURIComponent(params.reference)}&status=success`,
          cancel_url: `${params.callbackUrl}?reference=${encodeURIComponent(params.reference)}&status=cancelled`,
          client_reference_id: params.reference,
          customer_email: params.email,
          ...Object.fromEntries(Object.entries(params.metadata || {}).map(([k, v]) => [`metadata[${k}]`, v])),
        }),
      });
      const data = await res.json();
      if (res.ok && data.url && data.client_reference_id === params.reference) {
        return { success: true, authorizationUrl: data.url, reference: params.reference, providerTransactionId: String(data.id || "") || undefined };
      }
      return { success: false, error: String(data.error?.message || "Stripe initialization failed") };
    } catch (error) {
      console.error("Stripe initialization failed", error instanceof Error ? error.message : "unknown error");
      return { success: false, error: "Stripe payment initialization failed" };
    }
  }

  async verifyPayment(reference: string): Promise<VerificationResult> {
    try {
      const secretKey = await this.getSecretKey();
      if (!secretKey) return { success: false, verified: false, error: "Stripe secret key not configured" };
      const url = new URL("https://api.stripe.com/v1/checkout/sessions");
      url.searchParams.set("client_reference_id", reference);
      url.searchParams.set("limit", "1");
      const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${secretKey}` } });
      const data = await res.json();
      const session = data?.data?.[0];
      if (res.ok && session?.client_reference_id === reference && session?.payment_status === "paid") {
        const amountMinor = Number(session.amount_total);
        if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
          return { success: false, verified: false, error: "Stripe returned an invalid amount" };
        }
        return {
          success: true,
          verified: true,
          amountMinor,
          amount: amountMinor / 100,
          currency: normalizeCurrency(session.currency, "USD"),
          reference,
          providerTransactionId: String(session.payment_intent || session.id || "") || undefined,
        };
      }
      return { success: true, verified: false, reference, error: "Payment not completed" };
    } catch (error) {
      console.error("Stripe verification failed", error instanceof Error ? error.message : "unknown error");
      return { success: false, verified: false, error: "Stripe verification failed" };
    }
  }
}

export function getGatewayByName(name: string): PaymentGateway {
  switch (name) {
    case "hubtel": return new HubtelGateway();
    case "stripe": return new StripeGateway();
    case "paystack": return new PaystackGateway();
    default: throw new Error(`Unsupported payment gateway: ${name}`);
  }
}

export async function getActiveGateway(): Promise<PaymentGateway> {
  const config = await db.systemConfig.findUnique({ where: { key: "payment_gateway" } });
  return getGatewayByName(config?.value || "paystack");
}
