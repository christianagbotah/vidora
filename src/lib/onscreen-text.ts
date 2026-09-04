/**
 * ───────────────────────────────────────────────────────────────────────────
 *  Vidora — On-Screen Text Intelligence
 * ───────────────────────────────────────────────────────────────────────────
 *
 *  WHY THIS EXISTS
 *  Users write scripts that describe text meant to be VISIBLE in the video:
 *    • cake inscriptions  ("a huge birthday cake" → the cake should read
 *      "Happy Birthday Giannis" in frosting)
 *    • party banners / decorations with the celebrant's name
 *    • "Final Screen: 🎉 HAPPY BIRTHDAY GIANNIS! 🎉" closing title cards
 *
 *  Video models only render text they are explicitly TOLD about, and the old
 *  scene splitter actively DISCARDED final-screen lines. These helpers detect
 *  celebration text in a script and inject precise, quoted rendering
 *  instructions into scene prompts, plus build a real title-card scene from
 *  the script's "Final Screen" line.
 */

export interface OnScreenTextScene {
  prompt: string;
  title?: string;
  dialogue?: string;
  characterNames?: string[];
  visualNote?: string;
}

/** Emoji / decoration range cleanup for text fed to models & TTS. */
export function stripDecorativeEmoji(s: string): string {
  return s
    .replace(
      /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}\u{1F1E6}-\u{1F1FF}]/gu,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The script's explicit closing title, e.g.
 *   "Final Screen: 🎉 HAPPY BIRTHDAY GIANNIS! 🎉"
 * Also tolerates the text sitting on the NEXT line after a bare
 * "Final Screen:" heading.
 * Returns the cleaned text (emojis stripped) or null.
 */
