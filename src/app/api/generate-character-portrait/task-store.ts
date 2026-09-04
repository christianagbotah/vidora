/**
 * Temporary portrait task store.
 *
 * NOTE: this remains process-local until the durable worker migration lands.
 * Every entry is nevertheless bound to its authenticated owner so status
 * polling cannot disclose generated media across users.
 */

export interface PortraitTask {
  userId: string;
  status: "pending" | "generating" | "complete" | "failed";
  base64?: string;
  error?: string;
  createdAt: number;
}

export const taskStore = new Map<string, PortraitTask>();

if (typeof globalThis !== "undefined" && typeof setInterval === "function") {
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [id, task] of taskStore) {
      if (now - task.createdAt > 10 * 60 * 1000) {
        taskStore.delete(id);
      }
    }
  }, 5 * 60 * 1000);
  // Do not keep a standalone Node worker alive solely for cleanup.
  if (typeof timer === "object" && "unref" in timer) timer.unref();
}
