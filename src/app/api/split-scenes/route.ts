import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { zai, cleanLLMOutput } from "@/lib/zai";
import { userFriendlyZaiMessage, isAdminSession } from "@/lib/zai-errors";

export const runtime = "nodejs";
export const maxDuration = 120;

const KNOWN_CHARACTERS: Record<string, { description: string; stylePrompt: string }> = {
  // PAW Patrol
  "chase": { description: "Chase, a German Shepherd police pup from PAW Patrol, blue police uniform with badge, police hat, blue eyes", stylePrompt: "Chase PAW Patrol German Shepherd police dog, blue uniform, official character design, 3D animated style matching the show" },
  "marshall": { description: "Marshall, a Dalmatian fire pup from PAW Patrol, red fire uniform with fire hat, spotted white fur, clumsy and cute", stylePrompt: "Marshall PAW Patrol Dalmatian fire dog, red uniform, official character design, 3D animated style" },
  "skye": { description: "Skye, a cockapoo aviator pup from PAW Patrol, pink aviator goggles and uniform, fluffy ears, adventurous", stylePrompt: "Skye PAW Patrol cockapoo pilot dog, pink aviator uniform, official character design, 3D animated style" },
  "rubble": { description: "Rubble, an English Bulldog construction pup from PAW Patrol, yellow construction uniform and hat, sturdy build", stylePrompt: "Rubble PAW Patrol bulldog construction dog, yellow uniform, official character design, 3D animated style" },
  "rocky": { description: "Rocky, a mixed breed recycling pup from PAW Patrol, green recycling uniform, eco-friendly, clever", stylePrompt: "Rocky PAW Patrol recycling dog, green uniform, official character design, 3D animated style" },
  "zuma": { description: "Zuma, a Chocolate Labrador water rescue pup from PAW Patrol, orange water rescue uniform", stylePrompt: "Zuma PAW Patrol Labrador water rescue dog, orange uniform, official character design, 3D animated style" },
  "everest": { description: "Everest, a Siberian Husky snow rescue pup from PAW Patrol, teal snow rescue uniform", stylePrompt: "Everest PAW Patrol husky snow rescue dog, teal uniform, official character design, 3D animated style" },
  // Bluey
  "bluey": { description: "Bluey, a blue heeler puppy from the show Bluey, light blue fur, dark blue spots, playful and energetic, Australian family", stylePrompt: "Bluey blue heeler puppy, light blue with dark blue spots, official character design, 2D animated style matching the show" },
  "bingo": { description: "Bingo, a red heeler puppy from the show Bluey, orange-red fur, darker orange spots, Bluey's younger sister", stylePrompt: "Bingo red heeler puppy, orange-red with darker spots, official character design, 2D animated style matching Bluey show" },
  // SuperKitties
  "gwen": { description: "Gwen, a cat from SuperKitties, pink outfit, brave leader with magical powers", stylePrompt: "Gwen SuperKitties cat, pink superhero outfit, magical sparkles, official character design, 3D animated style" },
  "buddy": { description: "Buddy, a cat from SuperKitties, blue outfit, strong and loyal team member", stylePrompt: "Buddy SuperKitties cat, blue superhero outfit, official character design, 3D animated style" },
  "bitsy": { description: "Bitsy, a cat from SuperKitties, yellow/green outfit, small and energetic", stylePrompt: "Bitsy SuperKitties cat, yellow-green superhero outfit, small cute cat, official character design, 3D animated style" },
  // Spider-Man / Marvel
  "spidey": { description: "Spider-Man, a superhero in red and blue web-patterned suit with spider emblem, mask with large white eyes, web-shooters", stylePrompt: "Spider-Man Marvel superhero, red and blue suit with web pattern, spider emblem, full mask with white eyes, official character design" },
  "spider-man": { description: "Spider-Man, a superhero in red and blue web-patterned suit with spider emblem, mask with large white eyes, web-shooters", stylePrompt: "Spider-Man Marvel superhero, red and blue suit with web pattern, spider emblem, full mask with white eyes, official character design" },
  // CoComelon
  "cocomelon": { description: "CoComelon characters, colorful 3D animated family with JJ as the toddler star, bright and cheerful", stylePrompt: "CoComelon 3D animated style, bright colors, cute toddler JJ, cheerful family, official character design" },
  "jj": { description: "JJ, the toddler star of CoComelon, adorable round face, curious expression, colorful outfits", stylePrompt: "JJ CoComelon toddler, round cute face, curious expression, colorful outfit, official 3D animated character design" },
  // Disney
  "mickey mouse": { description: "Mickey Mouse, classic Disney character, black round ears, red shorts with white buttons, white gloves, yellow shoes", stylePrompt: "Mickey Mouse Disney, black round ears, red shorts, white gloves, yellow shoes, official character design" },
  "minnie mouse": { description: "Minnie Mouse, classic Disney character, red polka-dot dress, large bow on head, mouse ears", stylePrompt: "Minnie Mouse Disney, red polka-dot dress, large bow, mouse ears, official character design" },
  "elsa": { description: "Elsa from Disney's Frozen, platinum blonde braid, ice blue gown, elegant and regal", stylePrompt: "Elsa Frozen Disney, platinum blonde braid, ice blue gown, ice powers, official character design" },
  "anna": { description: "Anna from Disney's Frozen, red-brown braided hair, green dress, adventurous and optimistic", stylePrompt: "Anna Frozen Disney, red-brown braided hair, green dress, official character design" },
  // More popular characters
  "spongebob": { description: "SpongeBob SquarePants, yellow square sponge character, brown pants, white shirt, red tie, big blue eyes", stylePrompt: "SpongeBob SquarePants, yellow square sponge, brown pants, white shirt, red tie, official character design" },
  "peppa pig": { description: "Peppa Pig, a pink pig character, red dress, black shoes, lives in a house on a hill", stylePrompt: "Peppa Pig, pink pig, red dress, black shoes, official character design, 2D animated style" },
  "dora": { description: "Dora the Explorer, young Latina girl with short brown hair, pink shirt, orange shorts, purple backpack, talking map", stylePrompt: "Dora the Explorer, young girl, pink shirt, orange shorts, purple backpack, official character design" },
  "barney": { description: "Barney the purple dinosaur, large purple T-Rex, friendly smile, green belly", stylePrompt: "Barney purple dinosaur, large friendly T-Rex, green belly, official character design" },
  "thomas": { description: "Thomas the Tank Engine, blue steam locomotive with number 1, friendly face on the front, anthropomorphic train", stylePrompt: "Thomas the Tank Engine, blue locomotive, number 1, friendly face, official character design" },
  "daniel tiger": { description: "Daniel Tiger from Daniel Tiger's Neighborhood, young tiger cub, red sweater, red sneakers, friendly and curious", stylePrompt: "Daniel Tiger young tiger cub, red sweater, red sneakers, official character design, 2D animated style" },
  "super wings": { description: "Super Wings, a transforming delivery plane named Jett, red and white airplane, can transform into a robot", stylePrompt: "Jett Super Wings, red and white transforming airplane/robot, official character design, 3D animated style" },
  "paw patrol": { description: "PAW Patrol team, a group of rescue pups led by Ryder, each with unique uniforms and vehicles", stylePrompt: "PAW Patrol team, rescue pups in colorful uniforms, Adventure Bay, official character design, 3D animated style" },
};

