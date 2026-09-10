import { describe, expect, test } from "bun:test";
import { BillingSafetyError } from "@/lib/provider-cost-billing";
import { providerBillingErrorResponse } from "@/lib/billing-errors";

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

describe("provider billing HTTP error boundary", () => {
  test("maps billing kill-switch failures to a safe service-unavailable response", async () => {
    const response = providerBillingErrorResponse(
      new BillingSafetyError("BILLING_DISABLED", "operator-only diagnostic"),
    );
    const body = await bodyOf(response);

    expect(response.status).toBe(503);
    expect(body.code).toBe("BILLING_DISABLED");
    expect(body.error).toBe("Paid AI generation is temporarily unavailable. Please try again later.");
    expect(JSON.stringify(body)).not.toContain("operator-only diagnostic");
  });

  test("maps exact insufficient-credit reservation failures without exposing unrelated internals", async () => {
    const response = providerBillingErrorResponse(
      new Error("Insufficient credits. Need 12, have 4"),
    );
    const body = await bodyOf(response);

    expect(response.status).toBe(402);
    expect(body.code).toBe("INSUFFICIENT_CREDITS");
    expect(body.error).toBe("You need 12 credits for this operation but currently have 4.");
  });

  test("maps stale provider pricing to a fresh-quote conflict", async () => {
    const response = providerBillingErrorResponse(
      new BillingSafetyError("STALE_PROVIDER_PRICE", "secret provider/model diagnostic"),
    );
    const body = await bodyOf(response);

    expect(response.status).toBe(503);
    expect(body.code).toBe("STALE_PROVIDER_PRICE");
    expect(JSON.stringify(body)).not.toContain("secret provider/model diagnostic");
  });

  test("never returns an arbitrary server exception to a normal customer", async () => {
    const response = providerBillingErrorResponse(
      new Error("postgresql://internal-user:secret@db.example/private"),
      {
        fallbackStatus: 502,
        fallbackMessage: "The AI story director could not complete this request. Please try again later.",
      },
    );
    const body = await bodyOf(response);

    expect(response.status).toBe(502);
    expect(body.error).toBe("The AI story director could not complete this request. Please try again later.");
    expect(JSON.stringify(body)).not.toContain("postgresql://");
    expect(body.adminDetail).toBeUndefined();
  });

  test("keeps raw diagnostic detail available only to an authenticated admin session", async () => {
    const response = providerBillingErrorResponse(
      new Error("internal reconciliation diagnostic"),
      { session: { role: "admin" } },
    );
    const body = await bodyOf(response);

    expect(response.status).toBe(500);
    expect(body.error).toBe("The AI operation could not be completed. Please try again later.");
    expect(body.adminDetail).toBe("internal reconciliation diagnostic");
  });
});
