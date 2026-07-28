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
// Uses the Online Checkout API (2026) which supports:
//   Mobile Money, Bank Card, Wallet (Hubtel, G-Money), GhQR, Cash / Cheque
// Initiate: POST https://payproxyapi.hubtel.com/items/initiate
// Status:   GET  https://api-txnstatus.hubtel.com/transactions/{AccountNumber}/status
// Auth:     Basic clientId:clientSecret
// Response: { responseCode: "0000", data: { checkoutUrl, checkoutId, checkoutDirectUrl }}
// Callback: { ResponseCode: "0000", Data: { ClientReference, Status: "Success", Amount, PaymentDetails }}
export class HubtelGateway implements PaymentGateway {
  getName() {
    return "hubtel";
  }

  private async getCredentials(): Promise<{
    clientId: string;
    clientSecret: string;
    merchantAccountNumber: string;
  }> {
    const clientIdRow = await db.systemConfig.findUnique({ where: { key: "hubtel_client_id" } });
    const clientSecretRow = await db.systemConfig.findUnique({ where: { key: "hubtel_client_secret" } });
    const accountNumberRow = await db.systemConfig.findUnique({ where: { key: "hubtel_merchant_account_number" } });
    return {
      clientId: clientIdRow?.value || process.env.HUBTEL_CLIENT_ID || "",
      clientSecret: clientSecretRow?.value || process.env.HUBTEL_CLIENT_SECRET || "",
      merchantAccountNumber:
        accountNumberRow?.value ||
        process.env.HUBTEL_MERCHANT_ACCOUNT_NUMBER ||
        // Backwards-compatible: fall back to old hubtel_merchant_id if set
        (await db.systemConfig.findUnique({ where: { key: "hubtel_merchant_id" } }))?.value ||
        process.env.HUBTEL_MERCHANT_ID ||
        "",
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
      const { clientId, clientSecret, merchantAccountNumber } = await this.getCredentials();
      if (!clientId || !clientSecret) {
        return {
          success: false,
          error: "Hubtel API credentials not configured. Set Client ID and Client Secret in the Admin Portal.",
        };
      }
      if (!merchantAccountNumber) {
        return {
          success: false,
          error: "Hubtel Merchant Account Number not configured. Set it in the Admin Portal.",
        };
      }

      const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
      const totalAmount = Number(params.amount.toFixed(2));

      console.log(`[Hubtel] Initiating checkout:`, {
        clientId: `${clientId.slice(0, 6)}...`,
        clientSecret: `${clientSecret.slice(0, 6)}...`,
        merchantAccountNumber,
        totalAmount,
        reference: params.reference,
        authPrefix: auth.slice(0, 10) + "...",
      });
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXTAUTH_URL || "http://localhost:3000";

      // Hubtel Online Checkout (2026) — initiate a hosted checkout
      const requestBody: Record<string, unknown> = {
        totalAmount,
        description: `Vidora Token Purchase - ${params.metadata?.tokens || ""} tokens`,
        callbackUrl: `${baseUrl}/api/payments/webhook`,
        returnUrl: `${baseUrl}/api/payments/verify?reference=${params.reference}&status=success`,
        merchantAccountNumber,
        cancellationUrl: `${baseUrl}/api/payments/verify?reference=${params.reference}&status=cancelled`,
        clientReference: params.reference,
      };

      // Optional payee info
      if (params.email) {
        requestBody.payeeEmail = params.email;
      }
      if (params.metadata?.userName) {
        requestBody.payeeName = params.metadata.userName;
      }
      if (params.metadata?.phone) {
        requestBody.payeeMobileNumber = params.metadata.phone;
      }

      const res = await fetch("https://payproxyapi.hubtel.com/items/initiate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${auth}`,
          Accept: "application/json",
          "Cache-Control": "no-cache",
        },
        body: JSON.stringify(requestBody),
      });

      // Handle non-JSON responses gracefully (Hubtel may return HTML on bad auth)
      const responseText = await res.text();
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(responseText);
      } catch {
        console.error("Hubtel returned non-JSON response:", res.status, responseText.substring(0, 500));
        return {
          success: false,
          error: `Hubtel API returned HTTP ${res.status}. Verify your API credentials and Merchant Account Number in the Admin Portal.`,
        };
      }

      // Hubtel Online Checkout response:
      // { responseCode: "0000", status: "Success", data: { checkoutUrl, checkoutId, clientReference, checkoutDirectUrl }}
      const responseCode = String(data.responseCode ?? data.response_code ?? "");
      const responseData = data.data as Record<string, unknown> | undefined;
      const checkoutUrl = String(responseData?.checkoutUrl ?? data.checkoutUrl ?? "");

      if ((responseCode === "0000" || responseCode === "00") && checkoutUrl) {
        return {
          success: true,
          authorizationUrl: checkoutUrl,
          reference: params.reference,
        };
      }

      // Fallback: check if checkoutUrl is at top level
      if (typeof data.checkoutUrl === "string" && data.checkoutUrl) {
        return {
          success: true,
          authorizationUrl: data.checkoutUrl,
          reference: params.reference,
        };
      }

      // Error — surface the actual Hubtel error for debugging
      const errorMsg =
        responseData?.message ||
        data.message ||
        data.responseMessage ||
        data.error_description ||
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
      const { clientId, clientSecret, merchantAccountNumber } = await this.getCredentials();
      if (!clientId || !clientSecret) {
        return { success: false, error: "Hubtel credentials not configured" };
      }
      if (!merchantAccountNumber) {
        return { success: false, error: "Hubtel Merchant Account Number not configured" };
      }

      const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

      // Hubtel Online Checkout: Transaction Status Check API
      // GET https://api-txnstatus.hubtel.com/transactions/{Collection_Account_Number}/status?clientReference=xxx
      const url = new URL(`https://api-txnstatus.hubtel.com/transactions/${merchantAccountNumber}/status`);
      url.searchParams.set("clientReference", reference);

      const res = await fetch(url.toString(), {
        method: "GET",
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: "application/json",
        },
      });

      const responseText = await res.text();
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(responseText);
      } catch {
        return {
          success: false,
          error: `Hubtel status API returned non-JSON response (HTTP ${res.status})`,
        };
      }

      const responseData = data.data as Record<string, unknown> | undefined;
      const status = String(responseData?.status ?? data.status ?? "").toLowerCase();
      const responseCode = String(data.responseCode ?? data.response_code ?? "");

      // Hubtel considers payment complete when status is "paid"
      if (status === "paid" || responseCode === "0000") {
        return {
          success: true,
          verified: true,
          amount: typeof responseData?.amount === "number" ? responseData.amount : 0,
          reference,
        };
      }

      return {
        success: true,
        verified: false,
        reference,
        error: data.message || responseData?.reason || "Payment not completed",
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
