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
export class HubtelGateway implements PaymentGateway {
  getName() {
    return "hubtel";
  }

  private async getCredentials(): Promise<{ clientId: string; clientSecret: string; merchantId: string }> {
    const clientId = await db.systemConfig.findUnique({ where: { key: "hubtel_client_id" } });
    const clientSecret = await db.systemConfig.findUnique({ where: { key: "hubtel_client_secret" } });
    const merchantId = await db.systemConfig.findUnique({ where: { key: "hubtel_merchant_id" } });
    return {
      clientId: clientId?.value || process.env.HUBTEL_CLIENT_ID || "",
      clientSecret: clientSecret?.value || process.env.HUBTEL_CLIENT_SECRET || "",
      merchantId: merchantId?.value || process.env.HUBTEL_MERCHANT_ID || "",
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
      const { clientId, clientSecret, merchantId } = await this.getCredentials();
      if (!clientId || !clientSecret || !merchantId) {
        return { success: false, error: "Hubtel credentials not configured" };
      }

      const res = await fetch(
        "https://api.hubtel.com/v2/merchant-account/mobile-money/online-checkout",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
          },
          body: JSON.stringify({
            clientReference: params.reference,
            description: `Vidora Token Purchase - ${params.reference}`,
            amount: params.amount,
            currency: params.currency || "GHS",
            callbackUrl: params.callbackUrl,
            returnUrl: params.callbackUrl,
            cancelledUrl: `${params.callbackUrl}?cancelled=true`,
            merchantAccountNumber: merchantId,
            customer: {
              name: params.email,
              email: params.email,
            },
          }),
        }
      );

      const data = await res.json();

      if (data.responseCode === "0000" || data.checkoutUrl) {
        return {
          success: true,
          authorizationUrl: data.checkoutUrl || data.responseMessage,
          reference: params.reference,
        };
      }

      return {
        success: false,
        error: data.message || data.responseMessage || "Hubtel initialization failed",
      };
    } catch (error) {
      console.error("Hubtel init error:", error);
      return { success: false, error: "Hubtel payment initialization failed" };
    }
  }

  async verifyPayment(reference: string): Promise<VerificationResult> {
    try {
      const { clientId, clientSecret } = await this.getCredentials();

      const res = await fetch(
        `https://api.hubtel.com/v2/merchant-account/transactions/${reference}/status`,
        {
          headers: {
            Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
          },
        }
      );

      const data = await res.json();

      if (data.status === "Completed" || data.responseCode === "0000") {
        return {
          success: true,
          verified: true,
          amount: data.amount,
          reference,
        };
      }

      return {
        success: true,
        verified: false,
        reference,
        error: data.reason || "Payment not verified",
      };
    } catch (error) {
      console.error("Hubtel verify error:", error);
      return { success: false, error: "Hubtel verification failed" };
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
