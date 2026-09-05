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


patch_file("scripts/generation-worker.ts", [
    (
        'import { saveGeneratedFile } from "@/lib/generated-store";\n',
        'import { saveGeneratedFile } from "@/lib/generated-store";\nimport { persistProviderVideo } from "@/lib/provider-video-storage";\n',
        "provider video persistence import",
    ),
    (
        '''  if (result.status === "success" && result.videoUrl) {\n    await db.videoScene.update({\n      where: { id: opts.sceneId },\n      data: { videoUrl: result.videoUrl, status: "completed", errorMessage: null },\n    });\n    await heartbeat(opts.runId);\n    // Narration has its own shared metered/idempotent provider boundary.\n    void autoNarrateScene(opts.sceneId);\n    return "completed";\n  }\n''',
        '''  if (result.status === "success" && result.videoUrl) {\n    let localVideoUrl: string;\n    try {\n      localVideoUrl = await persistProviderVideo(opts.sceneId, result.videoUrl);\n    } catch (error) {\n      console.warn(\n        `[generation-worker] scene=${opts.sceneId} rendered but provider media copy is pending:`,\n        error instanceof Error ? error.message : "unknown error",\n      );\n      await db.videoScene.update({\n        where: { id: opts.sceneId },\n        data: {\n          status: "generating",\n          errorMessage: "Video rendered successfully; Vidora is securing the media file locally before completion.",\n        },\n      });\n      await heartbeat(opts.runId);\n      return "waiting";\n    }\n\n    await db.videoScene.update({\n      where: { id: opts.sceneId },\n      data: { videoUrl: localVideoUrl, status: "completed", errorMessage: null },\n    });\n    await heartbeat(opts.runId);\n    // Narration has its own shared metered/idempotent provider boundary.\n    void autoNarrateScene(opts.sceneId);\n    return "completed";\n  }\n''',
        "persist completed provider clip",
    ),
])


