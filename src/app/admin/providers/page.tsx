"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  Cpu,
  Loader2,
  Mic2,
  Save,
  ShieldCheck,
  TestTube2,
  Video,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { previewElevenLabsVoiceResolution } from "@/lib/elevenlabs-voice-map";

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
  "zai_tts_base_url",
  "xai_base_url",
  "xai_text_model",
  "elevenlabs_base_url",
  "elevenlabs_default_voice_id",
  "elevenlabs_voice_map",
  "compatible_base_url",
  "compatible_text_model",
] as const;

const ELEVENLABS_EXAMPLE = JSON.stringify({
  "profile:en:ghanaian:tongtong": "ELEVENLABS_GH_NARRATOR_ID",
  "profile:fr:ghanaian:jam": "ELEVENLABS_FR_GH_JAM_ID",
  "accent:ghanaian": "ELEVENLABS_GH_GENERIC_ID",
  "language:fr": "ELEVENLABS_FR_GENERIC_ID",
  jam: "ELEVENLABS_JAM_FALLBACK_ID",
}, null, 2);

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

function providerLabel(provider: string): string {
  if (provider === "xai") return "Grok / xAI";
  if (provider === "compatible") return "OpenAI-compatible API";
  if (provider === "none") return "None";
  return "Z.ai";
}