// Multi-word character name aliases for matching (sorted longest first)
const CHARACTER_ALIASES: string[] = Object.keys(KNOWN_CHARACTERS).sort((a, b) => b.length - a.length);

// Case-insensitive multi-word known character lookup
function findKnownCharacter(name: string): { description: string; stylePrompt: string } | null {
  const normalizedName = name.toLowerCase().trim();
  // Exact single-word or multi-word match
  if (KNOWN_CHARACTERS[normalizedName]) {
    return KNOWN_CHARACTERS[normalizedName];
  }
  // Partial match for multi-word names (e.g., "Paw Patrol pups" contains "paw patrol")
  for (const alias of CHARACTER_ALIASES) {
    if (alias.includes(" ") && normalizedName.includes(alias)) {
      return KNOWN_CHARACTERS[alias];
    }
  }
  // Single-word token match (e.g., "SuperKitties" contains "gwen")
  const tokens = normalizedName.split(/\s+/);
  for (const token of tokens) {
    if (KNOWN_CHARACTERS[token]) {
      return KNOWN_CHARACTERS[token];
    }
  }
  return null;
}

// Enrich character list with known brand character data
function enrichWithKnownCharacters(characters: DetectedCharacter[]): DetectedCharacter[] {
  return characters.map((char) => {
    const known = findKnownCharacter(char.name);
    if (known) {
      return {
        ...char,
        description: known.description,
        stylePrompt: known.stylePrompt,
      };
    }
    return char;
  });
}

