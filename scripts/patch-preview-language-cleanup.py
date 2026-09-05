from pathlib import Path


def patch(path_str: str, old: str, new: str, label: str) -> None:
    path = Path(path_str)
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path_str} / {label}: expected exactly one match, found {count}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")
    print(f"patched {path_str}: {label}")


# ── Client-facing project list must never expose raw provider URLs ──────────
patch(
    "src/app/api/projects/route.ts",
    'import { isValidVideoModelId } from "@/lib/video-models";\n',
    'import { isValidVideoModelId } from "@/lib/video-models";\nimport { withClientSceneVideoUrl } from "@/lib/client-video-url";\n',
    "client scene URL import",
)
patch(
    "src/app/api/projects/route.ts",
    '''    const projectsForClient = projects.map(({ draftData, ...project }) => ({\n      ...project,\n      hasDraft: Boolean(draftData),\n    }));\n''',
    '''    const projectsForClient = projects.map(({ draftData, ...project }) => ({\n      ...project,\n      scenes: project.scenes.map((scene) => withClientSceneVideoUrl(scene)),\n      hasDraft: Boolean(draftData),\n    }));\n''',
    "proxy legacy scene URLs in project list",
)

# ── DB-only video status response must use same-origin playback URL ─────────
patch(
    "src/app/api/video-status/route.ts",
    'import { requireSceneAccess } from "@/lib/project-auth";\n',
    'import { requireSceneAccess } from "@/lib/project-auth";\nimport { clientSceneVideoUrl } from "@/lib/client-video-url";\n',
    "video status client URL import",
)
patch(
    "src/app/api/video-status/route.ts",
    '      videoUrl: scene.videoUrl,\n',
    '      videoUrl: clientSceneVideoUrl(scene.id, scene.videoUrl),\n',
    "video status same-origin URL",
)

# ── Full-preview legacy recovery: current URL -> refresh task -> local copy ──
patch(
    "src/lib/full-preview-render.ts",
    'import { persistProviderVideo } from "@/lib/provider-video-storage";\n',
    'import { persistProviderVideo } from "@/lib/provider-video-storage";\nimport { zai } from "@/lib/zai";\n',
    "zai recovery import",
)
patch(
    "src/lib/full-preview-render.ts",
    '''  videoUrl: string | null;\n  dialogue: string | null;\n''',
    '''  videoUrl: string | null;\n  taskId: string | null;\n  dialogue: string | null;\n''',
    "preview task id",
)
patch(
    "src/lib/full-preview-render.ts",
    '''  // Legacy projects may still contain a provider-hosted URL. Archive it into\n  // Vidora's persistent generated store before ffmpeg touches it, then repair\n  // the scene row so future playback/preview no longer depends on provider\n  // cache semantics or signed URL lifetime.\n  const localUrl = await persistProviderVideo(scene.id, scene.videoUrl);\n  const localPath = resolvePublicAssetPath(localUrl);\n  if (!existsSync(localPath)) throw new Error(`Scene ${scene.sceneNumber} media copy produced no local file`);\n  await db.videoScene.update({\n    where: { id: scene.id },\n    data: { videoUrl: localUrl },\n  });\n  scene.videoUrl = localUrl;\n  return localPath;\n''',
    '''  // Legacy projects may still contain a provider-hosted URL. Archive it into\n  // Vidora's persistent generated store before ffmpeg touches it. If the old\n  // provider URL has expired but we still have the provider task id, refresh\n  // that task once to obtain a fresh media URL before giving up.\n  let providerUrl = scene.videoUrl;\n  let firstError: unknown = null;\n  let localUrl: string | null = null;\n  try {\n    localUrl = await persistProviderVideo(scene.id, providerUrl);\n  } catch (error) {\n    firstError = error;\n  }\n\n  if (!localUrl && scene.taskId) {\n    try {\n      const refreshed = await zai.pollVideoTask({\n        taskId: scene.taskId,\n        maxAttempts: 2,\n        intervalMs: 1_500,\n      });\n      if (refreshed.status === "success" && refreshed.videoUrl) {\n        providerUrl = refreshed.videoUrl;\n        localUrl = await persistProviderVideo(scene.id, providerUrl);\n      }\n    } catch (refreshError) {\n      console.warn(\n        `[full-preview] scene=${scene.id} provider task refresh failed:`,\n        refreshError instanceof Error ? refreshError.message : "unknown error",\n      );\n    }\n  }\n\n  if (!localUrl) {\n    const detail = firstError instanceof Error ? firstError.message : "provider media unavailable";\n    throw new Error(`Scene ${scene.sceneNumber} provider video could not be recovered: ${detail}`);\n  }\n\n  const localPath = resolvePublicAssetPath(localUrl);\n  if (!existsSync(localPath)) throw new Error(`Scene ${scene.sceneNumber} media copy produced no local file`);\n  await db.videoScene.update({\n    where: { id: scene.id },\n    data: { videoUrl: localUrl, errorMessage: null },\n  });\n  scene.videoUrl = localUrl;\n  return localPath;\n''',
    "legacy provider URL recovery",
)

