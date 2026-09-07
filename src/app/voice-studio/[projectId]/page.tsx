"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { AudioLines, CheckCircle2, Film, Info, Loader2, Mic2, RefreshCw, Users, Volume2 } from "lucide-react";
import { NarrationProfileControls } from "@/components/NarrationProfileControls";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  buildVoiceStudioNarrationRequest,
  voiceStudioNarrationSuccessMessage,
} from "@/lib/voice-studio-audition";

type Profile = {
  language: string;
  accent: string;
  style: string;
  voice: string;
};

type Voice = { id: string; label: string; desc?: string };
type Character = {
  id: string;
  name: string;
  role: string | null;
  voiceId: string | null;
  imageUrl: string | null;
};
type Scene = {
  id: string;
  sceneNumber: number;
  title: string | null;
  narrationUrl: string | null;
  subtitleLang: string | null;
  burnSubtitles: boolean;
  profile: Profile;
};
type MixedState = { language: boolean; accent: boolean; style: boolean; voice: boolean };
type Payload = {
  success: true;
  project: { id: string; title: string };
  canEdit: boolean;
  bulkProfile: Profile;
  mixed: MixedState;
  voices: Voice[];
  characters: Character[];
  scenes: Scene[];
};

function profileChangedLabel(mixed: MixedState): string {
  const fields = Object.entries(mixed)
    .filter(([, value]) => value)
    .map(([key]) => key);
  if (fields.length === 0) return "All scenes currently use the same narration profile.";
  return `Scenes currently have mixed ${fields.join(", ")} settings. Applying the profile below will make them consistent.`;
}

function mixedStateForScenes(scenes: Scene[]): MixedState {
  if (scenes.length === 0) {
    return { language: false, accent: false, style: false, voice: false };
  }
  const first = scenes[0].profile;
  return {
    language: scenes.some((scene) => scene.profile.language !== first.language),
    accent: scenes.some((scene) => scene.profile.accent !== first.accent),
    style: scenes.some((scene) => scene.profile.style !== first.style),
    voice: scenes.some((scene) => scene.profile.voice !== first.voice),
  };
}

function patchScenePayload(
  current: Payload | null,
  sceneId: string,
  patch: (scene: Scene) => Scene,
): Payload | null {
  if (!current) return current;
  const scenes = current.scenes.map((scene) => scene.id === sceneId ? patch(scene) : scene);
  return { ...current, scenes, mixed: mixedStateForScenes(scenes) };
}

