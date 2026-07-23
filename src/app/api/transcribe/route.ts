import { NextRequest, NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";
import { writeFile, unlink } from "fs/promises";
import { readFile } from "fs/promises";
import path from "path";
import os from "os";

export async function POST(req: NextRequest) {
  let tempPath: string | null = null;
  try {
    const formData = await req.formData();
    const audioFile = formData.get("audio") as File | null;

    if (!audioFile) {
      return NextResponse.json(
        { success: false, error: "No audio file provided" },
        { status: 400 }
      );
    }

    const bytes = await audioFile.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Save to temp file
    const ext = audioFile.name.split(".").pop() || "webm";
    tempPath = path.join(os.tmpdir(), `audio_${Date.now()}.${ext}`);
    await writeFile(tempPath, buffer);

    const fileData = await readFile(tempPath);
    const base64Audio = fileData.toString("base64");

    const zai = await ZAI.create();
    const response = await zai.audio.asr.create({
      file_base64: base64Audio,
    });

    return NextResponse.json({
      success: true,
      transcription: response.text,
    });
  } catch (error) {
    console.error("Failed to transcribe audio:", error);
    return NextResponse.json(
      { success: false, error: "Failed to transcribe audio" },
      { status: 500 }
    );
  } finally {
    if (tempPath) {
      try {
        await unlink(tempPath);
      } catch {}
    }
  }
}
