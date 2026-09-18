"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  AudioLines,
  CheckCircle2,
  Loader2,
  Mic2,
  Play,
  ShieldCheck,
  Sparkles,
  Upload,
} from "lucide-react";

type ImageAsset = {
  id: string;
  originalName: string;
  url: string;
};

type AudioAsset = {
  id: string;
  originalName: string;
  url: string;
  durationSeconds?: number | null;
  createdAt: string;
};

type TalkingPhotoQuote = {
  quoteId: string;
  durationSeconds: number;
  creditsRequired: number;
  providerCostUsd: number;
  customerValueUsd: number;
  customerValueGhs?: number | null;
  expiresAt: string;
  wallet: { availableCredits: number };
  hasEnoughCredits: boolean;
  shortfallCredits: number;
};

type TalkingPhotoJob = {
  id: string;
  imageAssetId?: string;
  audioAssetId?: string;
  status: string;
  durationSeconds: number;
  videoUrl?: string | null;
  error?: string | null;
  createdAt?: string;
};

interface TalkingPhotoStudioProps {
  images: ImageAsset[];
}

function durationLabel(raw?: number | null): string {
  const seconds = Math.max(0, Number(raw || 0));
  const whole = Math.round(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return minutes > 0 ? `${minutes}m ${rest}s` : `${rest}s`;
}

function statusLabel(status: string): string {
  switch (status) {
    case "reserving": return "Reserving confirmed credits…";
    case "queued": return "Queued for Talking Photo…";
    case "processing": return "Preparing private media…";
    case "submitting": return "Submitting one lip-sync job…";
    case "waiting_provider": return "Synchronizing speech and facial motion…";
    case "completed": return "Talking Photo ready";
    case "needs_reconciliation": return "Needs safe reconciliation";
    case "failed": return "Talking Photo failed";
    default: return status.replaceAll("_", " ");
  }
}

export function TalkingPhotoStudio({ images }: TalkingPhotoStudioProps) {
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const [audioAssets, setAudioAssets] = useState<AudioAsset[]>([]);
  const [selectedImageId, setSelectedImageId] = useState("");
  const [selectedAudioId, setSelectedAudioId] = useState("");
  const [quote, setQuote] = useState<TalkingPhotoQuote | null>(null);
  const [job, setJob] = useState<TalkingPhotoJob | null>(null);
  const [recentJobs, setRecentJobs] = useState<TalkingPhotoJob[]>([]);
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [providerAvailable, setProviderAvailable] = useState<boolean | null>(null);
  const [loadingAudio, setLoadingAudio] = useState(true);
  const [uploadingAudio, setUploadingAudio] = useState(false);
  const [quoting, setQuoting] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!selectedImageId && images[0]) setSelectedImageId(images[0].id);
    if (selectedImageId && !images.some((image) => image.id === selectedImageId)) {
      setSelectedImageId(images[0]?.id || "");
      setQuote(null);
      setJob(null);
    }
  }, [images, selectedImageId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoadingAudio(true);
      try {
        const [audioResponse, jobsResponse, capabilityResponse] = await Promise.all([
          fetch("/api/photo-studio/audio-assets", { cache: "no-store" }),
          fetch("/api/photo-studio/talking-photo/jobs", { cache: "no-store" }),
          fetch("/api/photo-studio/talking-photo/capabilities", { cache: "no-store" }),
        ]);
        const [audioBody, jobsBody, capabilityBody] = await Promise.all([
          audioResponse.json().catch(() => ({})),
          jobsResponse.json().catch(() => ({})),
          capabilityResponse.json().catch(() => ({})),
        ]);
        if (!audioResponse.ok || !audioBody.success) {
          throw new Error(audioBody.error || "Unable to load audio library");
        }
        if (!jobsResponse.ok || !jobsBody.success) {
          throw new Error(jobsBody.error || "Unable to load recent Talking Photo jobs");
        }
        if (!capabilityResponse.ok || !capabilityBody.success) {
          throw new Error(capabilityBody.error || "Unable to verify Talking Photo provider readiness");
        }
        const items = Array.isArray(audioBody.assets) ? audioBody.assets as AudioAsset[] : [];
        const jobs = Array.isArray(jobsBody.jobs) ? jobsBody.jobs as TalkingPhotoJob[] : [];
        if (cancelled) return;
        setAudioAssets(items);
        setRecentJobs(jobs);
        setProviderAvailable(capabilityBody.talkingPhoto?.available === true);
        setSelectedAudioId((current) => current || items[0]?.id || "");
        const active = jobs.find((candidate) =>
          !["completed", "failed", "needs_reconciliation"].includes(candidate.status),
        );
        if (active) {
          setJob(active);
          if (active.imageAssetId) setSelectedImageId(active.imageAssetId);
          if (active.audioAssetId) setSelectedAudioId(active.audioAssetId);
        }
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Unable to load audio library");
      } finally {
        if (!cancelled) setLoadingAudio(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const resetPaidState = () => {
    setQuote(null);
    setJob(null);
    setConsentConfirmed(false);
    setError("");
  };

  const selectImage = (id: string) => {
    if (id === selectedImageId) return;
    setSelectedImageId(id);
    resetPaidState();
  };

  const selectAudio = (id: string) => {
    if (id === selectedAudioId) return;
    setSelectedAudioId(id);
    resetPaidState();
  };

  const uploadAudio = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setUploadingAudio(true);
    setError("");
    try {
      const form = new FormData();
      form.append("audio", file);
      const response = await fetch("/api/photo-studio/audio-assets", {
        method: "POST",
        body: form,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.success || !body.asset) {
        throw new Error(body.error || "Audio upload failed");
      }
      const asset = body.asset as AudioAsset;
      setAudioAssets((current) => {
        const map = new Map(current.map((item) => [item.id, item]));
        map.set(asset.id, asset);
        return [...map.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      });
      setSelectedAudioId(asset.id);
      resetPaidState();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Audio upload failed");
    } finally {
      setUploadingAudio(false);
      if (audioInputRef.current) audioInputRef.current.value = "";
    }
  };

  const reviewCost = async () => {
    if (!providerAvailable || !selectedImageId || !selectedAudioId) return;
    setQuoting(true);
    setQuote(null);
    setJob(null);
    setConsentConfirmed(false);
    setError("");
    try {
      const response = await fetch("/api/photo-studio/talking-photo/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageAssetId: selectedImageId,
          audioAssetId: selectedAudioId,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.success) throw new Error(body.error || "Unable to calculate Talking Photo cost");
      setQuote(body as TalkingPhotoQuote);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to calculate Talking Photo cost");
    } finally {
      setQuoting(false);
    }
  };

  const pollJob = async (jobId: string) => {
    for (let attempt = 0; attempt < 900; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      const response = await fetch(
        `/api/photo-studio/talking-photo/jobs/${encodeURIComponent(jobId)}`,
        { cache: "no-store" },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.success || !body.job) {
        throw new Error(body.error || "Unable to read Talking Photo progress");
      }
      const next = body.job as TalkingPhotoJob;
      setJob(next);
      setRecentJobs((current) => {
        const remaining = current.filter((item) => item.id !== next.id);
        return [next, ...remaining].slice(0, 20);
      });
      if (next.status === "completed") return;
      if (next.status === "failed" || next.status === "needs_reconciliation") {
        throw new Error(next.error || statusLabel(next.status));
      }
    }
    throw new Error("Talking Photo is still processing. Its durable job is safe; return to this page to check again.");
  };

  const startTalkingPhoto = async () => {
    if (!providerAvailable || !quote || !selectedImageId || !selectedAudioId || !consentConfirmed) return;
    setStarting(true);
    setError("");
    try {
      const response = await fetch("/api/photo-studio/talking-photo/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageAssetId: selectedImageId,
          audioAssetId: selectedAudioId,
          quoteId: quote.quoteId,
          consentConfirmed: true,
          billingConfirmed: true,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.success || !body.job) {
        throw new Error(body.error || "Unable to start Talking Photo");
      }
      const next = body.job as TalkingPhotoJob;
      setJob(next);
      setRecentJobs((current) => {
        const remaining = current.filter((item) => item.id !== next.id);
        return [next, ...remaining].slice(0, 20);
      });
      if (next.status !== "completed") await pollJob(next.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Talking Photo failed");
    } finally {
      setStarting(false);
    }
  };

  const selectedImage = images.find((image) => image.id === selectedImageId);
  const selectedAudio = audioAssets.find((audio) => audio.id === selectedAudioId);

  return (
    <section className="rounded-3xl border border-violet-300/20 bg-[radial-gradient(circle_at_top_right,_rgba(168,85,247,.14),_transparent_42%),rgba(15,23,42,.78)] p-5 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-violet-300">4 · Talking Photo</p>
          <h2 className="mt-2 text-2xl font-bold">Make one portrait speak with real lip-sync</h2>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            Choose one owned photo and one audio track. Vidora measures the audio on the server, shows the exact current credit charge, then runs a durable speech-synchronization job only after you confirm.
          </p>
        </div>
        <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold ${
          providerAvailable === false
            ? "border-slate-300/15 bg-slate-400/10 text-slate-300"
            : "border-amber-300/15 bg-amber-400/10 text-amber-100"
        }`}>
          <ShieldCheck className="h-4 w-4" />
          {providerAvailable === false ? "Provider setup required" : "Explicit consent + billing"}
        </span>
      </div>

      {error ? (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-300/20 bg-red-400/10 p-3 text-xs leading-5 text-red-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {providerAvailable === false ? (
        <div className="mt-4 flex items-start gap-3 rounded-xl border border-amber-300/20 bg-amber-400/10 p-4 text-xs leading-5 text-amber-100">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-bold">Talking Photo rendering is not enabled on this server yet.</p>
            <p className="mt-1 text-amber-100/80">
              You can prepare photos and audio without charge, but Vidora will not quote, reserve credits, or submit lip-sync work until the provider is configured.
            </p>
          </div>
        </div>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Portrait</p>
          {images.length ? (
            <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-6">
              {images.slice(0, 18).map((image) => (
                <button
                  type="button"
                  key={image.id}
                  onClick={() => selectImage(image.id)}
                  className={`overflow-hidden rounded-xl border ${
                    selectedImageId === image.id
                      ? "border-violet-300 ring-2 ring-violet-300/25"
                      : "border-white/10"
                  }`}
                >
                  <img src={image.url} alt={image.originalName} className="aspect-square w-full object-cover" />
                </button>
              ))}
            </div>
          ) : (
            <div className="mt-3 rounded-xl border border-dashed border-white/10 p-5 text-sm text-slate-500">
              Upload a portrait in Media Library first.
            </div>
          )}
        </div>

        <div>
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Speech audio</p>
              <p className="mt-1 text-xs text-slate-500">Audio-only · up to 50 MB · maximum 10 minutes.</p>
            </div>
            <button
              type="button"
              onClick={() => audioInputRef.current?.click()}
              disabled={uploadingAudio}
              className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold hover:bg-white/10 disabled:opacity-50"
            >
              {uploadingAudio ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              {uploadingAudio ? "Inspecting…" : "Upload audio"}
            </button>
            <input
              ref={audioInputRef}
              type="file"
              accept="audio/mpeg,audio/wav,audio/mp4,audio/aac,audio/ogg,audio/webm,audio/flac"
              hidden
              onChange={(event) => void uploadAudio(event.target.files)}
            />
          </div>

          {loadingAudio ? (
            <div className="mt-3 flex min-h-20 items-center justify-center gap-2 rounded-xl border border-white/10 text-xs text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading audio…
            </div>
          ) : audioAssets.length ? (
            <div className="mt-3 max-h-52 space-y-2 overflow-auto pr-1">
              {audioAssets.map((audio) => (
                <button
                  type="button"
                  key={audio.id}
                  onClick={() => selectAudio(audio.id)}
                  className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left ${
                    selectedAudioId === audio.id
                      ? "border-cyan-300/60 bg-cyan-400/10"
                      : "border-white/10 bg-white/[0.03]"
                  }`}
                >
                  <AudioLines className="h-4 w-4 shrink-0 text-cyan-300" />
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold">{audio.originalName}</span>
                  <span className="text-[11px] text-slate-500">{durationLabel(audio.durationSeconds)}</span>
                </button>
              ))}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => audioInputRef.current?.click()}
              className="mt-3 flex min-h-24 w-full flex-col items-center justify-center rounded-xl border border-dashed border-cyan-300/20 bg-cyan-400/5 text-xs text-slate-400"
            >
              <Mic2 className="h-5 w-5 text-cyan-300" />
              <span className="mt-2 font-semibold">Upload spoken audio</span>
            </button>
          )}
        </div>
      </div>

      {recentJobs.length ? (
        <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.025] p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Recent Talking Photos</p>
              <p className="mt-1 text-xs text-slate-500">Durable jobs remain here after refresh or reconnect.</p>
            </div>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {recentJobs.slice(0, 6).map((recent) => {
              const active = !["completed", "failed", "needs_reconciliation"].includes(recent.status);
              return (
                <button
                  type="button"
                  key={recent.id}
                  onClick={() => {
                    setJob(recent);
                    if (recent.imageAssetId) setSelectedImageId(recent.imageAssetId);
                    if (recent.audioAssetId) setSelectedAudioId(recent.audioAssetId);
                    setQuote(null);
                    setConsentConfirmed(false);
                    if (active && !starting) {
                      setStarting(true);
                      setError("");
                      void pollJob(recent.id)
                        .catch((reason) => setError(reason instanceof Error ? reason.message : "Unable to monitor Talking Photo"))
                        .finally(() => setStarting(false));
                    }
                  }}
                  className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-slate-950/45 p-3 text-left hover:bg-white/5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs font-bold">{statusLabel(recent.status)}</p>
                    <p className="mt-1 text-[11px] text-slate-500">{durationLabel(recent.durationSeconds)}</p>
                  </div>
                  <span className="text-[11px] font-bold text-violet-200">
                    {active ? "Resume" : "View"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {selectedImage && selectedAudio ? (
        <div className="mt-5 rounded-2xl border border-white/10 bg-slate-950/55 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <img src={selectedImage.url} alt="" className="h-14 w-14 rounded-xl object-cover" />
              <div className="min-w-0">
                <p className="truncate text-sm font-bold">{selectedImage.originalName}</p>
                <p className="mt-1 truncate text-xs text-slate-500">
                  {selectedAudio.originalName} · server duration {durationLabel(selectedAudio.durationSeconds)}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void reviewCost()}
              disabled={providerAvailable !== true || quoting || starting || Boolean(job && !["failed", "completed", "needs_reconciliation"].includes(job.status))}
              className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-xs font-black text-slate-950 hover:bg-slate-200 disabled:opacity-50"
            >
              {quoting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {providerAvailable === false
                ? "Provider setup required"
                : quoting
                  ? "Checking live cost…"
                  : "Review cost"}
            </button>
          </div>

          {quote ? (
            <div className="mt-4 rounded-xl border border-violet-300/20 bg-violet-400/10 p-4">
              <div className="grid gap-3 sm:grid-cols-4">
                <div><p className="text-[10px] uppercase tracking-wider text-slate-500">Duration</p><p className="mt-1 font-bold">{durationLabel(quote.durationSeconds)}</p></div>
                <div><p className="text-[10px] uppercase tracking-wider text-slate-500">Charge</p><p className="mt-1 font-bold">{quote.creditsRequired} credits</p></div>
                <div><p className="text-[10px] uppercase tracking-wider text-slate-500">Wallet</p><p className="mt-1 font-bold">{quote.wallet.availableCredits} credits</p></div>
                <div><p className="text-[10px] uppercase tracking-wider text-slate-500">Customer value</p><p className="mt-1 font-bold">{quote.customerValueGhs ? `GHS ${quote.customerValueGhs.toFixed(2)}` : `USD ${quote.customerValueUsd.toFixed(2)}`}</p></div>
              </div>

              {!quote.hasEnoughCredits ? (
                <p className="mt-3 text-xs font-semibold text-amber-200">
                  You need {quote.shortfallCredits} more credits before this Talking Photo can start.
                </p>
              ) : (
                <>
                  <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-emerald-300/15 bg-emerald-400/5 p-3 text-xs leading-5 text-slate-300">
                    <input
                      type="checkbox"
                      checked={consentConfirmed}
                      onChange={(event) => setConsentConfirmed(event.target.checked)}
                      className="mt-1"
                    />
                    <span>
                      I own this photo/audio or have the necessary permission from the depicted person and rights holders to create this Talking Photo. I understand that clicking the button below confirms the displayed {quote.creditsRequired}-credit charge.
                    </span>
                  </label>
                  <button
                    type="button"
                    onClick={() => void startTalkingPhoto()}
                    disabled={!consentConfirmed || starting}
                    className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-3 text-sm font-black hover:brightness-110 disabled:opacity-40"
                  >
                    {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic2 className="h-4 w-4" />}
                    {starting ? "Creating Talking Photo…" : `Confirm ${quote.creditsRequired} credits & create`}
                  </button>
                </>
              )}
            </div>
          ) : null}

          {job ? (
            <div className={`mt-4 rounded-xl border p-4 ${
              job.status === "completed"
                ? "border-emerald-300/20 bg-emerald-400/10"
                : job.status === "failed" || job.status === "needs_reconciliation"
                  ? "border-amber-300/20 bg-amber-400/10"
                  : "border-cyan-300/20 bg-cyan-400/10"
            }`}>
              <div className="flex items-center gap-2 text-sm font-bold">
                {job.status === "completed"
                  ? <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                  : starting
                    ? <Loader2 className="h-4 w-4 animate-spin text-cyan-300" />
                    : <Play className="h-4 w-4 text-cyan-300" />}
                {statusLabel(job.status)}
              </div>
              {job.error ? <p className="mt-2 text-xs leading-5 text-amber-100">{job.error}</p> : null}
              {job.status === "completed" && job.videoUrl ? (
                <div className="mt-4">
                  <video src={job.videoUrl} controls playsInline className="w-full rounded-xl border border-white/10 bg-black" />
                  <a
                    href={job.videoUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 inline-flex items-center gap-2 text-xs font-bold text-emerald-200 hover:text-emerald-100"
                  >
                    Open completed Talking Photo <Play className="h-3.5 w-3.5" />
                  </a>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