// Proper display name for known character keys
function displayNameForKey(key: string): string {
  const special: Record<string, string> = {
    "paw patrol": "PAW Patrol",
    "spider-man": "Spider-Man",
    "cocomelon": "CoComelon",
    "jj": "JJ",
    "spongebob": "SpongeBob",
    "daniel tiger": "Daniel Tiger",
    "super wings": "Super Wings",
    "mickey mouse": "Mickey Mouse",
    "minnie mouse": "Minnie Mouse",
    "peppa pig": "Peppa Pig",
  };
  return special[key] || (key.charAt(0).toUpperCase() + key.slice(1));
}

const CLIP_DURATION = 10;

interface ParsedScene {
  prompt: string;
  title?: string;
  dialogue?: string;
  characterNames?: string[];
  visualNote?: string;
}

interface DetectedCharacter {
  name: string;
  role: string;
  description: string;
  stylePrompt?: string;
}

// Extract pre-defined scenes from structured scripts
function extractDefinedScenes(prompt: string): ParsedScene[] | null {
  // Pattern for "Scene 1 – Title" or "🎬 Scene 2 – Title"
  const sceneBlockPattern = /(?:🎬\s*)?(?:Scene\s*\d+)[\s\-–—:]+([^\n]*)\n([\s\S]*?)(?=(?:🎬\s*)?(?:Scene\s*\d+)[\s\-–—:]|Final\s*Screen|$)/gi;
  const matches = [...prompt.matchAll(sceneBlockPattern)];

  if (matches.length >= 2) {
    const scenes = matches.map((m) => {
      const title = m[1]?.trim() || undefined;
      const body = m[2]?.trim() || "";

      const visual = extractVisualLines(body);
      const dialogue = extractDialogue(body);
      const characters = detectCharacterNames(body);

      return {
        prompt: visual || body.replace(/\n{2,}/g, " ").trim(),
        title: title || undefined,
        dialogue: dialogue || undefined,
        characterNames: characters.length > 0 ? characters : undefined,
        visualNote: visual || undefined,
      };
    }).filter((s) => s.prompt.length > 10);

    if (scenes.length >= 2) return scenes;
  }

  // Fallback: numbered list pattern
  const numberedPattern = /(?:^|\n)\s*(?:🎬)?\s*\d+[.)][\s]+([\s\S]*?)(?=(?:^|\n)\s*(?:🎬)?\s*\d+[.)]|$)/gi;
  const numberedMatches = [...prompt.matchAll(numberedPattern)];
  if (numberedMatches.length >= 2) {
    const scenes = numberedMatches.map((m) => {
      const body = m[1].trim();
      const visual = extractVisualLines(body);
      const dialogue = extractDialogue(body);
      const characters = detectCharacterNames(body);
      return {
        prompt: visual || body.replace(/\n{2,}/g, " ").trim(),
        dialogue: dialogue || undefined,
        characterNames: characters.length > 0 ? characters : undefined,
        visualNote: visual || undefined,
      };
    }).filter((s) => s.prompt.length > 10);

    if (scenes.length >= 2) return scenes;
  }

  return null;
}

