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
import { Loader2, Save, Coins, TrendingDown, AlertCircle, Sparkle, RefreshCw, ArrowRightLeft } from "lucide-react";

interface AdminTokenPackage {
  id: string;
  slug: string;
  name: string;
  tokens: number;
  priceGHS: number;
  priceUSD: number;
  bonusPct: number;
  popular: boolean;
  isActive: boolean;
  sortOrder: number;
  features: string[];
  effectiveTokens: number;
  effectiveTokenPriceGHS: number;
  effectiveTokenPriceUSD: number;
}

interface PackageEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pkg: AdminTokenPackage | null;
  onSave: (pkg: Partial<AdminTokenPackage> & { id?: string }) => void;
  saving: boolean;
}

interface ExchangeRateData {
  ghsPerUsd: number;
  usdPerGhs: number;
  source: string;
}

export function PackageEditDialog({ open, onOpenChange, pkg, onSave, saving }: PackageEditDialogProps) {
  const isEdit = !!pkg?.id;

  const [form, setForm] = useState({
    slug: "",
    name: "",
    tokens: 10,
    priceGHS: 5,
    priceUSD: 1,
    bonusPct: 0,
    popular: false,
    isActive: true,
    sortOrder: 0,
    featuresText: "",
  });

  // Exchange rate state
  const [exchangeRate, setExchangeRate] = useState<ExchangeRateData | null>(null);
  const [rateLoading, setRateLoading] = useState(false);
  const [lastEditedField, setLastEditedField] = useState<"ghs" | "usd" | null>(null);

  // Fetch live exchange rate when dialog opens
  const fetchExchangeRate = useCallback(async () => {
    setRateLoading(true);
    try {
      const res = await fetch("/api/admin/exchange-rate");
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.data) {
          setExchangeRate(data.data);
        }
      }
    } catch (err) {
      console.error("Failed to fetch exchange rate:", err);
    } finally {
      setRateLoading(false);
    }
  }, []);

  // Auto-fetch rate when dialog opens
  useEffect(() => {
    if (open) {
      fetchExchangeRate();
    }
  }, [open, fetchExchangeRate]);

  // Sync form when dialog opens or pkg changes
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      setForm({
        slug: pkg?.slug || "",
        name: pkg?.name || "",
        tokens: pkg?.tokens ?? 10,
        priceGHS: pkg?.priceGHS ?? 5,
        priceUSD: pkg?.priceUSD ?? 1,
        bonusPct: pkg?.bonusPct ?? 0,
        popular: pkg?.popular ?? false,
        isActive: pkg?.isActive ?? true,
        sortOrder: pkg?.sortOrder ?? 0,
        featuresText: (pkg?.features || []).join("\n"),
      });
      setLastEditedField(null); // Reset on open
    }, 0);
    return () => clearTimeout(t);
  }, [open, pkg]);

  // Auto-convert: when GHS changes, update USD
  const handleGhsChange = (ghsValue: number) => {
    setLastEditedField("ghs");
    setForm((f) => {
      const usdValue = exchangeRate && ghsValue > 0
        ? Math.round((ghsValue * exchangeRate.usdPerGhs) * 100) / 100
        : f.priceUSD;
      return { ...f, priceGHS: ghsValue, priceUSD: usdValue };
    });
  };

  // Auto-convert: when USD changes, update GHS
  const handleUsdChange = (usdValue: number) => {
    setLastEditedField("usd");
    setForm((f) => {
      const ghsValue = exchangeRate && usdValue > 0
        ? Math.round((usdValue * exchangeRate.ghsPerUsd) * 100) / 100
        : f.priceGHS;
      return { ...f, priceUSD: usdValue, priceGHS: ghsValue };
    });
  };

  // Derived: live economics preview
  const effectiveTokens =
    Number(form.tokens) + Math.round((Number(form.tokens) * Number(form.bonusPct)) / 100);
  const perTokenGHS = effectiveTokens > 0 ? Number(form.priceGHS) / effectiveTokens : 0;
  const perTokenUSD = effectiveTokens > 0 ? Number(form.priceUSD) / effectiveTokens : 0;

  // A 6-scene 45–60s video costs ≈ 44 tokens (6 clips × 6 + 6 thumbs + narration)
  // on the default CogVideoX-3 engine — show how many videos this pkg makes
  const videosPerPackage = Math.floor(effectiveTokens / 44);
  const revenuePerVideoGHS = videosPerPackage > 0 ? Number(form.priceGHS) / videosPerPackage : 0;

  const handleSave = () => {
    const features = form.featuresText
      .split("\n")
      .map((f) => f.trim())
      .filter((f) => f.length > 0);

    onSave({
      id: pkg?.id,
      slug: form.slug,
      name: form.name,
      tokens: Number(form.tokens),
      priceGHS: Number(form.priceGHS),
      priceUSD: Number(form.priceUSD),
      bonusPct: Number(form.bonusPct),
      popular: form.popular,
      isActive: form.isActive,
      sortOrder: Number(form.sortOrder),
      features,
    });
  };

  const isValid =
    form.name.trim().length > 0 &&
    (!isEdit || true) &&
    (isEdit || form.slug.trim().length > 0) &&
    Number(form.tokens) > 0 &&
    Number(form.priceGHS) >= 0 &&
    Number(form.priceUSD) >= 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Coins className="h-5 w-5 text-amber-500" />
            {isEdit ? `Edit ${pkg?.name}` : "Create Token Package"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Adjust the price, token quantity, or bonus. Changes go live instantly."
              : "Define a new token package for customers to purchase."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Name + Slug */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Display Name *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Basic, Pro, Business"
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
                placeholder="e.g. basic, pro, business"
                disabled={isEdit}
                className="h-9 font-mono"
              />
              <p className="text-xs text-muted-foreground">
                {isEdit
                  ? "Slug is locked after creation to preserve existing checkout references."
                  : "Lowercase, no spaces. Used in URLs and payment references."}
              </p>
            </div>
          </div>

          {/* Tokens + Bonus */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Base Tokens *</Label>
              <Input
                type="number"
                min={1}
                value={form.tokens}
                onChange={(e) => setForm((f) => ({ ...f, tokens: Number(e.target.value) }))}
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Bonus %</Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={form.bonusPct}
                onChange={(e) => setForm((f) => ({ ...f, bonusPct: Number(e.target.value) }))}
                className="h-9"
              />
            </div>

            {/* GHS Price with auto-convert indicator */}
            <div className="space-y-1.5">
              <Label className="text-sm font-medium flex items-center gap-1">
                Price (GHS) *
                {lastEditedField === "ghs" && (
                  <ArrowRightLeft className="h-3 w-3 text-emerald-500" />
                )}
              </Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={form.priceGHS}
                onChange={(e) => handleGhsChange(Number(e.target.value))}
                className="h-9"
              />
              <p className="text-xs text-muted-foreground">
                Auto-converts to USD at live rate
              </p>
            </div>

            {/* USD Price with auto-convert indicator */}
            <div className="space-y-1.5">
              <Label className="text-sm font-medium flex items-center gap-1">
                Price (USD) *
                {lastEditedField === "usd" && (
                  <ArrowRightLeft className="h-3 w-3 text-emerald-500" />
                )}
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
                Auto-converts to GHS at live rate
              </p>
            </div>
          </div>

          {/* Live Exchange Rate Banner */}
          <div className="flex items-center justify-between rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2">
            <div className="flex items-center gap-2">
              <ArrowRightLeft className="h-3.5 w-3.5 text-emerald-600" />
              <span className="text-xs font-medium text-emerald-700">
                Live Exchange Rate
              </span>
              {exchangeRate && (
                <span className="text-xs text-emerald-600">
                  (1 USD = {exchangeRate.ghsPerUsd} GHS · 1 GHS = ${exchangeRate.usdPerGhs})
                </span>
              )}
              {exchangeRate?.source && (
                <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${
                  exchangeRate.source === "live" ? "bg-emerald-100 text-emerald-700 border-emerald-300" :
                  exchangeRate.source === "cache" ? "bg-blue-50 text-blue-600 border-blue-200" :
                  "bg-amber-50 text-amber-600 border-amber-200"
                }`}>
                  {exchangeRate.source === "live" ? "Live" : exchangeRate.source === "cache" ? "Cached" : "Fallback"}
                </Badge>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs text-emerald-600 hover:text-emerald-700 hover:bg-emerald-100"
              onClick={fetchExchangeRate}
              disabled={rateLoading}
            >
              {rateLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              Refresh
            </Button>
          </div>

          {/* Live economics preview */}
          <div className="rounded-lg bg-gradient-to-br from-violet-50 to-amber-50 border border-violet-100 p-4">
            <div className="flex items-center gap-1.5 mb-2">
              <Sparkle className="h-3.5 w-3.5 text-amber-500" />
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wide">Live Economics Preview</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Effective tokens</p>
                <p className="font-bold text-violet-600 text-lg">{effectiveTokens}</p>
                {Number(form.bonusPct) > 0 && (
                  <p className="text-xs text-emerald-600">+{Math.round((Number(form.tokens) * Number(form.bonusPct)) / 100)} bonus</p>
                )}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Per-token (GHS)</p>
                <p className="font-bold text-slate-800">₵{perTokenGHS.toFixed(3)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Per-token (USD)</p>
                <p className="font-bold text-slate-800">${perTokenUSD.toFixed(4)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">~1-min videos</p>
                <p className="font-bold text-slate-800">{videosPerPackage}</p>
                <p className="text-xs text-muted-foreground">₵{revenuePerVideoGHS.toFixed(2)}/video</p>
              </div>
            </div>
            {perTokenGHS > 0.5 && (
              <div className="mt-2 flex items-start gap-1.5 text-xs text-amber-700">
                <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>Per-token price is above ₵0.50 — this is more expensive than the Starter baseline. Larger packages usually have a lower per-token price to reward volume purchases.</span>
              </div>
            )}
          </div>

          {/* Features list */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Features (one per line)</Label>
            <Textarea
              value={form.featuresText}
              onChange={(e) => setForm((f) => ({ ...f, featuresText: e.target.value }))}
              placeholder={"30 AI credits (+6 bonus)\nHD video quality\nPriority support\nAI Director Mode"}
              rows={5}
              className="text-sm"
            />
            <p className="text-xs text-muted-foreground">
              These appear as bullet points on the Buy Tokens page. Empty lines are ignored.
            </p>
          </div>

          {/* Toggles */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label className="text-sm font-medium">Popular</Label>
                <p className="text-xs text-muted-foreground">Highlight on storefront</p>
              </div>
              <Switch
                checked={form.popular}
                onCheckedChange={(v) => setForm((f) => ({ ...f, popular: v }))}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label className="text-sm font-medium">Active</Label>
                <p className="text-xs text-muted-foreground">Visible to customers</p>
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
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!isValid || saving} className="btn-gradient">
            {saving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
            {isEdit ? "Save Changes" : "Create Package"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
