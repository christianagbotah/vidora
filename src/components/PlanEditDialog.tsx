"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, Save, LayoutGrid, AlertCircle, Sparkle, RefreshCw, ArrowRightLeft, Check } from "lucide-react";

/**
 * PlanEditDialog — create/edit a homepage pricing plan card.
 *
 * Everything the admin can control on the public homepage pricing section:
 * name, badge, price (GHS + USD with live-rate auto-convert), billing
 * period, feature bullets, CTA label + action, highlight, active, order.
 * Includes a live preview of how the card will look on the homepage.
 */

interface StorefrontPlanInput {
  id: string;
  slug: string;
  name: string;
  badge: string | null;
  priceGHS: number;
  priceUSD: number;
  period: string;
  features: string[];
  ctaLabel: string;
  ctaAction: string;
  highlight: boolean;
  isActive: boolean;
  sortOrder: number;
}

interface PlanEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: StorefrontPlanInput | null;
  onSave: (plan: Partial<StorefrontPlanInput> & { id?: string }) => void;
  saving: boolean;
}

interface ExchangeRateData {
  ghsPerUsd: number;
  usdPerGhs: number;
  source: string;
}

const PERIODS = [
  { value: "forever", label: "Forever (one-off, e.g. free)" },
  { value: "month", label: "Per month" },
  { value: "one-time", label: "One-time purchase" },
];

const CTA_ACTIONS = [
  { value: "create", label: "Start Creating — opens the video wizard" },
  { value: "buy-tokens", label: "Buy Tokens — opens token checkout" },
  { value: "contact", label: "Contact Us — opens the contact form" },
];

function badgePreviewStyle(badge: string | null): string {
  const b = (badge || "").toUpperCase();
  if (b.includes("FREE")) return "bg-gradient-to-r from-emerald-400 to-teal-500";
  if (b.includes("POPULAR")) return "bg-gradient-to-r from-violet-500 to-fuchsia-500";
  if (b.includes("BEST") || b.includes("VALUE")) return "bg-gradient-to-r from-amber-400 to-orange-500";
  return "bg-gradient-to-r from-slate-500 to-slate-600";
}

