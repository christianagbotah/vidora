"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Auto-save draft hook.
 *
 * Debounced write of a JSON-serializable draft object to localStorage. On
 * mount, returns any previously-saved draft (with a `savedAt` timestamp)
 * so the caller can prompt the user to resume.
 *
 * Usage:
 *   const { draft, saveState, saveNow, clearDraft, hasDraft } = useCreateDraft({
 *     key: "vidora:draft:create",
 *     value: { scriptText, textPrompt, ... },
 *     debounceMs: 2000,
 *   });
 *
 * On mount, `draft` will be the previously-saved value (or null). The
 * caller decides whether to apply it (typically via a "Resume draft?"
 * dialog). After that, every change to `value` triggers a debounced save.
 *
 * `saveState` cycles: "idle" → "saving" → "saved" (or "error"). The caller
 * can render a small indicator ("Saved 5s ago", "Saving…", etc.).
 */

export type DraftSaveState = "idle" | "saving" | "saved" | "error";

export interface SavedDraft<T> {
  value: T;
  savedAt: number; // ms epoch
}

export interface UseCreateDraftOptions<T> {
  /** localStorage key. */
  key: string;
  /** The draft value to persist. Must be JSON-serializable. */
  value: T;
  /** Debounce window in ms. Default 2000. */
  debounceMs?: number;
  /** Set to false to pause auto-save (e.g. while a generation is running). */
  enabled?: boolean;
}

export interface UseCreateDraftResult<T> {
  /** The previously-saved draft loaded on mount (or null). Stays null after
   *  the caller dismisses it via `clearDraft`. */
  savedDraft: SavedDraft<T> | null;
  /** Current save activity. Drives the small "Saving…/Saved" pill. */
  saveState: DraftSaveState;
  /** ms epoch of the last successful write. */
  lastSavedAt: number | null;
  /** Whether there is currently a saved draft in localStorage. */
  hasDraft: boolean;
  /** Force an immediate write (flushes the debounce queue). */
  saveNow: () => void;
  /** Remove the saved draft from localStorage AND clear `savedDraft`. Used
   *  when the user successfully creates the project, or explicitly discards. */
  clearDraft: () => void;
  /** Mark the restored draft as consumed without deleting it from storage.
   *  Use this after the user clicks "Resume" so the prompt doesn't show again. */
  dismissDraftPrompt: () => void;
}

export function useCreateDraft<T>(
  options: UseCreateDraftOptions<T>
): UseCreateDraftResult<T> {
  const { key, value, debounceMs = 2000, enabled = true } = options;

  // Load any saved draft on first mount only.
  const [savedDraft, setSavedDraft] = useState<SavedDraft<T> | null>(null);
  const [saveState, setSaveState] = useState<DraftSaveState>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

  // Track whether we've loaded the initial draft. We don't want to start
  // auto-saving until the caller has had a chance to inspect `savedDraft`
  // and decide whether to apply it.
  const initializedRef = useRef(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const valueRef = useRef(value);
  // Keep valueRef in sync with the latest value AFTER render (so the debounced
  // save callback can read the freshest value without re-running on every keystroke).
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  // One-shot load on mount.
  // We intentionally read localStorage in an effect (not lazy initial state)
  // to avoid SSR/hydration mismatches: the server-rendered HTML must match
  // the first client render, both showing "no draft", and the actual saved
  // draft is loaded only after mount.
  useEffect(() => {
    try {
      const raw = typeof window !== "undefined" ? window.localStorage.getItem(key) : null;
      if (raw) {
        const parsed = JSON.parse(raw) as SavedDraft<T>;
        if (parsed && typeof parsed.savedAt === "number" && parsed.value !== undefined) {
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setSavedDraft(parsed);
          setLastSavedAt(parsed.savedAt);
        }
      }
    } catch {
      // Corrupt JSON — ignore, treat as no draft.
    }
    initializedRef.current = true;
  }, [key]);

  // Debounced write
  const persist = useCallback(() => {
    if (!enabled) return;
    setSaveState("saving");
    try {
      const snapshot: SavedDraft<T> = {
        value: valueRef.current,
        savedAt: Date.now(),
      };
      window.localStorage.setItem(key, JSON.stringify(snapshot));
      setLastSavedAt(snapshot.savedAt);
      setSaveState("saved");
    } catch {
      // Quota exceeded or storage disabled — silently fail.
      setSaveState("error");
    }
  }, [enabled, key]);

  // Watch for value changes (shallow JSON compare) and trigger debounce.
  useEffect(() => {
    if (!initializedRef.current) return;
    if (!enabled) return;

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      persist();
    }, debounceMs);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [value, enabled, debounceMs, persist]);

  // Persist on tab close / page hide (best-effort — localStorage sync write)
  useEffect(() => {
    const onBeforeUnload = () => {
      if (!enabled || !initializedRef.current) return;
      try {
        const snapshot: SavedDraft<T> = {
          value: valueRef.current,
          savedAt: Date.now(),
        };
        window.localStorage.setItem(key, JSON.stringify(snapshot));
      } catch {
        // ignore
      }
    };
    window.addEventListener("pagehide", onBeforeUnload);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("pagehide", onBeforeUnload);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [enabled, key]);

  const clearDraft = useCallback(() => {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // ignore
    }
    setSavedDraft(null);
    setLastSavedAt(null);
    setSaveState("idle");
  }, [key]);

  const dismissDraftPrompt = useCallback(() => {
    setSavedDraft(null);
  }, []);

  const saveNow = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    persist();
  }, [persist]);

  return {
    savedDraft,
    saveState,
    lastSavedAt,
    hasDraft: lastSavedAt !== null,
    saveNow,
    clearDraft,
    dismissDraftPrompt,
  };
}