export default function AIProviderAdminPage() {
  const [configs, setConfigs] = useState<ConfigMap>({});
  const [form, setForm] = useState<FormState>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testingVoice, setTestingVoice] = useState(false);
  const [secretForm, setSecretForm] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [previewLanguage, setPreviewLanguage] = useState("en");
  const [previewAccent, setPreviewAccent] = useState("ghanaian");
  const [previewVoice, setPreviewVoice] = useState("tongtong");

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

  const setSecretField = (key: string, value: string) => {
    setSecretForm((current) => ({ ...current, [key]: value }));
    setMessage("");
    setError("");
  };

  const textProvider = form.ai_text_provider || "zai";
  const fallbackProvider = form.ai_text_fallback_provider || "zai";
  const ttsProvider = form.ai_tts_provider || "zai";
  const usesXai = textProvider === "xai" || fallbackProvider === "xai";
  const usesCompatible = textProvider === "compatible" || fallbackProvider === "compatible";

  const effectiveTextLabel = useMemo(() => {
    if (textProvider === "xai") return form.ai_text_model || form.xai_text_model || "grok-4.6";
    if (textProvider === "compatible") return form.ai_text_model || form.compatible_text_model || "Not set";
    return form.ai_text_model || "Z.ai default";
  }, [form, textProvider]);

  const fallbackModelLabel = useMemo(() => {
    if (fallbackProvider === "none") return "Disabled";
    if (fallbackProvider === "xai") return form.xai_text_model || "grok-4.6";
    if (fallbackProvider === "compatible") return form.compatible_text_model || "Not set";
    return "Z.ai default";
  }, [fallbackProvider, form.compatible_text_model, form.xai_text_model]);

  const voicePreview = useMemo(() => previewElevenLabsVoiceResolution({
    rawMap: form.elevenlabs_voice_map || "",
    defaultVoiceId: form.elevenlabs_default_voice_id || "",
    requestedVoice: previewVoice,
    language: previewLanguage,
    accent: previewAccent,
  }), [form.elevenlabs_default_voice_id, form.elevenlabs_voice_map, previewAccent, previewLanguage, previewVoice]);

  const voiceMapInvalid = ttsProvider === "elevenlabs" && Boolean(voicePreview.validation.error);

  const save = async () => {
    if (voiceMapInvalid) {
      setError(voicePreview.validation.error || "Fix the ElevenLabs voice map before saving.");
      return;
    }
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const payload: Record<string, string> = {};
      for (const key of EDITABLE_KEYS) payload[key] = form[key] || "";
      const secretConfigs: Record<string, string> = {};
      for (const key of ["zai_tts_api_key", "elevenlabs_api_key"]) {
        const value = (secretForm[key] || "").trim();
        if (value) secretConfigs[key] = value;
      }
      const response = await fetch("/api/admin/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ configs: payload, secretConfigs }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || "Failed to save provider settings");
      setSecretForm({});
      setMessage("AI provider routing saved. New story and voice jobs will use these settings.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to save provider settings");
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async (provider: "active" | "tts") => {
    const setBusy = provider === "active" ? setTesting : setTestingVoice;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/admin/config/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || "Provider test failed");
      setMessage(provider === "active"
        ? `Connected to ${data.provider} / ${data.model} in ${data.latencyMs} ms. Reply: ${data.reply}`
        : `Voice connected: ${data.provider} / ${data.model} / ${data.voice} in ${data.latencyMs} ms (${data.audioBytes} bytes).`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Provider test failed");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen grid place-items-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <Button variant="ghost" size="sm" asChild className="mb-3 -ml-2">
              <Link href="/?view=admin"><ArrowLeft className="mr-2 h-4 w-4" />Back to Admin</Link>
            </Button>
            <h1 className="text-3xl font-bold tracking-tight">AI Provider Studio</h1>
            <p className="mt-2 max-w-3xl text-muted-foreground">
              Route story intelligence, video generation and speech independently while keeping provider credentials server-side.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void testConnection("active")} disabled={testing || testingVoice || saving}>
              {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <TestTube2 className="mr-2 h-4 w-4" />}Test text model
            </Button>
            <Button variant="outline" onClick={() => void testConnection("tts")} disabled={testing || testingVoice || saving || voiceMapInvalid}>
              {testingVoice ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mic2 className="mr-2 h-4 w-4" />}Test voice model
            </Button>
            <Button onClick={() => void save()} disabled={saving || testing || testingVoice || voiceMapInvalid}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save routing
            </Button>
          </div>
        </div>

        {message && <div className="mb-5 flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{message}</div>}
        {error && <div className="mb-5 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">{error}</div>}

        <div className="grid gap-5 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Bot className="h-5 w-5" />Story & dialogue intelligence</CardTitle>
              <CardDescription>Choose a primary story model and an optional independent fallback.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5 md:grid-cols-2">
              <div className="space-y-2"><Label>Active text provider</Label><Select value={textProvider} onValueChange={(value) => setField("ai_text_provider", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="zai">Z.ai</SelectItem><SelectItem value="xai">Grok / xAI</SelectItem><SelectItem value="compatible">OpenAI-compatible API</SelectItem></SelectContent></Select></div>
              <div className="space-y-2"><Label>Fallback text provider</Label><Select value={fallbackProvider} onValueChange={(value) => setField("ai_text_fallback_provider", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">No automatic fallback</SelectItem><SelectItem value="zai">Z.ai</SelectItem><SelectItem value="xai">Grok / xAI</SelectItem><SelectItem value="compatible">OpenAI-compatible API</SelectItem></SelectContent></Select></div>
              <div className="md:col-span-2 grid gap-3 rounded-xl border bg-muted/25 p-4 sm:grid-cols-2"><div><div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Primary route</div><div className="mt-1 font-semibold">{providerLabel(textProvider)}</div><div className="text-sm text-muted-foreground">{effectiveTextLabel}</div></div><div><div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Fallback route</div><div className="mt-1 font-semibold">{providerLabel(fallbackProvider)}</div><div className="text-sm text-muted-foreground">{fallbackModelLabel}</div></div></div>
              <div className="space-y-2 md:col-span-2"><Label>Active-model override <span className="text-muted-foreground">(optional)</span></Label><Input value={form.ai_text_model || ""} onChange={(event) => setField("ai_text_model", event.target.value)} placeholder="Leave blank to use the active provider default" /></div>
              {usesXai && <><div className="space-y-2"><Label>xAI base URL</Label><Input value={form.xai_base_url || ""} onChange={(event) => setField("xai_base_url", event.target.value)} /></div><div className="space-y-2"><Label>xAI provider model</Label><Input value={form.xai_text_model || ""} onChange={(event) => setField("xai_text_model", event.target.value)} placeholder="grok-4.6" /></div></>}
              {usesCompatible && <><div className="space-y-2"><Label>Compatible API base URL</Label><Input value={form.compatible_base_url || ""} onChange={(event) => setField("compatible_base_url", event.target.value)} placeholder="https://provider.example/v1" /></div><div className="space-y-2"><Label>Compatible provider model</Label><Input value={form.compatible_text_model || ""} onChange={(event) => setField("compatible_text_model", event.target.value)} /></div></>}
            </CardContent>
          </Card>

          <Card><CardHeader><CardTitle className="flex items-center gap-2"><Video className="h-5 w-5" />Video engine</CardTitle><CardDescription>Visual generation remains independently routed.</CardDescription></CardHeader><CardContent><div className="rounded-xl border bg-muted/30 p-4"><div className="flex items-center justify-between gap-3"><div className="font-semibold">Z.ai video</div><Badge>Active</Badge></div><p className="mt-2 text-sm text-muted-foreground">Changing story or speech providers does not alter Vidora's current Z.ai video pipeline.</p></div></CardContent></Card>

          <Card className="lg:col-span-2">
            <CardHeader><CardTitle className="flex items-center gap-2"><Mic2 className="h-5 w-5" />Character voice & dialogue</CardTitle><CardDescription>Voice Studio language, accent and logical voice settings resolve through this provider layer.</CardDescription></CardHeader>
            <CardContent className="grid gap-5 md:grid-cols-2">
              <div className="space-y-2"><Label>Active TTS provider</Label><Select value={ttsProvider} onValueChange={(value) => setField("ai_tts_provider", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="zai">BigModel GLM-TTS (optional)</SelectItem><SelectItem value="elevenlabs">ElevenLabs</SelectItem></SelectContent></Select></div>
              <div className="space-y-2"><Label>TTS model</Label><Input value={form.ai_tts_model || ""} onChange={(event) => setField("ai_tts_model", event.target.value)} placeholder={ttsProvider === "elevenlabs" ? "eleven_v3" : "glm-tts"} /></div>

              {ttsProvider === "zai" && <><div className="space-y-2 md:col-span-2"><Label>BigModel GLM-TTS base URL</Label><Input value={form.zai_tts_base_url || ""} onChange={(event) => setField("zai_tts_base_url", event.target.value)} placeholder="https://open.bigmodel.cn/api/paas/v4" /><p className="text-xs text-muted-foreground">Optional speech provider. The global api.z.ai video/chat subscription remains separate.</p></div><div className="space-y-2 md:col-span-2 rounded-xl border bg-muted/25 p-4"><div className="flex items-center justify-between gap-3"><Label>BigModel GLM-TTS API key</Label><Badge variant={configs.zai_tts_api_key?.configured ? "default" : "outline"}>{configs.zai_tts_api_key?.configured ? "Configured" : "Not configured"}</Badge></div><Input type="password" autoComplete="new-password" value={secretForm.zai_tts_api_key || ""} onChange={(event) => setSecretField("zai_tts_api_key", event.target.value)} placeholder={configs.zai_tts_api_key?.configured ? "Enter a new key only to replace the current one" : "Paste the API key when you are ready"} /><p className="text-xs text-muted-foreground">Write-only field. Leave blank to keep the current encrypted key.</p></div></>}

              {ttsProvider === "elevenlabs" && <>
                <div className="space-y-2"><Label>ElevenLabs base URL</Label><Input value={form.elevenlabs_base_url || ""} onChange={(event) => setField("elevenlabs_base_url", event.target.value)} /></div>
                <div className="space-y-2"><Label>ElevenLabs API key</Label><Input type="password" autoComplete="new-password" value={secretForm.elevenlabs_api_key || ""} onChange={(event) => setSecretField("elevenlabs_api_key", event.target.value)} placeholder={configs.elevenlabs_api_key?.configured ? "Enter a new key only to replace the current one" : "Paste the API key when you are ready"} /><p className="text-xs text-muted-foreground">{configs.elevenlabs_api_key?.configured ? "Configured · leave blank to keep it" : "Not configured"}</p></div>
                <div className="space-y-2 md:col-span-2"><Label>Default ElevenLabs voice ID</Label><Input value={form.elevenlabs_default_voice_id || ""} onChange={(event) => setField("elevenlabs_default_voice_id", event.target.value)} placeholder="Voice ID used only when no map key matches" /></div>

                <div className="space-y-3 md:col-span-2 rounded-xl border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2"><div><Label>Language / accent / logical voice map (JSON)</Label><p className="mt-1 text-xs text-muted-foreground">Keys are case-insensitive and checked from most specific to broadest fallback.</p></div><Badge variant={voicePreview.validation.error ? "destructive" : "outline"}>{voicePreview.validation.error ? "Invalid JSON" : `${voicePreview.validation.entryCount} mapping${voicePreview.validation.entryCount === 1 ? "" : "s"}`}</Badge></div>
                  <Textarea value={form.elevenlabs_voice_map || ""} onChange={(event) => setField("elevenlabs_voice_map", event.target.value)} rows={10} className="font-mono text-xs" placeholder={ELEVENLABS_EXAMPLE} />
                  {voicePreview.validation.error ? <p className="text-xs font-medium text-destructive">{voicePreview.validation.error}</p> : <p className="text-xs text-muted-foreground">Precedence: <code>profile:language:accent:voice</code> → <code>profile:language:accent</code> → <code>accent:language:accent</code> → <code>accent:accent</code> → <code>language:language</code> → logical voice → default voice ID.</p>}
                  <div className="grid gap-3 sm:grid-cols-3"><div className="space-y-1"><Label className="text-xs">Preview language</Label><Input value={previewLanguage} onChange={(event) => setPreviewLanguage(event.target.value)} placeholder="en" /></div><div className="space-y-1"><Label className="text-xs">Preview accent</Label><Input value={previewAccent} onChange={(event) => setPreviewAccent(event.target.value)} placeholder="ghanaian" /></div><div className="space-y-1"><Label className="text-xs">Logical voice</Label><Input value={previewVoice} onChange={(event) => setPreviewVoice(event.target.value)} placeholder="tongtong" /></div></div>
                  <div className="rounded-lg bg-muted/40 p-3 text-sm"><div className="font-medium">Routing preview</div>{voicePreview.validation.error ? <div className="mt-1 text-muted-foreground">Fix the JSON to preview resolution.</div> : voicePreview.resolvedVoiceId ? <><div className="mt-1 break-all">Resolved ElevenLabs voice: <code>{voicePreview.resolvedVoiceId}</code></div><div className="mt-1 text-xs text-muted-foreground">{voicePreview.matchedKey ? <>Matched <code>{voicePreview.matchedKey}</code>.</> : "No map key matched; using the configured default voice ID."}</div></> : <div className="mt-1 text-amber-700 dark:text-amber-300">No mapping and no default voice ID resolve this profile. Narration would fail until one is configured.</div>}</div>
                  <details className="rounded-lg border px-3 py-2 text-xs"><summary className="cursor-pointer font-medium">Show example map</summary><pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-muted-foreground">{ELEVENLABS_EXAMPLE}</pre></details>
                </div>
              </>}
            </CardContent>
          </Card>

          <Card><CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5" />Server secrets</CardTitle><CardDescription>Keys never leave the server.</CardDescription></CardHeader><CardContent className="space-y-3"><SecretBadge configs={configs} configKey="zai_api_key" env="ZAI_API_KEY" /><SecretBadge configs={configs} configKey="zai_tts_api_key" env="ZAI_TTS_API_KEY" /><SecretBadge configs={configs} configKey="xai_api_key" env="XAI_API_KEY" /><SecretBadge configs={configs} configKey="elevenlabs_api_key" env="ELEVENLABS_API_KEY" /><SecretBadge configs={configs} configKey="compatible_api_key" env="AI_COMPATIBLE_API_KEY" /><p className="pt-2 text-xs text-muted-foreground">BigModel and ElevenLabs TTS keys can be added above. They are stored encrypted and are never displayed again.</p></CardContent></Card>
        </div>

        <Card className="mt-5"><CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-3"><Cpu className="mt-0.5 h-5 w-5" /><div><div className="font-semibold">Recommended premium mix</div><p className="text-sm text-muted-foreground">Grok/xAI for story intelligence + Z.ai for video + ElevenLabs for character speech.</p></div></div><Badge variant="outline" className="w-fit">Capability routing</Badge></CardContent></Card>
      </div>
    </main>
  );
}
