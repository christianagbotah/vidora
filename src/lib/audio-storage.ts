/**
 * ───────────────────────────────────────────────────────────────────────────
 *  Vidora — Audio File Storage Helper
 * ───────────────────────────────────────────────────────────────────────────
 *
 *  Writes generated audio files (TTS narration, dubbing) to the OS temp
 *  directory (/tmp/vidora-audio/) using a CHILD PROCESS (bash) instead of
 *  Node's `fs.writeFile`.
 *
 *  WHY: The Next.js Turbopack dev server intercepts `fs.writeFile` /
 *  `fs.writeFileSync` calls inside API route handlers and stores them in a
 *  VIRTUAL filesystem layer (for HMR file-change tracking). These virtual
 *  files are NOT visible to the real filesystem — so they can't be served
 *  as static assets, can't be read back by ffmpeg, and can't be seen by
 *  `ls`. Reads (`fs.readFile`) still go to the real filesystem, but writes
 *  are redirected.
 *
 *  Writing via `execFileSync('bash', ['-c', 'cat > file'])` bypasses this
 *  interception because the write happens in a separate process. The
 *  resulting file is visible to both the real filesystem AND subsequent
 *  `fs.readFile` calls.
 *
 *  In PRODUCTION (next start / PM2, no Turbopack), this overhead is
 *  negligible and the helper still works correctly.
 * ───────────────────────────────────────────────────────────────────────────
 */

import { execFileSync } from "child_process";
import { mkdirSync, readdirSync, unlinkSync, existsSync, statSync } from "fs";
import { readFile } from "fs/promises";
import path from "path";
import os from "os";

const AUDIO_DIR = path.join(os.tmpdir(), "vidora-audio");

/** Ensures the audio directory exists. Uses sync mkdir (also intercepted by
 *  Turbopack in dev, but we double-check with a bash mkdir as fallback). */
export function ensureAudioDir(): string {
  try {
    mkdirSync(AUDIO_DIR, { recursive: true });
  } catch {
    // Fallback: create via bash (bypasses Turbopack interception)
    execFileSync("bash", ["-c", `mkdir -p "${AUDIO_DIR}"`]);
  }
  // Ensure it really exists via bash (authoritative)
  execFileSync("bash", ["-c", `mkdir -p "${AUDIO_DIR}"`]);
  return AUDIO_DIR;
}

/** Writes a Buffer to a file in the audio directory. Uses bash to bypass
 *  Turbopack's fs interception in dev mode. Returns the full file path. */
export function writeAudioFile(filename: string, data: Buffer): string {
  ensureAudioDir();
  const filePath = path.join(AUDIO_DIR, filename);
  // Write via bash — the write happens in a child process, so Turbopack
  // can't intercept it. The file lands on the real filesystem.
  execFileSync("bash", ["-c", `cat > "${filePath}"`], { input: data });
  return filePath;
}

/** Reads a file from the audio directory. fs.readFile works fine for reads
 *  (Turbopack only intercepts writes), so we use the async fs API. */
export async function readAudioFile(filename: string): Promise<Buffer> {
  const filePath = path.join(AUDIO_DIR, filename);
  return readFile(filePath);
}

/** Deletes a file from the audio directory. Uses bash rm to bypass
 *  Turbopack's interception of fs.unlink. */
export function deleteAudioFile(filename: string): void {
  const filePath = path.join(AUDIO_DIR, filename);
  try {
    execFileSync("bash", ["-c", `rm -f "${filePath}"`]);
  } catch {
    // non-fatal
  }
}

/** Lists all files in the audio directory. Uses bash ls (authoritative). */
export function listAudioFiles(): string[] {
  try {
    const output = execFileSync("bash", ["-c", `ls -1 "${AUDIO_DIR}" 2>/dev/null`], { encoding: "utf-8" });
    return output.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

/** Checks if a file exists. Uses bash test (authoritative, bypasses
 *  Turbopack's virtual fs). */
export function audioFileExists(filename: string): boolean {
  const filePath = path.join(AUDIO_DIR, filename);
  try {
    execFileSync("bash", ["-c", `test -f "${filePath}"`]);
    return true;
  } catch {
    return false;
  }
}

/** Gets the full path for a filename in the audio directory. */
export function getAudioPath(filename: string): string {
  return path.join(AUDIO_DIR, filename);
}

export { AUDIO_DIR };
