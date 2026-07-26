import { db } from "@/lib/db";

// ─── Interface ───────────────────────────────────────────────
export interface PaymentResult {
  success: boolean;
  authorizationUrl?: string;
  reference?: string;
  error?: string;
}

export interface VerificationResult {
  success: boolean;
  verified: boolean;
  amount?: number;
  reference?: string;
  error?: string;
}

export interface PaymentGateway {
  getName(): string;
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

// ─── Paystack ────────────────────────────────────────────────
export class PaystackGateway implements PaymentGateway {
  getName() {
    return "paystack";
  }

  private async getSecretKey(): Promise<string> {
    const config = await db.systemConfig.findUnique({
      where: { key: "paystack_secret_key" },
    });
    return config?.value || process.env.PAYSTACK_SECRET_KEY || "";
  }

  async initializePayment(params: {
    email: string;
    amount: number;
    currency: string;
    reference: string;
    callbackUrl: string;
    metadata?: Record<string, string>;
  }): Promise<PaymentResult> {
    try {
      const secretKey = await this.getSecretKey();
      if (!secretKey) {
        return { success: false, error: "Paystack secret key not configured" };
      }

      const amountInKobo = Math.round(params.amount * 100);

      const res = await fetch("https://api.paystack.co/transaction/initialize", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secretKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: params.email,
          amount: amountInKobo,
          currency: params.currency || "GHS",
          reference: params.reference,
          callback_url: params.callbackUrl,
          metadata: params.metadata,
        }),
      });

      const data = await res.json();

      if (data.status && data.data?.authorization_url) {
        return {
          success: true,
          authorizationUrl: data.data.authorization_url,
          reference: params.reference,
        };
      }

      return {
        success: false,
        error: data.message || "Paystack initialization failed",
      };
    } catch (error) {
      console.error("Paystack init error:", error);
      return { success: false, error: "Paystack payment initialization failed" };
    }
  }

  async verifyPayment(reference: string): Promise<VerificationResult> {
    try {
      const secretKey = await this.getSecretKey();
      if (!secretKey) {
        return { success: false, error: "Paystack secret key not configured" };
      }

      const res = await fetch(
        `https://api.paystack.co/transaction/verify/${reference}`,
        {
          headers: {
            Authorization: `Bearer ${secretKey}`,
          },
        }
      );

      const data = await res.json();

      if (data.status && data.data?.status === "success") {
        return {
          success: true,
          verified: true,
          amount: data.data.amount / 100,
          reference,
        };
      }

      return {
        success: true,
        verified: false,
        reference,
        error: data.message || "Payment not verified",
      };
    } catch (error) {
      console.error("Paystack verify error:", error);
      return { success: false, error: "Paystack verification failed" };
    }
  }
}

// ─── Hubtel ──────────────────────────────────────────────────
// Uses the Online Checkout API (v1) which generates a hosted checkout URL
// the customer is redirected to. They enter their phone number on Hubtel's page.
// Endpoint: POST https://api.hubtel.com/v1/merchantaccount/onlinecheckout/invoice/create
// Auth: Basic client_id:client_secret
// Response: { response_code: "00", response_text: "<checkout URL>", token: "..." }
export class HubtelGateway implements PaymentGateway {
  getName() {
    return "hubtel";
  }

  private async getCredentials(): Promise<{ clientId: string; clientSecret: string; merchantId: string }> {
    const clientIdRow = await db.systemConfig.findUnique({ where: { key: "hubtel_client_id" } });
    const clientSecretRow = await db.systemConfig.findUnique({ where: { key: "hubtel_client_secret" } });
    const merchantIdRow = await db.systemConfig.findUnique({ where: { key: "hubtel_merchant_id" } });
    return {
      clientId: clientIdRow?.value || process.env.HUBTEL_CLIENT_ID || "",
      clientSecret: clientSecretRow?.value || process.env.HUBTEL_CLIENT_SECRET || "",
      merchantId: merchantIdRow?.value || process.env.HUBTEL_MERCHANT_ID || "",
    };
  }

