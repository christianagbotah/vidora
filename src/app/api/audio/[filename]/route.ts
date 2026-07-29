import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { readAudioFile, audioFileExists } from "@/lib/audio-storage";

/**
 * GET /api/audio/[filename]
 * Streams a generated audio file (TTS narration, dubbing) from /tmp/vidora-audio/.
 *
 * Files are written there by the audio-storage helper (which uses bash to
 * bypass Turbopack's fs interception in dev mode). This route reads them
 * back and streams them to the browser with the correct Content-Type.
 *
 * Supports .wav and .mp3 files.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  try {
    const { filename } = await params;

    // Sanitize: only allow alphanumeric, underscore, hyphen, dot in the filename
    // to prevent path traversal attacks.
    if (!/^[\w.\-]+$/.test(filename)) {
      return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
    }

    // Only allow audio file extensions
    if (!/\.(wav|mp3|ogg|m4a)$/i.test(filename)) {
      return NextResponse.json({ error: "Only audio files are supported" }, { status: 400 });
    }

    if (!audioFileExists(filename)) {
      return NextResponse.json({ error: "Audio file not found" }, { status: 404 });
    }

    const buffer = await readAudioFile(filename);

    const ext = path.extname(filename).toLowerCase();
    const contentType =
      ext === ".wav" ? "audio/wav" :
      ext === ".mp3" ? "audio/mpeg" :
      ext === ".ogg" ? "audio/ogg" :
      ext === ".m4a" ? "audio/mp4" :
      "application/octet-stream";

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": buffer.length.toString(),
        "Cache-Control": "public, max-age=86400, immutable",
        "Accept-Ranges": "bytes",
      },
    });
  } catch (error) {
    console.error("[audio serve]", error);
    return NextResponse.json({ error: "Failed to serve audio" }, { status: 500 });
  }
}
