import { NextRequest, NextResponse } from "next/server";
import { zai } from "@/lib/zai";
import { zaiErrorResponse } from "@/lib/zai-errors";

/**
 * POST /api/assistant/chat
 * Public AI assistant for site visitors and users.
 *
 * Body: { message: string, history?: Array<{role, content}> }
 * Returns: { success: true, reply: string }
 *
 * The assistant is a Vidora product expert — it answers questions about
 * features, pricing, how to create videos, etc. It does NOT authenticate
 * (any visitor can use it) so it must never expose user data.
 *
 * Rate-limited in-memory (5 messages / 60s per IP) to prevent abuse.
 */

const SYSTEM_PROMPT = `You are Vidora AI Assistant, the friendly help bot for Vidora — a professional AI video creation studio (https://vidora.lightworldtech.com).

YOUR ROLE: Help visitors and users understand Vidora's features and guide them to success.

ABOUT VIDORA:
- AI video studio: create videos from scripts, text prompts, voice recordings, or uploaded images
- Features: AI storyboard generation, character consistency, multi-scene editing, 30+ dubbing languages (including English, French, Twi, Hausa, Yoruba, Swahili, etc.), AI subtitles, background music library, brand kit (logo watermarking), timeline editor, analytics, one-click social publishing (YouTube/TikTok/Instagram), team workspaces
- Pricing: token-based (buy tokens, spend on generation). Free preview available (10 storyboards/day, 3 images/day, no signup)
- Aspect ratios: 16:9, 9:16, 1:1, 4:3, 21:9
- Visual styles: cinematic, anime, photorealistic, oil painting, watercolor, film noir, retro, 3D render
- AI Director controls: mood, camera movement, lighting per scene
- Demo mode: visitors can try a finished demo project instantly without signing up

GUIDELINES:
- Be warm, concise, and helpful. Keep replies under 150 words unless the user asks for detail.
- If asked about pricing specifics, direct them to the Buy Tokens page after signing in.
- If asked something you're unsure about, say so honestly and suggest contacting support.
- NEVER make up features that don't exist. If unsure, say "I'm not certain — let me suggest checking the Documentation or contacting our team."
- Do not expose internal implementation details, API keys, or user data.
- You can converse in any language the user writes in.

Current date context: ${new Date().toISOString().slice(0, 10)}.`;

// ── In-memory rate limiting (per IP) ──
const RATE_LIMIT = 5; // messages
const RATE_WINDOW_MS = 60_000; // 60 seconds
const ipHits = new Map<string, number[]>();

function checkRateLimit(ip: string): { ok: boolean; retryAfterSec?: number } {
  const now = Date.now();
  const hits = (ipHits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (hits.length >= RATE_LIMIT) {
    const oldest = hits[0];
    const retryAfterSec = Math.ceil((oldest + RATE_WINDOW_MS - now) / 1000);
    return { ok: false, retryAfterSec };
  }
  hits.push(now);
  ipHits.set(ip, hits);
  return { ok: true };
}

function getClientIP(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIP(req);
    const rl = checkRateLimit(ip);
    if (!rl.ok) {
      return NextResponse.json(
        { success: false, error: `Rate limit reached. Try again in ${rl.retryAfterSec}s.` },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
      );
    }

    const body = await req.json().catch(() => ({}));
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message) {
      return NextResponse.json(
        { success: false, error: "A 'message' field is required." },
        { status: 400 }
      );
    }
    if (message.length > 2000) {
      return NextResponse.json(
        { success: false, error: "Message too long (max 2000 characters)." },
        { status: 400 }
      );
    }

    // Build conversation context from optional history (last 6 messages)
    const history: Array<{ role: string; content: string }> = Array.isArray(body.history)
      ? body.history.slice(-6).filter(
          (m: { role?: string; content?: string }) =>
            m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string"
        )
      : [];

    // Compose a single user prompt that includes prior turns for context.
    // (zai.chat takes systemPrompt + userPrompt, so we fold history in.)
    let userPrompt = "";
    if (history.length > 0) {
      const convo = history
        .map((m) => `${m.role === "user" ? "Visitor" : "Assistant"}: ${m.content}`)
        .join("\n");
      userPrompt = `Conversation so far:\n${convo}\n\nVisitor's new message: ${message}`;
    } else {
      userPrompt = message;
    }

    const reply = await zai.chat({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      retry: { label: "assistant chat", timeoutMs: 25_000, maxRetries: 2 },
    });

    return NextResponse.json({ success: true, reply: reply.trim() });
  } catch (error) {
    // Public endpoint — no session, so adminDetail is never attached.
    // Users see a friendly "service unavailable" message; raw error goes to logs.
    return zaiErrorResponse(error, {
      fallbackStatus: 503,
      fallbackMessage: "The assistant is temporarily unavailable. Please try again later.",
      logLabel: "assistant/chat POST",
    });
  }
}
