"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, DollarSign, Loader2, RefreshCw, Save, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface ProviderPriceView {
  provider: string;
  model: string;
  operation: string;
  billingUnit: string;
  unitPriceUsd: number;
  unitsPerPrice: number;
  sourceUrl: string;
  pricingVersion: string;
  verifiedAt: string;
}

interface BillingState {
  success: boolean;
  creditDenominationLocked: boolean;
  lockedCreditValueUsd: number;
  policy: {
    creditValueUsd: number;
    targetGrossMarginPct: number;
    providerSafetyBufferPct: number;
    fxSafetyBufferPct: number;
    gatewayFeeReservePct: number;
    infrastructureReservePct: number;
    minimumChargeCredits: number;
    priceMaxAgeHours: number;
    quoteTtlMinutes: number;
    billingEnabled: boolean;
  };
  providerPrices: ProviderPriceView[];
  summary: {
    availableCredits: number;
    reservedCredits: number;
    outstandingCredits: number;
    outstandingFaceValueUsd: number;
    providerReserveRequiredUsd: number;
    manualProviderReserveUsd: number | null;
    reserveCoveragePct: number | null;
    reserveStatus: string;
    providerUsage: { calls: number; cogsUsd: number; customerValueUsd: number; grossProfitUsd: number };
    settledRevenue: { ghs: number; usd: number };
  };
}

function priceKey(price: ProviderPriceView): string {
  return `${price.provider}:${price.model}:${price.operation}`;
}