patch_file("src/lib/full-preview-render.ts", [
    (
        'import { audioFileExists, getAudioPath } from "@/lib/audio-storage";\n',
        'import { audioFileExists, getAudioPath } from "@/lib/audio-storage";\nimport { persistProviderVideo } from "@/lib/provider-video-storage";\n',
        "provider video persistence import",
    ),
    (
        '''  narrationVoice: string | null;\n  characterIds: string | null;\n  musicTrackUrl: string | null;\n''',
        '''  narrationVoice: string | null;\n  narrationLang: string | null;\n  narrationAccent: string | null;\n  narrationStyle: string | null;\n  characterIds: string | null;\n  translations: Array<{ lang: string; translatedText: string | null }>;\n  musicTrackUrl: string | null;\n''',
        "preview scene narration profile",
    ),
    (
        '''function sleep(ms: number): Promise<void> {\n  return new Promise((resolve) => setTimeout(resolve, ms));\n}\n\nasync function downloadWithRetry(url: string, destination: string): Promise<void> {\n  for (let attempt = 1; attempt <= 3; attempt++) {\n    try {\n      const response = await fetch(url);\n      if (!response.ok) throw new Error(`HTTP ${response.status}`);\n      await writeFile(destination, Buffer.from(await response.arrayBuffer()));\n      return;\n    } catch (error) {\n      if (attempt === 3) throw error;\n      await sleep(600 * attempt);\n    }\n  }\n}\n\nasync function materializeVideo(scene: PreviewScene, workDir: string, index: number): Promise<string> {\n  if (!scene.videoUrl) throw new Error(`Scene ${scene.sceneNumber} has no generated clip`);\n  if (scene.videoUrl.startsWith("/")) {\n    const local = resolvePublicAssetPath(scene.videoUrl);\n    if (existsSync(local)) return local;\n  }\n  const local = path.join(workDir, `scene_${String(index + 1).padStart(3, "0")}.mp4`);\n  await downloadWithRetry(scene.videoUrl, local);\n  return local;\n}\n''',
        '''async function materializeVideo(scene: PreviewScene): Promise<string> {\n  if (!scene.videoUrl) throw new Error(`Scene ${scene.sceneNumber} has no generated clip`);\n  if (scene.videoUrl.startsWith("/")) {\n    const local = resolvePublicAssetPath(scene.videoUrl);\n    if (existsSync(local)) return local;\n    throw new Error(`Scene ${scene.sceneNumber} local video file is missing`);\n  }\n\n  // Legacy projects may still contain a provider-hosted URL. Archive it into\n  // Vidora's persistent generated store before ffmpeg touches it, then repair\n  // the scene row so future playback/preview no longer depends on provider\n  // cache semantics or signed URL lifetime.\n  const localUrl = await persistProviderVideo(scene.id, scene.videoUrl);\n  const localPath = resolvePublicAssetPath(localUrl);\n  if (!existsSync(localPath)) throw new Error(`Scene ${scene.sceneNumber} media copy produced no local file`);\n  await db.videoScene.update({\n    where: { id: scene.id },\n    data: { videoUrl: localUrl },\n  });\n  scene.videoUrl = localUrl;\n  return localPath;\n}\n''',
        "legacy provider media migration",
    ),
    (
        '''  if (scene.dialogue?.trim()) {\n    const voice = await pickSceneNarrationVoice(scene);\n    // Always resolve through the deterministic narration generator. It replays\n    // an existing matching fingerprint without charging again, while a stale\n    // provider/voice/dialogue artifact receives a new fingerprint. The\n    // generator persists only narrationUrl; the resolved character voice stays\n    // derived and therefore does not mutate the reviewed source configuration.\n    const narration = await generateSceneNarration({\n      sceneId: scene.id,\n      text: scene.dialogue,\n      voice,\n    });\n    narrationPath = narration.path;\n''',
        '''  if (scene.dialogue?.trim()) {\n    const voice = await pickSceneNarrationVoice(scene);\n    const language = scene.narrationLang || "en";\n    let narrationText = scene.dialogue.trim();\n    if (language !== "en") {\n      const translated = scene.translations.find(\n        (translation) => translation.lang === language && translation.translatedText?.trim(),\n      );\n      narrationText = translated?.translatedText?.trim() || "";\n      if (!narrationText) {\n        throw new Error(\n          `Scene ${scene.sceneNumber} is set to ${language} but has no translated dialogue. Apply the video language again before previewing.`,\n        );\n      }\n    }\n\n    // Always resolve through the deterministic narration generator. It replays\n    // an existing matching fingerprint without charging again, while a stale\n    // provider/voice/dialogue/profile artifact receives a new fingerprint.\n    const narration = await generateSceneNarration({\n      sceneId: scene.id,\n      text: narrationText,\n      voice,\n      language,\n      accent: scene.narrationAccent || undefined,\n      style: scene.narrationStyle || undefined,\n    });\n    narrationPath = narration.path;\n''',
        "language-aware preview narration",
    ),
    (
        '    include: { scenes: { orderBy: { sceneNumber: "asc" } } },\n',
        '    include: { scenes: { orderBy: { sceneNumber: "asc" }, include: { translations: true } } },\n',
        "load scene translations for preview",
    ),
    (
        '      scenePaths.push(await materializeVideo(scenes[index], workDir, index));\n',
        '      scenePaths.push(await materializeVideo(scenes[index]));\n',
        "materialize call",
    ),
    (
        '      if (ambience[videoIndex]) {\n',
        '      if (ambience[videoIndex] && !sceneAudio[sceneIndex]?.narrationPath) {\n',
        "mute embedded clip audio under active narration",
    ),
])


patch_file("src/app/api/scenes/[id]/dubbing/route.ts", [
    (
        '    const { lang, voiceId } = await req.json();\n',
        '    const { lang, voiceId, translateOnly } = await req.json();\n',
        "translate-only request flag",
    ),
    (
        '''      const chunks = splitTextIntoChunks(cleanTranslation);\n      ensureAudioDir();\n''',
        '''      if (translateOnly === true) {\n        const translatedOnly = await db.sceneTranslation.update({\n          where: { id: translation.id },\n          data: { status: "translated" },\n        });\n        return NextResponse.json({\n          success: true,\n          translation: translatedOnly,\n          translatedOnly: true,\n          tokensChargedForVoice: 0,\n        });\n      }\n\n      const chunks = splitTextIntoChunks(cleanTranslation);\n      ensureAudioDir();\n''',
        "translation-only exit",
    ),
])


patch_file("src/app/api/scenes/[id]/subtitles/route.ts", [
    (
        '    const scene = await db.videoScene.findUnique({ where: { id } });\n',
        '''    const scene = await db.videoScene.findUnique({\n      where: { id },\n      include: { translations: { where: { lang }, take: 1 } },\n    });\n''',
        "load requested subtitle translation",
    ),
    (
        '    const sourceText = (scene.dialogue || scene.prompt || "").trim();\n',
        '''    const sourceText = (\n      lang === "en"\n        ? (scene.dialogue || scene.prompt || "")\n        : (scene.translations[0]?.translatedText || "")\n    ).trim();\n''',
        "translated subtitle source text",
    ),
    (
        '        { success: false, error: "No narration text available for this scene" },\n',
        '        { success: false, error: lang === "en" ? "No narration text available for this scene" : `No ${lang} translation is available for subtitles` },\n',
        "translated subtitle missing message",
    ),
])