// Extract visual-only description lines from scene body
function extractVisualLines(text: string): string {
  const lines = text.split("\n");
  const visualLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Skip dialogue lines (CharacterName: "text")
    if (/^[A-Z][a-zA-Z\s]+:\s*["\u201C]/.test(trimmed)) continue;
    if (/^[A-Z][a-zA-Z\s]+\s*["\u201C]/.test(trimmed)) continue;
    if (/^Narrator:\s*/i.test(trimmed)) continue;
    if (/^Everyone\s/.test(trimmed) && /:["\u201C]/.test(trimmed)) continue;

    // Skip music/lyrics
    if (/^[🎵\u{1F3B5}\u{1F3B6}]/.test(trimmed)) continue;

    // Skip Final Screen
    if (/^Final\s+Screen/i.test(trimmed)) continue;

    // Extract Visual: prefixed lines
    if (/^Visual:/i.test(trimmed)) {
      const visual = trimmed.replace(/^Visual:\s*/i, "");
      if (visual.length > 10) visualLines.push(visual);
    } else if (
      !trimmed.endsWith('"') &&
      !trimmed.endsWith("\u201D") &&
      !trimmed.endsWith("!\u201D") &&
      !/^[A-Z][a-z]+\s*[:"\u201C]/.test(trimmed) &&
      !/^Everyone\s+(shouts|sings|laughs|cheers)/i.test(trimmed) &&
      trimmed.length > 10
    ) {
      visualLines.push(trimmed);
    }
  }

  return visualLines.join(" ").trim();
}

// Extract dialogue/narration from scene body
function extractDialogue(text: string): string {
  const lines = text.split("\n");
  const dialogueLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Match CharacterName: "dialogue" patterns
    if (/^[A-Z][a-zA-Z\s]+:\s*["\u201C]/.test(trimmed)) {
      dialogueLines.push(trimmed);
    }
    if (/^Narrator:\s*/i.test(trimmed)) {
      dialogueLines.push(trimmed);
    }
    if (/^Everyone\s/.test(trimmed) && /:["\u201C]/.test(trimmed)) {
      dialogueLines.push(trimmed);
    }
  }

  return dialogueLines.join("\n").trim();
}

// Detect character names from dialogue attribution and visual descriptions
function detectCharacterNames(text: string): string[] {
  const names = new Set<string>();
  const patterns = [
    // Standard: "CharacterName: dialogue" (e.g., Chase:, Bluey:)
    /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*:/gm,
    // Narrator
    /^Narrator:/gim,
    // All-caps or short uppercase names (e.g., JJ:, MR. BEAST:)
    /^([A-Z]{2,}(?:\s+[A-Z]{2,})?)\s*:/gm,
    // CamelCase names (e.g., SuperKitties:, CoComelon:)
    /^([A-Z][a-z]+[A-Z][a-z]+(?:[A-Z][a-z]+)*)\s*:/gm,
  ];

  for (const pattern of patterns) {
    const matches = [...text.matchAll(pattern)];
    for (const m of matches) {
      if (m[1] && m[1].length > 1 && m[1].length < 30) {
        names.add(m[1].trim());
      }
    }
  }

  // Also scan visual descriptions for known brand characters mentioned by name
  // (characters who appear but don't have dialogue)
  // Skip team-level entries that are redundant with individual characters
  const skipTeamNames = new Set(["paw patrol", "cocomelon"]);
  const bodyText = text.replace(/^Visual:\s*/gim, " ");
  for (const [key] of Object.entries(KNOWN_CHARACTERS)) {
    if (skipTeamNames.has(key)) continue;
    if (bodyText.toLowerCase().includes(key.toLowerCase())) {
      names.add(displayNameForKey(key));
    }
  }

  return [...names].filter((n) => !["Visual", "Scene", "Final", "Remember", "Everyone", "The"].includes(n));
}

// Known words to exclude when scanning for proper nouns
const EXCLUDE_WORDS = new Set([
  "Visual", "Scene", "Final", "Remember", "Miss", "Rachel", "Narrator", "Everyone",
  "The", "This", "That", "With", "Happy", "Birthday", "Dear", "Our", "Their",
  "We", "Have", "Make", "Let", "Get", "Come", "All", "Her", "His", "She", "He",
  "But", "And", "Not", "For", "You", "Your", "Are", "Was", "Is", "Has", "Had",
  "Today", "Every", "Super", "Amazing", "Colorful", "Giant", "Glowing", "Magical",
  "PAW", "Patrol", "SuperKitties", "CoComelon", "Spidey", "Spider", "Bluey",
  "Bingo", "Chase", "Marshall", "JJ", "Now", "May", "Love", "Ever", "Ready",
  "Surprise", "Everything", "Dance", "Fireworks", " Presents", "Candles", "Lights",
  "Bubbles", "Streamers", "Balloons", "Confetti", "Rainbow", "Sky", "Stars",
  "A", "An", "In", "On", "At", "To", "Of", "By", "As", "Be", "Do", "If", "Or",
  "From", "With", "Into", "Around", "Through", "During", "After", "Before",
  "Adventure", "Story", "Video", "Town", "Birds", "Birds", "Pups", "Pup",
  "Friends", "Friend", "Music", "Musical", "Notes", "Hearts", "Wishes",
  "Presents", "Gifts", "Cake", "Candles", "Sparkle", "Sparkles", "Swing",
  "Leap", "Gather", "Sing", "Sings", "Blow", "Lights", "True", "Dreams",
  "Small", "Boy", "Girl", "Little", "Old", "Years", "Year", "Nursery",
  "Use", "Just", "Very", "So", "Too", "Up", "Out", "About", "Down",
  "Most", "Also", "Still", "Over", "Again", "Then", "Here", "There",
  "What", "When", "Where", "Why", "How", "Who", "Which", "Will", "Would",
]);

// Detect the honoree (birthday child, celebrant, etc.) from the script
function detectHonoree(fullPrompt: string): string | null {
  // Pattern 1: "for [Name] who is X years old"
  const agePattern = /(?:for|about)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+who\s+(?:is\s+|just\s+(?:a\s+)?(?:small\s+)?(?:boy|girl),?\s*)?(?:\d+|turning|now)\s+(?:years?\s+)?old/i;
  const ageMatch = fullPrompt.match(agePattern);
  if (ageMatch && ageMatch[1]) {
    const name = ageMatch[1].trim();
    // Don't match generic words
    if (name.length > 1 && name.length < 30 && !EXCLUDE_WORDS.has(name)) {
      return name;
    }
  }

  // Pattern 2: "Birthday Story for [Name]"
  const titlePattern = /(?:birthday|celebration|party|adventure)\s+(?:story|video|movie|special)\s+for\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i;
  const titleMatch = fullPrompt.match(titlePattern);
  if (titleMatch && titleMatch[1]) {
    const name = titleMatch[1].trim();
    if (name.length > 1 && name.length < 30 && !EXCLUDE_WORDS.has(name)) {
      return name;
    }
  }

  // Pattern 3: "HAPPY BIRTHDAY [NAME]" in all caps
  const capsPattern = /HAPPY\s+BIRTHDAY\s+([A-Z]{2,}(?:\s+[A-Z]{2,})*)/i;
  const capsMatch = fullPrompt.match(capsPattern);
  if (capsMatch && capsMatch[1]) {
    const name = capsMatch[1].trim();
    if (name.length > 1 && name.length < 30 && !EXCLUDE_WORDS.has(name)) {
      return name;
    }
  }

  // Pattern 4: Count most frequently mentioned capitalized proper nouns
  // (not at start of a line after a colon, which are speakers)
  const nameCounts = new Map<string, number>();
  // Match capitalized words in the middle of sentences (mentioned, not speaking)
  const mentionPattern = /(?:for|to|about|with|our|super|dear|friend)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g;
  let mentionMatch;
  while ((mentionMatch = mentionPattern.exec(fullPrompt)) !== null) {
    const name = mentionMatch[1].trim();
    if (name.length > 1 && name.length < 30 && !EXCLUDE_WORDS.has(name) && !findKnownCharacter(name)) {
      nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
    }
  }

  // Also check "Happy Birthday, [Name]" and "[Name]'s birthday"
  const possessivePattern = /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)'s?\s+birthday/i;
  const possessiveMatch = fullPrompt.match(possessivePattern);
  if (possessiveMatch && possessiveMatch[1]) {
    const name = possessiveMatch[1].trim();
    if (name.length > 1 && name.length < 30 && !EXCLUDE_WORDS.has(name)) {
      nameCounts.set(name, (nameCounts.get(name) || 0) + 5); // High weight for possessive
    }
  }

  // Find the most mentioned name
  let bestName: string | null = null;
  let bestCount = 0;
  for (const [name, count] of nameCounts) {
    if (count > bestCount) {
      bestCount = count;
      bestName = name;
    }
  }

  // Only return if mentioned at least twice (it's clearly the honoree)
  if (bestCount >= 2) return bestName;

  return null;
}

// Detect characters across entire script with AI-enhanced descriptions
function buildCharacterDescriptions(characters: string[], fullPrompt: string): DetectedCharacter[] {
  // Ensure the honoree is always included with protagonist role
  const honoree = detectHonoree(fullPrompt);
  const allNames = new Set<string>(characters.map(c => c.toLowerCase()));
  const isBirthdayScript = /birthday/i.test(fullPrompt);
  const ageMatch = fullPrompt.match(/(\d+)\s+years?\s+old/i);
  const age = ageMatch ? parseInt(ageMatch[1]) : null;
  const genderHint = /small\s+boy|boy\s+who|nursery.*boy/i.test(fullPrompt) ? "boy" :
                     /small\s+girl|girl\s+who|nursery.*girl/i.test(fullPrompt) ? "girl" : null;

  if (honoree && !allNames.has(honoree.toLowerCase())) {
    characters.push(honoree);
  }
  return characters.map((name) => {
    const isHonoree = honoree && name.toLowerCase() === honoree.toLowerCase();

    // Check if this is a known brand character FIRST
    const known = findKnownCharacter(name);
    if (known) {
      let role = "supporting";
      if (name.toLowerCase().includes("narrator")) {
        role = "narrator";
      } else if (
        name.toLowerCase().includes("hero") ||
        name.toLowerCase().includes("spidey") ||
        name.toLowerCase().includes("super") ||
        name.toLowerCase().includes("chase") ||
        name.toLowerCase().includes("spider")
      ) {
        role = "protagonist";
      }
      return { name, role, description: known.description, stylePrompt: known.stylePrompt };
    }

    // Try to extract description from context
    const descPattern = new RegExp(`${name}[^\\n]*?(?:"([^"]*)"[\\s\\n])`, "gi");
    const descMatch = descPattern.exec(fullPrompt);

    let role = "supporting";
    let description = `${name} character`;

    if (name.toLowerCase().includes("narrator")) {
      role = "narrator";
      description = `Narrator, off-screen voice, storytelling presence`;
    } else if (isHonoree) {
      // The birthday child / celebrant — protagonist with rich context
      role = "protagonist";
      const parts: string[] = [name];
      if (age) parts.push(`a ${age}-year-old ${genderHint || "child"}`);
      if (isBirthdayScript) parts.push("the birthday child");
      if (genderHint === "boy") parts.push("a small boy in nursery school");
      else if (genderHint === "girl") parts.push("a small girl in nursery school");
      parts.push("expressive face, joyful and excited, wearing a birthday outfit or party clothes");
      description = parts.join(", ");
    } else if (name.toLowerCase().includes("hero") || name.toLowerCase().includes("spidey") || name.toLowerCase().includes("super")) {
      role = "protagonist";
      description = `Hero character ${name}, brave and adventurous, central to the story`;
    } else {
      description = `${name}, a character in the story, colorful and expressive appearance`;
    }

    return { name, role, description };
  });
}

export async function POST(req: NextRequest) {
  try {
    const { prompt, targetDuration = 60 } = await req.json();
    if (!prompt) {
      return NextResponse.json({ success: false, error: "Prompt is required" }, { status: 400 });
    }

    const targetSec = Math.max(10, Math.min(300, targetDuration));
    const desiredSceneCount = Math.max(1, Math.ceil(targetSec / CLIP_DURATION));

    // Step 1: Try to extract pre-defined scenes from the prompt
    const predefinedScenes = extractDefinedScenes(prompt);

    if (predefinedScenes && predefinedScenes.length >= 2) {
      // Detect all characters across the full script
      const allCharacterNames = new Set<string>();
      for (const scene of predefinedScenes) {
        if (scene.characterNames) {
          scene.characterNames.forEach((n) => allCharacterNames.add(n));
        }
      }
      // Also scan the FULL script for known brand characters mentioned anywhere
      // Skip team-level entries (paw patrol) since individual pups are detected separately
      const skipTeamEntries = new Set(["paw patrol", "cocomelon"]);
      for (const [key] of Object.entries(KNOWN_CHARACTERS)) {
        if (skipTeamEntries.has(key)) continue;
        if (prompt.toLowerCase().includes(key.toLowerCase())) {
          allCharacterNames.add(displayNameForKey(key));
        }
      }
      const characterList = buildCharacterDescriptions([...allCharacterNames], prompt);

      console.log(`Extracted ${predefinedScenes.length} scenes and ${characterList.length} characters from script`);
      return NextResponse.json({
        success: true,
        scenes: predefinedScenes.slice(0, desiredSceneCount),
        characters: characterList,
        count: predefinedScenes.length,
        estimatedDuration: predefinedScenes.length * CLIP_DURATION,
        source: "predefined",
      });
    }

    // Step 2: No pre-defined scenes — use AI to split and detect characters
    const systemPrompt = [
      "You are a professional film storyboard assistant and character designer.",
      "The user will give you a video concept, story, or script.",
      "",
      "Your job is to:",
      "1. Break the concept into EXACTLY " + desiredSceneCount + " individual scenes for AI video generation",
      "2. Identify ALL characters mentioned or referenced in the script — including those who don't speak",
      "3. For each scene, provide visual description (NO dialogue) AND extracted dialogue",
      "",
      "IMPORTANT CHARACTER RULES:",
      "- Detect characters who speak AND characters who are only MENTIONED by name (e.g., a birthday child mentioned in 'Happy Birthday Emma!')",
      "- If the script is about a birthday, celebration, or dedication — the honoree (birthday child, celebrant) MUST be listed as a character with role 'protagonist'",
      "- Look for patterns like 'for [Name]', '[Name]'s birthday', 'Happy Birthday [Name]', 'Dear [Name]' to identify the honoree",
      "- Describe the honoree's visual appearance (age, gender, clothing) based on context clues in the script",
      "",
      "Rules:",
      "- Each scene PROMPT must be a self-contained VISUAL description (NO dialogue, NO text, NO on-screen text)",
      "- Each scene should represent roughly 10 seconds of video action",
      "- Maintain visual continuity across scenes",
      "- Include camera movement suggestions in prompts",
      "- For characters: describe their visual appearance (clothing, features, age, style) for AI generation",
      "",
      "Return ONLY valid JSON (no markdown, no code fences):",
      '{"scenes": [{"prompt": "cinematic visual description", "title": "Scene Title", "dialogue": "extracted dialogue", "characterNames": ["Character1"]}], "characters": [{"name": "Character1", "role": "protagonist/supporting/narrator", "description": "visual appearance description for AI generation"}]}',
    ].join("\n");

    const raw = await zai.chat({
      systemPrompt,
      userPrompt: prompt,
      thinking: "disabled",
      retry: { label: "Split scenes AI", timeoutMs: 90_000, maxRetries: 3 },
    });

    const content = cleanLLMOutput(raw);

    let parsed: { scenes?: Array<Record<string, unknown>>; characters?: Array<Record<string, unknown>> };
    try {
      parsed = JSON.parse(content);
    } catch {
      // Surface the JSON parse failure to the client instead of silently falling back
      return NextResponse.json({
        success: false,
        error: "The AI returned a response that could not be parsed as JSON. Please try again or rephrase your prompt.",
        rawPreview: content.slice(0, 500),
        fallback: true,
        scenes: [{ prompt }],
        characters: [],
        isSingle: true,
      }, { status: 422 });
    }

    const scenes: ParsedScene[] = (parsed.scenes || []).map((s) => ({
      prompt: (s.prompt || s.text || s.description || "") as string,
      title: (s.title || undefined) as string | undefined,
      dialogue: (s.dialogue || undefined) as string | undefined,
      characterNames: (s.characterNames || undefined) as string[] | undefined,
      visualNote: (s.visualNote || (s.prompt || "") as string) as string | undefined,
    })).filter((s: ParsedScene) => s.prompt.length > 0);

    const characters: DetectedCharacter[] = enrichWithKnownCharacters(
      (parsed.characters || []).map((c: Record<string, unknown>) => ({
        name: (c.name || "") as string,
        role: (c.role || "supporting") as string,
        description: (c.description || "") as string,
      })).filter((c: DetectedCharacter) => c.name.length > 0)
    );

    // Safety net: ensure honoree is detected even if AI missed it
    const aiCharNames = new Set(characters.map(c => c.name.toLowerCase()));
    const fallbackHonoree = detectHonoree(prompt);
    if (fallbackHonoree && !aiCharNames.has(fallbackHonoree.toLowerCase())) {
      const isBirthdayScript = /birthday/i.test(prompt);
      const ageM = prompt.match(/(\d+)\s+years?\s+old/i);
      const age = ageM ? parseInt(ageM[1]) : null;
      const gender = /small\s+boy|boy\s+who|nursery.*boy/i.test(prompt) ? "boy" :
                     /small\s+girl|girl\s+who|nursery.*girl/i.test(prompt) ? "girl" : "child";
      const descParts: string[] = [fallbackHonoree];
      if (age) descParts.push(`a ${age}-year-old ${gender}`);
      if (isBirthdayScript) descParts.push("the birthday child");
      descParts.push("expressive face, joyful, wearing party clothes");
      characters.unshift({
        name: fallbackHonoree,
        role: "protagonist",
        description: descParts.join(", "),
      });
    }

    // Pad if AI returned fewer scenes
    while (scenes.length < desiredSceneCount && scenes.length > 0) {
      const lastScene = scenes[scenes.length - 1];
      scenes.push({
        prompt: lastScene.prompt + " (continuation, different camera angle)",
        dialogue: lastScene.dialogue,
        characterNames: lastScene.characterNames,
      });
    }

    if (scenes.length === 0) {
      return NextResponse.json({
        success: true,
        scenes: [{ prompt }],
        characters: [],
        isSingle: true,
        fallback: true,
      });
    }

    return NextResponse.json({
      success: true,
      scenes: scenes.slice(0, desiredSceneCount),
      characters,
      count: scenes.length,
      estimatedDuration: scenes.length * CLIP_DURATION,
      source: "ai",
    });
  } catch (error) {
    console.error("Failed to split scenes:", error);
    // Provide a graceful fallback so the UI still works, but surface a friendly error.
    // For non-admin users, hide the raw technical detail; admins get it in `adminDetail`.
    const body = await req.clone().json().catch(() => null);
    const session = await getServerSession(authOptions).catch(() => null);
    const isAdmin = isAdminSession(session);
    const friendly = userFriendlyZaiMessage(error);
    return NextResponse.json({
      success: false,
      error: friendly,
      adminDetail: isAdmin ? (error instanceof Error ? error.message : String(error)) : undefined,
      fallback: true,
      scenes: body?.prompt ? [{ prompt: body.prompt }] : [],
      characters: [],
      isSingle: true,
    }, { status: 503 });
  }
}
