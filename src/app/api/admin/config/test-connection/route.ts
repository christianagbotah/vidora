import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { zai, resetZaiClient } from "@/lib/zai";

export const runtime = "nodejs";

/**
 * POST /api/admin/config/test-connection
 *
 * Resets the ZAI client (to pick up freshly-saved DB credentials),
 * then sends a tiny chat completion to verify connectivity.
 */
export async function POST(req: NextRequest) {
  const { error } = await requireAdmin(req);
  if (error) return error;

  // Reset so we pick up the latest DB values
  resetZaiClient();

  try {
    const result = await zai.chat({
      messages: [{ role: "user", content: "Say 'ok' in one word." }],
      model: "glm-4-flash",
      retry: { label: "ZAI connection test", timeoutMs: 15_000, maxRetries: 0 },
    });

    return NextResponse.json({
      success: true,
      message: "Connection successful!",
      reply: result?.slice(0, 100),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: msg },
      { status: 502 },
    );
  }
}