patch_file("src/app/page.tsx", [
    (
        '''  const [fullPreviewUrl, setFullPreviewUrl] = useState<string | null>(null);\n  const [isBuildingFullPreview, setIsBuildingFullPreview] = useState(false);\n''',
        '''  const [fullPreviewUrl, setFullPreviewUrl] = useState<string | null>(null);\n  const [isBuildingFullPreview, setIsBuildingFullPreview] = useState(false);\n  const [projectLanguage, setProjectLanguage] = useState("en");\n  const [isChangingProjectLanguage, setIsChangingProjectLanguage] = useState(false);\n''',
        "project language state",
    ),
    (
        '''  const safeCharacters = currentProject?.characters && Array.isArray(currentProject.characters)\n    ? currentProject.characters : [];\n''',
        '''  const safeCharacters = currentProject?.characters && Array.isArray(currentProject.characters)\n    ? currentProject.characters : [];\n\n  useEffect(() => {\n    const narratable = (currentProject?.scenes || []).filter((scene) => scene.dialogue?.trim());\n    if (narratable.length === 0) {\n      setProjectLanguage("en");\n      return;\n    }\n    const languages = new Set(narratable.map((scene) => scene.narrationLang || "en"));\n    if (languages.size === 1) setProjectLanguage([...languages][0]);\n  }, [currentProject?.id, currentProject?.scenes]);\n''',
        "sync project language from scenes",
    ),
    (
        '''      const res = await fetch(`/api/scenes/${sceneId}/subtitles`, {\n        method: "POST",\n        headers: { "Content-Type": "application/json" },\n        body: JSON.stringify({ lang: "en" }),\n      });\n''',
        '''      const scene = safeScenes.find((item) => item.id === sceneId);\n      const res = await fetch(`/api/scenes/${sceneId}/subtitles`, {\n        method: "POST",\n        headers: { "Content-Type": "application/json" },\n        body: JSON.stringify({ lang: scene?.narrationLang || "en" }),\n      });\n''',
        "scene subtitles follow narration language",
    ),
    (
        '''  const handleBuildFullPreview = async () => {\n''',
        '''  const handleApplyProjectLanguage = async () => {\n    if (!currentProject || isChangingProjectLanguage) return;\n    const languageMeta = ALL_DUBBING_LANGUAGES.find((item) => item.code === projectLanguage);\n    if (!languageMeta) {\n      toast({ title: "Unsupported language", variant: "destructive" });\n      return;\n    }\n\n    const narratableScenes = safeScenes.filter((scene) => scene.dialogue?.trim());\n    if (narratableScenes.length === 0) {\n      toast({ title: "No spoken dialogue", description: "This video has no scene dialogue to translate." });\n      return;\n    }\n\n    setIsChangingProjectLanguage(true);\n    let updatedScenes = 0;\n    let subtitleWarnings = 0;\n    try {\n      for (const scene of narratableScenes) {\n        const voice = scene.narrationVoice || "tongtong";\n        const accent = projectLanguage === "en"\n          ? (scene.narrationAccent === "native" ? "auto" : scene.narrationAccent || "auto")\n          : "native";\n        const style = scene.narrationStyle || "natural";\n\n        if (projectLanguage !== "en") {\n          const translateRes = await fetch(`/api/scenes/${scene.id}/dubbing`, {\n            method: "POST",\n            headers: { "Content-Type": "application/json" },\n            body: JSON.stringify({ lang: projectLanguage, voiceId: voice, translateOnly: true }),\n          });\n          const translateData = await translateRes.json();\n          if (!translateRes.ok || !translateData.success) {\n            throw new Error(`Scene ${scene.sceneNumber}: ${getApiError(translateData, "translation failed")}`);\n          }\n        }\n\n        const narrationRes = await fetch("/api/generate-narration", {\n          method: "POST",\n          headers: { "Content-Type": "application/json" },\n          body: JSON.stringify({\n            projectId: currentProject.id,\n            sceneId: scene.id,\n            voice,\n            language: projectLanguage,\n            accent,\n            style,\n            ...(projectLanguage === "en" ? { text: scene.dialogue } : {}),\n          }),\n        });\n        const narrationData = await narrationRes.json();\n        if (!narrationRes.ok || !narrationData.success) {\n          throw new Error(`Scene ${scene.sceneNumber}: ${getApiError(narrationData, "narration failed")}`);\n        }\n        updatedScenes += 1;\n\n        if (scene.subtitleSrt || scene.subtitleStatus === "ready" || scene.burnSubtitles) {\n          const subtitleRes = await fetch(`/api/scenes/${scene.id}/subtitles`, {\n            method: "POST",\n            headers: { "Content-Type": "application/json" },\n            body: JSON.stringify({ lang: projectLanguage }),\n          });\n          const subtitleData = await subtitleRes.json();\n          if (!subtitleRes.ok || !subtitleData.success) {\n            subtitleWarnings += 1;\n            if (scene.burnSubtitles) {\n              await fetch(`/api/scenes/${scene.id}/subtitles`, {\n                method: "PUT",\n                headers: { "Content-Type": "application/json" },\n                body: JSON.stringify({ burnSubtitles: false }),\n              }).catch(() => undefined);\n            }\n          }\n        }\n      }\n\n      setFullPreviewUrl(null);\n      await refreshProject();\n      toast({\n        title: `Video language changed to ${languageMeta.name}`,\n        description: subtitleWarnings > 0\n          ? `${updatedScenes} scene voices updated. ${subtitleWarnings} subtitle track(s) could not be rebuilt and were kept out of burned captions.`\n          : `${updatedScenes} scene voices${updatedScenes === 1 ? "" : "s"} updated. Build a new full preview to review the localized cut.`,\n      });\n    } catch (error) {\n      setFullPreviewUrl(null);\n      await refreshProject();\n      toast({\n        title: "Language change stopped",\n        description: `${updatedScenes}/${narratableScenes.length} scenes were updated. ${error instanceof Error ? error.message : "Please retry to continue."}`,\n        variant: "destructive",\n      });\n    } finally {\n      setIsChangingProjectLanguage(false);\n    }\n  };\n\n  const handleBuildFullPreview = async () => {\n''',
        "whole-video language handler",
    ),
    (
        '''                          </p>\n                        </div>\n\n                        {/* Duration */}\n''',
        '''                          </p>\n                        </div>\n\n                        {/* Video Language */}\n                        <div className="space-y-2">\n                          <Label className="text-sm font-medium flex items-center gap-1.5">\n                            <Languages className="h-3.5 w-3.5 text-muted-foreground" />Video Language\n                            <span className="text-xs font-normal text-muted-foreground">(changes spoken dialogue across the current video)</span>\n                          </Label>\n                          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">\n                            <Select value={projectLanguage} onValueChange={setProjectLanguage} disabled={isChangingProjectLanguage}>\n                              <SelectTrigger className="h-9 sm:w-[260px] text-sm">\n                                <SelectValue placeholder="Choose video language" />\n                              </SelectTrigger>\n                              <SelectContent className="max-h-[320px]">\n                                {DUBBING_LANGUAGE_GROUPS.map((group) => (\n                                  <SelectGroup key={group.label}>\n                                    <SelectLabel>{group.label}</SelectLabel>\n                                    {group.languages.map((lang) => (\n                                      <SelectItem key={lang.code} value={lang.code}>\n                                        <span className="mr-1.5">{lang.flag}</span>{lang.name}\n                                      </SelectItem>\n                                    ))}\n                                  </SelectGroup>\n                                ))}\n                              </SelectContent>\n                            </Select>\n                            <Button\n                              type="button"\n                              variant="outline"\n                              className="h-9 border-violet-200 text-violet-700 hover:bg-violet-50"\n                              onClick={handleApplyProjectLanguage}\n                              disabled={isChangingProjectLanguage || safeScenes.every((scene) => !scene.dialogue?.trim())}\n                            >\n                              {isChangingProjectLanguage\n                                ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Localizing video...</>\n                                : <><Languages className="h-3.5 w-3.5 mr-1.5" />Apply to Entire Video</>}\n                            </Button>\n                          </div>\n                          <p className="text-xs text-muted-foreground">\n                            Keeps the existing visual clips, translates scene dialogue, regenerates the active voice track, and rebuilds existing subtitles in the selected language.\n                          </p>\n                        </div>\n\n                        {/* Duration */}\n''',
        "video language project setting",
    ),
])

print("Video language + provider media patch complete")
