/**
 * In-memory task store for fire-and-forget portrait generation.
 *
 * Shared between:
 *   - POST /api/generate-character-portrait  (creates tasks)
 *   - GET  /api/generate-character-portrait/status (reads tasks)
 *
 * Tasks are auto-cleaned after 10 minutes.
 */

export interface PortraitTask {
  status: "pending" | "generating" | "complete" | "failed";
  base64?: string;
  error?: string;
  createdAt: number;
}

export const taskStore = new Map<string, PortraitTask>();

// Auto-cleanup stale tasks every 5 minutes
if (typeof globalThis !== "undefined" && typeof setInterval === "function") {
  setInterval(() => {
    const now = Date.now();
    for (const [id, task] of taskStore) {
      if (now - task.createdAt > 10 * 60 * 1000) {
        taskStore.delete(id);
      }
    }
  }, 5 * 60 * 1000);
}
