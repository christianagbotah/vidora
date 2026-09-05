"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CreateDraftSaveResponse,
  CreateDraftSaveStatus,
  CreateDraftSnapshot,
} from "@/lib/create-draft-types";

const DRAFT_ID_KEY = "vidora:create-draft-project-id";
const DRAFT_FALLBACK_KEY = "vidora:create-draft-fallback-v1";
const AUTOSAVE_DELAY_MS = 700;

type RestoredProject = {
  id: string;
  title: string;
  draftData?: string | null;
};

interface UseCreateDraftAutosaveOptions {
  enabled: boolean;
  title: string;
  snapshot: CreateDraftSnapshot;
  onRestore: (title: string, snapshot: CreateDraftSnapshot) => void;
  onPersistedImages: (images: Record<string, string>) => void;
}

interface SaveResult {
  projectId: string;
  snapshot?: CreateDraftSnapshot;
}

function hasOnlyDurableImageUrls(images: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(images).filter(([, value]) => value.startsWith("/generated/")),
  );
}

function parseDraftData(project: RestoredProject): CreateDraftSnapshot | null {
  if (!project.draftData) return null;
  try {
    const parsed = JSON.parse(project.draftData) as CreateDraftSnapshot;
    return parsed && parsed.version === 1 ? parsed : null;
  } catch {
    return null;
  }
}

