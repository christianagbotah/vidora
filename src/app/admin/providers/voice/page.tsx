"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Loader2, Mic2, Save, Sparkles, TestTube2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

interface ConfigEntry {
  value: string;
  description: string;
  configured: boolean;
  secret: boolean;
  source?: string;
}

type ConfigMap = Record<string, ConfigEntry>;
type TtsProvider = "qwen" | "grok" | "zai" | "elevenlabs";

const QWEN_MODEL = "qwen3-tts-instruct-flash";
const GROK_MODEL = "grok-tts";

const QWEN_MAP_EXAMPLE = JSON.stringify({
  tongtong: "Cherry",
  chuichui: "Pip",
  kazi: "Ethan",
  luodo: "Ryan",
  "profile:fr:ghanaian:jam": "Ryan",
}, null, 2);

const GROK_MAP_EXAMPLE = JSON.stringify({
  tongtong: "eve",
  kazi: "rex",
  luodo: "leo",
  "profile:fr:ghanaian:douji": "ara",
}, null, 2);

function validMap(raw: string): string | null {
  if (!raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "Voice map must be a JSON object.";
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!key.trim() || typeof value !== "string" || !value.trim()) {
        return "Every voice-map key and value must be non-empty text.";
      }
    }
    return null;
  } catch {
    return "Voice map must contain valid JSON.";
  }
}

