"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, Lock, Save, SlidersHorizontal } from "lucide-react";
import {
  PHOTO_MOTION_PRESETS,
  extractCustomPhotoMotionDirection,
  photoMotionPresetFromCameraMove,
  type PhotoMotionPresetId,
} from "@/lib/photo-studio-motion";

type MotionScene = {
  id: string;
  sceneNumber: number;
  title?: string | null;
  imageUrl?: string | null;
  referenceImageUrl?: string | null;
  enhancedPrompt?: string | null;
  cameraMove?: string | null;
  status: string;
  videoUrl?: string | null;
  taskId?: string | null;
};

type DirectionDraft = {
  preset: PhotoMotionPresetId;
  customDirection: string;
};

interface PhotoMotionDirectorProps {
  projectId: string;
  locked?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
}

function draftForScene(scene: MotionScene): DirectionDraft {
  const preset = photoMotionPresetFromCameraMove(scene.cameraMove);
  return {
    preset,
    customDirection: preset === "custom"
      ? extractCustomPhotoMotionDirection(scene.enhancedPrompt)
      : "",
  };
}

export function PhotoMotionDirector({
  projectId,
  locked = false,
  onDirtyChange,
}: PhotoMotionDirectorProps) {
  const [scenes, setScenes] = useState<MotionScene[]>([]);
  const [drafts, setDrafts] = useState<Record<string, DirectionDraft>>({});
  const [loading, setLoading] = useState(true);
  const [savingSceneId, setSavingSceneId] = useState("");
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
          cache: "no-store",
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok || !body.success || !body.project) {
          throw new Error(body.error || "Unable to load Living Photo scenes");
        }
        const nextScenes = Array.isArray(body.project.scenes)
          ? body.project.scenes as MotionScene[]
          : [];
        if (cancelled) return;
        setScenes(nextScenes);
        setDrafts(Object.fromEntries(
          nextScenes.map((scene) => [scene.id, draftForScene(scene)]),
        ));
        setDirty({});
        onDirtyChange?.(false);
      } catch (reason) {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : "Unable to load Motion Director");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [projectId, onDirtyChange]);

  const updateDraft = (sceneId: string, patch: Partial<DirectionDraft>) => {
    setDrafts((current) => ({
      ...current,
      [sceneId]: {
        ...(current[sceneId] || { preset: "natural", customDirection: "" }),
        ...patch,
      },
    }));
    setSaved((current) => ({ ...current, [sceneId]: false }));
    setDirty((current) => {
      const next = { ...current, [sceneId]: true };
      onDirtyChange?.(Object.values(next).some(Boolean));
      return next;
    });
  };

  const saveDirection = async (sceneId: string) => {
    const draft = drafts[sceneId];
    if (!draft || locked) return;
    if (draft.preset === "custom" && !draft.customDirection.trim()) {
      setError("Add a custom motion direction before saving this scene.");
      return;
    }

    setSavingSceneId(sceneId);
    setError("");
    try {
      const response = await fetch(
        `/api/photo-studio/projects/${encodeURIComponent(projectId)}/motion/${encodeURIComponent(sceneId)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            preset: draft.preset,
            customDirection: draft.customDirection,
          }),
        },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.success || !body.scene) {
        throw new Error(body.error || "Unable to save motion direction");
      }
      setScenes((current) => current.map((scene) => (
        scene.id === sceneId ? { ...scene, ...body.scene } : scene
      )));
      setSaved((current) => ({ ...current, [sceneId]: true }));
      setDirty((current) => {
        const next = { ...current, [sceneId]: false };
        onDirtyChange?.(Object.values(next).some(Boolean));
        return next;
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save motion direction");
    } finally {
      setSavingSceneId("");
    }
  };

  return (
    <div className="mt-4 rounded-xl border border-fuchsia-300/20 bg-slate-950/50 p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-bold text-fuchsia-100">
            <SlidersHorizontal className="h-4 w-4" />
            Motion Director
          </p>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-400">
            Direct each still before AI generation. These edits are provider-free and preserve the original photo as the reference image.
          </p>
        </div>
        <span className="rounded-full border border-emerald-300/15 bg-emerald-400/10 px-2.5 py-1 text-[11px] font-bold text-emerald-200">
          0 credits to direct
        </span>
      </div>

      {locked ? (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-300/15 bg-amber-400/10 p-3 text-xs leading-5 text-amber-100">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" />
          Motion direction is locked after Living Photo generation starts. Use Vidora Studio for reviewed regeneration or corrections.
        </div>
      ) : null}

      {error ? (
        <div className="mt-3 rounded-lg border border-red-300/15 bg-red-400/10 p-3 text-xs text-red-100">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="mt-4 flex min-h-24 items-center justify-center gap-2 text-xs text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading scene direction controls…
        </div>
      ) : (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {scenes.map((scene) => {
            const draft = drafts[scene.id] || { preset: "natural" as const, customDirection: "" };
            const sceneLocked = locked || Boolean(scene.videoUrl || scene.taskId) ||
              ["queued", "submitting", "generating"].includes(scene.status);
            const previewUrl = scene.referenceImageUrl || scene.imageUrl || "";

            return (
              <div key={scene.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <div className="flex gap-3">
                  {previewUrl ? (
                    <img
                      src={previewUrl}
                      alt={scene.title || `Photo ${scene.sceneNumber}`}
                      className="h-20 w-20 shrink-0 rounded-lg border border-white/10 object-cover"
                    />
                  ) : (
                    <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-xs text-slate-500">
                      {scene.sceneNumber}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-xs font-bold text-white">
                        {scene.title || `Photo ${scene.sceneNumber}`}
                      </p>
                      {saved[scene.id] ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-300">
                          <Check className="h-3 w-3" /> Saved
                        </span>
                      ) : null}
                    </div>
                    <select
                      value={draft.preset}
                      disabled={sceneLocked || savingSceneId === scene.id}
                      onChange={(event) => updateDraft(scene.id, {
                        preset: event.target.value as PhotoMotionPresetId,
                      })}
                      className="mt-2 w-full rounded-lg border border-white/10 bg-slate-950 px-2.5 py-2 text-xs text-white disabled:opacity-50"
                    >
                      {PHOTO_MOTION_PRESETS.map((preset) => (
                        <option key={preset.id} value={preset.id}>{preset.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {draft.preset === "custom" ? (
                  <textarea
                    value={draft.customDirection}
                    disabled={sceneLocked || savingSceneId === scene.id}
                    maxLength={500}
                    rows={2}
                    placeholder="e.g. Slow push toward the subject, subtle smile and blinking, keep the background architecture unchanged."
                    onChange={(event) => updateDraft(scene.id, {
                      customDirection: event.target.value,
                    })}
                    className="mt-3 w-full resize-none rounded-lg border border-white/10 bg-slate-950 px-3 py-2.5 text-xs leading-5 text-white placeholder:text-slate-600 disabled:opacity-50"
                  />
                ) : null}

                <button
                  type="button"
                  disabled={sceneLocked || savingSceneId === scene.id ||
                    (draft.preset === "custom" && !draft.customDirection.trim())}
                  onClick={() => void saveDirection(scene.id)}
                  className="mt-3 inline-flex min-h-9 w-full items-center justify-center gap-2 rounded-lg border border-fuchsia-300/20 bg-fuchsia-400/10 px-3 py-2 text-xs font-bold text-fuchsia-100 hover:bg-fuchsia-400/15 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {savingSceneId === scene.id
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <Save className="h-3.5 w-3.5" />}
                  {savingSceneId === scene.id ? "Saving direction…" : "Save direction"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
