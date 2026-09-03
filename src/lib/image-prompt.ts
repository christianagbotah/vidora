/**
 * ───────────────────────────────────────────────────────────────────────────
 *  Vidora — Character-Aware Prompt Builders
 * ───────────────────────────────────────────────────────────────────────────
 *
 *  WHY THIS EXISTS
 *  Users describe recognizable characters ("JJ, the toddler star of
 *  CoComelon, adorable round face…", "the Super Kittens…") but the raw
 *  scene prompt ("JJ plays with blocks") never tells the image/video model
 *  what those characters LOOK like. The full appearance descriptions live
 *  on the project's Character rows — these builders merge them into the
 *  generation prompts so every render matches the described character.
 *
 *  Three builders:
 *   • buildSceneImagePrompt  → rich prompt for cogview-4 thumbnails
 *                              (long prompts OK — quality first)
 *   • buildSceneVideoPrompt  → compact prompt for the video API
 *                              (HARD 512-char limit)
 *   • buildCharacterPortraitPrompt → reference-sheet prompt for portraits
 */

export interface CharacterLike {
  id: string;
  name: string;
  role?: string | null;
  description?: string | null;
  stylePrompt?: string | null;
}

/** Per-character budget inside the scene image prompt. */
const MAX_CHAR_DESCRIPTION = 320;
/** Total cap for the image prompt (cogview-4 handles long prompts fine). */
const MAX_IMAGE_PROMPT = 1800;
/** HARD limit for the video API prompt (server rejects > 512). */
const MAX_VIDEO_PROMPT = 500;

/** Rendering keywords per project style — steers the whole frame. */
const STYLE_IMAGE_KEYWORDS: Record<string, string> = {
  cinematic:
    "cinematic film still, dramatic professional lighting, shallow depth of field, 35mm film aesthetic, photorealistic, high dynamic range",
  anime:
    "anime style illustration, clean cel shading, vibrant saturated colors, expressive character design, studio-quality anime art",
  photorealistic:
    "photorealistic, ultra-detailed, natural lighting, shot on professional cinema camera, 8k resolution",
  "oil-painting":
    "oil painting, rich visible brush strokes, canvas texture, classical fine art composition",
  watercolor:
    "watercolor painting, soft translucent washes, delicate paper texture, gently bleeding colors",
  noir: "black and white film noir, dramatic chiaroscuro lighting, deep shadows, high contrast, 1940s cinematic mood",
  retro: "retro vintage aesthetic, faded warm colors, subtle film grain, 1970s color palette",
  "3d-render":
    "high-end 3D render, physically based materials, soft global illumination, feature-film animation quality",
};

const DEFAULT_STYLE_KEYWORDS =
  "cinematic film still, dramatic professional lighting, shallow depth of field, photorealistic";

/** Escape a name so it can be embedded in a RegExp safely. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Characters relevant to a scene:
 *  1. Characters explicitly linked to the scene (scene.characterIds)
 *  2. Characters whose NAME is mentioned in the prompt (word-boundary match)
 *  3. Fallback: when only ONE character exists in the project, always include
 *     it (single-character stories mention the name inconsistently)
 */
export function detectSceneCharacters(
  scenePrompt: string,
  characters: CharacterLike[],
  linkedCharacterIds?: string | null
): CharacterLike[] {
  if (!characters || characters.length === 0) return [];

  const linked = new Set<string>();
  if (linkedCharacterIds) {
    try {
      const parsed = JSON.parse(linkedCharacterIds);
      if (Array.isArray(parsed)) parsed.forEach((id) => typeof id === "string" && linked.add(id));
    } catch { /* not JSON — ignore */ }
  }

  const mentioned = characters.filter((c) => {
    if (!c.name) return false;
    const name = c.name.trim();
    if (name.length < 2) return false;
    // Match "JJ", "Super Kittens", "Uncle Cody" — word boundaries, case-insensitive
    const re = new RegExp(`\\b${escapeRegExp(name)}\\b`, "i");
    return re.test(scenePrompt);
  });

  const result = characters.filter(
    (c) => linked.has(c.id) || mentioned.includes(c)
  );

  // Single-character project: include it even if the name isn't in this scene
  if (result.length === 0 && characters.length === 1) return characters.slice(0, 1);

  return result;
}

/** Strip a leading "Name," / "Name —" / "Name:" prefix from a description to
 *  avoid "JJ — JJ, the toddler…" duplication in merged prompts. */
function stripLeadingName(name: string, desc: string): string {
  if (!name || !desc) return desc;
  const namePrefix = new RegExp(`^${escapeRegExp(name)}[\\s,:—-]*`, "i");
  return desc.replace(namePrefix, "").trim() || desc;
}

