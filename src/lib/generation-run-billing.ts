import { db } from "@/lib/db";

export interface GenerationRunBillingLink {
  billingQuoteId: string | null;
  creditReservationId: string | null;
}

export async function getGenerationRunBillingLink(runId: string): Promise<GenerationRunBillingLink> {
  const rows = await db.$queryRaw<GenerationRunBillingLink[]>`
    SELECT "billingQuoteId", "creditReservationId"
    FROM "GenerationRun"
    WHERE "id" = ${runId}
    LIMIT 1
  `;
  return rows[0] ?? { billingQuoteId: null, creditReservationId: null };
}

export async function setGenerationRunBillingLink(opts: {
  runId: string;
  billingQuoteId: string;
  creditReservationId: string;
}): Promise<void> {
  const changed = await db.$executeRaw`
    UPDATE "GenerationRun"
    SET "billingQuoteId" = ${opts.billingQuoteId},
        "creditReservationId" = ${opts.creditReservationId},
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${opts.runId}
  `;
  if (changed !== 1) throw new Error("Generation run disappeared while attaching its credit reservation");
}
