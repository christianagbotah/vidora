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
  Square,
  Upload,
} from "lucide-react";

type ImageAsset = {
  id: string;
  originalName: string;
  url: string;
};

type DigitalActorProfile = {
  id: string;
  name: string;
  role?: string | null;
  voiceId?: string | null;
  consentStatus: string;
  performanceProfile: string;
  primaryAsset?: ImageAsset | null;
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

type SpeechQuote = {
  quoteId: string;
  creditsRequired: number;
  customerValueUsd: number;
  customerValueGhs?: number | null;
  wallet: { availableCredits: number };
  hasEnoughCredits: boolean;
  shortfallCredits: number;
  chunkCount: number;
};

type SpeechJob = {
  id: string;
  status: string;
  outputAssetId?: string | null;
  error?: string | null;
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
  characters: DigitalActorProfile[];
}

const DIGITAL_ACTOR_VOICES = new Set(["tongtong", "xiaochen", "jam", "kazi", "luodo", "chuichui"]);

function digitalActorSpeechStyle(raw: string): string {
  try {
    const row = JSON.parse(raw) as Record<string, unknown>;
    const acting = typeof row.actingStyle === "string" ? row.actingStyle.trim() : "";
    const emotion = typeof row.emotion === "string" ? row.emotion.trim() : "";
    const gesture = typeof row.gestureIntensity === "string" ? row.gestureIntensity.trim() : "";
    const body = typeof row.bodyMotion === "string" ? row.bodyMotion.trim() : "";
    const parts = [
      acting,
      emotion ? `emotion ${emotion}` : "",
      gesture ? `${gesture} gestures` : "",
      body ? `${body} body motion` : "",
    ].filter(Boolean);
    return (parts.join("; ") || "natural, warm and expressive").slice(0, 120);
  } catch {
    return "natural, warm and expressive";
  }
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

export function TalkingPhotoStudio({ images, characters }: TalkingPhotoStudioProps) {
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingCancelledRef = useRef(false);
  const [audioAssets, setAudioAssets] = useState<AudioAsset[]>([]);
  const [selectedImageId, setSelectedImageId] = useState("");
  const [selectedCharacterId, setSelectedCharacterId] = useState("");
  const [selectedAudioId, setSelectedAudioId] = useState("");
  const [quote, setQuote] = useState<TalkingPhotoQuote | null>(null);
  const [job, setJob] = useState<TalkingPhotoJob | null>(null);
  const [recentJobs, setRecentJobs] = useState<TalkingPhotoJob[]>([]);
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [providerAvailable, setProviderAvailable] = useState<boolean | null>(null);
  const [speechScript, setSpeechScript] = useState("");
  const [speechVoice, setSpeechVoice] = useState("tongtong");
  const [speechStyle, setSpeechStyle] = useState("natural, warm and expressive");
  const [speechQuote, setSpeechQuote] = useState<SpeechQuote | null>(null);
  const [speechJob, setSpeechJob] = useState<SpeechJob | null>(null);
  const [speechQuoting, setSpeechQuoting] = useState(false);
  const [speechStarting, setSpeechStarting] = useState(false);
  const [recordingSupported, setRecordingSupported] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [loadingAudio, setLoadingAudio] = useState(true);
  const [uploadingAudio, setUploadingAudio] = useState(false);
  const [quoting, setQuoting] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setRecordingSupported(
      typeof MediaRecorder !== "undefined"
      && Boolean(navigator.mediaDevices?.getUserMedia),
    );
    return () => {
      recordingCancelledRef.current = true;
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.onstop = null;
        recorder.stop();
      }
      recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
      recordingStreamRef.current = null;
      mediaRecorderRef.current = null;
    };
  }, []);

  useEffect(() => {
    const confirmedProfileHasImage = characters.some((profile) =>
      profile.consentStatus === "confirmed" && profile.primaryAsset?.id === selectedImageId,
    );
    if (!selectedImageId && images[0]) setSelectedImageId(images[0].id);
    if (
      selectedImageId
      && !images.some((image) => image.id === selectedImageId)
      && !confirmedProfileHasImage
    ) {
      setSelectedImageId(images[0]?.id || "");
      setSelectedCharacterId("");
      setQuote(null);
      setJob(null);
    }
  }, [characters, images, selectedImageId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoadingAudio(true);
      try {
        const [audioResponse, jobsResponse, capabilityResponse, speechJobsResponse] = await Promise.all([
          fetch("/api/photo-studio/audio-assets", { cache: "no-store" }),
          fetch("/api/photo-studio/talking-photo/jobs", { cache: "no-store" }),
          fetch("/api/photo-studio/talking-photo/capabilities", { cache: "no-store" }),
          fetch("/api/photo-studio/talking-photo/speech/jobs", { cache: "no-store" }),
        ]);
        const [audioBody, jobsBody, capabilityBody, speechJobsBody] = await Promise.all([
          audioResponse.json().catch(() => ({})),
          jobsResponse.json().catch(() => ({})),
          capabilityResponse.json().catch(() => ({})),
          speechJobsResponse.json().catch(() => ({})),
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
        if (!speechJobsResponse.ok || !speechJobsBody.success) {
          throw new Error(speechJobsBody.error || "Unable to load recent Digital Actor voice jobs");
        }
        const items = Array.isArray(audioBody.assets) ? audioBody.assets as AudioAsset[] : [];
        const jobs = Array.isArray(jobsBody.jobs) ? jobsBody.jobs as TalkingPhotoJob[] : [];
        const speechJobs = Array.isArray(speechJobsBody.jobs) ? speechJobsBody.jobs as SpeechJob[] : [];
        if (cancelled) return;
        setAudioAssets(items);
        setRecentJobs(jobs);
        setProviderAvailable(capabilityBody.talkingPhoto?.available === true);
        setSelectedAudioId((current) => current || items[0]?.id || "");
        const active = jobs.find((candidate) =>
          !["completed", "failed", "needs_reconciliation"].includes(candidate.status),
        );
        const activeSpeech = speechJobs.find((candidate) =>
          !["completed", "failed", "needs_reconciliation"].includes(candidate.status),
        );
        if (activeSpeech) setSpeechJob(activeSpeech);
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

  const selectCharacter = (profileId: string) => {
    const profile = characters.find((candidate) =>
      candidate.id === profileId
      && candidate.consentStatus === "confirmed"
      && candidate.primaryAsset,
    );
    if (!profile?.primaryAsset) return;

    setSelectedCharacterId(profile.id);
    setSelectedImageId(profile.primaryAsset.id);
    const savedVoice = (profile.voiceId || "").trim().toLowerCase();
    setSpeechVoice(DIGITAL_ACTOR_VOICES.has(savedVoice) ? savedVoice : "tongtong");
    setSpeechStyle(digitalActorSpeechStyle(profile.performanceProfile));
    setSpeechQuote(null);
    setSpeechJob(null);
    resetPaidState();
  };

  const selectImage = (id: string) => {
    if (id === selectedImageId) return;
    const leavingSavedActor = Boolean(selectedCharacterId);
    setSelectedImageId(id);
    setSelectedCharacterId("");
    if (leavingSavedActor) {
      setSpeechVoice("tongtong");
      setSpeechStyle("natural, warm and expressive");
      setSpeechQuote(null);
      setSpeechJob(null);
    }
    resetPaidState();
  };

  const selectAudio = (id: string) => {
    if (id === selectedAudioId) return;
    setSelectedAudioId(id);
    resetPaidState();
  };

  const uploadAudioFile = async (file: File) => {
    if (!file || file.size <= 0) return;
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

  const uploadAudio = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    await uploadAudioFile(file);
  };

  const clearRecordingResources = () => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
    recordingStreamRef.current = null;
    mediaRecorderRef.current = null;
    setRecording(false);
  };

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    recorder.stop();
  };

  const startRecording = async () => {
    if (
      typeof MediaRecorder === "undefined"
      || !navigator.mediaDevices?.getUserMedia
    ) {
      setRecordingSupported(false);
      setError("Microphone recording is not supported in this browser. Upload an audio file instead.");
      return;
    }
    if (recording || uploadingAudio) return;

    setError("");
    setQuote(null);
    setJob(null);
    setConsentConfirmed(false);
    recordingCancelledRef.current = false;
    recordingChunksRef.current = [];
    setRecordingSeconds(0);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      recordingStreamRef.current = stream;

      const preferredMime = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4",
      ].find((mime) => MediaRecorder.isTypeSupported(mime));
      const recorder = preferredMime
        ? new MediaRecorder(stream, { mimeType: preferredMime })
        : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordingChunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        recordingCancelledRef.current = true;
        if (recorder.state !== "inactive") recorder.stop();
        else clearRecordingResources();
        setError("Microphone recording failed. You can upload an audio file instead.");
      };
      recorder.onstop = () => {
        const cancelled = recordingCancelledRef.current;
        const chunks = [...recordingChunksRef.current];
        recordingChunksRef.current = [];
        const mimeType = recorder.mimeType || chunks[0]?.type || "audio/webm";
        clearRecordingResources();
        if (cancelled) return;

        const blob = new Blob(chunks, { type: mimeType });
        if (blob.size <= 0) {
          setError("The microphone recording was empty. Please record again.");
          return;
        }
        const extension = mimeType.includes("mp4")
          ? "m4a"
          : mimeType.includes("ogg")
            ? "ogg"
            : "webm";
        const file = new File(
          [blob],
          `talking-photo-recording-${new Date().toISOString().replace(/[:.]/g, "-")}.${extension}`,
          { type: mimeType },
        );
        void uploadAudioFile(file);
      };

      recorder.start(1_000);
      setRecording(true);
      const startedAt = Date.now();
      recordingTimerRef.current = setInterval(() => {
        const seconds = Math.min(600, Math.floor((Date.now() - startedAt) / 1_000));
        setRecordingSeconds(seconds);
        if (seconds >= 600 && recorder.state !== "inactive") recorder.stop();
      }, 500);
    } catch (reason) {
      clearRecordingResources();
      setError(
        reason instanceof Error && reason.name === "NotAllowedError"
          ? "Microphone permission was denied. Allow microphone access or upload an audio file instead."
          : "Vidora could not start microphone recording. Upload an audio file instead.",
      );
    }
  };

  const reviewSpeechCost = async () => {
    if (!speechScript.trim()) return;
    setSpeechQuoting(true);
    setSpeechQuote(null);
    setSpeechJob(null);
    setError("");
    try {
      const response = await fetch("/api/photo-studio/talking-photo/speech/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          script: speechScript,
          voice: speechVoice,
          language: "en",
          accent: "auto",
          style: speechStyle,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.success) throw new Error(body.error || "Unable to calculate Digital Actor voice cost");
      setSpeechQuote(body as SpeechQuote);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to calculate Digital Actor voice cost");
    } finally {
      setSpeechQuoting(false);
    }
  };

  const pollSpeechJob = async (jobId: string) => {
    for (let attempt = 0; attempt < 300; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      const response = await fetch(
        `/api/photo-studio/talking-photo/speech/jobs/${encodeURIComponent(jobId)}`,
        { cache: "no-store" },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.success || !body.job) {
        throw new Error(body.error || "Unable to read Digital Actor voice progress");
      }
      const next = body.job as SpeechJob;
      setSpeechJob(next);
      if (next.status === "completed") {
        const asset = body.outputAsset as AudioAsset | null;
        if (!asset) throw new Error("Voice completed but its private audio asset is unavailable");
        setAudioAssets((current) => {
          const map = new Map(current.map((item) => [item.id, item]));
          map.set(asset.id, asset);
          return [...map.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        });
        setSelectedAudioId(asset.id);
        setQuote(null);
        setJob(null);
        setConsentConfirmed(false);
        return;
      }
      if (next.status === "failed" || next.status === "needs_reconciliation") {
        throw new Error(next.error || "Digital Actor voice needs attention");
      }
    }
    throw new Error("Digital Actor voice is still processing. The durable job is safe; return here to check again.");
  };

  const startSpeechJob = async () => {
    if (!speechQuote || !speechScript.trim()) return;
    setSpeechStarting(true);
    setError("");
    try {
      const response = await fetch("/api/photo-studio/talking-photo/speech/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quoteId: speechQuote.quoteId,
          script: speechScript,
          voice: speechVoice,
          language: "en",
          accent: "auto",
          style: speechStyle,
          billingConfirmed: true,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.success || !body.job) {
        throw new Error(body.error || "Unable to start Digital Actor voice");
      }
      const next = body.job as SpeechJob;
      setSpeechJob(next);
      await pollSpeechJob(next.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Digital Actor voice failed");
    } finally {
      setSpeechStarting(false);
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

  const selectedImage = images.find((image) => image.id === selectedImageId)
    || characters.find((profile) =>
      profile.consentStatus === "confirmed" && profile.primaryAsset?.id === selectedImageId,
    )?.primaryAsset
    || null;
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
          {characters.some((profile) => profile.consentStatus === "confirmed" && profile.primaryAsset) ? (
            <div className="mb-5">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-violet-300">Saved Digital Actors</p>
                  <p className="mt-1 text-[11px] text-slate-500">Reuse a consent-confirmed Character Forge portrait, voice and performance direction.</p>
                </div>
                <span className="rounded-full border border-emerald-300/15 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-bold text-emerald-200">
                  Consent confirmed
                </span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {characters
                  .filter((profile) => profile.consentStatus === "confirmed" && profile.primaryAsset)
                  .slice(0, 9)
                  .map((profile) => (
                    <button
                      type="button"
                      key={profile.id}
                      onClick={() => selectCharacter(profile.id)}
                      className={`flex items-center gap-2 rounded-xl border p-2 text-left ${
                        selectedCharacterId === profile.id
                          ? "border-violet-300 bg-violet-400/10 ring-2 ring-violet-300/20"
                          : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"
                      }`}
                    >
                      <img
                        src={profile.primaryAsset!.url}
                        alt={profile.name}
                        className="h-11 w-11 shrink-0 rounded-lg object-cover"
                      />
                      <div className="min-w-0">
                        <p className="truncate text-xs font-bold text-slate-100">{profile.name}</p>
                        <p className="mt-0.5 truncate text-[10px] text-slate-500">
                          {profile.role || "Reusable character"}
                        </p>
                      </div>
                    </button>
                  ))}
              </div>
              {selectedCharacterId ? (
                <p className="mt-2 text-[11px] text-violet-200">
                  Saved portrait, voice and acting profile restored. Current lip-sync still requires explicit confirmation below.
                </p>
              ) : null}
            </div>
          ) : null}

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
            <div className="flex flex-wrap justify-end gap-2">
              {recordingSupported ? (
                <button
                  type="button"
                  onClick={() => recording ? stopRecording() : void startRecording()}
                  disabled={uploadingAudio}
                  className={`inline-flex min-h-9 items-center gap-2 rounded-lg border px-3 py-2 text-xs font-bold disabled:opacity-50 ${
                    recording
                      ? "border-red-300/30 bg-red-400/10 text-red-100 hover:bg-red-400/15"
                      : "border-cyan-300/20 bg-cyan-400/10 text-cyan-100 hover:bg-cyan-400/15"
                  }`}
                >
                  {recording ? <Square className="h-3.5 w-3.5 fill-current" /> : <Mic2 className="h-3.5 w-3.5" />}
                  {recording ? `Stop · ${durationLabel(recordingSeconds)}` : "Record voice"}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => audioInputRef.current?.click()}
                disabled={uploadingAudio || recording}
                className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold hover:bg-white/10 disabled:opacity-50"
              >
                {uploadingAudio ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                {uploadingAudio ? "Inspecting…" : "Upload audio"}
              </button>
            </div>
            <input
              ref={audioInputRef}
              type="file"
              accept="audio/mpeg,audio/wav,audio/mp4,audio/aac,audio/ogg,audio/webm,audio/flac"
              hidden
              onChange={(event) => void uploadAudio(event.target.files)}
            />
            {recording ? (
              <div className="mt-3 flex items-center gap-2 rounded-xl border border-red-300/20 bg-red-400/10 px-3 py-2 text-xs text-red-100">
                <span className="h-2 w-2 animate-pulse rounded-full bg-red-300" />
                Recording from your microphone · {durationLabel(recordingSeconds)} · maximum 10 minutes · no provider credits used
              </div>
            ) : recordingSupported ? (
              <p className="mt-2 text-[11px] text-slate-500">
                Record directly in Vidora or upload an existing audio file. Recording itself uses no provider credits.
              </p>
            ) : null}
          </div>

          <div className="mt-4 rounded-2xl border border-fuchsia-300/15 bg-fuchsia-400/5 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-fuchsia-200">Scripted Digital Actor</p>
                <p className="mt-1 text-[11px] leading-5 text-slate-500">
                  Type the dialogue, review the exact Qwen TTS character charge, then generate measured speech. Lip-sync is priced separately afterward from the real audio duration.
                </p>
              </div>
              <span className="rounded-full border border-fuchsia-300/15 px-2.5 py-1 text-[10px] font-bold text-fuchsia-200">
                Two-stage billing
              </span>
            </div>
            <textarea
              value={speechScript}
              onChange={(event) => {
                setSpeechScript(event.target.value);
                setSpeechQuote(null);
                setSpeechJob(null);
              }}
              maxLength={3500}
              rows={4}
              placeholder="Type exactly what the person should say…"
              className="mt-3 w-full rounded-xl border border-white/10 bg-slate-950/55 px-3 py-2 text-sm outline-none focus:border-fuchsia-300/40"
            />
            <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
              <span>Single-speaker script · Qwen voice generation</span>
              <span>{speechScript.length}/3500</span>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <select
                value={speechVoice}
                onChange={(event) => {
                  setSpeechVoice(event.target.value);
                  setSpeechQuote(null);
                }}
                className="min-h-10 rounded-xl border border-white/10 bg-slate-950/60 px-3 text-xs"
              >
                <option value="tongtong">Warm narrator</option>
                <option value="xiaochen">Professional calm</option>
                <option value="jam">British gentleman</option>
                <option value="kazi">Clear standard</option>
                <option value="luodo">Expressive</option>
                <option value="chuichui">Playful</option>
              </select>
              <input
                value={speechStyle}
                onChange={(event) => {
                  setSpeechStyle(event.target.value);
                  setSpeechQuote(null);
                }}
                maxLength={120}
                placeholder="Delivery style"
                className="min-h-10 rounded-xl border border-white/10 bg-slate-950/60 px-3 text-xs"
              />
            </div>
            <button
              type="button"
              onClick={() => void reviewSpeechCost()}
              disabled={!speechScript.trim() || speechQuoting || speechStarting}
              className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-xl border border-fuchsia-300/20 bg-fuchsia-400/10 px-4 py-2 text-xs font-black text-fuchsia-100 hover:bg-fuchsia-400/15 disabled:opacity-40"
            >
              {speechQuoting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {speechQuoting ? "Pricing voice…" : "Review voice cost"}
            </button>

            {speechQuote ? (
              <div className="mt-3 rounded-xl border border-fuchsia-300/15 bg-slate-950/45 p-3">
                <div className="grid gap-2 sm:grid-cols-3">
                  <div><p className="text-[10px] uppercase text-slate-500">Voice charge</p><p className="mt-1 text-sm font-bold">{speechQuote.creditsRequired} credits</p></div>
                  <div><p className="text-[10px] uppercase text-slate-500">Wallet</p><p className="mt-1 text-sm font-bold">{speechQuote.wallet.availableCredits} credits</p></div>
                  <div><p className="text-[10px] uppercase text-slate-500">Provider parts</p><p className="mt-1 text-sm font-bold">{speechQuote.chunkCount}</p></div>
                </div>
                {!speechQuote.hasEnoughCredits ? (
                  <p className="mt-2 text-xs font-semibold text-amber-200">You need {speechQuote.shortfallCredits} more credits.</p>
                ) : (
                  <button
                    type="button"
                    onClick={() => void startSpeechJob()}
                    disabled={speechStarting}
                    className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-fuchsia-500 px-4 py-2 text-xs font-black hover:bg-fuchsia-400 disabled:opacity-40"
                  >
                    {speechStarting ? <Loader2 className="h-4 w-4 animate-spin" /> : <AudioLines className="h-4 w-4" />}
                    {speechStarting ? "Generating speech…" : `Confirm ${speechQuote.creditsRequired} credits & generate voice`}
                  </button>
                )}
              </div>
            ) : null}

            {speechJob ? (
              <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs">
                <p className="font-bold">
                  {speechJob.status === "completed"
                    ? "Voice ready and selected below"
                    : speechJob.status === "needs_reconciliation"
                      ? "Voice job needs safe reconciliation"
                      : speechJob.status === "failed"
                        ? "Voice generation failed"
                        : "Durable voice generation in progress…"}
                </p>
                {speechJob.error ? <p className="mt-1 text-amber-100">{speechJob.error}</p> : null}
                {!["completed", "failed", "needs_reconciliation"].includes(speechJob.status) && !speechStarting ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSpeechStarting(true);
                      setError("");
                      void pollSpeechJob(speechJob.id)
                        .catch((reason) => setError(reason instanceof Error ? reason.message : "Unable to resume voice job"))
                        .finally(() => setSpeechStarting(false));
                    }}
                    className="mt-2 font-bold text-fuchsia-200 hover:text-fuchsia-100"
                  >
                    Resume monitoring
                  </button>
                ) : null}
              </div>
            ) : null}
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
              disabled={providerAvailable !== true || recording || uploadingAudio || quoting || starting || Boolean(job && !["failed", "completed", "needs_reconciliation"].includes(job.status))}
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
