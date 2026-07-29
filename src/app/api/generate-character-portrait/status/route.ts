import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * GET /api/generate-character-portrait/status?taskId=xxx
 *
 * Polls for the result of a previously started portrait generation task.
 * The actual task store lives in the parent route module — we re-export
 * it via a shared module to avoid import cycles.
 *
 * Returns:
 *   { success: false, status: "generating" }  — still working
 *   { success: true, status: "complete", base64 } — done
 *   { success: false, status: "failed", error } — generation failed
 */
export async function GET(req: NextRequest) {
  // Dynamic import to avoid circular deps at module load time
  const { taskStore } = await import("../task-store");
  const taskId = req.nextUrl.searchParams.get("taskId");

  if (!taskId) {
    return NextResponse.json(
      { success: false, error: "taskId is required" },
      { status: 400 }
    );
  }

  const task = taskStore.get(taskId);
  if (!task) {
    return NextResponse.json(
      { success: false, error: "Task not found or expired" },
      { status: 404 }
    );
  }

  // If complete or failed, return result and clean up
  if (task.status === "complete" || task.status === "failed") {
    const result = { ...task };
    taskStore.delete(taskId);
    return NextResponse.json({ success: task.status === "complete", ...result });
  }

  // Still generating
  return NextResponse.json({ success: false, status: "generating" });
}