export function useCreateDraftAutosave({
  enabled,
  title,
  snapshot,
  onRestore,
  onPersistedImages,
}: UseCreateDraftAutosaveOptions) {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [status, setStatus] = useState<CreateDraftSaveStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [restoreChecked, setRestoreChecked] = useState(false);

  const projectIdRef = useRef<string | null>(null);
  const restoringRef = useRef(false);
  const saveChainRef = useRef<Promise<SaveResult | null>>(Promise.resolve(null));
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const snapshotRef = useRef(snapshot);
  const titleRef = useRef(title);

  snapshotRef.current = snapshot;
  titleRef.current = title;

  useEffect(() => () => {
    mountedRef.current = false;
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const rememberProjectId = useCallback((id: string | null) => {
    projectIdRef.current = id;
    setProjectId(id);
    if (typeof window === "undefined") return;
    if (id) localStorage.setItem(DRAFT_ID_KEY, id);
    else localStorage.removeItem(DRAFT_ID_KEY);
  }, []);

  const restoreFallback = useCallback(() => {
    if (typeof window === "undefined") return false;
    try {
      const raw = localStorage.getItem(DRAFT_FALLBACK_KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw) as { title?: string; snapshot?: CreateDraftSnapshot };
      if (!parsed.title || !parsed.snapshot || parsed.snapshot.version !== 1) return false;
      restoringRef.current = true;
      onRestore(parsed.title, parsed.snapshot);
      queueMicrotask(() => { restoringRef.current = false; });
      return true;
    } catch {
      return false;
    }
  }, [onRestore]);

  const loadDraft = useCallback(async (requestedProjectId?: string | null): Promise<boolean> => {
    if (!enabled) return false;
    restoringRef.current = true;
    try {
      const query = requestedProjectId
        ? `?projectId=${encodeURIComponent(requestedProjectId)}`
        : "";
      const res = await fetch(`/api/projects/draft${query}`, { credentials: "include" });
      const data = await res.json();
      if (!res.ok || !data.success || !data.project) return false;
      const project = data.project as RestoredProject;
      const restored = parseDraftData(project);
      if (!restored) return false;
      rememberProjectId(project.id);
      onRestore(project.title, restored);
      setLastSavedAt((data.project.lastAutosavedAt as string | null | undefined) || restored.savedAt || null);
      setStatus("saved");
      return true;
    } catch {
      return false;
    } finally {
      // Let React commit the restored setters before autosave can observe them.
      setTimeout(() => { restoringRef.current = false; }, 0);
    }
  }, [enabled, onRestore, rememberProjectId]);

  // Full reload recovery: prefer the exact draft id remembered by this
  // browser, then the user's latest server draft, then the small local fallback.
  useEffect(() => {
    if (!enabled || restoreChecked) return;
    let cancelled = false;
    (async () => {
      const remembered = typeof window !== "undefined" ? localStorage.getItem(DRAFT_ID_KEY) : null;
      let restored = false;
      if (remembered) restored = await loadDraft(remembered);
      // A synchronous fallback can be newer than the server when a refresh
      // happens inside the 700ms debounce window, so prefer it next.
      if (!restored && !cancelled) restored = restoreFallback();
      if (!restored) restored = await loadDraft(null);
      if (!cancelled) setRestoreChecked(true);
    })();
    return () => { cancelled = true; };
  }, [enabled, restoreChecked, loadDraft, restoreFallback]);

  // Small synchronous fallback for sudden refresh/crash before the debounced
  // network save finishes. Base64 images are intentionally excluded; those
  // move to generated-store via the server autosave.
  useEffect(() => {
    if (!enabled || !title.trim() || restoringRef.current || typeof window === "undefined") return;
    try {
      localStorage.setItem(DRAFT_FALLBACK_KEY, JSON.stringify({
        title: title.trim(),
        snapshot: {
          ...snapshot,
          preCharImages: hasOnlyDurableImageUrls(snapshot.preCharImages),
          savedAt: new Date().toISOString(),
        },
      }));
    } catch {
      // Browser storage can be disabled; server autosave remains authoritative.
    }
  }, [enabled, title, snapshot]);

  const saveNow = useCallback(async (): Promise<SaveResult | null> => {
    if (!enabled || restoringRef.current) return null;
    const currentTitle = titleRef.current.trim();
    if (!currentTitle) return null;
    const currentSnapshot = snapshotRef.current;

    const run = async (): Promise<SaveResult | null> => {
      if (mountedRef.current) setStatus("saving");
      try {
        const res = await fetch("/api/projects/draft", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            projectId: projectIdRef.current,
            title: currentTitle,
            snapshot: currentSnapshot,
          }),
        });
        const data = await res.json() as CreateDraftSaveResponse;
        if (!res.ok || !data.success || !data.projectId) {
          throw new Error(data.error || "Autosave failed");
        }
        rememberProjectId(data.projectId);
        if (data.snapshot?.preCharImages) {
          onPersistedImages(data.snapshot.preCharImages);
        }
        if (mountedRef.current) {
          setStatus("saved");
          setLastSavedAt(data.autosavedAt || new Date().toISOString());
        }
        return { projectId: data.projectId, snapshot: data.snapshot };
      } catch (error) {
        console.error("[create-draft] autosave failed", error);
        if (mountedRef.current) setStatus("error");
        return null;
      }
    };

    const chained = saveChainRef.current.then(run, run);
    saveChainRef.current = chained;
    return chained;
  }, [enabled, onPersistedImages, rememberProjectId]);

  // Debounce normal typing/option changes. Once a title exists, every create
  // wizard state transition becomes recoverable without a Save button.
  useEffect(() => {
    if (!enabled || !restoreChecked || restoringRef.current || !title.trim()) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { void saveNow(); }, AUTOSAVE_DELAY_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [enabled, restoreChecked, title, snapshot, saveNow]);

  const ensureSaved = useCallback(async (): Promise<SaveResult | null> => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    return saveNow();
  }, [saveNow]);

  const resumeProject = useCallback(async (id: string): Promise<boolean> => {
    rememberProjectId(id);
    const restored = await loadDraft(id);
    setRestoreChecked(true);
    return restored;
  }, [loadDraft, rememberProjectId]);

  const clearDraftReference = useCallback(() => {
    rememberProjectId(null);
    setStatus("idle");
    setLastSavedAt(null);
    if (typeof window !== "undefined") localStorage.removeItem(DRAFT_FALLBACK_KEY);
  }, [rememberProjectId]);

  return {
    draftProjectId: projectId,
    autosaveStatus: status,
    lastAutosavedAt: lastSavedAt,
    ensureDraftSaved: ensureSaved,
    resumeDraftProject: resumeProject,
    clearDraftReference,
  };
}
