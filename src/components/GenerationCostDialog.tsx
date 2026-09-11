"use client";

import { AlertTriangle, Coins, CreditCard, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface GenerationQuoteView {
  quoteId: string;
  projectId: string;
  sceneCount: number;
  creditsRequired: number;
  customerValueUsd: number;
  customerValueGhs?: number | null;
  ghsPerUsd?: number | null;
  pricingVersion: string;
  expiresAt: string;
  breakdown: Array<{
    lineKey: string;
    label: string;
    credits: number;
    customerValueGhs?: number | null;
  }>;
  wallet: {
    availableCredits: number;
    reservedCredits: number;
    lifetimePurchasedCredits: number;
  };
  hasEnoughCredits: boolean;
  shortfallCredits: number;
}

interface GenerationCostDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quote: GenerationQuoteView | null;
  loading: boolean;
  starting: boolean;
  toppingUp: boolean;
  onRefresh: () => void | Promise<void>;
  onConfirm: () => void | Promise<void>;
  onTopUp: () => void | Promise<void>;
}

function formatGhs(value: number): string {
  return `GH₵${value.toFixed(2)}`;
}

export function GenerationCostDialog({
  open,
  onOpenChange,
  quote,
  loading,
  starting,
  toppingUp,
  onRefresh,
  onConfirm,
  onTopUp,
}: GenerationCostDialogProps) {
  const expired = quote ? new Date(quote.expiresAt).getTime() <= Date.now() : false;
  const busy = loading || starting || toppingUp;

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-w-lg sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
              <Coins className="h-4 w-4" />
            </span>
            Review generation cost
          </DialogTitle>
          <DialogDescription>
            Vidora locks this price before any paid AI provider work starts. Only completed provider work consumes the reserved credits.
          </DialogDescription>
        </DialogHeader>

        {loading || !quote ? (
          <div className="flex min-h-44 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Calculating current provider-backed price…
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-xl border bg-slate-50 p-3">
                <div className="text-xs text-muted-foreground">This generation</div>
                <div className="mt-1 text-2xl font-bold">{quote.creditsRequired} credits</div>
                {typeof quote.customerValueGhs === "number" ? (
                  <div className="text-xs text-muted-foreground">
                    ≈ {formatGhs(quote.customerValueGhs)} customer value
                  </div>
                ) : null}
                <div className="text-xs text-muted-foreground">
                  ≈ ${quote.customerValueUsd.toFixed(2)} USD
                  {typeof quote.ghsPerUsd === "number" ? ` at GH₵${quote.ghsPerUsd.toFixed(3)}/USD` : ""}
                </div>
              </div>
              <div className="rounded-xl border bg-slate-50 p-3">
                <div className="text-xs text-muted-foreground">Available balance</div>
                <div className="mt-1 text-2xl font-bold">{quote.wallet.availableCredits}</div>
                <div className="text-xs text-muted-foreground">{quote.wallet.reservedCredits} already reserved</div>
              </div>
            </div>

            <div className="max-h-48 space-y-1 overflow-x-hidden overflow-y-auto rounded-xl border p-3 pr-4">
              {quote.breakdown.map((line) => (
                <div key={line.lineKey} className="flex w-full items-start gap-3 py-1 text-sm">
                  <span className="min-w-0 flex-1 break-words pr-2 text-slate-700">{line.label}</span>
                  <span className="shrink-0 pr-1 text-right">
                    <span className="block font-semibold whitespace-nowrap">{line.credits} cr</span>
                    {typeof line.customerValueGhs === "number" ? (
                      <span className="block whitespace-nowrap text-[11px] font-normal text-muted-foreground">
                        ≈ {formatGhs(line.customerValueGhs)}
                      </span>
                    ) : null}
                  </span>
                </div>
              ))}
            </div>

            {!quote.hasEnoughCredits && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <div className="flex items-center gap-2 font-semibold">
                  <AlertTriangle className="h-4 w-4" /> {quote.shortfallCredits} more credits required
                </div>
                <p className="mt-1 text-xs text-amber-800">
                  You can fund exactly the shortfall through Hubtel. After payment, refresh the quote before generating.
                </p>
              </div>
            )}

            {expired && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                This price quote expired. Refresh it before proceeding.
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => void onRefresh()} disabled={busy}>
            <RefreshCw className={`mr-1.5 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh price
          </Button>
          {quote && !quote.hasEnoughCredits ? (
            <Button type="button" onClick={() => void onTopUp()} disabled={busy || expired} className="btn-gradient">
              {toppingUp ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CreditCard className="mr-1.5 h-4 w-4" />}
              Top up {quote.shortfallCredits} credits
            </Button>
          ) : (
            <Button type="button" onClick={() => void onConfirm()} disabled={busy || !quote || expired || !quote.hasEnoughCredits} className="btn-gradient">
              {starting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1.5 h-4 w-4" />}
              Confirm & generate
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
