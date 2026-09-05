"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

type Option = { id: string; label: string; description?: string };
type Profile = { language: string; accent: string; voice: string; style: string; speed: number };
type Character = { id: string; name: string; role: string | null; voiceId: string | null };
type Scene = { id: string; sceneNumber: number; title: string | null; narrationLang: string | null; narrationVoice: string | null };
type Catalog = { languages: Option[]; accents: Option[]; voices: Option[]; styles: Option[] };
type Payload = {
  project: { id: string; title: string };
  projectProfile: Profile | null;
  characters: Character[];
  characterProfiles: Record<string, Profile | null>;
  scenes: Scene[];
  sceneProfiles: Record<string, Profile | null>;
  catalog: Catalog;
  capabilities: { language: string; accent: string };
};

const DEFAULT_PROFILE: Profile = { language: "auto", accent: "auto", voice: "auto", style: "natural", speed: 1 };
const INHERIT_PROFILE: Profile = { language: "auto", accent: "auto", voice: "auto", style: "auto", speed: 0 };

function ProfileEditor({
  profile,
  catalog,
  inherit,
  onChange,
}: {
  profile: Profile;
  catalog: Catalog;
  inherit: boolean;
  onChange: (profile: Profile) => void;
}) {
  const field = (key: keyof Profile, value: string | number) => onChange({ ...profile, [key]: value });
  const speedOptions = inherit
    ? [{ id: "0", label: "Inherit" }, { id: "0.85", label: "0.85×" }, { id: "0.9", label: "0.90×" }, { id: "0.95", label: "0.95×" }, { id: "1", label: "1.00×" }, { id: "1.05", label: "1.05×" }, { id: "1.1", label: "1.10×" }, { id: "1.2", label: "1.20×" }]
    : [{ id: "0.85", label: "0.85×" }, { id: "0.9", label: "0.90×" }, { id: "0.95", label: "0.95×" }, { id: "1", label: "1.00×" }, { id: "1.05", label: "1.05×" }, { id: "1.1", label: "1.10×" }, { id: "1.2", label: "1.20×" }];

  const selectClass = "w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none transition focus:border-violet-400/70";
  const labelClass = "mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400";

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
      <label><span className={labelClass}>Language</span><select className={selectClass} value={profile.language} onChange={(e) => field("language", e.target.value)}>{catalog.languages.map((o) => <option className="bg-zinc-950" key={o.id} value={o.id}>{inherit && o.id === "auto" ? "Inherit / Auto" : o.label}</option>)}</select></label>
      <label><span className={labelClass}>Accent</span><select className={selectClass} value={profile.accent} onChange={(e) => field("accent", e.target.value)}>{catalog.accents.map((o) => <option className="bg-zinc-950" key={o.id} value={o.id}>{inherit && o.id === "auto" ? "Inherit" : o.label}</option>)}</select></label>
      <label><span className={labelClass}>Voice</span><select className={selectClass} value={profile.voice} onChange={(e) => field("voice", e.target.value)}>{catalog.voices.map((o) => <option className="bg-zinc-950" key={o.id} value={o.id}>{inherit && o.id === "auto" ? "Inherit" : o.label}</option>)}</select></label>
      <label><span className={labelClass}>Speaking style</span><select className={selectClass} value={profile.style} onChange={(e) => field("style", e.target.value)}>{catalog.styles.map((o) => <option className="bg-zinc-950" key={o.id} value={o.id}>{inherit && o.id === "auto" ? "Inherit" : o.label}</option>)}</select></label>
      <label><span className={labelClass}>Speed</span><select className={selectClass} value={String(profile.speed)} onChange={(e) => field("speed", Number(e.target.value))}>{speedOptions.map((o) => <option className="bg-zinc-950" key={o.id} value={o.id}>{o.label}</option>)}</select></label>
    </div>
  );
}

