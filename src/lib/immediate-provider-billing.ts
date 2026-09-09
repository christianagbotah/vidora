import { getCommercialPricingPolicy, quoteProviderCharge, type BillableOperation, type BillableProvider } from "@/lib/provider-cost-billing";
import {
  captureReservedQuoteLine,
  createBillingQuote,
  releaseReservationRemainder,
  reserveBillingQuote,
  type BillingQuoteLine,
} from "@/lib/credit-reservations";

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
  const policy = await getCommercialPricingPolicy();
  const charge = await quoteProviderCharge({
    provider: opts.provider,
    model: opts.model,
    operation: opts.operation,
    quantity: opts.quantity ?? 1,
    policy,
  });
  const line: BillingQuoteLine = {
    ...charge,
    lineKey: opts.lineKey,
    label: opts.label,
    sceneId: opts.sceneId ?? null,
  };
  const quote = await createBillingQuote({
    userId: opts.userId,
    projectId: opts.projectId ?? null,
    operation: opts.operation,
    lines: [line],
    policy,
  });
  const reserved = await reserveBillingQuote({
    quoteId: quote.id,
    userId: opts.userId,
    referenceId: opts.referenceId,
    idempotencyKey: opts.idempotencyKey,
  });
  return { quote, line, ...reserved };
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

export async function releaseImmediateProviderOperation(opts: {
  reservationId: string;
  userId: string;
  reason: string;
}) {
  return releaseReservationRemainder(opts);
}