  async initializePayment(params: {
    email: string;
    amount: number;
    currency: string;
    reference: string;
    callbackUrl: string;
    metadata?: Record<string, string>;
  }): Promise<PaymentResult> {
    try {
      const { clientId, clientSecret } = await this.getCredentials();
      if (!clientId || !clientSecret) {
        return {
          success: false,
          error: "Hubtel client ID and secret are not configured. Set them in the Admin Portal.",
        };
      }

      const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
      const amountStr = params.amount.toFixed(2);
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXTAUTH_URL || "http://localhost:3000";

      // Hubtel v1 Online Checkout — creates an invoice and returns a checkout URL
      const res = await fetch(
        "https://api.hubtel.com/v1/merchantaccount/onlinecheckout/invoice/create",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Basic ${auth}`,
          },
          body: JSON.stringify({
            invoice: {
              items: [
                {
                  name: "Vidora Tokens",
                  quantity: 1,
                  unit_price: amountStr,
                  total_price: amountStr,
                  description: `Token purchase — ${params.metadata?.tokens || ""} tokens`,
                },
              ],
              total_amount: Number(amountStr),
              description: `Vidora Token Purchase — ${params.reference}`,
            },
            store: {
              name: "Vidora",
              tagline: "Professional AI Video Studio",
              website_url: baseUrl,
            },
            actions: {
              cancel_url: `${params.callbackUrl}?reference=${params.reference}&status=cancelled`,
              return_url: `${params.callbackUrl}?reference=${params.reference}&status=success`,
            },
            custom_data: {
              payment_id: params.metadata?.paymentId || "",
              user_id: params.metadata?.userId || "",
              tokens: params.metadata?.tokens || "",
              client_reference: params.reference,
            },
          }),
        }
      );

      // Handle non-JSON responses gracefully (Hubtel may return HTML errors on bad auth)
      const responseText = await res.text();
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(responseText);
      } catch {
        console.error("Hubtel returned non-JSON response:", res.status, responseText.substring(0, 300));
        return {
          success: false,
          error: `Hubtel API returned status ${res.status}. Verify your client ID and secret are correct in the Admin Portal.`,
        };
      }

      // Hubtel v1 returns: { response_code: "00", response_text: "<checkout URL>", token: "..." }
      const responseCode = String(data.response_code ?? data.responseCode ?? "");
      const checkoutUrl = String(data.response_text ?? data.responseText ?? data.checkoutUrl ?? "");

      // Success: response_code "00" and response_text contains the checkout URL
      if ((responseCode === "00" || responseCode === "0000") && checkoutUrl) {
        return {
          success: true,
          authorizationUrl: checkoutUrl,
          reference: params.reference,
        };
      }

      // Fallback: some Hubtel responses nest the URL under checkoutUrl directly
      if (typeof data.checkoutUrl === "string" && data.checkoutUrl) {
        return {
          success: true,
          authorizationUrl: data.checkoutUrl,
          reference: params.reference,
        };
      }

      // Error — surface the actual Hubtel error message so the user can see what went wrong
      const errorMsg =
        data.message ||
        data.responseMessage ||
        data.response_text ||
        data.error ||
        `Hubtel initialization failed (HTTP ${res.status}, code: ${responseCode || "none"})`;
      console.error("Hubtel init failed:", { status: res.status, responseCode, data });
      return { success: false, error: String(errorMsg) };
    } catch (error) {
      console.error("Hubtel init error:", error);
      return {
        success: false,
        error: `Hubtel payment initialization failed: ${error instanceof Error ? error.message : "network error"}`,
      };
    }
  }

  async verifyPayment(reference: string): Promise<VerificationResult> {
    try {
      const { clientId, clientSecret } = await this.getCredentials();
      if (!clientId || !clientSecret) {
        return { success: false, error: "Hubtel credentials not configured" };
      }

      const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

      // Hubtel v1: check invoice status by token/reference
      const res = await fetch(
        `https://api.hubtel.com/v1/merchantaccount/onlinecheckout/invoice/status/${encodeURIComponent(reference)}`,
        {
          headers: {
            Authorization: `Basic ${auth}`,
            Accept: "application/json",
          },
        }
      );

      const responseText = await res.text();
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(responseText);
      } catch {
        return {
          success: false,
          error: `Hubtel returned non-JSON response (status ${res.status})`,
        };
      }

      const status = String(data.status ?? data.payment_status ?? "").toLowerCase();
      const responseCode = String(data.response_code ?? data.responseCode ?? "");

      // Hubtel considers the payment complete when status is "completed"/"paid"/"success"
      // or response_code is "00"/"0000"
      if (
        status === "completed" ||
        status === "paid" ||
        status === "success" ||
        responseCode === "00" ||
        responseCode === "0000"
      ) {
        return {
          success: true,
          verified: true,
          amount: typeof data.amount === "number" ? data.amount : Number(data.total_amount) || 0,
          reference,
        };
      }

      return {
        success: true,
        verified: false,
        reference,
        error: data.reason || data.response_text || data.message || "Payment not completed",
      };
    } catch (error) {
      console.error("Hubtel verify error:", error);
      return {
        success: false,
        error: `Hubtel verification failed: ${error instanceof Error ? error.message : "network error"}`,
      };
    }
  }
}

