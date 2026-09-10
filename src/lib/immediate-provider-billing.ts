import { db } from "@/lib/db";
import {
  BillingSafetyError,
  getCommercialPricingPolicy,
  quoteProviderCharge,
  type BillableOperation,
  type BillableProvider,
} from "@/lib/provider-cost-billing";
import {
  captureReservedQuoteLine,
  createBillingQuote,
  releaseReservationRemainder,
  reserveBillingQuote,
  type BillingQuoteLine,
} from "@/lib/credit-reservations";

export interface ImmediateProviderLineInput {
  provider: BillableProvider;
  model: string;
  operation: BillableOperation;
  quantity?: number;
  lineKey: string;
  label: string;
  sceneId?: string | null;
}

interface ExistingReservationRow {
  id: string;
  userId: string;
  quoteId: string;
  referenceId: string | null;
  operation: string;
  status: string;
}

async function assertImmediateIdempotencyUnused(opts: {
  userId: string;
  referenceId: string;
  operation: string;
  idempotencyKey: string;
}): Promise<void> {
  const rows = await db.$queryRaw<ExistingReservationRow[]>`
    SELECT "id", "userId", "quoteId", "referenceId", "operation", "status"
    FROM "CreditReservation"
    WHERE "idempotencyKey" = ${opts.idempotencyKey}
    LIMIT 1
  `;
  const existing = rows[0];
  if (!existing) return;
  if (
    existing.userId !== opts.userId ||
    existing.referenceId !== opts.referenceId ||
    existing.operation !== opts.operation
  ) {
    throw new BillingSafetyError(
      "BILLING_IDEMPOTENCY_CONFLICT",
      "This billing idempotency key belongs to a different provider operation.",
    );
  }
  // Once a reservation exists we cannot prove, from an HTTP retry alone,
  // whether the provider boundary was crossed before the previous request was
  // interrupted. Never create a fresh quote/reservation or resubmit silently.
  throw new BillingSafetyError(
    "BILLING_REPLAY_REQUIRES_RECONCILIATION",
    `This provider operation already has a ${existing.status} reservation and will not be submitted twice automatically.`,
  );
}

export async function reserveImmediateProviderOperations(opts: {
  userId: string;
  projectId?: string | null;
  referenceId: string;
  operation: string;
  lines: ImmediateProviderLineInput[];
  idempotencyKey: string;
}) {
  if (opts.lines.length === 0) throw new Error("At least one provider billing line is required");
  await assertImmediateIdempotencyUnused({
    userId: opts.userId,
    referenceId: opts.referenceId,
    operation: opts.operation,
    idempotencyKey: opts.idempotencyKey,
  });

  const policy = await getCommercialPricingPolicy();
  const lines: BillingQuoteLine[] = [];
  for (const input of opts.lines) {
    const charge = await quoteProviderCharge({
      provider: input.provider,
      model: input.model,
      operation: input.operation,
      quantity: input.quantity ?? 1,
      policy,
    });
    lines.push({
      ...charge,
      lineKey: input.lineKey,
      label: input.label,
      sceneId: input.sceneId ?? null,
    });
  }
  const quote = await createBillingQuote({
    userId: opts.userId,
    projectId: opts.projectId ?? null,
    operation: opts.operation,
    lines,
    policy,
  });
  const reserved = await reserveBillingQuote({
    quoteId: quote.id,
    userId: opts.userId,
    referenceId: opts.referenceId,
    idempotencyKey: opts.idempotencyKey,
  });
  return { quote, lines, ...reserved };
}

export async function reserveImmediateProviderOperation(opts: {
  userId: string;
  projectId?: string | null;
  referenceId: string;
  provider: BillableProvider;
  model: string;
  operation: BillableOperation;
  quantity?: number;
  lineKey: string;
  label: string;
  sceneId?: string | null;
  idempotencyKey: string;
}) {
  const bundled = await reserveImmediateProviderOperations({
    userId: opts.userId,
    projectId: opts.projectId ?? null,
    referenceId: opts.referenceId,
    operation: opts.operation,
    lines: [{
      provider: opts.provider,
      model: opts.model,
      operation: opts.operation,
      quantity: opts.quantity,
      lineKey: opts.lineKey,
      label: opts.label,
      sceneId: opts.sceneId ?? null,
    }],
    idempotencyKey: opts.idempotencyKey,
  });
  return { ...bundled, line: bundled.lines[0] };
}

export async function captureImmediateProviderOperation(opts: {
  reservationId: string;
  lineKey: string;
  userId: string;
  projectId?: string | null;
  sceneId?: string | null;
  providerTaskId?: string | null;
}) {
  return captureReservedQuoteLine({
    reservationId: opts.reservationId,
    lineKey: opts.lineKey,
    userId: opts.userId,
    projectId: opts.projectId ?? null,
    sceneId: opts.sceneId ?? null,
    providerTaskId: opts.providerTaskId ?? null,
  });
}

export async function captureImmediateProviderOperations(opts: {
  reservationId: string;
  lineKeys: string[];
  userId: string;
  projectId?: string | null;
  sceneId?: string | null;
}) {
  const captures: Awaited<ReturnType<typeof captureImmediateProviderOperation>>[] = [];
  for (const lineKey of opts.lineKeys) {
    captures.push(await captureImmediateProviderOperation({
      reservationId: opts.reservationId,
      lineKey,
      userId: opts.userId,
      projectId: opts.projectId ?? null,
      sceneId: opts.sceneId ?? null,
    }));
  }
  return captures;
}

export async function releaseImmediateProviderOperation(opts: {
  reservationId: string;
  userId: string;
  reason: string;
}) {
  return releaseReservationRemainder(opts);
}
