import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/project-auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const authResult = await requireAuth();
  if (!authResult.ok) return authResult.response;

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
  if (task.userId !== authResult.session.userId) {
    // Do not disclose whether another user's task exists.
    return NextResponse.json(
      { success: false, error: "Task not found or expired" },
      { status: 404 }
    );
  }

  if (task.status === "complete" || task.status === "failed") {
    const result = { ...task };
    taskStore.delete(taskId);
    // Never expose the internal owner identifier in the response.
    const { userId: _userId, ...publicResult } = result;
    return NextResponse.json({
      success: task.status === "complete",
      ...publicResult,
    });
  }

  return NextResponse.json({ success: false, status: "generating" });
}