export default function VoiceStudioProjectPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;
  const [data, setData] = useState<Payload | null>(null);
  const [bulkProfile, setBulkProfile] = useState<Profile | null>(null);
  const [sceneProfiles, setSceneProfiles] = useState<Record<string, Profile>>({});
  const [characterVoices, setCharacterVoices] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/voice-studio`, { cache: "no-store" });
    const body = await response.json();
    if (!response.ok || !body.success) throw new Error(body.error || "Unable to load Voice Studio");
    const payload = body as Payload;
    setData(payload);
    setBulkProfile(payload.bulkProfile);
    setSceneProfiles(Object.fromEntries(payload.scenes.map((scene) => [scene.id, scene.profile])));
    setCharacterVoices(Object.fromEntries(payload.characters.map((character) => [character.id, character.voiceId || "inherit"])));
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    setError("");
    load().catch((reason) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : "Unable to load Voice Studio");
    });
    return () => { cancelled = true; };
  }, [load]);

  const saveProfile = async (scope: "project" | "scene", profile: Profile, scopeId?: string) => {
    const key = scope === "project" ? "project" : `scene:${scopeId}`;
    setBusyKey(key);
    setMessage("");
    setError("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/voice-studio`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, scopeId, profile }),
      });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || "Unable to save narration profile");
      if (scope === "project") {
        setMessage(body.changed
          ? `Applied the narration profile to ${body.changedSceneCount} scene${body.changedSceneCount === 1 ? "" : "s"}. A fresh full-video preview is required before export.`
          : "Every scene already uses this narration profile.");
        await load();
      } else {
        setMessage(body.changed
          ? "Scene voice profile saved. Its stale narration was cleared and the project must be previewed again before export."
          : "This scene already uses that voice profile.");
        if (scopeId) {
          const savedProfile = (body.profile || profile) as Profile;
          setSceneProfiles((current) => ({ ...current, [scopeId]: savedProfile }));
          setData((current) => patchScenePayload(current, scopeId, (scene) => ({
            ...scene,
            profile: savedProfile,
            narrationUrl: body.changed ? null : scene.narrationUrl,
            burnSubtitles: body.staleBurnedSubtitlesDisabled ? false : scene.burnSubtitles,
          })));
        }
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save narration profile");
    } finally {
      setBusyKey("");
    }
  };

  const saveCharacterVoice = async (characterId: string) => {
    const key = `character:${characterId}`;
    setBusyKey(key);
    setMessage("");
    setError("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/voice-studio`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "character", scopeId: characterId, voice: characterVoices[characterId] || "inherit" }),
      });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || "Unable to save character voice");
      setMessage(body.changed
        ? `Character voice saved. ${body.narrationInvalidatedScenes || 0} linked scene narration track${body.narrationInvalidatedScenes === 1 ? " was" : "s were"} invalidated.`
        : "This character already uses that voice setting.");

      const persistedVoice = typeof body.voiceId === "string" && body.voiceId ? body.voiceId : "inherit";
      const affectedSceneIds = new Set<string>(
        Array.isArray(body.affectedSceneIds)
          ? body.affectedSceneIds.filter((id: unknown): id is string => typeof id === "string")
          : [],
      );
      setCharacterVoices((current) => ({ ...current, [characterId]: persistedVoice }));
      setData((current) => current ? {
        ...current,
        characters: current.characters.map((character) => character.id === characterId
          ? { ...character, voiceId: persistedVoice === "inherit" ? null : persistedVoice }
          : character),
        scenes: current.scenes.map((scene) => affectedSceneIds.has(scene.id)
          ? { ...scene, narrationUrl: null }
          : scene),
      } : current);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save character voice");
    } finally {
      setBusyKey("");
    }
  };

  const generateNarration = async (sceneId: string, profile: Profile) => {
    const key = `narration:${sceneId}`;
    setBusyKey(key);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/generate-narration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildVoiceStudioNarrationRequest({
          projectId,
          sceneId,
          profile,
        })),
      });
      const body = await response.json();
      if (!response.ok || !body.success) {
        throw new Error(body.error || "Unable to generate scene narration");
      }
      setMessage(voiceStudioNarrationSuccessMessage(body));
      const persistedProfile: Profile = {
        language: typeof body.language === "string" ? body.language : profile.language,
        accent: typeof body.accent === "string" ? body.accent : profile.accent,
        style: typeof body.style === "string" ? body.style : profile.style,
        voice: typeof body.voice === "string" ? body.voice : profile.voice,
      };
      setSceneProfiles((current) => ({ ...current, [sceneId]: persistedProfile }));
      setData((current) => patchScenePayload(current, sceneId, (scene) => ({
        ...scene,
        profile: persistedProfile,
        narrationUrl: typeof body.narrationUrl === "string" ? body.narrationUrl : scene.narrationUrl,
      })));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to generate scene narration");
    } finally {
      setBusyKey("");
    }
  };

  const title = useMemo(() => data?.project.title || "Voice Studio", [data]);

  if (!data) {
    return (
      <main className="min-h-screen bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-slate-50">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
          <Link href="/voice-studio" className="text-sm font-medium text-violet-700 dark:text-violet-300">← Voice Studio projects</Link>
          <div className="mt-10 rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
            {error || "Loading project voice settings…"}
          </div>
        </div>
      </main>
    );
  }

  const disabled = !data.canEdit;

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-slate-50">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm font-medium">
              <Link href="/voice-studio" className="text-violet-700 hover:text-violet-600 dark:text-violet-300">← Voice Studio projects</Link>
              <Link href="/" className="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">Back to Vidora Studio</Link>
            </div>
            <div className="mt-6 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-600 text-white"><AudioLines className="h-5 w-5" /></div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-700 dark:text-violet-300">Voice Studio</p>
                <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
              </div>
            </div>
            <p className="mt-4 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-400">
              These controls write directly to the narration fields used by Vidora Full Preview and Export. Language changes are translated when narration is prepared; accent and speaking-style precision depend on the active TTS provider.
            </p>
          </div>
          <button
            type="button"
            onClick={() => load().catch((reason) => setError(reason instanceof Error ? reason.message : "Refresh failed"))}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold shadow-sm hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800"
          >
            <RefreshCw className="h-4 w-4" />Refresh
          </button>
        </div>

        {!data.canEdit ? (
          <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            You have read-only access to this project. Only its owner can change voice settings.
          </div>
        ) : null}
        {message ? (
          <div className="mt-6 flex items-start gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{message}
          </div>
        ) : null}
        {error ? (
          <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{error}</div>
        ) : null}

        <section className="mt-8 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2"><Film className="h-5 w-5 text-violet-600" /><h2 className="text-lg font-semibold">Entire video</h2></div>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Apply one narration profile across all existing scenes, then override any scene below.</p>
            </div>
            <button
              type="button"
              onClick={() => bulkProfile && saveProfile("project", bulkProfile)}
              disabled={disabled || !bulkProfile || busyKey === "project"}
              className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busyKey === "project" ? "Applying…" : "Apply to entire video"}
            </button>
          </div>
          <div className="mt-4 flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-xs leading-5 text-slate-600 dark:bg-slate-950 dark:text-slate-400">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />{profileChangedLabel(data.mixed)}
          </div>
          {bulkProfile ? (
            <div className="mt-5">
              <NarrationProfileControls
                language={bulkProfile.language}
                accent={bulkProfile.accent}
                style={bulkProfile.style}
                voice={bulkProfile.voice}
                voices={data.voices}
                onLanguageChange={(language) => setBulkProfile((current) => current ? { ...current, language } : current)}
                onAccentChange={(accent) => setBulkProfile((current) => current ? { ...current, accent } : current)}
                onStyleChange={(style) => setBulkProfile((current) => current ? { ...current, style } : current)}
                onVoiceChange={(voice) => setBulkProfile((current) => current ? { ...current, voice } : current)}
                disabled={disabled || busyKey === "project"}
              />
            </div>
          ) : null}
        </section>

        <section className="mt-8">
          <div className="flex items-center gap-2"><Users className="h-5 w-5 text-violet-600" /><h2 className="text-xl font-semibold">Character voices</h2></div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Attributed dialogue uses a character's assigned voice. “Use scene voice” falls back to the scene profile.</p>
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {data.characters.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">No characters are attached to this project.</div>
            ) : data.characters.map((character) => {
              const key = `character:${character.id}`;
              return (
                <article key={character.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <div className="flex items-center gap-3">
                    {character.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={character.imageUrl} alt="" className="h-10 w-10 rounded-full border border-slate-200 object-cover dark:border-slate-700" />
                    ) : (
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300"><Mic2 className="h-4 w-4" /></div>
                    )}
                    <div className="min-w-0"><h3 className="truncate font-semibold">{character.name}</h3><p className="truncate text-xs text-slate-500 dark:text-slate-400">{character.role || "Character"}</p></div>
                  </div>
                  <div className="mt-4">
                    <Select
                      value={characterVoices[character.id] || "inherit"}
                      onValueChange={(voice) => setCharacterVoices((current) => ({ ...current, [character.id]: voice }))}
                      disabled={disabled || busyKey === key}
                    >
                      <SelectTrigger aria-label={`Voice for ${character.name}`}><SelectValue placeholder="Character voice" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="inherit">Use scene voice</SelectItem>
                        {data.voices.map((voice) => <SelectItem key={voice.id} value={voice.id}>{voice.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <button
                    type="button"
                    onClick={() => saveCharacterVoice(character.id)}
                    disabled={disabled || busyKey === key}
                    className="mt-4 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
                  >
                    {busyKey === key ? "Saving…" : "Save character voice"}
                  </button>
                </article>
              );
            })}
          </div>
        </section>

        <section className="mt-10 pb-12">
          <div className="flex items-center gap-2"><Film className="h-5 w-5 text-violet-600" /><h2 className="text-xl font-semibold">Scene overrides &amp; auditions</h2></div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Fine-tune a scene without changing the visual clip. Save clears stale narration; Generate &amp; listen uses the selected profile through Vidora's normal narration pipeline and may use narration tokens.</p>
          <div className="mt-4 space-y-4">
            {data.scenes.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">This project does not have scenes yet.</div>
            ) : data.scenes.map((scene) => {
              const profile = sceneProfiles[scene.id] || scene.profile;
              const key = `scene:${scene.id}`;
              const narrationKey = `narration:${scene.id}`;
              const sceneBusy = busyKey === key || busyKey === narrationKey;
              return (
                <article key={scene.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-6">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold">Scene {scene.sceneNumber}{scene.title ? ` — ${scene.title}` : ""}</h3>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {scene.narrationUrl ? "Narration exists — changing this profile will invalidate it." : "Narration can be generated and auditioned from this profile."}
                        {scene.burnSubtitles && scene.subtitleLang ? ` Burned subtitles: ${scene.subtitleLang}.` : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => saveProfile("scene", profile, scene.id)}
                        disabled={disabled || sceneBusy}
                        className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
                      >
                        {busyKey === key ? "Saving…" : "Save scene"}
                      </button>
                      <button
                        type="button"
                        onClick={() => generateNarration(scene.id, profile)}
                        disabled={disabled || sceneBusy}
                        className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {busyKey === narrationKey ? (
                          <><Loader2 className="h-4 w-4 animate-spin" />Generating…</>
                        ) : (
                          <><Volume2 className="h-4 w-4" />{scene.narrationUrl ? "Regenerate & listen" : "Generate & listen"}</>
                        )}
                      </button>
                    </div>
                  </div>
                  <div className="mt-5">
                    <NarrationProfileControls
                      language={profile.language}
                      accent={profile.accent}
                      style={profile.style}
                      voice={profile.voice}
                      voices={data.voices}
                      onLanguageChange={(language) => setSceneProfiles((current) => ({ ...current, [scene.id]: { ...profile, language } }))}
                      onAccentChange={(accent) => setSceneProfiles((current) => ({ ...current, [scene.id]: { ...profile, accent } }))}
                      onStyleChange={(style) => setSceneProfiles((current) => ({ ...current, [scene.id]: { ...profile, style } }))}
                      onVoiceChange={(voice) => setSceneProfiles((current) => ({ ...current, [scene.id]: { ...profile, voice } }))}
                      disabled={disabled || sceneBusy}
                    />
                  </div>
                  {scene.narrationUrl ? (
                    <div className="mt-5 rounded-2xl border border-violet-100 bg-violet-50/60 p-4 dark:border-violet-900 dark:bg-violet-950/30">
                      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-violet-800 dark:text-violet-200">
                        <Volume2 className="h-4 w-4" />Current narration audition
                      </div>
                      <audio
                        controls
                        preload="metadata"
                        src={scene.narrationUrl}
                        className="w-full"
                        aria-label={`Narration for scene ${scene.sceneNumber}`}
                      />
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}