export default function VoiceProviderStudioPage() {
  const [configs, setConfigs] = useState<ConfigMap>({});
  const [provider, setProvider] = useState<TtsProvider>("qwen");
  const [qwenBaseUrl, setQwenBaseUrl] = useState("");
  const [qwenDefaultVoice, setQwenDefaultVoice] = useState("Cherry");
  const [qwenVoiceMap, setQwenVoiceMap] = useState("");
  const [grokBaseUrl, setGrokBaseUrl] = useState("");
  const [grokDefaultVoice, setGrokDefaultVoice] = useState("eve");
  const [grokVoiceMap, setGrokVoiceMap] = useState("");
  const [qwenKey, setQwenKey] = useState("");
  const [grokKey, setGrokKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/config", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || "Failed to load voice-provider settings");
      const next = data.configs as ConfigMap;
      setConfigs(next);
      const active = (next.ai_tts_provider?.value || "qwen").toLowerCase();
      setProvider((["qwen", "grok", "zai", "elevenlabs"].includes(active) ? active : "qwen") as TtsProvider);
      setQwenBaseUrl(next.qwen_tts_base_url?.value || "https://dashscope-intl.aliyuncs.com/api/v1");
      setQwenDefaultVoice(next.qwen_tts_default_voice?.value || "Cherry");
      setQwenVoiceMap(next.qwen_tts_voice_map?.value || "");
      setGrokBaseUrl(next.grok_tts_base_url?.value || "https://api.x.ai/v1");
      setGrokDefaultVoice(next.grok_tts_default_voice?.value || "eve");
      setGrokVoiceMap(next.grok_tts_voice_map?.value || "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load voice-provider settings");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const mapError = useMemo(() => {
    if (provider === "qwen") return validMap(qwenVoiceMap);
    if (provider === "grok") return validMap(grokVoiceMap);
    return null;
  }, [grokVoiceMap, provider, qwenVoiceMap]);

  const effectiveModel = provider === "qwen"
    ? QWEN_MODEL
    : provider === "grok"
      ? GROK_MODEL
      : configs.ai_tts_model?.value || "Provider default";

  const save = async (): Promise<boolean> => {
    if (mapError) {
      setError(mapError);
      return false;
    }
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const model = provider === "qwen" ? QWEN_MODEL : provider === "grok" ? GROK_MODEL : "";
      const secretConfigs: Record<string, string> = {};
      if (qwenKey.trim()) secretConfigs.qwen_tts_api_key = qwenKey.trim();
      if (grokKey.trim()) secretConfigs.xai_tts_api_key = grokKey.trim();
      const response = await fetch("/api/admin/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          configs: {
            ai_tts_provider: provider,
            ai_tts_model: model,
            qwen_tts_base_url: qwenBaseUrl,
            qwen_tts_default_voice: qwenDefaultVoice,
            qwen_tts_voice_map: qwenVoiceMap,
            grok_tts_base_url: grokBaseUrl,
            grok_tts_default_voice: grokDefaultVoice,
            grok_tts_voice_map: grokVoiceMap,
          },
          secretConfigs,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || "Failed to save voice routing");
      setQwenKey("");
      setGrokKey("");
      setMessage(`Voice routing saved: ${provider} / ${effectiveModel}. Derived narration will regenerate with the new casting.`);
      await load();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to save voice routing");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const testVoice = async () => {
    setTesting(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/admin/config/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "tts" }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || "Voice provider test failed");
      setMessage(`Voice connected: ${data.provider} / ${data.model} / ${data.voice} in ${data.latencyMs} ms (${data.audioBytes} bytes).`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Voice provider test failed");
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return <div className="min-h-[60vh] grid place-items-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Button variant="ghost" size="sm" asChild className="mb-3 -ml-2">
              <Link href="/admin/providers"><ArrowLeft className="mr-2 h-4 w-4" />Provider Studio</Link>
            </Button>
            <div className="flex items-center gap-2">
              <h1 className="text-3xl font-bold tracking-tight">Voice Provider Studio</h1>
              <Badge variant="outline" className="gap-1"><Sparkles className="h-3 w-3" />Character-aware</Badge>
            </div>
            <p className="mt-2 max-w-3xl text-muted-foreground">
              Choose the production speech engine independently from Z.ai video generation. Character identities remain provider-neutral and are cast to distinct provider-native voices.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void testVoice()} disabled={testing || saving}>
              {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <TestTube2 className="mr-2 h-4 w-4" />}Test saved voice
            </Button>
            <Button onClick={() => void save()} disabled={saving || testing || Boolean(mapError)}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save voice routing
            </Button>
          </div>
        </div>

        {message && <div className="mb-5 flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{message}</div>}
        {error && <div className="mb-5 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">{error}</div>}

        <div className="grid gap-5 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Mic2 className="h-5 w-5" />Production speech route</CardTitle>
              <CardDescription>Qwen Instruct is the economical expressive route; Grok TTS is the premium expressive route.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Active TTS provider</Label>
                <Select value={provider} onValueChange={(value) => { setProvider(value as TtsProvider); setMessage(""); setError(""); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="qwen">Qwen3 TTS Instruct / DashScope</SelectItem>
                    <SelectItem value="grok">Grok TTS / xAI</SelectItem>
                    <SelectItem value="zai">BigModel GLM-TTS</SelectItem>
                    <SelectItem value="elevenlabs">ElevenLabs</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Effective model</Label>
                <Input value={effectiveModel} readOnly />
              </div>

              {provider === "qwen" && <>
                <div className="space-y-2 md:col-span-2 rounded-xl border bg-muted/20 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2"><div><div className="font-semibold">Qwen3 TTS Instruct</div><p className="text-sm text-muted-foreground">Instruction-controlled delivery for emotion, pace and accent while retaining the proven DashScope HTTP workflow.</p></div><Badge>Recommended economical route</Badge></div>
                </div>
                <div className="space-y-2 md:col-span-2"><Label>DashScope base URL</Label><Input value={qwenBaseUrl} onChange={(event) => setQwenBaseUrl(event.target.value)} /></div>
                <div className="space-y-2 md:col-span-2"><div className="flex items-center justify-between gap-2"><Label>DashScope API key</Label><Badge variant={configs.qwen_tts_api_key?.configured ? "default" : "outline"}>{configs.qwen_tts_api_key?.configured ? `Configured · ${configs.qwen_tts_api_key.source || "server"}` : "Not configured"}</Badge></div><Input type="password" autoComplete="new-password" value={qwenKey} onChange={(event) => setQwenKey(event.target.value)} placeholder={configs.qwen_tts_api_key?.configured ? "Leave blank to keep the current key" : "Paste DashScope API key"} /><p className="text-xs text-muted-foreground">Write-only. Environment fallback: DASHSCOPE_API_KEY.</p></div>
                <div className="space-y-2"><Label>Default narrator voice</Label><Input value={qwenDefaultVoice} onChange={(event) => setQwenDefaultVoice(event.target.value)} placeholder="Cherry" /></div>
                <div className="space-y-2 md:col-span-2"><Label>Logical/profile voice map (JSON)</Label><Textarea value={qwenVoiceMap} onChange={(event) => setQwenVoiceMap(event.target.value)} rows={8} className="font-mono text-xs" placeholder={QWEN_MAP_EXAMPLE} />{mapError && <p className="text-xs font-medium text-destructive">{mapError}</p>}<details className="rounded-lg border px-3 py-2 text-xs"><summary className="cursor-pointer font-medium">Show Qwen map example</summary><pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-muted-foreground">{QWEN_MAP_EXAMPLE}</pre></details></div>
              </>}

              {provider === "grok" && <>
                <div className="space-y-2 md:col-span-2 rounded-xl border bg-muted/20 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2"><div><div className="font-semibold">Grok TTS</div><p className="text-sm text-muted-foreground">Dynamic xAI voice discovery, deterministic per-character casting, expressive speech tags and provider-native Voice Studio IDs.</p></div><Badge>Premium expressive route</Badge></div>
                </div>
                <div className="space-y-2 md:col-span-2"><Label>xAI TTS base URL</Label><Input value={grokBaseUrl} onChange={(event) => setGrokBaseUrl(event.target.value)} placeholder="https://api.x.ai/v1" /></div>
                <div className="space-y-2 md:col-span-2"><div className="flex items-center justify-between gap-2"><Label>xAI TTS API key</Label><Badge variant={configs.xai_tts_api_key?.configured ? "default" : "outline"}>{configs.xai_tts_api_key?.configured ? `Configured · ${configs.xai_tts_api_key.source || "server"}` : "Not configured"}</Badge></div><Input type="password" autoComplete="new-password" value={grokKey} onChange={(event) => setGrokKey(event.target.value)} placeholder={configs.xai_tts_api_key?.configured ? "Leave blank to keep the current/shared xAI key" : "Paste xAI API key"} /><p className="text-xs text-muted-foreground">Optional dedicated key. If blank, Vidora can reuse the server XAI_API_KEY.</p></div>
                <div className="space-y-2"><Label>Default narrator voice ID</Label><Input value={grokDefaultVoice} onChange={(event) => setGrokDefaultVoice(event.target.value.toLowerCase())} placeholder="eve" /><p className="text-xs text-muted-foreground">Character logical voices are automatically distributed across other available Grok voices unless mapped explicitly.</p></div>
                <div className="space-y-2 md:col-span-2"><Label>Logical/profile voice map (JSON)</Label><Textarea value={grokVoiceMap} onChange={(event) => setGrokVoiceMap(event.target.value)} rows={8} className="font-mono text-xs" placeholder={GROK_MAP_EXAMPLE} />{mapError && <p className="text-xs font-medium text-destructive">{mapError}</p>}<details className="rounded-lg border px-3 py-2 text-xs"><summary className="cursor-pointer font-medium">Show Grok map example</summary><pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-muted-foreground">{GROK_MAP_EXAMPLE}</pre></details></div>
              </>}

              {(provider === "zai" || provider === "elevenlabs") && <div className="md:col-span-2 rounded-xl border bg-muted/20 p-4 text-sm text-muted-foreground">This provider remains supported. Use the main <Link href="/admin/providers" className="font-medium text-foreground underline underline-offset-4">Provider Studio</Link> for its detailed settings.</div>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Character performance</CardTitle><CardDescription>What stays consistent when you switch providers.</CardDescription></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="rounded-lg border p-3"><div className="font-medium">Speaker identity</div><p className="mt-1 text-muted-foreground">Narrator, Chase, Marshall and other named speakers keep separate logical voice identities across scenes.</p></div>
              <div className="rounded-lg border p-3"><div className="font-medium">Performance direction</div><p className="mt-1 text-muted-foreground">Screenplay cues such as excited, calm, whispering and urgent are routed to Qwen instructions or Grok expressive tags.</p></div>
              <div className="rounded-lg border p-3"><div className="font-medium">Safe cache invalidation</div><p className="mt-1 text-muted-foreground">Changing the active voice engine/model/cast invalidates derived narration and review state without regenerating visual clips.</p></div>
              <div className="rounded-lg border p-3"><div className="font-medium">Testing order</div><p className="mt-1 text-muted-foreground">Save routing first, then use Test saved voice. Production deployment repeats a real provider synthesis probe before marking a release healthy.</p></div>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
