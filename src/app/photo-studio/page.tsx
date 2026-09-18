"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  Clapperboard,
  Film,
  ImagePlus,
  Loader2,
  ShieldCheck,
  Sparkles,
  Upload,
  UserRound,
  Users,
  WandSparkles,
} from "lucide-react";

type MediaAsset = {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
  createdAt: string;
};

type CharacterProfile = {
  id: string;
  name: string;
  role?: string | null;
  consentStatus: string;
  performanceProfile: string;
  primaryAsset?: MediaAsset | null;
};

type ProjectResult = {
  projectId: string;
  sceneCount: number;
  mode: string;
  message: string;
  dashboardUrl: string;
};

type SlideshowRenderState = {
  jobId: string;
  status: string;
  progress: number;
  step: string;
  message?: string | null;
  error?: string | null;
};

const modeOptions = [
  {
    id: "animate",
    title: "Living Photos",
    subtitle: "Turn stills into cinematic moving shots",
    description: "Build reference-backed scenes that preserve each source photo, then use Vidora's existing generation flow for natural motion.",
    icon: WandSparkles,
  },
  {
    id: "slideshow",
    title: "Cinematic Slideshow",
    subtitle: "Subtle depth, parallax and documentary movement",
    description: "Create an editable photo-story sequence designed for restrained motion rather than aggressive visual changes.",
    icon: Film,
  },
] as const;

