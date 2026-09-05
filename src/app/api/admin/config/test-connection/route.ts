import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { constructClient, ZAIError, classifyError } from "@/lib/zai";
import {
  generateProviderText,
  getAIProviderSettings,
} from "@/lib/ai-provider-router";

export const runtime = "nodejs";

/**
 * POST /api/admin/config/test-connection
 *
 * New mode: { provider: "active" } verifies the currently-selected text
 * provider through the same capability router production scene planning uses.
 *
 * Legacy mode: { baseUrl, apiKey } keeps the existing one-off Z.ai credential
 * test for backward compatibility with the original admin screen.
 */
export async function POST(req: NextRequest) {
  const { error } = await requireAdmin(req);
  if (error) return error;

  let body: Record<string, unknown> = {};
  try {
    const parsed = await req.json();
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      body = parsed as Record<string, unknown>;
    }
  } catch {
    return NextResponse.json(
      { success: false, error: "Request body must be valid JSON" },
      { status: 400 },
    );
  }

  const mode = typeof body.provider === "string" ? body.provider.trim().toLowerCase() : "";
  const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl.trim() : "";
  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";

  if (mode === "active" || (!baseUrl && !apiKey)) {
    try {
      const settings = await getAIProviderSettings();
      const started = Date.now();
      const reply = await generateProviderText({
        systemPrompt: "You are a provider health check. Reply with exactly OK.",
        userPrompt: "ping",
        thinking: "disabled",
        temperature: 0,
        maxTokens: 12,
        timeoutMs: 20_000,
      });
      return NextResponse.json({
        success: true,
        message: "Active text provider connection successful",
        provider: settings.textProvider,
        model: settings.textModel || (
          settings.textProvider === "xai"
            ? settings.xaiTextModel
            : settings.textProvider === "compatible"
              ? settings.compatibleTextModel
              : process.env.ZAI_CHAT_MODEL || "glm-4-plus"
        ),
        reply: reply.slice(0, 100),
        latencyMs: Date.now() - started,
      });
    } catch (err) {
      return NextResponse.json(
        {
          success: false,
          error: err instanceof Error ? err.message : "Active provider test failed",
        },
        { status: 502 },
      );
    }
  }

  if (!baseUrl || !apiKey) {
    return NextResponse.json(
      { success: false, error: "Both baseUrl and apiKey are required for the legacy Z.ai test" },
      { status: 400 },
    );
  }

  try {
    const client = constructClient(baseUrl, apiKey);
    const response = await client.chat.completions.create({
      messages: [{ role: "user", content: "Say 'ok' in one word." }],
      model: process.env.ZAI_CHAT_MODEL || "glm-4-plus",
      thinking: { type: "disabled" },
      max_tokens: 10,
    });
    const reply = response?.choices?.[0]?.message?.content || "";
    return NextResponse.json({
      success: true,
      message: "Z.ai connection successful",
      provider: "zai",
      reply: reply.slice(0, 100),
    });
  } catch (err: unknown) {
    const classified = err instanceof ZAIError ? err : classifyError(err);
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
