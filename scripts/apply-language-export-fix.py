from pathlib import Path


def replace_once(file_name: str, old: str, new: str, label: str) -> None:
    path = Path(file_name)
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{file_name}: {label}: expected exactly one match, found {count}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")
    print(f"patched {file_name}: {label}")


# Full preview: selected language auto-translates; TTS outages no longer kill
# an otherwise valid visual preview/export review gate.
replace_once(
    "src/lib/full-preview-render.ts",
    'import { generateSceneNarration, pickSceneNarrationVoice } from "@/lib/narration";\n',
    'import { generateSceneNarration, pickSceneNarrationVoice } from "@/lib/narration";\nimport { resolveSceneLanguageText } from "@/lib/scene-language";\n',
    "scene-language import",
)

replace_once(
    "src/lib/full-preview-render.ts",
    '''  if (scene.dialogue?.trim()) {\n    const voice = await pickSceneNarrationVoice(scene);\n    const language = scene.narrationLang || "en";\n    let narrationText = scene.dialogue.trim();\n    if (language !== "en") {\n      const translated = scene.translations.find(\n        (translation) => translation.lang === language && translation.translatedText?.trim(),\n      );\n      narrationText = translated?.translatedText?.trim() || "";\n      if (!narrationText) {\n        throw new Error(\n          `Scene ${scene.sceneNumber} is set to ${language} but has no translated dialogue. Apply the video language again before previewing.`,\n        );\n      }\n    }\n\n    // Always resolve through the deterministic narration generator. It replays\n    // an existing matching fingerprint without charging again, while a stale\n    // provider/voice/dialogue/profile artifact receives a new fingerprint.\n    const narration = await generateSceneNarration({\n      sceneId: scene.id,\n      text: narrationText,\n      voice,\n      language,\n      accent: scene.narrationAccent || undefined,\n      style: scene.narrationStyle || undefined,\n    });\n    narrationPath = narration.path;\n  } else if (scene.narrationUrl) {\n''',
    '''  if (scene.dialogue?.trim()) {\n    try {\n      const voice = await pickSceneNarrationVoice(scene);\n      const language = scene.narrationLang || "en";\n      const narrationText = language === "en"\n        ? scene.dialogue.trim()\n        : (await resolveSceneLanguageText(scene.id, language)).text;\n\n      // Always resolve through the deterministic narration generator. It replays\n      // an existing matching fingerprint without charging again, while a stale\n      // provider/voice/dialogue/profile artifact receives a new fingerprint.\n      const narration = await generateSceneNarration({\n        sceneId: scene.id,\n        text: narrationText,\n        voice,\n        language,\n        accent: scene.narrationAccent || undefined,\n        style: scene.narrationStyle || undefined,\n      });\n      narrationPath = narration.path;\n    } catch (voiceError) {\n      // Voice providers are optional. A missing/unfunded/unavailable TTS service\n      // must not turn valid scene clips into a 502 or block the review gate.\n      console.warn(\n        `[full-preview] scene=${scene.id} voice generation skipped:`,\n        voiceError instanceof Error ? voiceError.message : "unknown voice error",\n      );\n      narrationPath = null;\n    }\n  } else if (scene.narrationUrl) {\n''',
    "non-fatal translated narration",
)


# Final export: preserve the selected language/profile and use the same robust
# provider-video archiving/recovery behavior as full preview.
replace_once(
    "src/app/api/export-video/route.ts",
    'import { generateSceneNarration, pickSceneNarrationVoice } from "@/lib/narration";\n',
    'import { generateSceneNarration, pickSceneNarrationVoice } from "@/lib/narration";\nimport { resolveSceneLanguageText } from "@/lib/scene-language";\nimport { materializeSceneVideo } from "@/lib/scene-video-materializer";\n',
    "language and media imports",
)

replace_once(
    "src/app/api/export-video/route.ts",
    '''interface AudioScene {\n  id: string;\n  dialogue?: string | null;\n  narrationUrl?: string | null;\n  narrationVoice?: string | null;\n  characterIds?: string | null;\n  musicTrackUrl?: string | null;\n  musicVolume?: number | null;\n}\n''',
    '''interface AudioScene {\n  id: string;\n  sceneNumber?: number | null;\n  taskId?: string | null;\n  dialogue?: string | null;\n  narrationUrl?: string | null;\n  narrationVoice?: string | null;\n  narrationLang?: string | null;\n  narrationAccent?: string | null;\n  narrationStyle?: string | null;\n  characterIds?: string | null;\n  musicTrackUrl?: string | null;\n  musicVolume?: number | null;\n}\n''',
    "export scene language/media fields",
)