export function PlanEditDialog({ open, onOpenChange, plan, onSave, saving }: PlanEditDialogProps) {
  const isEdit = !!plan?.id;

  const [form, setForm] = useState({
    slug: "",
    name: "",
    badge: "",
    priceGHS: 0,
    priceUSD: 0,
    period: "month",
    featuresText: "",
    ctaLabel: "Get Started",
    ctaAction: "create",
    highlight: false,
    isActive: true,
    sortOrder: 0,
  });

  // Exchange rate (for GHS ⇄ USD auto-convert parity with the engine table)
  const [exchangeRate, setExchangeRate] = useState<ExchangeRateData | null>(null);
  const [rateLoading, setRateLoading] = useState(false);

  const fetchExchangeRate = useCallback(async () => {
    setRateLoading(true);
    try {
      const res = await fetch("/api/admin/exchange-rate");
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.data) setExchangeRate(data.data);
      }
    } catch {
      /* ignore */
    } finally {
      setRateLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) fetchExchangeRate();
  }, [open, fetchExchangeRate]);

  // Sync form when the dialog opens
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      setForm({
        slug: plan?.slug || "",
        name: plan?.name || "",
        badge: plan?.badge || "",
        priceGHS: plan?.priceGHS ?? 0,
        priceUSD: plan?.priceUSD ?? 0,
        period: plan?.period || "month",
        featuresText: (plan?.features || []).join("\n"),
        ctaLabel: plan?.ctaLabel || "Get Started",
        ctaAction: plan?.ctaAction || "create",
        highlight: plan?.highlight ?? false,
        isActive: plan?.isActive ?? true,
        sortOrder: plan?.sortOrder ?? 0,
      });
    }, 0);
    return () => clearTimeout(t);
  }, [open, plan]);

  const handleGhsChange = (ghsValue: number) => {
    setForm((f) => ({
      ...f,
      priceGHS: ghsValue,
      priceUSD: exchangeRate?.usdPerGhs && ghsValue > 0
        ? Math.round(ghsValue * exchangeRate.usdPerGhs * 100) / 100
        : f.priceUSD,
    }));
  };

  const handleUsdChange = (usdValue: number) => {
    setForm((f) => ({
      ...f,
      priceUSD: usdValue,
      priceGHS: exchangeRate?.ghsPerUsd && usdValue > 0
        ? Math.round(usdValue * exchangeRate.ghsPerUsd * 100) / 100
        : f.priceGHS,
    }));
  };

  const handleSave = () => {
    const features = form.featuresText
      .split("\n")
      .map((f) => f.trim())
      .filter((f) => f.length > 0);

    onSave({
      id: plan?.id,
      slug: form.slug,
      name: form.name,
      badge: form.badge.trim() || null,
      priceGHS: Number(form.priceGHS) || 0,
      priceUSD: Number(form.priceUSD) || 0,
      period: form.period,
      features,
      ctaLabel: form.ctaLabel.trim() || "Get Started",
      ctaAction: form.ctaAction,
      highlight: form.highlight,
      isActive: form.isActive,
      sortOrder: Number(form.sortOrder) || 0,
    });
  };

  const isValid =
    form.name.trim().length > 0 &&
    (isEdit || form.slug.trim().length > 0) &&
    Number(form.priceGHS) >= 0 &&
    Number(form.priceUSD) >= 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LayoutGrid className="h-5 w-5 text-violet-500" />
            {isEdit ? `Edit ${plan?.name}` : "Create Homepage Plan"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Adjust the price, features, or call-to-action. Changes go live on the homepage instantly."
              : "Define a new pricing card for the homepage."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* ── Live card preview ── */}
          <div className="rounded-xl border-2 border-dashed border-violet-200 bg-violet-50/30 p-4">
            <p className="text-[10px] font-bold uppercase tracking-wide text-violet-400 mb-2.5 flex items-center gap-1">
              <Sparkle className="h-3 w-3" />Live preview — homepage card
            </p>
            <div
              className={`bg-white rounded-xl p-4 shadow-sm relative ${
                form.highlight ? "ring-2 ring-violet-400" : "border border-slate-100"
              }`}
            >
              {form.highlight && form.badge && (
                <div className="absolute -top-2.5 left-4 z-10">
                  <Badge className={`${badgePreviewStyle(form.badge)} text-white text-[10px] px-2 shadow`}>
                    {form.badge}
                  </Badge>
                </div>
              )}
              <div className="flex items-center justify-between gap-2">
                {form.badge && !form.highlight ? (
                  <Badge className={`${badgePreviewStyle(form.badge)} text-white border-0 text-[10px] font-bold px-2 shadow`}>
                    {form.badge}
                  </Badge>
                ) : <span className="text-[8px]" />}
                <span className="text-xs text-muted-foreground">{form.name || "Plan name"}</span>
              </div>
              <p className="text-xl font-extrabold mt-1.5">
                GH₵{Number(form.priceGHS) || 0}
                <span className="text-xs font-normal text-muted-foreground">
                  {form.period === "forever" ? "/forever" : form.period === "one-time" ? "/one-time" : "/month"}
                </span>
                <span className="ml-2 text-xs font-semibold text-violet-600">${Number(form.priceUSD) || 0}</span>
              </p>
              <div className="mt-2 space-y-1">
                {form.featuresText.split("\n").filter((f) => f.trim()).slice(0, 3).map((f, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-[11px]">
                    <Check className={`h-3 w-3 shrink-0 ${form.highlight ? "text-violet-500" : "text-emerald-500"}`} />
                    <span>{f.trim()}</span>
                  </div>
                ))}
                {form.featuresText.split("\n").filter((f) => f.trim()).length > 3 && (
                  <p className="text-[10px] text-muted-foreground pl-4">
                    +{form.featuresText.split("\n").filter((f) => f.trim()).length - 3} more…
                  </p>
                )}
              </div>
              <Button
                size="sm"
                className={`w-full mt-3 h-7 text-xs ${form.highlight ? "btn-gradient" : ""}`}
                variant={form.highlight ? "default" : "outline"}
                disabled
              >
                {form.ctaLabel || "Get Started"}
              </Button>
            </div>
          </div>

          {/* Name + Slug */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Display Name *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Starter, Pro, Studio"
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">
                Slug {isEdit && <span className="text-xs text-muted-foreground">(locked)</span>}
              </Label>
              <Input
                value={form.slug}
                onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
                placeholder="e.g. starter, pro, studio"
                disabled={isEdit}
                className="h-9 font-mono"
              />
              <p className="text-xs text-muted-foreground">
                {isEdit ? "Locked after creation." : "Lowercase, no spaces — stable internal reference."}
              </p>
            </div>
          </div>

          {/* Badge + Period */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Badge</Label>
              <Input
                value={form.badge}
                onChange={(e) => setForm((f) => ({ ...f, badge: e.target.value }))}
                placeholder="FREE · POPULAR · BEST VALUE (or custom)"
                className="h-9"
              />
              <p className="text-xs text-muted-foreground">Color is derived from the text (FREE=green, POPULAR=purple, BEST VALUE=amber).</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Billing Period</Label>
              <Select value={form.period} onValueChange={(v) => setForm((f) => ({ ...f, period: v }))}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PERIODS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Prices with auto-convert */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium flex items-center gap-1">
                Price (GHS) * <ArrowRightLeft className="h-3 w-3 text-emerald-500" />
              </Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={form.priceGHS}
                onChange={(e) => handleGhsChange(Number(e.target.value))}
                className="h-9"
              />
              <p className="text-xs text-muted-foreground">Auto-converts to USD</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium flex items-center gap-1">
                Price (USD) * <ArrowRightLeft className="h-3 w-3 text-emerald-500" />
              </Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={form.priceUSD}
                onChange={(e) => handleUsdChange(Number(e.target.value))}
                className="h-9"
              />
              <p className="text-xs text-muted-foreground">
                {exchangeRate ? `1 USD = ${exchangeRate.ghsPerUsd} GHS` : "Auto-converts to GHS"}
                <button onClick={fetchExchangeRate} disabled={rateLoading} className="ml-1.5 text-violet-500 hover:text-violet-600 inline-flex items-center">
                  {rateLoading ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <RefreshCw className="h-2.5 w-2.5" />}
                </button>
              </p>
            </div>
          </div>

          {/* Features */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Features (one per line)</Label>
            <Textarea
              value={form.featuresText}
              onChange={(e) => setForm((f) => ({ ...f, featuresText: e.target.value }))}
              placeholder={"2,000 Tokens\nUnlimited projects\n1080p export"}
              rows={5}
              className="text-sm"
            />
            <p className="text-xs text-muted-foreground">Shown as bullet points on the card. Empty lines are ignored.</p>
          </div>

          {/* CTA */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Button Label</Label>
              <Input
                value={form.ctaLabel}
                onChange={(e) => setForm((f) => ({ ...f, ctaLabel: e.target.value }))}
                placeholder="Get Started / Buy Tokens / Contact Us"
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Button Action</Label>
              <Select value={form.ctaAction} onValueChange={(v) => setForm((f) => ({ ...f, ctaAction: v }))}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CTA_ACTIONS.map((a) => (
                    <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Toggles + order */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label className="text-sm font-medium">Highlight</Label>
                <p className="text-xs text-muted-foreground">Purple border + ribbon</p>
              </div>
              <Switch
                checked={form.highlight}
                onCheckedChange={(v) => setForm((f) => ({ ...f, highlight: v }))}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label className="text-sm font-medium">Active</Label>
                <p className="text-xs text-muted-foreground">Visible on homepage</p>
              </div>
              <Switch
                checked={form.isActive}
                onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Sort Order</Label>
              <Input
                type="number"
                min={0}
                value={form.sortOrder}
                onChange={(e) => setForm((f) => ({ ...f, sortOrder: Number(e.target.value) }))}
                className="h-9"
              />
              <p className="text-xs text-muted-foreground">Lower = shown first</p>
            </div>
          </div>

          {form.priceGHS === 0 && form.priceUSD === 0 && !form.badge.toLowerCase().includes("free") && (
            <div className="flex items-start gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>Price is zero and the badge doesn&apos;t say &quot;FREE&quot; — users may think this is an error. Free plans usually use the FREE badge.</span>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!isValid || saving} className="btn-gradient">
            {saving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
            {isEdit ? "Save Changes" : "Create Plan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
