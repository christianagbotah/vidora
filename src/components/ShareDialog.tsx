"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Share2, Copy, Check, Globe, Lock, Code, Eye, Loader2, ExternalLink,
  Twitter, Facebook, Linkedin, MessageCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

interface ShareSettings {
  isPublic: boolean;
  shareSlug: string | null;
  hasPassword: boolean;
  allowEmbed: boolean;
  shareUrl: string | null;
}

interface Props {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ShareDialog({ projectId, open, onOpenChange }: Props) {
  const [settings, setSettings] = useState<ShareSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isPublic, setIsPublic] = useState(false);
  const [slug, setSlug] = useState("");
  const [password, setPassword] = useState("");
  const [allowEmbed, setAllowEmbed] = useState(true);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedEmbed, setCopiedEmbed] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (open && projectId) {
      loadSettings();
    }
  }, [open, projectId]);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/share`);
      const data = await res.json();
      if (data.success) {
        setSettings(data.settings);
        setIsPublic(data.settings.isPublic);
        setSlug(data.settings.shareSlug || "");
        setAllowEmbed(data.settings.allowEmbed);
        setPassword(""); // never pre-fill password
      }
    } catch {
      toast({ title: "Failed to load share settings", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isPublic,
          shareSlug: slug.trim() || undefined,
          password: password || undefined, // empty = remove, undefined = no change
          allowEmbed,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSettings(data.settings);
        setSlug(data.settings.shareSlug || "");
        toast({ title: "Share settings saved", description: isPublic ? "Your video is now shareable!" : "Sharing disabled." });
      } else {
        toast({ title: "Failed to save", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const shareUrl = settings?.shareUrl || "";
  const embedCode = shareUrl
    ? `<iframe src="${shareUrl}" width="560" height="315" frameborder="0" allowfullscreen style="border:none;border-radius:12px;"></iframe>`
    : "";

  const copyLink = () => {
    navigator.clipboard.writeText(shareUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const copyEmbed = () => {
    navigator.clipboard.writeText(embedCode);
    setCopiedEmbed(true);
    setTimeout(() => setCopiedEmbed(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-5 w-5 text-violet-500" />
            Share Video
          </DialogTitle>
          <DialogDescription>
            Make your video public and share it with a link or embed code.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-violet-500" />
          </div>
        ) : (
          <div className="space-y-5">
            {/* Public toggle */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-violet-50 border border-violet-100">
              <div className="flex items-center gap-3">
                <Globe className="h-5 w-5 text-violet-600" />
                <div>
                  <Label className="font-semibold cursor-pointer">Public sharing</Label>
                  <p className="text-xs text-muted-foreground">Anyone with the link can watch</p>
                </div>
              </div>
              <Switch checked={isPublic} onCheckedChange={setIsPublic} />
            </div>

            {isPublic && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                className="space-y-4"
              >
                {/* Custom slug */}
                <div className="space-y-1.5">
                  <Label htmlFor="share-slug" className="text-sm">Custom URL (optional)</Label>
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-muted-foreground whitespace-nowrap">/share/</span>
                    <Input
                      id="share-slug"
                      value={slug}
                      onChange={(e) => setSlug(e.target.value.replace(/[^a-zA-Z0-9-_]/g, "").toLowerCase())}
                      placeholder="my-video"
                      className="h-9 text-sm"
                    />
                  </div>
                </div>

                {/* Password */}
                <div className="space-y-1.5">
                  <Label htmlFor="share-password" className="text-sm flex items-center gap-1.5">
                    <Lock className="h-3.5 w-3.5" />
                    Password protection (optional)
                  </Label>
                  <Input
                    id="share-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={settings?.hasPassword ? "•••••• (leave blank to keep)" : "No password"}
                    className="h-9 text-sm"
                  />
                  {settings?.hasPassword && (
                    <p className="text-xs text-amber-600">Password is set. Enter a new one to change, or save with this field empty to keep the current one.</p>
                  )}
                </div>

                {/* Allow embed */}
                <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-100">
                  <div className="flex items-center gap-3">
                    <Code className="h-5 w-5 text-slate-600" />
                    <div>
                      <Label className="font-semibold cursor-pointer">Allow embedding</Label>
                      <p className="text-xs text-muted-foreground">Let others embed this video</p>
                    </div>
                  </div>
                  <Switch checked={allowEmbed} onCheckedChange={setAllowEmbed} />
                </div>

                {/* Share URL */}
                {shareUrl && (
                  <div className="space-y-1.5">
                    <Label className="text-sm">Share link</Label>
                    <div className="flex gap-2">
                      <Input readOnly value={shareUrl} className="text-xs font-mono h-9" />
                      <Button size="sm" variant="outline" onClick={copyLink} className="shrink-0">
                        {copiedLink ? <><Check className="h-4 w-4" /></> : <><Copy className="h-4 w-4" /></>}
                      </Button>
                    </div>
                  </div>
                )}

                {/* Embed code */}
                {shareUrl && allowEmbed && (
                  <div className="space-y-1.5">
                    <Label className="text-sm">Embed code</Label>
                    <div className="flex gap-2">
                      <Input readOnly value={embedCode} className="text-xs font-mono h-9" />
                      <Button size="sm" variant="outline" onClick={copyEmbed} className="shrink-0">
                        {copiedEmbed ? <><Check className="h-4 w-4" /></> : <><Copy className="h-4 w-4" /></>}
                      </Button>
                    </div>
                  </div>
                )}

                {/* Social share */}
                {shareUrl && (
                  <div className="flex gap-2 justify-center pt-2">
                    <a href={`https://twitter.com/intent/tweet?text=Check+out+my+video&url=${encodeURIComponent(shareUrl)}`} target="_blank" rel="noopener noreferrer"
                       className="h-9 w-9 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors">
                      <Twitter className="h-4 w-4" />
                    </a>
                    <a href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`} target="_blank" rel="noopener noreferrer"
                       className="h-9 w-9 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors">
                      <Facebook className="h-4 w-4" />
                    </a>
                    <a href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`} target="_blank" rel="noopener noreferrer"
                       className="h-9 w-9 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors">
                      <Linkedin className="h-4 w-4" />
                    </a>
                    <a href={`https://wa.me/?text=${encodeURIComponent("Check out my video " + shareUrl)}`} target="_blank" rel="noopener noreferrer"
                       className="h-9 w-9 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors">
                      <MessageCircle className="h-4 w-4" />
                    </a>
                    <a href={shareUrl} target="_blank" rel="noopener noreferrer"
                       className="h-9 w-9 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors">
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </div>
                )}
              </motion.div>
            )}

            {/* Save button */}
            <div className="flex gap-2 pt-2">
              <Button onClick={handleSave} disabled={saving} className="flex-1 btn-gradient">
                {saving ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Saving...</> : "Save Settings"}
              </Button>
              {shareUrl && (
                <Button variant="outline" asChild>
                  <a href={shareUrl} target="_blank" rel="noopener noreferrer">
                    <Eye className="h-4 w-4 mr-1.5" />Preview
                  </a>
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
