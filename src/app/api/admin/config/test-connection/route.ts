import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";

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
    // Dynamically import so we don't pollute the module-level singleton
    const ZAI = (await import("z-ai-web-dev-sdk")).default;

    type ZAIInstance = Awaited<ReturnType<typeof ZAI.create>>;
    type ZAIConstructor = new (config: {
      baseUrl: string;
      apiKey: string;
      chatId?: string;
      userId?: string;
      token?: string;
    }) => ZAIInstance;

    // Build a one-off client with the provided credentials
    const client = new (ZAI as unknown as ZAIConstructor)({
      baseUrl,
      apiKey,
    });

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
    let msg = "Unknown error";
    if (err instanceof Error) {
      msg = err.message;
      // Truncate very long error messages (e.g. HTML error pages)
      if (msg.length > 500) msg = msg.slice(0, 500) + "...";
    }
    return NextResponse.json(
      { success: false, error: msg },
      { status: 502 },
    );
  }
}
