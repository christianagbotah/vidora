"use client";

import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import {
  Palette, Upload, Loader2, Check, Image as ImageIcon, Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

interface BrandKit {
  id: string;
  brandName: string;
  logoUrl: string | null;
  logoPosition: string;
  logoOpacity: number;
  logoScale: number;
  primaryColor: string | null;
  tagline: string | null;
  website: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const POSITIONS = [
  { value: "top-left", label: "Top Left" },
  { value: "top-right", label: "Top Right" },
  { value: "bottom-left", label: "Bottom Left" },
  { value: "bottom-right", label: "Bottom Right" },
];

const PRESET_COLORS = [
  "#7c3aed", "#ec4899", "#f59e0b", "#10b981",
  "#ef4444", "#3b82f6", "#0f172a", "#ffffff",
];

export function BrandKitDialog({ open, onOpenChange }: Props) {
  const [kit, setKit] = useState<BrandKit | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [brandName, setBrandName] = useState("");
  const [tagline, setTagline] = useState("");
  const [website, setWebsite] = useState("");
  const [primaryColor, setPrimaryColor] = useState("#7c3aed");
  const [logoPosition, setLogoPosition] = useState("bottom-right");
  const [logoOpacity, setLogoOpacity] = useState(80);
  const [logoScale, setLogoScale] = useState(25);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch("/api/brand-kit")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.success && data.brandKit) {
          const k = data.brandKit as BrandKit;
          setKit(k);
          setBrandName(k.brandName || "");
          setTagline(k.tagline || "");
          setWebsite(k.website || "");
          setPrimaryColor(k.primaryColor || "#7c3aed");
          setLogoPosition(k.logoPosition || "bottom-right");
          setLogoOpacity(k.logoOpacity ?? 80);
          setLogoScale(k.logoScale ?? 25);
          setLogoUrl(k.logoUrl || null);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open]);

  const handleUpload = async (file: File) => {
    const fd = new FormData();
    fd.append("logo", file);
    setSaving(true);
    try {
      const res = await fetch("/api/brand-kit", { method: "POST", body: fd });
      const data = await res.json();
      if (data.success) {
        setLogoUrl(data.brandKit.logoUrl);
        toast({ title: "Logo uploaded", description: "Your brand logo is now set." });
      } else {
        toast({ title: "Upload failed", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Upload failed", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/brand-kit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandName, tagline, website, primaryColor,
          logoPosition, logoOpacity, logoScale,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setKit(data.brandKit);
        toast({ title: "Brand kit saved", description: "Your branding will be applied to exported videos." });
        onOpenChange(false);
      } else {
        toast({ title: "Save failed", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Save failed", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Palette className="h-5 w-5 text-violet-600" />
            Brand Kit
          </DialogTitle>
          <DialogDescription>
            Upload your logo and set brand colors. These are applied as a watermark when you export videos.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-violet-500" />
          </div>
        ) : (
          <div className="space-y-5">
            {/* Logo upload */}
            <div className="space-y-2">
              <Label>Brand Logo</Label>
              <div className="flex items-center gap-4">
                <div className="h-20 w-20 rounded-xl border-2 border-dashed border-slate-200 flex items-center justify-center overflow-hidden bg-slate-50 shrink-0">
                  {logoUrl ? (
                    <img src={logoUrl} alt="Logo" className="h-full w-full object-contain" />
                  ) : (
                    <ImageIcon className="h-8 w-8 text-slate-300" />
                  )}
                </div>
                <div className="flex-1 space-y-2">
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/svg+xml"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleUpload(f);
                      e.target.value = "";
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => fileRef.current?.click()}
                    disabled={saving}
                  >
                    <Upload className="h-3.5 w-3.5 mr-1.5" />
                    {logoUrl ? "Replace Logo" : "Upload Logo"}
                  </Button>
                  {logoUrl && (
                    <p className="text-xs text-emerald-600 flex items-center gap-1">
                      <Check className="h-3 w-3" /> Logo ready
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Brand name */}
            <div className="space-y-2">
              <Label htmlFor="brand-name">Brand Name</Label>
              <Input
                id="brand-name"
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                placeholder="Your Brand Inc."
              />
            </div>

            {/* Tagline */}
            <div className="space-y-2">
              <Label htmlFor="tagline">Tagline (optional)</Label>
              <Input
                id="tagline"
                value={tagline}
                onChange={(e) => setTagline(e.target.value)}
                placeholder="Creating tomorrow, today."
              />
            </div>

            {/* Website */}
            <div className="space-y-2">
              <Label htmlFor="website">Website (optional)</Label>
              <Input
                id="website"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="https://yourbrand.com"
              />
            </div>

            {/* Primary color */}
            <div className="space-y-2">
              <Label>Primary Brand Color</Label>
              <div className="flex items-center gap-2 flex-wrap">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setPrimaryColor(c)}
                    className={`h-8 w-8 rounded-full border-2 transition-all ${
                      primaryColor === c ? "border-slate-800 scale-110" : "border-white shadow"
                    }`}
                    style={{ backgroundColor: c }}
                    aria-label={`Color ${c}`}
                  />
                ))}
                <input
                  type="color"
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  className="h-8 w-8 rounded cursor-pointer border border-slate-200"
                  aria-label="Custom color"
                />
              </div>
            </div>

            {/* Logo position */}
            <div className="space-y-2">
              <Label>Logo Position</Label>
              <div className="grid grid-cols-4 gap-2">
                {POSITIONS.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => setLogoPosition(p.value)}
                    className={`px-2 py-2 rounded-lg text-xs font-medium border transition-colors ${
                      logoPosition === p.value
                        ? "border-violet-400 bg-violet-50 text-violet-700"
                        : "border-slate-200 text-slate-600 hover:border-slate-300"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Opacity + Scale */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Logo Opacity: {logoOpacity}%</Label>
                <input
                  type="range"
                  min={20}
                  max={100}
                  value={logoOpacity}
                  onChange={(e) => setLogoOpacity(Number(e.target.value))}
                  className="w-full accent-violet-600"
                />
              </div>
              <div className="space-y-2">
                <Label>Logo Size: {logoScale}%</Label>
                <input
                  type="range"
                  min={10}
                  max={50}
                  value={logoScale}
                  onChange={(e) => setLogoScale(Number(e.target.value))}
                  className="w-full accent-violet-600"
                />
              </div>
            </div>

            {/* Preview */}
            <div className="rounded-xl border border-slate-200 overflow-hidden bg-slate-900 relative aspect-video">
              <div className="absolute inset-0 flex items-center justify-center">
                <p className="text-slate-500 text-sm">Video preview area</p>
              </div>
              {logoUrl && (
                <div
                  className="absolute"
                  style={{
                    [logoPosition.includes("top") ? "top" : "bottom"]: "12px",
                    [logoPosition.includes("left") ? "left" : "right"]: "12px",
                    opacity: logoOpacity / 100,
                    width: `${logoScale}%`,
                    maxWidth: "120px",
                  } as React.CSSProperties}
                >
                  <img src={logoUrl} alt="Logo preview" className="w-full h-auto" />
                </div>
              )}
              {brandName && (
                <div
                  className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[10px] font-medium tracking-wide"
                  style={{ color: primaryColor }}
                >
                  {brandName}{tagline ? ` · ${tagline}` : ""}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Check className="h-4 w-4 mr-1.5" />}
                Save Brand Kit
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
