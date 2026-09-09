"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, DollarSign, Loader2, RefreshCw, Save, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface BillingState {
  success: boolean;
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
  providerPrices: Array<{
    provider: string;
    model: string;
    operation: string;
    billingUnit: string;
    unitPriceUsd: number;
    unitsPerPrice: number;
    sourceUrl: string;
    pricingVersion: string;
    verifiedAt: string;
  }>;
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

export default function AdminBillingPage() {
  const [state, setState] = useState<BillingState | null>(null);
  const [form, setForm] = useState<Record<string, string | boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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
        "creditValueUsd", "targetGrossMarginPct", "providerSafetyBufferPct", "fxSafetyBufferPct",
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
          <p className="text-sm text-muted-foreground">Verified provider COGS, customer-credit pricing, reserve coverage and gross-margin controls.</p>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh</Button>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}

      {state && (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Outstanding credits</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{state.summary.outstandingCredits.toLocaleString()}</div><div className="text-xs text-muted-foreground">${state.summary.outstandingFaceValueUsd.toFixed(2)} face value</div></CardContent></Card>
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Provider COGS captured</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">${state.summary.providerUsage.cogsUsd.toFixed(2)}</div><div className="text-xs text-muted-foreground">{state.summary.providerUsage.calls} billed calls</div></CardContent></Card>
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Gross profit captured</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">${state.summary.providerUsage.grossProfitUsd.toFixed(2)}</div><div className="text-xs text-muted-foreground">on ${state.summary.providerUsage.customerValueUsd.toFixed(2)} customer value</div></CardContent></Card>
            <Card className={state.summary.reserveStatus === "underfunded" ? "border-amber-300" : ""}><CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm">Provider reserve {state.summary.reserveStatus === "funded" ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <AlertTriangle className="h-4 w-4 text-amber-600" />}</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">${state.summary.providerReserveRequiredUsd.toFixed(2)}</div><div className="text-xs text-muted-foreground">required · recorded ${Number(state.summary.manualProviderReserveUsd ?? 0).toFixed(2)}</div></CardContent></Card>
          </div>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5" />Commercial pricing policy</CardTitle></CardHeader>
            <CardContent className="space-y-5">
              <div className="flex items-center justify-between rounded-xl border p-3"><div><div className="font-semibold">Paid generation enabled</div><div className="text-xs text-muted-foreground">Kill switch: disabling this blocks new provider-backed quotes.</div></div><Switch checked={Boolean(form.billingEnabled)} onCheckedChange={(value) => setForm((prev) => ({ ...prev, billingEnabled: value }))} /></div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                {numberField("creditValueUsd", "Credit value (USD)", "0.001")}
                {numberField("targetGrossMarginPct", "Target gross margin (0–1)", "0.01")}
                {numberField("providerSafetyBufferPct", "Provider price buffer (0–1)", "0.01")}
                {numberField("fxSafetyBufferPct", "FX reserve (0–1)", "0.01")}
                {numberField("gatewayFeeReservePct", "Gateway fee reserve (0–1)", "0.01")}
                {numberField("infrastructureReservePct", "Infrastructure reserve (0–1)", "0.01")}
                {numberField("priceMaxAgeHours", "Max provider-price age (hours)", "1")}
                {numberField("quoteTtlMinutes", "Quote validity (minutes)", "1")}
                {numberField("providerReserveBalanceUsd", "Recorded provider funding (USD)", "0.01")}
              </div>
              <Button onClick={() => void save()} disabled={saving}><Save className="mr-2 h-4 w-4" />{saving ? "Saving…" : "Save billing policy"}</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><DollarSign className="h-5 w-5" />Verified provider price catalog</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead><tr className="border-b text-left"><th className="py-2">Provider</th><th>Model</th><th>Operation</th><th>Billing unit</th><th className="text-right">Price</th><th>Verified</th><th>Version</th></tr></thead>
                <tbody>{state.providerPrices.map((price) => <tr key={`${price.provider}:${price.model}:${price.operation}`} className="border-b last:border-0"><td className="py-2 font-semibold uppercase">{price.provider}</td><td>{price.model}</td><td>{price.operation}</td><td>{price.billingUnit} / {price.unitsPerPrice}</td><td className="text-right font-mono">${price.unitPriceUsd.toFixed(6)}</td><td><a className="text-violet-700 underline" href={price.sourceUrl} target="_blank" rel="noreferrer">{new Date(price.verifiedAt).toLocaleDateString()}</a></td><td className="font-mono text-xs">{price.pricingVersion}</td></tr>)}</tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}
    </main>
  );
}
