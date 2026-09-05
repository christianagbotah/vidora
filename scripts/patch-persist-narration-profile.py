from pathlib import Path


def patch_file(path_str: str, replacements: list[tuple[str, str, str]]) -> None:
    path = Path(path_str)
    text = path.read_text(encoding="utf-8")
    for old, new, label in replacements:
        count = text.count(old)
        if count != 1:
            raise SystemExit(f"{path_str} / {label}: expected exactly one match, found {count}")
        text = text.replace(old, new, 1)
        print(f"patched {path_str}: {label}")
    path.write_text(text, encoding="utf-8")


patch_file("prisma/schema.prisma", [
    (
        "  narrationLang     String?\n  imageUrl          String?      @db.Text\n",
        "  narrationLang     String?\n  narrationAccent   String?\n  narrationStyle    String?\n  imageUrl          String?      @db.Text\n",
        "VideoScene narration profile columns",
    ),
])

patch_file("src/types/video.ts", [
    (
        "  narrationLang?: string | null;\n  imageUrl?: string | null;\n",
        "  narrationLang?: string | null;\n  narrationAccent?: string | null;\n  narrationStyle?: string | null;\n  imageUrl?: string | null;\n",
        "VideoScene narration profile types",
    ),
])

patch_file("src/app/api/projects/[id]/scenes/[sceneId]/route.ts", [
    (
        "      mood, cameraMove, lighting, narrationVoice, narrationLang,\n",
        "      mood, cameraMove, lighting, narrationVoice, narrationLang, narrationAccent, narrationStyle,\n",
        "request fields",
    ),
    (
        "        narrationVoice: true,\n        narrationLang: true,\n",
        "        narrationVoice: true,\n        narrationLang: true,\n        narrationAccent: true,\n        narrationStyle: true,\n",
        "existing profile select",
    ),
    (
        "      (narrationVoice !== undefined && nullableText(narrationVoice) !== existing.narrationVoice) ||\n      (narrationLang !== undefined && nullableText(narrationLang) !== existing.narrationLang);\n",
        "      (narrationVoice !== undefined && nullableText(narrationVoice) !== existing.narrationVoice) ||\n      (narrationLang !== undefined && nullableText(narrationLang) !== existing.narrationLang) ||\n      (narrationAccent !== undefined && nullableText(narrationAccent) !== existing.narrationAccent) ||\n      (narrationStyle !== undefined && nullableText(narrationStyle) !== existing.narrationStyle);\n",
        "profile invalidation comparison",
    ),
    (
        "        ...(narrationVoice !== undefined && { narrationVoice: narrationVoice || null }),\n        ...(narrationLang !== undefined && { narrationLang: narrationLang || null }),\n",
        "        ...(narrationVoice !== undefined && { narrationVoice: narrationVoice || null }),\n        ...(narrationLang !== undefined && { narrationLang: narrationLang || null }),\n        ...(narrationAccent !== undefined && { narrationAccent: narrationAccent || null }),\n        ...(narrationStyle !== undefined && { narrationStyle: narrationStyle || null }),\n",
        "persist profile fields",
    ),
    (
        "      dialogue !== undefined || narrationVoice !== undefined || narrationLang !== undefined ||\n",
        "      dialogue !== undefined || narrationVoice !== undefined || narrationLang !== undefined ||\n      narrationAccent !== undefined || narrationStyle !== undefined ||\n",
        "assembly invalidation",
    ),
])

patch_file("src/lib/narration.ts", [
    (
        "      narrationUrl: true,\n      narrationLang: true,\n      characterIds: true,\n",
        "      narrationUrl: true,\n      narrationLang: true,\n      narrationAccent: true,\n      narrationStyle: true,\n      characterIds: true,\n",
        "generation profile select",
    ),
    (
        "    language: opts.language || scene.narrationLang || undefined,\n    accent: opts.accent,\n    style: opts.style,\n",
        "    language: opts.language || scene.narrationLang || undefined,\n    accent: opts.accent || scene.narrationAccent || undefined,\n    style: opts.style || scene.narrationStyle || undefined,\n",
        "profile fallback to saved scene",
    ),
    (
        "      data: { narrationUrl: finalUrl, narrationLang: profile.language },\n",
        "      data: {\n        narrationUrl: finalUrl,\n        narrationLang: profile.language,\n        narrationAccent: profile.accent,\n        narrationStyle: profile.style,\n      },\n",
        "cached narration profile persistence",
    ),
    (
        "      data: { narrationUrl: url, narrationLang: profile.language },\n",
        "      data: {\n        narrationUrl: url,\n        narrationLang: profile.language,\n        narrationAccent: profile.accent,\n        narrationStyle: profile.style,\n      },\n",
        "generated narration profile persistence",
    ),
    (
        "  narrationVoice?: string | null;\n  narrationLang?: string | null;\n  characterIds?: string | null;\n",
        "  narrationVoice?: string | null;\n  narrationLang?: string | null;\n  narrationAccent?: string | null;\n  narrationStyle?: string | null;\n  characterIds?: string | null;\n",
        "NarratableScene profile fields",
    ),
    (
        "        narrationVoice: true,\n        narrationLang: true,\n        characterIds: true,\n",
        "        narrationVoice: true,\n        narrationLang: true,\n        narrationAccent: true,\n        narrationStyle: true,\n        characterIds: true,\n",
        "auto narration profile select",
    ),
    (
        "      language: scene.narrationLang || undefined,\n",
        "      language: scene.narrationLang || undefined,\n      accent: scene.narrationAccent || undefined,\n      style: scene.narrationStyle || undefined,\n",
        "auto narration saved profile",
    ),
])

patch_file("src/app/page.tsx", [
    (
        '  const [narrationAccent, setNarrationAccent] = useState("auto");\n  const [narrationStyle, setNarrationStyle] = useState("natural");\n',
        '  const [narrationAccent, setNarrationAccent] = useState(scene.narrationAccent || "auto");\n  const [narrationStyle, setNarrationStyle] = useState(scene.narrationStyle || "natural");\n',
        "initialize saved accent/style",
    ),
    (
        "                        {scene.dialogue && !scene.narrationUrl && (\n",
        "                        {scene.dialogue && (\n",
        "allow narration regeneration",
    ),
    (
        ': <><Volume2 className="h-3.5 w-3.5 mr-1" />Narrate</>\n',
        ': <><Volume2 className="h-3.5 w-3.5 mr-1" />{scene.narrationUrl ? "Regenerate" : "Narrate"}</>\n',
        "regenerate button label",
    ),
])

print("Narration profile persistence patch complete")