/** Compact appearance digest for one character (name + description + stylePrompt). */
function characterDigest(c: CharacterLike): string {
  const rawDesc = (c.description || "").trim();
  const style = (c.stylePrompt || "").trim();
  const desc = rawDesc ? stripLeadingName(c.name, rawDesc) : "";
  let digest = `${c.name}`;
  if (desc) {
    // Prefer the stylePrompt's visual core if it repeats the description
    const extra = style && !desc.includes(style.slice(0, 40)) ? `. ${style}` : "";
    digest += ` — ${desc}${extra}`;
  } else if (style) {
    digest += ` — ${style}`;
  } else {
    digest += " — as described in the story";
  }
  if (digest.length > MAX_CHAR_DESCRIPTION) {
    digest = `${digest.slice(0, MAX_CHAR_DESCRIPTION - 1)}…`;
  }
  return digest;
}

/**
 * Rich, character-aware prompt for image generation (thumbnails).
 *
 * Structure:
 *   [scene prompt] — [style keywords]
 *   CHARACTERS (render EXACTLY as described):
 *   • Name — appearance description
 *   + consistency & quality instructions
 */
export function buildSceneImagePrompt(opts: {
  scenePrompt: string;
  style?: string | null;
  characters: CharacterLike[];
  linkedCharacterIds?: string | null;
}): string {
  const { scenePrompt, style, characters, linkedCharacterIds } = opts;
  const base = (scenePrompt || "").trim();
  const styleKey = STYLE_IMAGE_KEYWORDS[(style || "").toLowerCase()] || DEFAULT_STYLE_KEYWORDS;

  const relevant = detectSceneCharacters(base, characters, linkedCharacterIds);

  const parts: string[] = [];
  parts.push(base ? `${base} — ${styleKey}` : styleKey);

  if (relevant.length > 0) {
    const sheets = relevant
      .slice(0, 5) // cap at 5 characters per frame
      .map((c) => `• ${characterDigest(c)}`)
      .join("\n");
    parts.push(
      `CHARACTERS in this frame — render each one EXACTLY as described, matching their distinctive face, proportions, outfit, colors and accessories in every detail:\n${sheets}`
    );
    parts.push(
      "Maintain exact character consistency with these descriptions. Do not redesign, merge, or omit characters."
    );
  }

  parts.push(
    "Coherent scene composition, professional production quality, highly detailed, sharp focus."
  );

  let prompt = parts.join("\n\n");
  if (prompt.length > MAX_IMAGE_PROMPT) {
    prompt = prompt.slice(0, MAX_IMAGE_PROMPT - 1) + "…";
  }
  return prompt;
}

/**
 * Compact, character-aware prompt for the VIDEO API (hard 512-char limit).
 *
 * Strategy: keep the scene prompt, then append a short character digest
 * with as many characters as fit.
 */
export function buildSceneVideoPrompt(opts: {
  scenePrompt: string;
  characters: CharacterLike[];
  linkedCharacterIds?: string | null;
}): string {
  const base = (opts.scenePrompt || "").trim();
  const relevant = detectSceneCharacters(base, opts.characters, opts.linkedCharacterIds);

  if (relevant.length === 0) {
    return base.slice(0, MAX_VIDEO_PROMPT);
  }

  const budget = MAX_VIDEO_PROMPT - base.length;
  if (budget < 40) return base.slice(0, MAX_VIDEO_PROMPT); // no room for characters

  const digestParts: string[] = [];
  let used = " | Chars: ".length;
  for (const c of relevant.slice(0, 3)) {
    const desc = (c.description || c.stylePrompt || "").trim();
    const compact = desc ? `${c.name}: ${desc}` : c.name;
    const piece = digestParts.length > 0 ? `; ${compact}` : compact;
    if (used + piece.length > budget) break;
    digestParts.push(compact);
    used += piece.length;
  }

  if (digestParts.length === 0) return base.slice(0, MAX_VIDEO_PROMPT);
  return `${base} | Chars: ${digestParts.join("; ")}`.slice(0, MAX_VIDEO_PROMPT);
}

/**
 * Reference-sheet prompt for character portraits — used both for the
 * portrait itself and as the canonical description stored in stylePrompt.
 */
export function buildCharacterPortraitPrompt(
  character: CharacterLike,
  style?: string | null
): string {
  const name = character.name?.trim() || "the character";
  const rawDesc = (character.description || "").trim();
  const desc = rawDesc ? stripLeadingName(name, rawDesc) : "";
  const role =
    character.role === "protagonist"
      ? "main character, full body visible"
      : character.role === "narrator"
        ? "storyteller character"
        : "supporting character";

  const styleKey = STYLE_IMAGE_KEYWORDS[(style || "").toLowerCase()] || DEFAULT_STYLE_KEYWORDS;

  const parts = [
    `Character reference of ${name}`,
    desc || `A character named ${name}`,
    role,
    "front-facing character reference, centered composition, clean uncluttered background",
    "match the character's described appearance EXACTLY — face, proportions, outfit, colors and accessories",
    styleKey,
    "consistent character design, professional production quality, highly detailed.",
  ];

  let prompt = parts.join(", ");
  if (prompt.length > MAX_IMAGE_PROMPT) {
    prompt = prompt.slice(0, MAX_IMAGE_PROMPT - 1) + "…";
  }
  return prompt;
}