export default function AdminBillingPage() {
  const [state, setState] = useState<BillingState | null>(null);
  const [form, setForm] = useState<Record<string, string | boolean>>({});
  const [priceDrafts, setPriceDrafts] = useState<Record<string, { unitPriceUsd: string; unitsPerPrice: string }>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingPrice, setSavingPrice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/billing", { cache: "no-store" });
      const data = await res.json() as BillingState & { error?: string };
      if (!res.ok || !data.success) throw new Error(data.error || "Could not load billing state");
      setState(data);
      setForm({
        ...Object.fromEntries(Object.entries(data.policy).map(([key, value]) => [key, typeof value === "boolean" ? value : String(value)])),
        providerReserveBalanceUsd: data.summary.manualProviderReserveUsd === null ? "" : String(data.summary.manualProviderReserveUsd),
      });
      setPriceDrafts(Object.fromEntries(data.providerPrices.map((price) => [
        priceKey(price),
        { unitPriceUsd: String(price.unitPriceUsd), unitsPerPrice: String(price.unitsPerPrice) },
      ])));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load billing state");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    if (!state) return;
    setSaving(true);
    setError(null);
    try {
      const numericKeys = [
        "targetGrossMarginPct", "providerSafetyBufferPct", "fxSafetyBufferPct",
        "gatewayFeeReservePct", "infrastructureReservePct", "minimumChargeCredits", "priceMaxAgeHours", "quoteTtlMinutes",
      ];
      const payload: Record<string, unknown> = { billingEnabled: Boolean(form.billingEnabled) };
      for (const key of numericKeys) payload[key] = Number(form[key]);
      if (String(form.providerReserveBalanceUsd || "").trim()) payload.providerReserveBalanceUsd = Number(form.providerReserveBalanceUsd);
      const res = await fetch("/api/admin/billing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json() as { success?: boolean; error?: string };
      if (!res.ok || !data.success) throw new Error(data.error || "Could not save billing policy");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save billing policy");
    } finally {
      setSaving(false);
    }
  };

  const saveProviderPrice = async (price: ProviderPriceView) => {
    const key = priceKey(price);
    const draft = priceDrafts[key];
    if (!draft) return;
    setSavingPrice(key);
    setError(null);
    try {
      const res = await fetch("/api/admin/billing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerPrice: {
            provider: price.provider,
            model: price.model,
            operation: price.operation,
            billingUnit: price.billingUnit,
            unitPriceUsd: Number(draft.unitPriceUsd),
            unitsPerPrice: Number(draft.unitsPerPrice),
            sourceUrl: price.sourceUrl,
            pricingVersion: `${price.provider}-${new Date().toISOString().slice(0, 10)}`,
          },
        }),
      });
      const data = await res.json() as { success?: boolean; error?: string };
      if (!res.ok || !data.success) throw new Error(data.error || "Could not re-verify provider price");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not re-verify provider price");
    } finally {
      setSavingPrice(null);
    }
  };

  const numberField = (key: string, label: string, step = "0.01") => (
    <div className="space-y-1.5">
      <Label htmlFor={key}>{label}</Label>
      <Input id={key} type="number" step={step} value={String(form[key] ?? "")} onChange={(e) => setForm((prev) => ({ ...prev, [key]: e.target.value }))} />
    </div>
  );

  if (loading && !state) return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Provider Billing & Profit Protection</h1>
          <p className="text-sm text-muted-foreground">Verified provider COGS, customer-credit pricing, reserve coverage and margin controls.</p>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh</Button>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}

      {state && (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Outstanding credits</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{state.summary.outstandingCredits.toLocaleString()}</div><div className="text-xs text-muted-foreground">${state.summary.outstandingFaceValueUsd.toFixed(2)} face value</div></CardContent></Card>
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Provider COGS captured</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">${state.summary.providerUsage.cogsUsd.toFixed(2)}</div><div className="text-xs text-muted-foreground">{state.summary.providerUsage.calls} billed calls</div></CardContent></Card>
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Protected gross profit</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">${state.summary.providerUsage.grossProfitUsd.toFixed(2)}</div><div className="text-xs text-muted-foreground">after configured provider, FX, gateway and infrastructure reserves</div></CardContent></Card>
            <Card className={state.summary.reserveStatus === "underfunded" ? "border-amber-300" : ""}><CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm">Provider reserve {state.summary.reserveStatus === "funded" ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <AlertTriangle className="h-4 w-4 text-amber-600" />}</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">${state.summary.providerReserveRequiredUsd.toFixed(2)}</div><div className="text-xs text-muted-foreground">required · recorded ${Number(state.summary.manualProviderReserveUsd ?? 0).toFixed(2)}</div></CardContent></Card>
          </div>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5" />Commercial pricing policy</CardTitle></CardHeader>
            <CardContent className="space-y-5">
              <div className="flex items-center justify-between rounded-xl border p-3"><div><div className="font-semibold">Paid generation enabled</div><div className="text-xs text-muted-foreground">Kill switch: disabling this blocks new provider-backed quotes.</div></div><Switch checked={Boolean(form.billingEnabled)} onCheckedChange={(value) => setForm((prev) => ({ ...prev, billingEnabled: value }))} /></div>
              <div className="rounded-xl border bg-muted/30 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-semibold">Credit denomination</div>
                    <div className="text-xs text-muted-foreground">Locked in Billing v2 so credits already purchased cannot be silently revalued.</div>
                  </div>
                  <div className="font-mono text-lg font-bold">${state.lockedCreditValueUsd.toFixed(2)} / credit</div>
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                {numberField("targetGrossMarginPct", "Target gross margin (0–1)", "0.01")}
                {numberField("providerSafetyBufferPct", "Provider price buffer (0–1)", "0.01")}
                {numberField("fxSafetyBufferPct", "FX reserve (0–1)", "0.01")}
                {numberField("gatewayFeeReservePct", "Gateway fee reserve (0–1)", "0.01")}
                {numberField("infrastructureReservePct", "Infrastructure reserve (0–1)", "0.01")}
                {numberField("minimumChargeCredits", "Minimum charge (credits)", "1")}
                {numberField("priceMaxAgeHours", "Max provider-price age (hours)", "1")}
                {numberField("quoteTtlMinutes", "Quote validity (minutes)", "1")}
                {numberField("providerReserveBalanceUsd", "Recorded provider funding (USD)", "0.01")}
              </div>
              <Button onClick={() => void save()} disabled={saving}><Save className="mr-2 h-4 w-4" />{saving ? "Saving…" : "Save billing policy"}</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><DollarSign className="h-5 w-5" />Verified provider price catalog</CardTitle>
              <p className="text-sm text-muted-foreground">Open the official source, confirm the current price, enter it below, then re-verify. Stale or unknown prices fail closed before paid generation.</p>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full min-w-[1050px] text-sm">
                <thead><tr className="border-b text-left"><th className="py-2">Provider</th><th>Model</th><th>Operation</th><th>Billing unit</th><th>USD price</th><th>Units / price</th><th>Verified</th><th>Version</th><th className="text-right">Action</th></tr></thead>
                <tbody>{state.providerPrices.map((price) => {
                  const key = priceKey(price);
                  const draft = priceDrafts[key] || { unitPriceUsd: String(price.unitPriceUsd), unitsPerPrice: String(price.unitsPerPrice) };
                  const ageHours = (Date.now() - new Date(price.verifiedAt).getTime()) / 3_600_000;
                  const nearStale = ageHours > state.policy.priceMaxAgeHours * 0.8;
                  return <tr key={key} className="border-b last:border-0 align-top">
                    <td className="py-3 font-semibold uppercase">{price.provider}</td>
                    <td className="py-3 font-mono text-xs">{price.model}</td>
                    <td className="py-3">{price.operation}</td>
                    <td className="py-3">{price.billingUnit}</td>
                    <td className="py-2"><Input className="w-32 font-mono" type="number" min="0" step="0.000001" value={draft.unitPriceUsd} onChange={(e) => setPriceDrafts((prev) => ({ ...prev, [key]: { ...draft, unitPriceUsd: e.target.value } }))} /></td>
                    <td className="py-2"><Input className="w-28 font-mono" type="number" min="0.000001" step="0.000001" value={draft.unitsPerPrice} onChange={(e) => setPriceDrafts((prev) => ({ ...prev, [key]: { ...draft, unitsPerPrice: e.target.value } }))} /></td>
                    <td className="py-3"><a className={nearStale ? "font-semibold text-amber-700 underline" : "text-violet-700 underline"} href={price.sourceUrl} target="_blank" rel="noreferrer">{new Date(price.verifiedAt).toLocaleDateString()}</a>{nearStale && <div className="text-[11px] text-amber-700">Re-verification due soon</div>}</td>
                    <td className="py-3 font-mono text-xs">{price.pricingVersion}</td>
                    <td className="py-2 text-right"><Button size="sm" variant="outline" disabled={savingPrice === key} onClick={() => void saveProviderPrice(price)}>{savingPrice === key ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}Re-verify</Button></td>
                  </tr>;
                })}</tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}
    </main>
  );
}
