"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Bot, CheckCircle2, Cpu, Loader2, Mic2, Save, ShieldCheck, TestTube2, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

interface ConfigEntry {
  value: string;
  description: string;
  configured: boolean;
  secret: boolean;
  source?: string;
}

type ConfigMap = Record<string, ConfigEntry>;
type FormState = Record<string, string>;

const EDITABLE_KEYS = [
  "ai_text_provider",
  "ai_text_model",
  "ai_text_fallback_provider",
  "ai_tts_provider",
  "ai_tts_model",
  "xai_base_url",
  "xai_text_model",
  "elevenlabs_base_url",
  "elevenlabs_default_voice_id",
  "elevenlabs_voice_map",
  "compatible_base_url",
  "compatible_text_model",
] as const;

function SecretBadge({ configs, configKey, env }: { configs: ConfigMap; configKey: string; env: string }) {
  const entry = configs[configKey];
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
      <div>
        <div className="font-medium">{env}</div>
        <div className="text-xs text-muted-foreground">Server-side secret</div>
      </div>
      <Badge variant={entry?.configured ? "default" : "outline"}>
        {entry?.configured ? `Configured · ${entry.source || "server"}` : "Not configured"}
      </Badge>
    </div>
  );
}

export default function AIProviderAdminPage() {
  const [configs, setConfigs] = useState<ConfigMap>({});
  const [form, setForm] = useState<FormState>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<string>("");
  const [error, setError] = useState<string>("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/config", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || "Failed to load provider settings");
      const nextConfigs = data.configs as ConfigMap;
      setConfigs(nextConfigs);
      const nextForm: FormState = {};
      for (const key of EDITABLE_KEYS) nextForm[key] = nextConfigs[key]?.value || "";
      setForm(nextForm);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load provider settings");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const setField = (key: string, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    setMessage("");
    setError("");
  };

  const save = async () => {
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const payload: Record<string, string> = {};
      for (const key of EDITABLE_KEYS) payload[key] = form[key] || "";
      const response = await fetch("/api/admin/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ configs: payload }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || "Failed to save provider settings");
      setMessage("AI provider routing saved. New story and voice jobs will use these settings.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to save provider settings");
    } finally {
      setSaving(false);
    }
  };

  const testActiveText = async () => {
    setTesting(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/admin/config/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "active" }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || "Provider test failed");
      setMessage(`Connected to ${data.provider} / ${data.model} in ${data.latencyMs} ms. Reply: ${data.reply}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Provider test failed");
    } finally {
      setTesting(false);
    }
  };

  const textProvider = form.ai_text_provider || "zai";
  const ttsProvider = form.ai_tts_provider || "zai";
  const effectiveTextLabel = useMemo(() => {
    if (textProvider === "xai") return form.ai_text_model || form.xai_text_model || "grok-4.6";
    if (textProvider === "compatible") return form.ai_text_model || form.compatible_text_model || "Not set";
    return form.ai_text_model || "Z.ai default";
  }, [form, textProvider]);

  if (loading) {
    return <div className="min-h-screen grid place-items-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Button variant="ghost" size="sm" asChild className="mb-3 -ml-2">
              <Link href="/?view=admin"><ArrowLeft className="mr-2 h-4 w-4" />Back to Admin</Link>
            </Button>
            <h1 className="text-3xl font-bold tracking-tight">AI Provider Studio</h1>
            <p className="mt-2 max-w-3xl text-muted-foreground">
              Choose the strongest model for each job. Vidora can use one model for story intelligence,
              keep Z.ai for high-quality video, and use a dedicated voice provider for character dialogue.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={testActiveText} disabled={testing || saving}>
              {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <TestTube2 className="mr-2 h-4 w-4" />}
              Test text model
            </Button>
            <Button onClick={save} disabled={saving || testing}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Save routing
            </Button>
          </div>
        </div>

        {message && (
          <div className="mb-5 flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{message}
          </div>
        )}
        {error && <div className="mb-5 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">{error}</div>}

        <div className="grid gap-5 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Bot className="h-5 w-5" />Story & dialogue intelligence</CardTitle>
              <CardDescription>
                This model turns a user's idea into scenes, preserves names/facts, writes explicit character lines, and directs the narrative.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Active text provider</Label>
                <Select value={textProvider} onValueChange={(value) => setField("ai_text_provider", value)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="zai">Z.ai</SelectItem>
                    <SelectItem value="xai">Grok / xAI</SelectItem>
                    <SelectItem value="compatible">OpenAI-compatible API</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Fallback text provider</Label>
                <Select value={form.ai_text_fallback_provider || "zai"} onValueChange={(value) => setField("ai_text_fallback_provider", value)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No automatic fallback</SelectItem>
                    <SelectItem value="zai">Z.ai</SelectItem>
                    <SelectItem value="xai">Grok / xAI</SelectItem>
                    <SelectItem value="compatible">OpenAI-compatible API</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Active-model override <span className="text-muted-foreground">(optional)</span></Label>
                <Input value={form.ai_text_model || ""} onChange={(event) => setField("ai_text_model", event.target.value)} placeholder="Leave blank to use the provider default" />
                <p className="text-xs text-muted-foreground">Current effective model: <strong>{effectiveTextLabel}</strong></p>
              </div>

              {textProvider === "xai" && (
                <>
                  <div className="space-y-2">
                    <Label>xAI base URL</Label>
                    <Input value={form.xai_base_url || ""} onChange={(event) => setField("xai_base_url", event.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>xAI default model</Label>
                    <Input value={form.xai_text_model || ""} onChange={(event) => setField("xai_text_model", event.target.value)} placeholder="grok-4.6" />
                  </div>
                </>
              )}

              {textProvider === "compatible" && (
                <>
                  <div className="space-y-2">
                    <Label>Compatible API base URL</Label>
                    <Input value={form.compatible_base_url || ""} onChange={(event) => setField("compatible_base_url", event.target.value)} placeholder="https://provider.example/v1" />
                  </div>
                  <div className="space-y-2">
                    <Label>Compatible API model</Label>
                    <Input value={form.compatible_text_model || ""} onChange={(event) => setField("compatible_text_model", event.target.value)} />
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Video className="h-5 w-5" />Video engine</CardTitle>
              <CardDescription>Kept separate from text intelligence.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-xl border bg-muted/30 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-semibold">Z.ai video</div><Badge>Active</Badge>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  Vidora keeps the current Z.ai visual/video pipeline while story and voice providers can change independently.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Mic2 className="h-5 w-5" />Character voice & dialogue</CardTitle>
              <CardDescription>
                Speaker-aware TTS preserves exact lines and lets each character resolve to a different voice.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Active TTS provider</Label>
                <Select value={ttsProvider} onValueChange={(value) => setField("ai_tts_provider", value)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="zai">Z.ai TTS</SelectItem>
                    <SelectItem value="elevenlabs">ElevenLabs</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>TTS model</Label>
                <Input value={form.ai_tts_model || ""} onChange={(event) => setField("ai_tts_model", event.target.value)} placeholder={ttsProvider === "elevenlabs" ? "eleven_v3" : "Leave blank for Z.ai default"} />
              </div>
              {ttsProvider === "elevenlabs" && (
                <>
                  <div className="space-y-2">
                    <Label>ElevenLabs base URL</Label>
                    <Input value={form.elevenlabs_base_url || ""} onChange={(event) => setField("elevenlabs_base_url", event.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Default ElevenLabs voice ID</Label>
                    <Input value={form.elevenlabs_default_voice_id || ""} onChange={(event) => setField("elevenlabs_default_voice_id", event.target.value)} placeholder="Voice ID from ElevenLabs" />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label>Character voice map (JSON)</Label>
                    <Textarea
                      value={form.elevenlabs_voice_map || ""}
                      onChange={(event) => setField("elevenlabs_voice_map", event.target.value)}
                      rows={6}
                      className="font-mono text-xs"
                      placeholder={'{\n  "chuichui": "VOICE_ID_FOR_PLAYFUL_CHILD",\n  "luodo": "VOICE_ID_FOR_EXPRESSIVE_ADULT"\n}'}
                    />
                    <p className="text-xs text-muted-foreground">
                      Map Vidora's logical voice names (or character-specific voice IDs) to ElevenLabs voice IDs. Unmapped voices use the default above.
                    </p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5" />Server secrets</CardTitle>
              <CardDescription>Keys never leave the server.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <SecretBadge configs={configs} configKey="zai_api_key" env="ZAI_API_KEY" />
              <SecretBadge configs={configs} configKey="xai_api_key" env="XAI_API_KEY" />
              <SecretBadge configs={configs} configKey="elevenlabs_api_key" env="ELEVENLABS_API_KEY" />
              <SecretBadge configs={configs} configKey="compatible_api_key" env="AI_COMPATIBLE_API_KEY" />
              <p className="pt-2 text-xs text-muted-foreground">
                Add or rotate these values in the VPS environment, then restart Vidora. The web admin only changes routing and non-secret model settings.
              </p>
            </CardContent>
          </Card>
        </div>

        <Card className="mt-5">
          <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <Cpu className="mt-0.5 h-5 w-5" />
              <div>
                <div className="font-semibold">Recommended premium mix</div>
                <p className="text-sm text-muted-foreground">Grok/xAI for story intelligence + Z.ai for video + ElevenLabs for character speech.</p>
              </div>
            </div>
            <Badge variant="outline" className="w-fit">Capability routing</Badge>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