replace_once(
    "src/app/api/export-video/route.ts",
    '''    if (!narrationPath && scene.dialogue && scene.dialogue.trim().length > 0) {\n      const voice = await pickSceneNarrationVoice(scene);\n      try {\n        console.log(`[Export] Auto-generating voice for scene ${scene.id} (voice=${voice})…`);\n        onSceneProgress?.({ index: i + 1, total: scenes.length, phase: "voice" });\n        const result = await generateSceneNarration({\n          sceneId: scene.id,\n          text: scene.dialogue,\n          voice,\n        });\n        narrationPath = result.path;\n        audio[i].narrationGenerated = true;\n        summary.voicesGenerated++;\n        // Persist so the studio player & future exports reuse it\n        await db.videoScene\n          .update({ where: { id: scene.id }, data: { narrationUrl: result.url, narrationVoice: voice } })\n          .catch(() => { /* non-fatal */ });\n      } catch (ttsErr) {\n        summary.voiceFailures++;\n        console.error(`[Export] TTS failed for scene ${scene.id} — exporting without its voice:`, ttsErr);\n      }\n    }\n''',
    '''    if (!narrationPath && scene.dialogue && scene.dialogue.trim().length > 0) {\n      const voice = await pickSceneNarrationVoice(scene);\n      const language = scene.narrationLang || "en";\n      try {\n        console.log(`[Export] Auto-generating voice for scene ${scene.id} (voice=${voice}, language=${language})…`);\n        onSceneProgress?.({ index: i + 1, total: scenes.length, phase: "voice" });\n        const narrationText = language === "en"\n          ? scene.dialogue.trim()\n          : (await resolveSceneLanguageText(scene.id, language)).text;\n        const result = await generateSceneNarration({\n          sceneId: scene.id,\n          text: narrationText,\n          voice,\n          language,\n          accent: scene.narrationAccent || undefined,\n          style: scene.narrationStyle || undefined,\n        });\n        narrationPath = result.path;\n        audio[i].narrationGenerated = true;\n        summary.voicesGenerated++;\n        // Persist so the studio player & future exports reuse it\n        await db.videoScene\n          .update({\n            where: { id: scene.id },\n            data: {\n              narrationUrl: result.url,\n              narrationVoice: voice,\n              narrationLang: result.profile.language,\n              narrationAccent: result.profile.accent,\n              narrationStyle: result.profile.style,\n            },\n          })\n          .catch(() => { /* non-fatal */ });\n      } catch (ttsErr) {\n        summary.voiceFailures++;\n        console.error(`[Export] TTS failed for scene ${scene.id} — exporting without its voice:`, ttsErr);\n      }\n    }\n''',
    "language-aware final export narration",
)

replace_once(
    "src/app/api/export-video/route.ts",
    '''    const localPath = path.join(workDir, "scene_001.mp4");\n    // Local-first for app-relative URLs (/generated/...): node fetch can't\n    // fetch a relative path, so probe the file store directly instead of\n    // burning 3 retry cycles on unparseable URLs.\n    let sceneVideoPath = localPath;\n    if (scene.videoUrl!.startsWith("/")) {\n      const storeFile = resolvePublicAssetPath(scene.videoUrl!);\n      if (existsSync(storeFile)) {\n        sceneVideoPath = storeFile;\n        console.log("[Export] Using local file for scene 1");\n      }\n    }\n    if (sceneVideoPath === localPath) {\n      await downloadWithRetry(scene.videoUrl!, localPath);\n    }\n''',
    '''    const localPath = path.join(workDir, "scene_001.mp4");\n    let sceneVideoPath: string;\n    try {\n      sceneVideoPath = await materializeSceneVideo(scene);\n      console.log("[Export] Materialized scene 1 into Vidora's local media store");\n    } catch (materializeError) {\n      // Preserve support for non-provider legacy absolute URLs, but let the\n      // resilient provider materializer handle Z.AI cache/range/task refresh.\n      if (scene.videoUrl!.startsWith("/")) throw materializeError;\n      console.warn("[Export] Scene 1 resilient materialization failed; trying legacy direct fetch:", materializeError);\n      await downloadWithRetry(scene.videoUrl!, localPath);\n      sceneVideoPath = localPath;\n    }\n''',
    "single-scene resilient media materialization",
)

replace_once(
    "src/app/api/export-video/route.ts",
    '''      // Local-first for app-relative URLs (/generated/...): node fetch can't\n      // fetch a relative path, so probe the file store directly instead of\n      // burning 3 retry cycles on unparseable URLs.\n      const isRelativeUrl = scene.videoUrl!.startsWith("/");\n      if (isRelativeUrl) {\n        const storeFile = resolvePublicAssetPath(scene.videoUrl!);\n        if (existsSync(storeFile)) {\n          localPaths.push(storeFile);\n          console.log(`[Export] Using local file for scene ${i + 1}`);\n          continue;\n        }\n      }\n\n      try {\n        await downloadWithRetry(scene.videoUrl!, localPath);\n        localPaths.push(localPath);\n        console.log(`[Export] Downloaded scene ${i + 1}/${completedScenes.length}`);\n      } catch (dlErr) {\n        // Fallback: check for local file\n        const localFile = resolvePublicAssetPath(scene.videoUrl!);\n        if (existsSync(localFile)) {\n          localPaths.push(localFile);\n          console.log(`[Export] Using local file for scene ${i + 1}`);\n        } else {\n          console.error(`[Export] Failed to download scene ${i + 1}:`, dlErr);\n          throw new Error(`Could not download scene ${i + 1} video after retries`);\n        }\n      }\n''',
    '''      try {\n        const materialized = await materializeSceneVideo(scene);\n        localPaths.push(materialized);\n        console.log(`[Export] Materialized scene ${i + 1}/${completedScenes.length}`);\n        continue;\n      } catch (materializeError) {\n        if (scene.videoUrl!.startsWith("/")) {\n          console.error(`[Export] Local scene ${i + 1} is unavailable:`, materializeError);\n          throw materializeError;\n        }\n        console.warn(\n          `[Export] Scene ${i + 1} resilient materialization failed; trying legacy direct fetch:`,\n          materializeError,\n        );\n      }\n\n      try {\n        await downloadWithRetry(scene.videoUrl!, localPath);\n        localPaths.push(localPath);\n        console.log(`[Export] Downloaded scene ${i + 1}/${completedScenes.length} using legacy fallback`);\n      } catch (dlErr) {\n        console.error(`[Export] Failed to download scene ${i + 1}:`, dlErr);\n        throw new Error(`Could not download scene ${i + 1} video after retries`);\n      }\n''',
    "multi-scene resilient media materialization",
)

print("language/export patch applied")