# ── Scene UI: one language selector, not two ────────────────────────────────
patch(
    "src/app/page.tsx",
    'import { DUBBING_LANGUAGE_GROUPS, ALL_DUBBING_LANGUAGES, DUBBING_LANGUAGE_COUNT } from "@/lib/dubbing-languages";\n',
    'import { DUBBING_LANGUAGE_GROUPS, ALL_DUBBING_LANGUAGES } from "@/lib/dubbing-languages";\n',
    "remove obsolete dubbing count import",
)
patch(
    "src/app/page.tsx",
    '''  onSetMusic, onGenerateSubtitles, onToggleBurnSubtitles, onGenerateDubbing, onDeleteDubbing, musicTracks,\n''',
    '''  onSetMusic, onGenerateSubtitles, onToggleBurnSubtitles, onDeleteDubbing, musicTracks,\n''',
    "remove dubbing callback from scene card args",
)
patch(
    "src/app/page.tsx",
    '''  onToggleBurnSubtitles: (sceneId: string, burn: boolean) => void;\n  onGenerateDubbing: (sceneId: string, lang: string, langName: string) => void;\n  onDeleteDubbing: (sceneId: string, lang: string, langName: string) => void;\n''',
    '''  onToggleBurnSubtitles: (sceneId: string, burn: boolean) => void;\n  onDeleteDubbing: (sceneId: string, lang: string, langName: string) => void;\n''',
    "remove dubbing callback type",
)
patch(
    "src/app/page.tsx",
    '''                        {/* ── Dubbing Selector (30+ languages, grouped) ── */}\n                        <Select\n                          value=""\n                          onValueChange={(v) => {\n                            const lang = ALL_DUBBING_LANGUAGES.find((l) => l.code === v);\n                            if (lang) onGenerateDubbing(scene.id, lang.code, lang.name);\n                          }}\n                        >\n                          <SelectTrigger className="h-7 w-[88px] text-xs px-1.5 gap-1">\n                            <Languages className="h-3 w-3 shrink-0" />\n                            <SelectValue placeholder="Dub" />\n                          </SelectTrigger>\n                          <SelectContent className="min-w-[240px] max-h-[320px]">\n                            <div className="px-2 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">\n                              {DUBBING_LANGUAGE_COUNT} languages\n                            </div>\n                            {DUBBING_LANGUAGE_GROUPS.map((group) => (\n                              <SelectGroup key={group.label}>\n                                <SelectLabel className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground px-2 pt-2">\n                                  {group.label}\n                                </SelectLabel>\n                                {group.languages.map((lang) => (\n                                  <SelectItem key={lang.code} value={lang.code} className="text-xs">\n                                    <span className="mr-1.5">{lang.flag}</span>\n                                    {lang.name}\n                                  </SelectItem>\n                                ))}\n                              </SelectGroup>\n                            ))}\n                          </SelectContent>\n                        </Select>\n''',
    '',
    "remove duplicate old Dub selector",
)
patch(
    "src/app/page.tsx",
    '''                                {narrationLanguage === "en"\n                                  ? "Language, accent and style shape this scene's AI performance."\n                                  : "Uses this scene's saved translation for the selected language. Generate dubbing/translation first if needed."}\n''',
    '''                                {narrationLanguage === "en"\n                                  ? "Language, accent and style shape this scene's AI performance."\n                                  : "Vidora automatically prepares a translation when this language has not been generated yet."}\n''',
    "scene language help text",
)
patch(
    "src/app/page.tsx",
    '''      const scene = currentProject.scenes?.find((item) => item.id === sceneId);\n      const language = profile?.language || scene?.narrationLang || "en";\n      const res = await fetch("/api/generate-narration", {\n''',
    '''      const scene = currentProject.scenes?.find((item) => item.id === sceneId);\n      const language = profile?.language || scene?.narrationLang || "en";\n\n      if (language !== "en") {\n        const hasTranslation = scene?.translations?.some(\n          (translation) => translation.lang === language && Boolean(translation.translatedText?.trim()),\n        );\n        if (!hasTranslation) {\n          const translateRes = await fetch(`/api/scenes/${sceneId}/dubbing`, {\n            method: "POST",\n            headers: { "Content-Type": "application/json" },\n            body: JSON.stringify({\n              lang: language,\n              voiceId: voice || scene?.narrationVoice || "tongtong",\n              translateOnly: true,\n            }),\n          });\n          const translateData = await translateRes.json();\n          if (!translateRes.ok || !translateData.success) {\n            toast({\n              title: "Translation failed",\n              description: getApiError(translateData, "Could not prepare this language."),\n              variant: "destructive",\n            });\n            return;\n          }\n        }\n      }\n\n      const res = await fetch("/api/generate-narration", {\n''',
    "auto-prepare selected scene translation",
)
patch(
    "src/app/page.tsx",
    '''  // ── Dubbing ──\n  const handleGenerateDubbing = async (sceneId: string, lang: string, langName: string) => {\n    toast({ title: `Generating ${langName} dubbing...`, description: "Translating and synthesizing voice." });\n    try {\n      const res = await fetch(`/api/scenes/${sceneId}/dubbing`, {\n        method: "POST",\n        headers: { "Content-Type": "application/json" },\n        body: JSON.stringify({ lang }),\n      });\n      const data = await res.json();\n      if (data.success) {\n        toast({\n          title: `${langName} dubbing ready!`,\n          description: data.chunks > 1 ? `Translation + voice generated (${data.chunks} segments).` : "Translation + voice generated.",\n        });\n        // Reload project so the new translation + audio URL appear in the scene card\n        if (currentProject) refreshProject();\n      } else {\n        // The API now returns a friendly user-facing message by default.\n        // Admins get the raw diagnostic via `adminDetail`; users see "service\n        // temporarily unavailable" instead of internal billing details.\n        toast({\n          title: "Dubbing failed",\n          description: getApiError(data, "Please try again in a moment."),\n          variant: "destructive",\n        });\n      }\n    } catch {\n      toast({ title: "Network error", description: "Could not reach the dubbing service.", variant: "destructive" });\n    }\n  };\n\n''',
    '',
    "remove obsolete dubbing handler",
)
patch(
    "src/app/page.tsx",
    '''                              onToggleBurnSubtitles={handleToggleBurnSubtitles}\n                              onGenerateDubbing={handleGenerateDubbing}\n                              onDeleteDubbing={handleDeleteDubbing}\n''',
    '''                              onToggleBurnSubtitles={handleToggleBurnSubtitles}\n                              onDeleteDubbing={handleDeleteDubbing}\n''',
    "remove obsolete dubbing prop",
)

print("preview/language cleanup patch complete")