// ─── Stripe ───────────────────────────────────────────────────
export class StripeGateway implements PaymentGateway {
  getName() {
    return "stripe";
  }

  private async getSecretKey(): Promise<string> {
    const config = await db.systemConfig.findUnique({
      where: { key: "stripe_secret_key" },
    });
    return config?.value || process.env.STRIPE_SECRET_KEY || "";
  }

  async initializePayment(params: {
    email: string;
    amount: number;
    currency: string;
    reference: string;
    callbackUrl: string;
    metadata?: Record<string, string>;
  }): Promise<PaymentResult> {
    try {
      const secretKey = await this.getSecretKey();
      if (!secretKey) {
        return { success: false, error: "Stripe secret key not configured" };
      }

      // Amount in cents for Stripe
      const currencyLower = (params.currency || "USD").toLowerCase();
      const amountInSmallestUnit = currencyLower === "ghs"
        ? Math.round(params.amount * 100)
        : Math.round(params.amount * 100);

      const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secretKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          "payment_method_types[0]": "card",
          "line_items[0][price_data][currency]": currencyLower,
          "line_items[0][price_data][product_data][name]": `Vidora Token Package`,
          "line_items[0][price_data][unit_amount]": String(amountInSmallestUnit),
          "line_items[0][quantity]": "1",
          mode: "payment",
          success_url: `${params.callbackUrl}?reference=${params.reference}&status=success`,
          cancel_url: `${params.callbackUrl}?reference=${params.reference}&status=cancelled`,
          client_reference_id: params.reference,
          customer_email: params.email,
          metadata: JSON.stringify(params.metadata || {}),
        }),
      });

      const data = await res.json();

      if (data.url) {
        return {
          success: true,
          authorizationUrl: data.url,
          reference: params.reference,
        };
      }

      return {
        success: false,
        error: data.error?.message || "Stripe initialization failed",
      };
    } catch (error) {
      console.error("Stripe init error:", error);
      return { success: false, error: "Stripe payment initialization failed" };
    }
  }

  async verifyPayment(reference: string): Promise<VerificationResult> {
    try {
      const secretKey = await this.getSecretKey();
      if (!secretKey) {
        return { success: false, error: "Stripe secret key not configured" };
      }

      // Retrieve checkout session
      const res = await fetch(
        `https://api.stripe.com/v1/checkout/sessions?client_reference_id=${reference}&limit=1`,
        {
          headers: {
            Authorization: `Bearer ${secretKey}`,
          },
        }
      );

      const data = await res.json();

      if (data.data && data.data.length > 0 && data.data[0].payment_status === "paid") {
        const session = data.data[0];
        return {
          success: true,
          verified: true,
          amount: session.amount_total / 100,
          reference,
        };
      }

      return {
        success: true,
        verified: false,
        reference,
        error: "Payment not completed",
      };
    } catch (error) {
      console.error("Stripe verify error:", error);
      return { success: false, error: "Stripe verification failed" };
    }
  }
}

// ─── Factory ─────────────────────────────────────────────────
export async function getActiveGateway(): Promise<PaymentGateway> {
  const config = await db.systemConfig.findUnique({
    where: { key: "payment_gateway" },
  });

  const gateway = config?.value || "paystack";

  switch (gateway) {
    case "hubtel":
      return new HubtelGateway();
    case "stripe":
      return new StripeGateway();
    case "paystack":
    default:
      return new PaystackGateway();
  }
}
