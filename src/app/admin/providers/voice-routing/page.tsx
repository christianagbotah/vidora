"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  FlaskConical,
  Loader2,
  Mic2,
  Plus,
  Route,
  Save,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

interface ConfigEntry {
  value: string;
  configured: boolean;
}

type ConfigMap = Record<string, ConfigEntry>;

interface RoutingPreview {
  candidates: string[];
  matchedKey: string | null;
  resolvedVoice: string;
  requestedVoice: string;
  language: string;
  accent: string;
  usedDefault: boolean;
  usedDirectProviderVoice: boolean;
}

const LOGICAL_VOICES = [
  { id: "tongtong", label: "TongTong — warm narrator" },
  { id: "chuichui", label: "ChuiChui — playful / child" },
  { id: "xiaochen", label: "XiaoChen — professional / calm" },
  { id: "jam", label: "Jam — British gentleman" },
  { id: "kazi", label: "Kazi — clear / standard" },
  { id: "douji", label: "DouJi — natural / smooth" },
  { id: "luodo", label: "LuoDo — expressive / engaging" },
] as const;

function parseMap(raw: string): { map: Record<string, string>; error: string | null } {
  const trimmed = raw.trim();
  if (!trimmed) return { map: {}, error: null };
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { map: {}, error: "Voice routing map must be a JSON object." };
    }
    const map: Record<string, string> = {};
    for (const [rawKey, rawValue] of Object.entries(parsed as Record<string, unknown>)) {
      const key = rawKey.trim().toLowerCase();
      if (!key || typeof rawValue !== "string" || !rawValue.trim()) {
        return { map: {}, error: "Every route must map a non-empty key to a non-empty ElevenLabs voice ID." };
      }
      map[key] = rawValue.trim();
    }
    return { map, error: null };
  } catch {
    return { map: {}, error: "Voice routing map is not valid JSON." };
  }
}

function prettyMap(map: Record<string, string>): string {
  return JSON.stringify(map, null, 2);
}

export default function ElevenLabsVoiceRoutingPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [ttsProvider, setTtsProvider] = useState("");
  const [defaultVoiceId, setDefaultVoiceId] = useState("");
  const [mapText, setMapText] = useState("{}");
  const [requestedVoice, setRequestedVoice] = useState("tongtong");
  const [language, setLanguage] = useState("en");
  const [accent, setAccent] = useState("ghanaian");
  const [targetVoiceId, setTargetVoiceId] = useState("");
  const [preview, setPreview] = useState<RoutingPreview | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const parsed = useMemo(() => parseMap(mapText), [mapText]);
  const entryCount = Object.keys(parsed.map).length;

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/config", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || "Failed to load AI provider settings");
      const configs = data.configs as ConfigMap;
      setTtsProvider(configs.ai_tts_provider?.value || "zai");
      setDefaultVoiceId(configs.elevenlabs_default_voice_id?.value || "");
      const existing = configs.elevenlabs_voice_map?.value || "";
      const normalized = parseMap(existing);
      setMapText(normalized.error ? existing : prettyMap(normalized.map));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load voice routing settings");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const runPreview = async () => {
    if (parsed.error) {
      setError(parsed.error);
      return;
    }
    setPreviewing(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/config/voice-routing-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          voiceMap: parsed.map,
          defaultVoiceId,
          requestedVoice,
          language,
          accent,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || "Failed to preview routing");
      setPreview(data.preview as RoutingPreview);
    } catch (cause) {
      setPreview(null);
      setError(cause instanceof Error ? cause.message : "Failed to preview routing");
    } finally {
      setPreviewing(false);
    }
  };

  const addCandidate = (key: string) => {
    if (!targetVoiceId.trim()) {
      setError("Enter the ElevenLabs voice ID you want this route to use first.");
      return;
    }
    const next = { ...parsed.map, [key.toLowerCase()]: targetVoiceId.trim() };
    setMapText(prettyMap(next));
    setMessage(`Added ${key}. Save the map when you are satisfied.`);
    setError("");
  };

  const save = async () => {
    if (parsed.error) {
      setError(parsed.error);
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          configs: {
            elevenlabs_default_voice_id: defaultVoiceId.trim(),
            elevenlabs_voice_map: prettyMap(parsed.map),
          },
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || "Failed to save ElevenLabs voice routing");
      setMapText(prettyMap(parsed.map));
      setMessage("ElevenLabs routing saved. New narration jobs will use this routing table.");
      await runPreview();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to save ElevenLabs voice routing");
    } finally {
      setSaving(false);
    }
  };

  const testSavedRoute = async () => {
    setTesting(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/config/test-voice-route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestedVoice, language, accent }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || "Saved voice route test failed");
      setMessage(
        `Saved route succeeded: ${data.requestedVoice} → ${data.resolvedVoice} · ${data.language}/${data.accent} · ${data.latencyMs} ms · ${data.audioBytes} bytes. No Vidora user tokens were deducted.`
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Saved voice route test failed");
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen grid place-items-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-7 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <Button variant="ghost" size="sm" asChild className="mb-3 -ml-2">
              <Link href="/admin/providers"><ArrowLeft className="mr-2 h-4 w-4" />Back to AI Provider Studio</Link>
            </Button>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-3xl font-bold tracking-tight">ElevenLabs Voice Routing</h1>
              <Badge variant={ttsProvider === "elevenlabs" ? "default" : "outline"}>
                {ttsProvider === "elevenlabs" ? "ElevenLabs active" : `TTS active: ${ttsProvider || "unknown"}`}
              </Badge>
            </div>
            <p className="mt-2 max-w-3xl text-muted-foreground">
              Route Vidora logical voices to accent- and language-trained ElevenLabs voices. The preview below uses the same precedence resolver as production narration.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={runPreview} disabled={previewing || saving || testing || Boolean(parsed.error)}>
              {previewing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Route className="mr-2 h-4 w-4" />}
              Preview route
            </Button>
            <Button variant="outline" onClick={testSavedRoute} disabled={testing || saving || previewing || ttsProvider !== "elevenlabs"}>
              {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FlaskConical className="mr-2 h-4 w-4" />}
              Test saved route
            </Button>
            <Button onClick={save} disabled={saving || testing || previewing || Boolean(parsed.error)}>
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

        <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-5">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Mic2 className="h-5 w-5" />Routing table</CardTitle>
                <CardDescription>
                  More-specific profile keys win before accent, language, logical voice, and the default provider voice.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Default ElevenLabs voice ID</Label>
                  <Input
                    value={defaultVoiceId}
                    onChange={(event) => { setDefaultVoiceId(event.target.value); setPreview(null); }}
                    placeholder="Fallback ElevenLabs voice ID"
                  />
                  <p className="text-xs text-muted-foreground">
                    Used only when no profile/accent/language/logical-voice mapping matches.
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Label>Voice routing map (JSON)</Label>
                    <Badge variant={parsed.error ? "destructive" : "outline"}>
                      {parsed.error ? "Invalid JSON/map" : `${entryCount} route${entryCount === 1 ? "" : "s"}`}
                    </Badge>
                  </div>
                  <Textarea
                    value={mapText}
                    onChange={(event) => { setMapText(event.target.value); setPreview(null); setMessage(""); }}
                    rows={16}
                    className="font-mono text-xs"
                    spellCheck={false}
                    placeholder={'{\n  "profile:en:ghanaian:tongtong": "ELEVENLABS_VOICE_ID",\n  "accent:ghanaian": "GHANAIAN_FALLBACK_VOICE",\n  "language:fr": "FRENCH_FALLBACK_VOICE",\n  "jam": "GENERIC_JAM_VOICE"\n}'}
                  />
                  {parsed.error ? (
                    <p className="text-xs text-destructive">{parsed.error}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Keys are case-insensitive and normalized to lowercase by production routing. Values are exact ElevenLabs voice IDs.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Plus className="h-5 w-5" />Build a route</CardTitle>
                <CardDescription>
                  Define the Vidora profile you want to cover, preview its production candidate order, then add the exact key you want.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label>Logical voice</Label>
                    <Select value={requestedVoice} onValueChange={(value) => { setRequestedVoice(value); setPreview(null); }}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {LOGICAL_VOICES.map((voice) => (
                          <SelectItem key={voice.id} value={voice.id}>{voice.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Language code</Label>
                    <Input value={language} onChange={(event) => { setLanguage(event.target.value); setPreview(null); }} placeholder="en" />
                  </div>
                  <div className="space-y-2">
                    <Label>Accent ID</Label>
                    <Input value={accent} onChange={(event) => { setAccent(event.target.value); setPreview(null); }} placeholder="ghanaian" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Target ElevenLabs voice ID</Label>
                  <Input value={targetVoiceId} onChange={(event) => setTargetVoiceId(event.target.value)} placeholder="Voice ID from ElevenLabs" />
                </div>
                <Button variant="secondary" onClick={runPreview} disabled={previewing || Boolean(parsed.error)}>
                  {previewing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                  Calculate production precedence
                </Button>

                {preview && (
                  <div className="space-y-3 rounded-xl border bg-muted/20 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="text-sm font-semibold">Resolved provider voice</div>
                        <div className="font-mono text-xs text-muted-foreground break-all">{preview.resolvedVoice}</div>
                      </div>
                      <Badge variant={preview.matchedKey ? "default" : "outline"}>
                        {preview.matchedKey ? `Matched ${preview.matchedKey}` : preview.usedDefault ? "Using default voice" : "Direct provider voice"}
                      </Badge>
                    </div>
                    <div className="space-y-2">
                      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Candidate order — first match wins</div>
                      {preview.candidates.map((candidate, index) => (
                        <div key={candidate} className="flex flex-col gap-2 rounded-lg border bg-background/70 p-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline">#{index + 1}</Badge>
                              {candidate === preview.matchedKey && <Badge>Current match</Badge>}
                            </div>
                            <div className="mt-2 break-all font-mono text-xs">{candidate}</div>
                          </div>
                          <Button size="sm" variant="outline" onClick={() => addCandidate(candidate)} disabled={!targetVoiceId.trim()}>
                            <Plus className="mr-2 h-3.5 w-3.5" />Use this key
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-5">
            <Card>
              <CardHeader>
                <CardTitle>How production chooses a voice</CardTitle>
                <CardDescription>Routing is deterministic and ordered from narrowest to broadest.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="rounded-lg border p-3"><code>profile:language:accent:voice</code><p className="mt-1 text-xs text-muted-foreground">Exact language + accent + logical voice.</p></div>
                <div className="rounded-lg border p-3"><code>profile:language:accent</code><p className="mt-1 text-xs text-muted-foreground">One provider voice for that whole language/accent profile.</p></div>
                <div className="rounded-lg border p-3"><code>accent:language:accent</code><p className="mt-1 text-xs text-muted-foreground">Explicit accent binding within a language.</p></div>
                <div className="rounded-lg border p-3"><code>accent:accent</code><p className="mt-1 text-xs text-muted-foreground">Generic accent fallback across languages.</p></div>
                <div className="rounded-lg border p-3"><code>language:language</code><p className="mt-1 text-xs text-muted-foreground">Language-wide fallback voice.</p></div>
                <div className="rounded-lg border p-3"><code>logicalvoice</code><p className="mt-1 text-xs text-muted-foreground">Generic mapping for TongTong, Jam, LuoDo, and other Vidora logical voices.</p></div>
                <div className="rounded-lg border bg-muted/20 p-3"><strong>Default voice ID</strong><p className="mt-1 text-xs text-muted-foreground">Used only after all map candidates fail.</p></div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Ghana-ready example</CardTitle>
                <CardDescription>Example only — replace every value with a real voice ID from your ElevenLabs workspace.</CardDescription>
              </CardHeader>
              <CardContent>
                <pre className="overflow-x-auto rounded-xl border bg-muted/30 p-4 text-xs">{`{
  "profile:en:ghanaian:tongtong": "VOICE_ID_GH_NARRATOR",
  "profile:en:ghanaian:chuichui": "VOICE_ID_GH_CHILD",
  "accent:ghanaian": "VOICE_ID_GH_FALLBACK",
  "language:fr": "VOICE_ID_FR_FALLBACK",
  "jam": "VOICE_ID_GENERIC_JAM"
}`}</pre>
                <p className="mt-3 text-xs text-muted-foreground">
                  A project saved as English + Ghanaian + TongTong will try the exact profile key first. A scene override can still select another logical voice without changing the project default.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Probe behavior</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                <p><strong className="text-foreground">Preview route</strong> does not call ElevenLabs; it only resolves the routing table with production precedence.</p>
                <p><strong className="text-foreground">Test saved route</strong> synthesizes a short phrase through the currently saved ElevenLabs configuration. It does not deduct Vidora user tokens, although ElevenLabs may count the request against the provider account.</p>
                {ttsProvider !== "elevenlabs" && (
                  <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-amber-700 dark:text-amber-300">
                    ElevenLabs is not currently the active TTS provider. You can build and preview the map now, but activate ElevenLabs in AI Provider Studio before running a live probe.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </main>
  );
}
