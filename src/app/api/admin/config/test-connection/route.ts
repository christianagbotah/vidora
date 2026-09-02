import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { constructClient, ZAIError, classifyError } from "@/lib/zai";

export const runtime = "nodejs";

/**
 * POST /api/admin/config/test-connection
 *
 * Accepts { baseUrl, apiKey } in the body. Builds a one-off ZAI client
 * with those credentials, sends a tiny chat ping, and returns the result.
 * This lets admins TEST credentials BEFORE saving them to the DB.
 */
export async function POST(req: NextRequest) {
  const { error } = await requireAdmin(req);
  if (error) return error;

  let baseUrl: string;
  let apiKey: string;

  try {
    const body = await req.json();
    baseUrl = (body.baseUrl || "").trim();
    apiKey = (body.apiKey || "").trim();
  } catch {
    return NextResponse.json(
      { success: false, error: "Request body must include baseUrl and apiKey" },
      { status: 400 },
    );
  }

  if (!baseUrl || !apiKey) {
    return NextResponse.json(
      { success: false, error: "Both baseUrl and apiKey are required" },
      { status: 400 },
    );
  }

  try {
    // Build a one-off client with the provided credentials (same logic as the
    // singleton in zai.ts — no singleton side effects).
    const client = constructClient(baseUrl, apiKey);

    const response = await client.chat.completions.create({
      messages: [{ role: "user", content: "Say 'ok' in one word." }],
      model: "glm-4-flash",
    });

    const reply = response?.choices?.[0]?.message?.content || "";

    return NextResponse.json({
      success: true,
      message: "Connection successful!",
      reply: reply.slice(0, 100),
    });
  } catch (err: unknown) {
    // Classify the error for a clear message
    const classified = err instanceof ZAIError
      ? err
      : classifyError(err);

    return NextResponse.json(
      {
        success: false,
        error: classified.message,
        kind: classified.kind,
      },
      { status: classified.kind === "auth" ? 401 : classified.kind === "validation" ? 400 : 502 },
    );
  }
}
