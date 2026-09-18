import crypto from "crypto";
import { execFile } from "child_process";
import { mkdir, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export const TALKING_PHOTO_MAX_AUDIO_BYTES = 50 * 1024 * 1024;
export const TALKING_PHOTO_MAX_DURATION_SECONDS = 600;

export interface ProbedAudio {
  durationSeconds: number;
  extension: "mp3" | "wav" | "m4a" | "ogg" | "webm" | "flac" | "aac";
  mimeType: string;
}

function resolveAudioFormat(formatName: string): Pick<ProbedAudio, "extension" | "mimeType"> | null {
  const formats = new Set(formatName.toLowerCase().split(",").map((item) => item.trim()));
  if (formats.has("mp3")) return { extension: "mp3", mimeType: "audio/mpeg" };
  if (formats.has("wav")) return { extension: "wav", mimeType: "audio/wav" };
  if (formats.has("ogg")) return { extension: "ogg", mimeType: "audio/ogg" };
  if (formats.has("webm") || formats.has("matroska")) return { extension: "webm", mimeType: "audio/webm" };
  if (formats.has("flac")) return { extension: "flac", mimeType: "audio/flac" };
  if (formats.has("aac")) return { extension: "aac", mimeType: "audio/aac" };
  if (formats.has("mov") || formats.has("mp4") || formats.has("m4a") || formats.has("3gp") || formats.has("3g2") || formats.has("mj2")) {
    return { extension: "m4a", mimeType: "audio/mp4" };
  }
  return null;
}

export async function probeTalkingPhotoAudio(buffer: Buffer): Promise<ProbedAudio> {
  if (!buffer.length) throw new Error("Audio file is empty.");
  if (buffer.length > TALKING_PHOTO_MAX_AUDIO_BYTES) {
    throw new Error("Talking Photo audio must be 50 MB or smaller.");
  }

  const directory = path.join(os.tmpdir(), "vidora-talking-photo-probe");
  await mkdir(directory, { recursive: true });
  const filePath = path.join(directory, `${crypto.randomUUID()}.media`);

  try {
    await writeFile(filePath, buffer);
    const { stdout } = await execFileAsync(
      "ffprobe",
      [
        "-v", "error",
        "-show_entries", "stream=codec_type:format=format_name,duration",
        "-of", "json",
        filePath,
      ],
      { timeout: 20_000, maxBuffer: 512 * 1024 },
    );
    const parsed = JSON.parse(stdout) as {
      streams?: Array<{ codec_type?: string }>;
      format?: { format_name?: string; duration?: string | number };
    };
    const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
    if (!streams.some((stream) => stream.codec_type === "audio")) {
      throw new Error("The uploaded file does not contain an audio stream.");
    }
    if (streams.some((stream) => stream.codec_type === "video")) {
      throw new Error("Upload an audio-only file for Talking Photo.");
    }

    const durationSeconds = Number(parsed.format?.duration);
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new Error("Audio duration could not be measured.");
    }
    if (durationSeconds > TALKING_PHOTO_MAX_DURATION_SECONDS + 0.001) {
      throw new Error("Talking Photo audio must be 10 minutes or shorter.");
    }

    const format = resolveAudioFormat(String(parsed.format?.format_name || ""));
    if (!format) {
      throw new Error("Use MP3, WAV, M4A/AAC, OGG, WebM audio, or FLAC.");
    }

    return {
      durationSeconds,
      ...format,
    };
  } finally {
    await rm(filePath, { force: true }).catch(() => undefined);
  }
}
