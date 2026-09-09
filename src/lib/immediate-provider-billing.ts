import {
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

export async function reserveImmediateProviderOperations(opts: {
  userId: string;
  projectId?: string | null;
  referenceId: string;
  operation: string;
  lines: ImmediateProviderLineInput[];
  idempotencyKey: string;
}) {
  if (opts.lines.length === 0) throw new Error("At least one provider billing line is required");
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
  const captures = [];
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
