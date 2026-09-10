import { splitQwenTtsInput } from "@/lib/qwen-tts";

const ATTRIBUTION_CAPTURE_RE =
  /^\s*((?:Narrator|Chorus|All|Everyone|[A-Z][A-Za-z'’.-]*(?:\s+[A-Z][A-Za-z'’.-]*)*)(?:\s*[&,+]\s*(?:and\s+)?[A-Z][A-Za-z'’.-]*(?:\s+[A-Z][A-Za-z'’.-]*)*)?(?:\s*\([^)]*\))?)\s*:\s*(.*)$/;

export interface NarrationTextSegment {
  speaker: string | null;
  direction: string | null;
  text: string;
}

function cleanSpokenText(value: string): string {
  return value
    .trim()
    .replace(/^["\u201C]+/, "")
    .replace(/["\u201D]+$/, "")
    .trim();
}

function performanceCueFromSpeakerLabel(label: string): string | null {
  const match = label.match(/\(([^()]*)\)\s*$/);
  const cue = match?.[1]?.trim().replace(/\s+/g, " ").slice(0, 64) || "";
  return cue || null;
}

/** Parse screenplay dialogue while keeping speaker/delivery identity. */
export function parseNarrationTextSegments(text: string): NarrationTextSegment[] {
  const segments: NarrationTextSegment[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const attributed = line.match(ATTRIBUTION_CAPTURE_RE);
    if (attributed) {
      const rawSpeaker = attributed[1].trim();
      const spoken = cleanSpokenText(attributed[2]);
      if (spoken) {
        segments.push({
          speaker: rawSpeaker.replace(/\s*\([^)]*\)\s*$/, "").trim(),
          direction: performanceCueFromSpeakerLabel(rawSpeaker),
          text: spoken,
        });
      }
      continue;
    }

    const spoken = cleanSpokenText(line);
    if (!spoken) continue;
    const previous = segments[segments.length - 1];
    if (previous) previous.text = `${previous.text} ${spoken}`.trim();
    else segments.push({ speaker: null, direction: null, text: spoken });
  }
  return segments;
}

/**
 * Exact text chunks used for Qwen reservation line-items. Each chunk is kept
 * at or below Qwen's safe request limit so one quote line maps to at most one
 * paid provider request.
 */
export function narrationBillableTextChunks(text: string): string[] {
  return parseNarrationTextSegments(text).flatMap((segment) => splitQwenTtsInput(segment.text));
}