export function extractFinalScreenLine(script: string): string | null {
  const m = script.match(
    /^[ \t]*(?:final\s*screen|title\s*card|end\s*card|closing\s*(?:title|card)|ending\s*title)[ \t]*:(.*)$/im
  );
  if (!m) return null;
  let raw = (m[1] || "").trim();
  if (!raw) {
    // Heading-only line — take the first non-empty line after it
    const after = script.slice((m.index ?? 0) + m[0].length);
    const next = after.match(/^[ \t]*(\S[^\n]*)$/m);
    raw = next ? next[1].trim() : "";
  }
  const text = stripDecorativeEmoji(raw).replace(/^[-–—•\s]+/, "").trim();
  // Keep the closing punctuation (often "!") but strip leftover symbols
  return text.replace(/[~*#_|]+/g, "").trim() || null;
}

type CelebrationKind =
  | "birthday"
  | "wedding"
  | "anniversary"
  | "graduation"
  | "baby"
  | "congratulations";

const CELEBRATION_KINDS: { kind: CelebrationKind; re: RegExp }[] = [
  { kind: "birthday", re: /\b(birthday|bday|born\s*day)\b/i },
  { kind: "wedding", re: /\b(wedding|bride|groom|marriage|just\s+married)\b/i },
  { kind: "anniversary", re: /\banniversary\b/i },
  { kind: "graduation", re: /\b(graduation|graduate|convocation)\b/i },
  { kind: "baby", re: /\b(baby\s+shower|naming\s+ceremony|christening|new\s+baby)\b/i },
  { kind: "congratulations", re: /\b(congratulations|congrats|well\s+done|achievement)\b/i },
];

/** Detect which kind of celebration a script describes (null = none). */
export function detectCelebrationKind(script: string): CelebrationKind | null {
  for (const c of CELEBRATION_KINDS) {
    if (c.re.test(script)) return c.kind;
  }
  return null;
}

/** Words that are never a person's name. */
const NAME_STOPWORDS = new Set([
  "the", "a", "an", "our", "his", "her", "their", "my", "your", "this",
  "story", "video", "movie", "adventure", "special", "day", "party",
  "everyone", "all", "birthday", "wedding", "dear", "friend", "little",
  "small", "boy", "girl", "child", "kid", "prince", "princess", "super",
  "happy", "year", "years", "old", "who", "for", "to", "and", "with",
]);

/**
 * Extract the celebrant's first name from a celebration script.
 * Order of trust: "Happy Birthday <Name>" → "for <Name> who is …" →
 * "<Name>'s birthday" → "<Story> for <Name>".
 */
export function extractCelebrantName(script: string): string | null {
  const patterns: RegExp[] = [
    /\b(?:happy|dear|for)\s+birthday[,\s]+([A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*)?)/i,
    /\bbirthday\s+(?:story|video|movie|special|adventure)\s+for\s+([A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*)?)/i,
    /\bfor\s+([A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*)?)\s+(?:who\s+is|turning|celebrating)\b/i,
    /\b([A-Za-z][A-Zaz'-]*(?:\s+[A-Za-z][A-Za-z'-]*)?)'s\s+\d+(?:st|nd|rd|th)?\s+birthday/i,
    /\b([A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*)?)'s\s+birthday\b/i,
  ];

  for (const re of patterns) {
    const m = script.match(re);
    if (m && m[1]) {
      const first = m[1].trim().split(/\s+/)[0];
      if (first.length > 1 && !NAME_STOPWORDS.has(first.toLowerCase())) {
        return first;
      }
    }
  }
  return null;
}

/** The canonical celebration phrase, e.g. "Happy Birthday Giannis". */
export function buildCelebrationText(script: string): string | null {
  const kind = detectCelebrationKind(script);
  if (!kind) return null;
  const name = extractCelebrantName(script);
  const withName = name ? ` ${name}` : "";
  switch (kind) {
    case "birthday":
      return `Happy Birthday${withName}`;
    case "wedding":
      return name ? `Just Married` : "Just Married";
    case "anniversary":
      return `Happy Anniversary${withName ? ` — ${name}` : ""}`;
    case "graduation":
      return `Congratulations${withName}`;
    case "baby":
      return name ? `Welcome ${name}` : "Welcome Baby";
    default:
      return `Congratulations${withName}`;
  }
}

/* ── Inscription injection ──────────────────────────────────────────────── */

/** True when a scene's prompt already carries the inscription text. */
function alreadyCarriesText(prompt: string, text: string): boolean {
  const needle = text.toLowerCase().replace(/[!.?]+$/g, "");
  return prompt.toLowerCase().includes(needle);
}

/**
 * Inject explicit text-rendering instructions into scenes that mention
 * cakes, banners or party decorations so the video model renders the
 * celebration text ("Happy Birthday Giannis") where the user expects it.
 * Mutates and returns the scenes (only when a celebration text exists).
 */
export function injectInscriptionInstructions<T extends OnScreenTextScene>(
  scenes: T[],
  celebrationText: string
): T[] {
  for (const scene of scenes) {
    if (!scene.prompt) continue;
    if (alreadyCarriesText(scene.prompt, celebrationText)) continue;

    const additions: string[] = [];
    const p = scene.prompt;

    if (/\bcakes?\b/i.test(p)) {
      additions.push(
        `the cake's frosting displays the words "${celebrationText}" in neat piped letters`
      );
    }
    if (/banner|streamer|decorate|decoration|bunting/i.test(p)) {
      additions.push(
        `a festive party banner reads "${celebrationText}"`
      );
    }
    // Presents/gift wrap: keep it subtle — only when nothing else matched
    // (avoid stuffing three text instructions into one prompt).
    if (additions.length === 0 && /presents?|gifts?|gift-wrap|wrapping/i.test(p)) {
      additions.push(`a gift tag reads "${celebrationText}"`);
    }

    if (additions.length > 0) {
      scene.prompt = `${p.replace(/[.\s]+$/, "")}. ${additions.join(", and ")}.`;
      if (scene.visualNote) {
        scene.visualNote = scene.prompt;
      }
    }
  }
  return scenes;
}

/**
 * Build the closing title-card scene from a script's "Final Screen" line —
 * previously this line was discarded and the celebratory ending never made
 * it into the video.
 */
export function buildFinalScreenScene(
  finalScreenText: string,
  celebrationText?: string | null
): OnScreenTextScene {
  const clean = stripDecorativeEmoji(finalScreenText).trim();
  const display = clean || celebrationText || "The End";
  const big = display.toUpperCase();

  return {
    title: "Final Screen",
    prompt:
      `Celebratory closing title card: the words "${big}" in huge, bold, colorful 3D letters ` +
      `with golden sparkling edges, perfectly centered on a bright festive background with ` +
      `soft confetti drifting down, glowing bokeh light orbs and ribbon streamers framing the ` +
      `edges of the screen, gentle magical shimmer on the text, warm joyful colors, steady ` +
      `camera with a slow subtle zoom toward the letters`,
    dialogue: undefined,
    characterNames: undefined,
    visualNote: undefined,
  };
}

/* ── Smart background music ───────────────────────────────────────────────── */

export interface DefaultMusic {
  mood: string;
  /** Public URL of the curated track in /public/music. */
  url: string;
}

const CELEBRATION_MUSIC: Record<CelebrationKind, DefaultMusic> = {
  birthday: { mood: "joyful", url: "/music/joyful.m4a" },
  wedding: { mood: "joyful", url: "/music/joyful.m4a" },
  anniversary: { mood: "joyful", url: "/music/joyful.m4a" },
  graduation: { mood: "epic", url: "/music/epic.m4a" },
  baby: { mood: "calm", url: "/music/calm.m4a" },
  congratulations: { mood: "epic", url: "/music/epic.m4a" },
};

/**
 * Pick a sensible default background-music track for a script.
 * Only celebration scripts get an automatic track (users can always swap or
 * mute it per scene in the studio); everything else stays music-free unless
 * the user picks a mood.
 */
export function pickDefaultMusic(script: string): DefaultMusic | null {
  const kind = detectCelebrationKind(script);
  return kind ? CELEBRATION_MUSIC[kind] : null;
}
