import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { zai } from "@/lib/zai";
import { zaiErrorResponse } from "@/lib/zai-errors";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const audioFile = formData.get("audio") as File | null;

    if (!audioFile) {
      return NextResponse.json(
        { success: false, error: "No audio file provided" },
        { status: 400 }
      );
    }

    // Convert the uploaded audio directly to base64 — no temp file needed.
    const bytes = await audioFile.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const base64Audio = buffer.toString("base64");

    const transcription = await zai.asr({
      fileBase64: base64Audio,
      retry: { label: "Transcribe audio", timeoutMs: 120_000, maxRetries: 3 },
    });

    return NextResponse.json({
      success: true,
      transcription,
    });
  } catch (error) {
    const session = await getServerSession(authOptions).catch(() => null);
    return zaiErrorResponse(error, {
      session,
      logLabel: "transcribe",
    });
  }
}