export default function VoiceStudioPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;
  const [data, setData] = useState<Payload | null>(null);
  const [projectProfile, setProjectProfile] = useState<Profile>(DEFAULT_PROFILE);
  const [characterProfiles, setCharacterProfiles] = useState<Record<string, Profile>>({});
  const [sceneProfiles, setSceneProfiles] = useState<Record<string, Profile>>({});
  const [busyKey, setBusyKey] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/voice-profile`, { cache: "no-store" });
    const body = await response.json();
    if (!response.ok || !body.success) throw new Error(body.error || "Unable to load Voice Studio");
    const payload = body as Payload & { success: true };
    setData(payload);
    setProjectProfile(payload.projectProfile || DEFAULT_PROFILE);
    setCharacterProfiles(Object.fromEntries(payload.characters.map((character) => [character.id, payload.characterProfiles[character.id] || INHERIT_PROFILE])));
    setSceneProfiles(Object.fromEntries(payload.scenes.map((scene) => [scene.id, payload.sceneProfiles[scene.id] || INHERIT_PROFILE])));
  }, [projectId]);

  useEffect(() => { load().catch((error) => setMessage(error instanceof Error ? error.message : "Unable to load Voice Studio")); }, [load]);

  const save = async (scope: "project" | "character" | "scene", profile: Profile, scopeId?: string) => {
    const key = `${scope}:${scopeId || projectId}`;
    setBusyKey(key);
    setMessage("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/voice-profile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, scopeId, profile }),
      });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || "Unable to save voice profile");
      setMessage("Voice profile saved. Existing narration for affected scenes was invalidated so the next preview/export uses the new voice settings.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save voice profile");
    } finally {
      setBusyKey("");
    }
  };

  const title = useMemo(() => data?.project.title || "Voice Studio", [data]);

  if (!data) {
    return <main className="min-h-screen bg-[#08080c] p-8 text-white"><div className="mx-auto max-w-6xl"><Link href="/" className="text-sm text-violet-300">← Back to Vidora</Link><p className="mt-10 text-zinc-400">{message || "Loading Voice Studio…"}</p></div></main>;
  }

  return (
    <main className="min-h-screen bg-[#08080c] text-white">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div><Link href="/" className="text-sm text-violet-300 hover:text-violet-200">← Back to Vidora</Link><p className="mt-5 text-xs font-semibold uppercase tracking-[0.22em] text-violet-300">Vidora Voice Studio</p><h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1><p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-400">Control narration language, accent, voice personality and delivery. Project settings are defaults; character and scene settings can inherit or override them.</p></div>
          <div className="rounded-2xl border border-violet-400/20 bg-violet-400/5 px-4 py-3 text-xs leading-5 text-zinc-300"><strong className="text-violet-200">Provider-aware</strong><br/>Language is enforced when supported. Accent precision comes from an accent-trained provider voice.</div>
        </div>

        {message && <div className="mb-6 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-zinc-200">{message}</div>}

        <section className="rounded-3xl border border-white/10 bg-white/[0.035] p-5 sm:p-6">
          <div className="mb-5 flex items-center justify-between gap-4"><div><h2 className="text-lg font-semibold">Project narration defaults</h2><p className="mt-1 text-sm text-zinc-500">Used by narrator lines and inherited by characters/scenes.</p></div><button onClick={() => save("project", projectProfile)} disabled={busyKey === `project:${projectId}`} className="rounded-xl bg-violet-500 px-4 py-2 text-sm font-semibold hover:bg-violet-400 disabled:opacity-50">{busyKey === `project:${projectId}` ? "Saving…" : "Save defaults"}</button></div>
          <ProfileEditor profile={projectProfile} catalog={data.catalog} inherit={false} onChange={setProjectProfile} />
        </section>

        <section className="mt-8">
          <div className="mb-4"><h2 className="text-xl font-semibold">Character voices</h2><p className="mt-1 text-sm text-zinc-500">Give each speaker a stable voice, accent and performance style. Existing character voice IDs remain compatible.</p></div>
          <div className="space-y-4">{data.characters.length === 0 ? <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-sm text-zinc-500">No characters have been created for this project yet.</div> : data.characters.map((character) => {
            const profile = characterProfiles[character.id] || INHERIT_PROFILE;
            const key = `character:${character.id}`;
            return <article key={character.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-medium">{character.name}</h3><p className="text-xs text-zinc-500">{character.role || "Character"}{character.voiceId ? ` · Existing voice: ${character.voiceId}` : " · Inherits narrator voice"}</p></div><button onClick={() => save("character", profile, character.id)} disabled={busyKey === key} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold hover:bg-white/10 disabled:opacity-50">{busyKey === key ? "Saving…" : "Save character"}</button></div><ProfileEditor profile={profile} catalog={data.catalog} inherit onChange={(next) => setCharacterProfiles((current) => ({ ...current, [character.id]: next }))} /></article>;
          })}</div>
        </section>

        <section className="mt-8 pb-12">
          <div className="mb-4"><h2 className="text-xl font-semibold">Scene overrides</h2><p className="mt-1 text-sm text-zinc-500">Useful for multilingual scenes, localised segments, interviews, news inserts or a deliberate change in delivery.</p></div>
          <div className="space-y-4">{data.scenes.map((scene) => {
            const profile = sceneProfiles[scene.id] || INHERIT_PROFILE;
            const key = `scene:${scene.id}`;
            return <article key={scene.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-medium">Scene {scene.sceneNumber}{scene.title ? ` — ${scene.title}` : ""}</h3>{(scene.narrationLang || scene.narrationVoice) && <p className="text-xs text-amber-300/80">Legacy settings: {scene.narrationLang || "auto"} · {scene.narrationVoice || "auto"}</p>}</div><button onClick={() => save("scene", profile, scene.id)} disabled={busyKey === key} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold hover:bg-white/10 disabled:opacity-50">{busyKey === key ? "Saving…" : "Save scene"}</button></div><ProfileEditor profile={profile} catalog={data.catalog} inherit onChange={(next) => setSceneProfiles((current) => ({ ...current, [scene.id]: next }))} /></article>;
          })}</div>
        </section>
      </div>
    </main>
  );
}
