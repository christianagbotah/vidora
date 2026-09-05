"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
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

type LocalFallback = {
  projectId?: string | null;
  title?: string;
  snapshot?: CreateDraftSnapshot;
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
  const { data: authSession } = useSession();
  const accountScope = useMemo(() => {
    const email = authSession?.user?.email?.trim().toLowerCase();
    return encodeURIComponent(email || "signed-in-user");
  }, [authSession?.user?.email]);
  const draftIdStorageKey = `${DRAFT_ID_KEY}:${accountScope}`;
  const draftFallbackStorageKey = `${DRAFT_FALLBACK_KEY}:${accountScope}`;

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

  // A session identity change must never reuse another account's in-memory
  // project id or restoration state, even on a shared browser/device.
  useEffect(() => {
    projectIdRef.current = null;
    setProjectId(null);
    setStatus("idle");
    setLastSavedAt(null);
    setRestoreChecked(false);
  }, [accountScope]);

  const rememberProjectId = useCallback((id: string | null) => {
    projectIdRef.current = id;
    setProjectId(id);
    if (typeof window === "undefined") return;
    if (id) localStorage.setItem(draftIdStorageKey, id);
    else localStorage.removeItem(draftIdStorageKey);
  }, [draftIdStorageKey]);

  const readFallback = useCallback((expectedProjectId?: string | null): LocalFallback | null => {
    if (typeof window === "undefined") return null;
    try {
      const raw = localStorage.getItem(draftFallbackStorageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as LocalFallback;
      if (!parsed.title || !parsed.snapshot || parsed.snapshot.version !== 1) return null;
      // When a server draft id is known, never restore a fallback that belongs
      // to a different draft. Older v1 envelopes without projectId are still
      // accepted only when no expected id exists.
      if (expectedProjectId && parsed.projectId && parsed.projectId !== expectedProjectId) return null;
      return parsed;
    } catch {
      return null;
    }
  }, [draftFallbackStorageKey]);

  const restoreFallback = useCallback((expectedProjectId?: string | null) => {
    const parsed = readFallback(expectedProjectId);
    if (!parsed?.title || !parsed.snapshot) return false;
    restoringRef.current = true;
    if (expectedProjectId) rememberProjectId(expectedProjectId);
    else if (parsed.projectId) rememberProjectId(parsed.projectId);
    onRestore(parsed.title, parsed.snapshot);
    queueMicrotask(() => { restoringRef.current = false; });
    return true;
  }, [onRestore, readFallback, rememberProjectId]);

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

  // Full reload recovery. The local fallback is written synchronously on every
  // edit and can therefore be newer than PostgreSQL during the debounce window.
  // Prefer it when it belongs to the remembered server project, then fall back
  // to the exact server draft, then the user's latest server draft.
  useEffect(() => {
    if (!enabled || restoreChecked) return;
    let cancelled = false;
    (async () => {
      const remembered = typeof window !== "undefined"
        ? localStorage.getItem(draftIdStorageKey)
        : null;
      let restored = false;
      if (remembered && !cancelled) restored = restoreFallback(remembered);
      if (!restored && remembered) restored = await loadDraft(remembered);
      if (!restored && !remembered && !cancelled) restored = restoreFallback(null);
      if (!restored) restored = await loadDraft(null);
      if (!cancelled) setRestoreChecked(true);
    })();
    return () => { cancelled = true; };
  }, [enabled, restoreChecked, loadDraft, restoreFallback, draftIdStorageKey]);

  // Small synchronous fallback for sudden refresh/crash before the debounced
  // network save finishes. Base64 images are intentionally excluded; those
  // are flushed immediately to generated-store by the server save below.
  useEffect(() => {
    if (!enabled || !title.trim() || restoringRef.current || typeof window === "undefined") return;
    try {
      localStorage.setItem(draftFallbackStorageKey, JSON.stringify({
        projectId: projectIdRef.current,
        title: title.trim(),
        snapshot: {
          ...snapshot,
          preCharImages: hasOnlyDurableImageUrls(snapshot.preCharImages),
          savedAt: new Date().toISOString(),
        },
      } satisfies LocalFallback));
    } catch {
      // Browser storage can be disabled or full; server autosave remains authoritative.
    }
  }, [enabled, title, snapshot, draftFallbackStorageKey]);

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

  // Debounce ordinary typing/option changes. Fresh base64 character portraits
  // are different: the local fallback intentionally excludes them, so save
  // those immediately into persistent generated-store before a refresh can
  // discard an expensive generation result.
  useEffect(() => {
    if (!enabled || !restoreChecked || restoringRef.current || !title.trim()) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    const hasUnpersistedPortrait = Object.values(snapshot.preCharImages)
      .some((value) => value.startsWith("data:image/"));
    const delay = hasUnpersistedPortrait ? 0 : AUTOSAVE_DELAY_MS;
    timerRef.current = setTimeout(() => { void saveNow(); }, delay);
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
    if (typeof window !== "undefined") localStorage.removeItem(draftFallbackStorageKey);
  }, [rememberProjectId, draftFallbackStorageKey]);

  return {
    draftProjectId: projectId,
    autosaveStatus: status,
    lastAutosavedAt: lastSavedAt,
    ensureDraftSaved: ensureSaved,
    resumeDraftProject: resumeProject,
    clearDraftReference,
  };
}