export default function PhotoStudioPage() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [profiles, setProfiles] = useState<CharacterProfile[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [renderingSlideshow, setRenderingSlideshow] = useState(false);
  const [slideshowRender, setSlideshowRender] = useState<SlideshowRenderState | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ProjectResult | null>(null);

  const [mode, setMode] = useState<"animate" | "slideshow">("animate");
  const [title, setTitle] = useState("My Photo Story");
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [secondsPerPhoto, setSecondsPerPhoto] = useState(6);
  const [transition, setTransition] = useState("fade");
  const [characterProfileId, setCharacterProfileId] = useState("");

  const [primaryAssetId, setPrimaryAssetId] = useState("");
  const [characterName, setCharacterName] = useState("");
  const [characterRole, setCharacterRole] = useState("primary");
  const [emotion, setEmotion] = useState("natural");
  const [gestureIntensity, setGestureIntensity] = useState("medium");
  const [eyeContact, setEyeContact] = useState("camera");
  const [bodyMotion, setBodyMotion] = useState("natural");
  const [actingStyle, setActingStyle] = useState("cinematic naturalism");
  const [consentConfirmed, setConsentConfirmed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [assetRes, profileRes] = await Promise.all([
        fetch("/api/photo-studio/assets", { cache: "no-store" }),
        fetch("/api/photo-studio/characters", { cache: "no-store" }),
      ]);
      const [assetBody, profileBody] = await Promise.all([assetRes.json(), profileRes.json()]);
      if (!assetRes.ok) throw new Error(assetBody.error || "Unable to load Photo Studio");
      if (!profileRes.ok) throw new Error(profileBody.error || "Unable to load Character Forge");
      setAssets(Array.isArray(assetBody.assets) ? assetBody.assets : []);
      setProfiles(Array.isArray(profileBody.profiles) ? profileBody.profiles : []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load Photo Studio");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleAsset = (id: string) => {
    setSelected((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      if (current.length >= 12) return current;
      return [...current, id];
    });
  };

  const uploadFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    setError("");
    try {
      const form = new FormData();
      Array.from(files).slice(0, 20).forEach((file) => form.append("images", file));
      const response = await fetch("/api/photo-studio/assets", { method: "POST", body: form });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || "Upload failed");
      const uploaded = Array.isArray(body.assets) ? body.assets as MediaAsset[] : [];
      setAssets((current) => {
        const map = new Map(current.map((asset) => [asset.id, asset]));
        uploaded.forEach((asset) => map.set(asset.id, asset));
        return [...map.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      });
      setSelected((current) => [...new Set([...current, ...uploaded.map((asset) => asset.id)])].slice(0, 12));
      if (!primaryAssetId && uploaded[0]) setPrimaryAssetId(uploaded[0].id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const saveCharacterProfile = async () => {
    if (!primaryAssetId || !characterName.trim()) return;
    setSavingProfile(true);
    setError("");
    try {
      const response = await fetch("/api/photo-studio/characters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: characterName,
          role: characterRole,
          primaryAssetId,
          referenceAssetIds: [primaryAssetId],
          consentConfirmed,
          performanceProfile: { emotion, gestureIntensity, eyeContact, bodyMotion, actingStyle },
        }),
      });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || "Unable to save character");
      setProfiles((current) => [body.profile as CharacterProfile, ...current]);
      setCharacterProfileId(body.profile.id);
      setCharacterName("");
      setConsentConfirmed(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save character");
    } finally {
      setSavingProfile(false);
    }
  };

  const createProject = async () => {
    if (!selected.length) return;
    setCreating(true);
    setError("");
    setResult(null);
    setSlideshowRender(null);
    try {
      const response = await fetch("/api/photo-studio/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          mode,
          assetIds: selected,
          aspectRatio,
          secondsPerPhoto,
          transition,
          characterProfileId: characterProfileId || null,
        }),
      });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || "Unable to create project");
      setResult(body as ProjectResult);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to create project");
    } finally {
      setCreating(false);
    }
  };

  const renderSlideshowLocally = async () => {
    if (!result || result.mode !== "slideshow") return;
    setRenderingSlideshow(true);
    setError("");
    try {
      const response = await fetch("/api/photo-studio/slideshow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: result.projectId }),
      });
      const body = await response.json();
      if (!response.ok || !body.success || !body.jobId) {
        throw new Error(body.error || "Unable to start local slideshow render");
      }

      const jobId = String(body.jobId);
      setSlideshowRender({
        jobId,
        status: body.status || "queued",
        progress: Number(body.progress || 0),
        step: body.step || "Queued local slideshow render",
      });

      for (let attempt = 0; attempt < 400; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 1_500));
        const statusResponse = await fetch(
          `/api/export-video?jobId=${encodeURIComponent(jobId)}`,
          { cache: "no-store" },
        );
        const statusBody = await statusResponse.json();
        if (!statusResponse.ok || !statusBody.success) {
          throw new Error(statusBody.error || "Unable to read slideshow render progress");
        }
        const job = statusBody.job as SlideshowRenderState | null;
        if (!job) throw new Error("Local slideshow render job disappeared");
        setSlideshowRender(job);
        if (job.status === "done") return;
        if (job.status === "failed") {
          throw new Error(job.error || job.message || "Local slideshow render failed");
        }
      }

      throw new Error("Local slideshow render is taking longer than expected. You can return to Vidora and check it again.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Local slideshow render failed");
    } finally {
      setRenderingSlideshow(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="border-b border-white/10 bg-[radial-gradient(circle_at_top_left,_rgba(124,58,237,.24),_transparent_42%),radial-gradient(circle_at_top_right,_rgba(6,182,212,.16),_transparent_36%)]">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Link href="/" className="text-sm font-semibold text-violet-300 hover:text-violet-200">← Back to Vidora</Link>
            <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-200">
              Uploads & local slideshow rendering use no AI credits
            </span>
          </div>

          <div className="grid gap-8 py-12 lg:grid-cols-[1.15fr_.85fr] lg:items-center">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.28em] text-violet-300">Vidora Photo & Character Studio</p>
              <h1 className="mt-4 max-w-4xl text-4xl font-black tracking-tight sm:text-5xl">
                Turn your photos into <span className="bg-gradient-to-r from-violet-300 via-fuchsia-300 to-cyan-300 bg-clip-text text-transparent">living stories and reusable digital characters.</span>
              </h1>
              <p className="mt-5 max-w-3xl text-base leading-7 text-slate-300">
                Upload a photo set once, organize it in your private Vidora media library, build reference-backed video scenes, and preserve a person's identity across projects with consent-aware Character Forge profiles.
              </p>
              <div className="mt-7 flex flex-wrap gap-3 text-sm text-slate-300">
                {["Persistent media library", "Reference-backed scenes", "Reusable characters", "Consent records", "Existing Vidora billing & export"].map((item) => (
                  <span key={item} className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2">
                    <Check className="h-4 w-4 text-emerald-300" />{item}
                  </span>
                ))}
              </div>
            </div>
            <div className="rounded-3xl border border-white/10 bg-white/[0.06] p-5 shadow-2xl shadow-violet-950/30 backdrop-blur">
              <div className="grid grid-cols-2 gap-3">
                {[
                  ["Photos", "Upload once, reuse everywhere", ImagePlus],
                  ["Characters", "Identity + voice + performance", UserRound],
                  ["Stories", "Photo sets become editable scenes", Clapperboard],
                  ["Motion", "Local or AI motion", Sparkles],
                ].map(([label, copy, Icon]) => {
                  const IconComponent = Icon as typeof ImagePlus;
                  return (
                    <div key={label as string} className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
                      <IconComponent className="h-5 w-5 text-violet-300" />
                      <p className="mt-3 font-semibold">{label as string}</p>
                      <p className="mt-1 text-xs leading-5 text-slate-400">{copy as string}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl space-y-8 px-4 py-10 sm:px-6 lg:px-8">
        {error ? <div className="rounded-2xl border border-red-400/20 bg-red-500/10 p-4 text-sm text-red-200">{error}</div> : null}

        <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 sm:p-7">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-cyan-300">1 · Media Library</p>
              <h2 className="mt-2 text-2xl font-bold">Upload your source photos</h2>
              <p className="mt-2 text-sm text-slate-400">PNG, JPEG or WebP · 15 MB each · up to 20 per upload · select up to 12 for one short-form project.</p>
            </div>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-slate-950 transition hover:bg-slate-200 disabled:opacity-60"
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {uploading ? "Uploading…" : "Upload photos"}
            </button>
            <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(event) => void uploadFiles(event.target.files)} />
          </div>

          {loading ? (
            <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-8 text-center text-sm text-slate-400">Loading your Photo Studio…</div>
          ) : assets.length === 0 ? (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="mt-6 flex min-h-48 w-full flex-col items-center justify-center rounded-2xl border border-dashed border-violet-400/30 bg-violet-500/5 p-8 text-center hover:bg-violet-500/10"
            >
              <ImagePlus className="h-8 w-8 text-violet-300" />
              <span className="mt-3 font-semibold">Start your visual library</span>
              <span className="mt-1 text-sm text-slate-400">Upload portraits, product shots, family photos, artwork or campaign images.</span>
            </button>
          ) : (
            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {assets.map((asset) => {
                const active = selected.includes(asset.id);
                return (
                  <button
                    type="button"
                    key={asset.id}
                    onClick={() => toggleAsset(asset.id)}
                    className={`group relative overflow-hidden rounded-2xl border text-left transition ${active ? "border-violet-400 ring-2 ring-violet-400/30" : "border-white/10 hover:border-white/25"}`}
                  >
                      <img src={asset.url} alt={asset.originalName} className="aspect-square w-full object-cover transition duration-300 group-hover:scale-[1.03]" />
                    <span className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full border border-white/20 bg-slate-950/80">
                      {active ? <Check className="h-4 w-4 text-emerald-300" /> : <span className="text-[10px] text-white/60">+</span>}
                    </span>
                    <span className="block truncate bg-slate-950/90 px-2.5 py-2 text-[11px] text-slate-300">{asset.originalName}</span>
                  </button>
                );
              })}
            </div>
          )}
          <p className="mt-4 text-xs text-slate-500">{selected.length}/12 selected</p>
        </section>

        <section className="grid gap-8 lg:grid-cols-[1fr_.9fr]">
          <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 sm:p-7">
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-violet-300">2 · Direct the photo story</p>
            <h2 className="mt-2 text-2xl font-bold">Choose how Vidora should treat the images</h2>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {modeOptions.map((option) => {
                const Icon = option.icon;
                const active = mode === option.id;
                return (
                  <button
                    type="button"
                    key={option.id}
                    onClick={() => setMode(option.id)}
                    className={`rounded-2xl border p-4 text-left transition ${active ? "border-violet-400 bg-violet-500/10" : "border-white/10 bg-white/[0.03] hover:border-white/25"}`}
                  >
                    <Icon className={`h-5 w-5 ${active ? "text-violet-300" : "text-slate-400"}`} />
                    <p className="mt-3 font-bold">{option.title}</p>
                    <p className="mt-1 text-xs font-semibold text-slate-300">{option.subtitle}</p>
                    <p className="mt-2 text-xs leading-5 text-slate-500">{option.description}</p>
                  </button>
                );
              })}
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <label className="sm:col-span-2">
                <span className="text-xs font-semibold text-slate-300">Project title</span>
                <input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950 px-3.5 py-3 text-sm outline-none focus:border-violet-400" />
              </label>
              <label>
                <span className="text-xs font-semibold text-slate-300">Aspect ratio</span>
                <select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950 px-3.5 py-3 text-sm">
                  {["16:9", "9:16", "1:1", "4:3", "21:9"].map((value) => <option key={value}>{value}</option>)}
                </select>
              </label>
              <label>
                <span className="text-xs font-semibold text-slate-300">Seconds per photo</span>
                <select value={secondsPerPhoto} onChange={(e) => setSecondsPerPhoto(Number(e.target.value))} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950 px-3.5 py-3 text-sm">
                  {[3, 4, 5, 6, 8, 10].map((value) => <option key={value} value={value}>{value} seconds</option>)}
                </select>
              </label>
              <label>
                <span className="text-xs font-semibold text-slate-300">Transition</span>
                <select value={transition} onChange={(e) => setTransition(e.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950 px-3.5 py-3 text-sm">
                  {["fade", "dissolve", "wipe", "slide", "cut"].map((value) => <option key={value}>{value}</option>)}
                </select>
              </label>
              <label>
                <span className="text-xs font-semibold text-slate-300">Reusable character (optional)</span>
                <select value={characterProfileId} onChange={(e) => setCharacterProfileId(e.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950 px-3.5 py-3 text-sm">
                  <option value="">No character profile</option>
                  {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
                </select>
              </label>
            </div>

            <button
              type="button"
              disabled={!selected.length || creating}
              onClick={() => void createProject()}
              className="mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 px-5 py-3 text-sm font-black shadow-lg shadow-violet-950/30 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clapperboard className="h-4 w-4" />}
              {creating ? "Building project…" : `Create ${mode === "slideshow" ? "slideshow" : "living photo"} project`}
            </button>

            {result ? (
              <div className="mt-5 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-4">
                <p className="font-bold text-emerald-200">Project ready · {result.sceneCount} scenes</p>
                <p className="mt-1 text-sm leading-6 text-emerald-100/80">{result.message}</p>
                {result.mode === "slideshow" ? (
                  <div className="mt-4 rounded-xl border border-cyan-300/20 bg-slate-950/40 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-bold text-cyan-100">Provider-free motion render</p>
                        <p className="mt-1 text-xs text-slate-400">Ken Burns zoom and directional drift run on Vidora's FFmpeg worker. AI credits: 0.</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void renderSlideshowLocally()}
                        disabled={renderingSlideshow || slideshowRender?.status === "done"}
                        className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-cyan-300 px-3.5 py-2 text-xs font-black text-slate-950 hover:bg-cyan-200 disabled:opacity-50"
                      >
                        {renderingSlideshow ? <Loader2 className="h-4 w-4 animate-spin" /> : <Film className="h-4 w-4" />}
                        {slideshowRender?.status === "done" ? "Local clips ready" : renderingSlideshow ? "Rendering locally…" : "Render locally · 0 credits"}
                      </button>
                    </div>
                    {slideshowRender ? (
                      <div className="mt-3">
                        <div className="flex items-center justify-between gap-3 text-xs text-slate-300">
                          <span>{slideshowRender.step}</span>
                          <span>{Math.max(0, Math.min(100, Math.round(slideshowRender.progress)))}%</span>
                        </div>
                        <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-violet-400 transition-[width] duration-500"
                            style={{ width: `${Math.max(0, Math.min(100, slideshowRender.progress))}%` }}
                          />
                        </div>
                        {slideshowRender.status === "done" ? (
                          <p className="mt-2 text-xs font-semibold text-emerald-200">
                            {slideshowRender.message || "Local slideshow clips are ready. Build Full Preview in Vidora to review the complete cut."}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <Link href={result.dashboardUrl || "/"} className="mt-3 inline-flex items-center gap-2 text-sm font-bold text-white hover:text-emerald-100">
                  Return to Vidora workspace <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            ) : null}
          </div>

          <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 sm:p-7">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.22em] text-fuchsia-300">3 · Character Forge</p>
                <h2 className="mt-2 text-2xl font-bold">Save a reusable digital character</h2>
              </div>
              <ShieldCheck className="h-6 w-6 text-emerald-300" />
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              Choose a portrait, define performance defaults, and store consent with the identity. The profile can already be attached to Photo Studio projects and becomes the project character/reference for Vidora generation.
            </p>

            <div className="mt-5 grid grid-cols-4 gap-2">
              {assets.slice(0, 12).map((asset) => (
                <button
                  type="button"
                  key={asset.id}
                  onClick={() => setPrimaryAssetId(asset.id)}
                  className={`overflow-hidden rounded-xl border ${primaryAssetId === asset.id ? "border-fuchsia-400 ring-2 ring-fuchsia-400/30" : "border-white/10"}`}
                >
                  <img src={asset.url} alt="" className="aspect-square w-full object-cover" />
                </button>
              ))}
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <input placeholder="Character name" value={characterName} onChange={(e) => setCharacterName(e.target.value)} className="rounded-xl border border-white/10 bg-slate-950 px-3.5 py-3 text-sm" />
              <input placeholder="Role e.g. founder, mother, presenter" value={characterRole} onChange={(e) => setCharacterRole(e.target.value)} className="rounded-xl border border-white/10 bg-slate-950 px-3.5 py-3 text-sm" />
              <input placeholder="Emotion" value={emotion} onChange={(e) => setEmotion(e.target.value)} className="rounded-xl border border-white/10 bg-slate-950 px-3.5 py-3 text-sm" />
              <input placeholder="Acting style" value={actingStyle} onChange={(e) => setActingStyle(e.target.value)} className="rounded-xl border border-white/10 bg-slate-950 px-3.5 py-3 text-sm" />
              <select value={gestureIntensity} onChange={(e) => setGestureIntensity(e.target.value)} className="rounded-xl border border-white/10 bg-slate-950 px-3.5 py-3 text-sm">
                <option value="low">Low gestures</option><option value="medium">Medium gestures</option><option value="high">High gestures</option>
              </select>
              <select value={eyeContact} onChange={(e) => setEyeContact(e.target.value)} className="rounded-xl border border-white/10 bg-slate-950 px-3.5 py-3 text-sm">
                <option value="camera">Eye contact: camera</option><option value="natural">Eye contact: natural</option><option value="off-camera">Eye contact: off-camera</option>
              </select>
              <select value={bodyMotion} onChange={(e) => setBodyMotion(e.target.value)} className="rounded-xl border border-white/10 bg-slate-950 px-3.5 py-3 text-sm sm:col-span-2">
                <option value="subtle">Subtle body movement</option><option value="natural">Natural body movement</option><option value="expressive">Expressive body movement</option>
              </select>
            </div>

            <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-emerald-400/15 bg-emerald-500/5 p-3 text-xs leading-5 text-slate-300">
              <input type="checkbox" checked={consentConfirmed} onChange={(e) => setConsentConfirmed(e.target.checked)} className="mt-1" />
              <span>I own this image or have permission from the depicted person to use it for AI animation and character creation.</span>
            </label>

            <button
              type="button"
              onClick={() => void saveCharacterProfile()}
              disabled={!primaryAssetId || !characterName.trim() || !consentConfirmed || savingProfile}
              className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-fuchsia-400/30 bg-fuchsia-500/10 px-4 py-3 text-sm font-bold text-fuchsia-100 hover:bg-fuchsia-500/15 disabled:opacity-40"
            >
              {savingProfile ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserRound className="h-4 w-4" />}
              {savingProfile ? "Saving character…" : "Save reusable character"}
            </button>

            {profiles.length ? (
              <div className="mt-6">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Your characters</p>
                <div className="mt-3 space-y-2">
                  {profiles.slice(0, 6).map((profile) => (
                    <button
                      type="button"
                      key={profile.id}
                      onClick={() => setCharacterProfileId(profile.id)}
                      className={`flex w-full items-center gap-3 rounded-xl border p-2.5 text-left ${characterProfileId === profile.id ? "border-fuchsia-400 bg-fuchsia-500/10" : "border-white/10 bg-white/[0.03]"}`}
                    >
                      {profile.primaryAsset?.url ? (
                        <img src={profile.primaryAsset.url} alt="" className="h-11 w-11 rounded-lg object-cover" />
                      ) : <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-white/5"><Users className="h-4 w-4" /></div>}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold">{profile.name}</p>
                        <p className="truncate text-xs text-slate-500">{profile.role || "character"} · consent {profile.consentStatus}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-gradient-to-r from-violet-500/10 via-fuchsia-500/10 to-cyan-500/10 p-6 sm:p-8">
          <div className="grid gap-5 md:grid-cols-3">
            {[
              ["Upload once", "Your original photos are stored as durable, account-owned Vidora assets instead of temporary browser blobs.", ImagePlus],
              ["Choose local or AI motion", "Slideshows render locally for zero credits; Living Photos keep Vidora’s explicit billing gate before paid AI motion.", ShieldCheck],
              ["Keep identity reusable", "Character Forge separates a person's reusable identity and performance defaults from any single video project.", UserRound],
            ].map(([heading, copy, Icon]) => {
              const IconComponent = Icon as typeof ImagePlus;
              return (
                <div key={heading as string}>
                  <IconComponent className="h-5 w-5 text-violet-300" />
                  <h3 className="mt-3 font-bold">{heading as string}</h3>
                  <p className="mt-1 text-sm leading-6 text-slate-400">{copy as string}</p>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}
