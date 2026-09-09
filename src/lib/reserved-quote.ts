import { db } from "@/lib/db";
import type { BillingQuoteLine } from "@/lib/credit-reservations";
import type { BillableOperation, BillableProvider } from "@/lib/provider-cost-billing";

interface ReservedQuoteRow { breakdown: string; }

/**
 * Load the immutable provider line-items that were actually funded by a
 * reservation. Paid execution must use these snapshots rather than re-reading
 * mutable project/admin model settings after the customer confirmed a quote.
 */
export async function getReservedQuoteLines(reservationId: string, userId: string): Promise<BillingQuoteLine[]> {
  const rows = await db.$queryRaw<ReservedQuoteRow[]>`
    SELECT q."breakdown"
    FROM "CreditReservation" r
    INNER JOIN "BillingQuote" q ON q."id" = r."quoteId"
    WHERE r."id" = ${reservationId} AND r."userId" = ${userId}
    LIMIT 1
  `;
  const raw = rows[0]?.breakdown;
  if (!raw) throw new Error("Reserved billing quote was not found");

  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error("Reserved billing quote breakdown is corrupted"); }
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("Reserved billing quote has no provider line-items");

  const lines = parsed as BillingQuoteLine[];
  const keys = new Set<string>();
  for (const line of lines) {
    if (!line || typeof line !== "object" || !line.lineKey?.trim()) throw new Error("Reserved billing quote contains an invalid line-item");
    if (keys.has(line.lineKey)) throw new Error(`Reserved billing quote contains duplicate line ${line.lineKey}`);
    keys.add(line.lineKey);
    if (!line.provider || !line.model || !line.operation) throw new Error(`Reserved billing quote line ${line.lineKey} is incomplete`);
  }
  return lines;
}

export function requireReservedQuoteLine(
  lines: BillingQuoteLine[],
  opts: { lineKey: string; provider: BillableProvider; operation: BillableOperation },
): BillingQuoteLine {
  const line = lines.find((candidate) => candidate.lineKey === opts.lineKey);
  if (!line) throw new Error(`Reserved billing quote is missing line ${opts.lineKey}`);
  if (line.provider !== opts.provider || line.operation !== opts.operation) {
    throw new Error(`Reserved billing quote line ${opts.lineKey} does not match the required provider operation`);
  }
  if (!line.model?.trim()) throw new Error(`Reserved billing quote line ${opts.lineKey} has no provider model`);
  return line;
}

/** True only when this exact reservation line already has a durable usage row. */
export async function isReservedQuoteLineCaptured(reservationId: string, lineKey: string): Promise<boolean> {
  const key = `reservation:${reservationId}:line:${lineKey}`;
  const rows = await db.$queryRaw<Array<{ present: number }>>`
    SELECT 1 AS "present"
    FROM "ProviderUsageLedger"
    WHERE "idempotencyKey" = ${key}
    LIMIT 1
  `;
  return rows.length > 0;
}
