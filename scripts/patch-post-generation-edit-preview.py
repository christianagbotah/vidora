from pathlib import Path
import re


def replace_once(path: str, old: str, new: str, label: str):
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly 1 match, found {count}")
    p.write_text(text.replace(old, new, 1))


def regex_once(path: str, pattern: str, replacement: str, label: str):
    p = Path(path)
    text = p.read_text()
    new_text, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly 1 match, found {count}")
    p.write_text(new_text)

# Prisma schema: retain the previous completed clip during a replacement render.
replace_once(
    "prisma/schema.prisma",
    '  videoUrl          String?      @db.Text\n  taskId            String?\n',
    '  videoUrl          String?      @db.Text\n  previousVideoUrl  String?      @db.Text\n  taskId            String?\n',
    "schema previousVideoUrl",
)

# Client type.
replace_once(
    "src/types/video.ts",
    '  videoUrl?: string | null;\n  taskId?: string | null;\n',
    '  videoUrl?: string | null;\n  previousVideoUrl?: string | null;\n  taskId?: string | null;\n',
    "video type previousVideoUrl",
)

# Generic scene update endpoint: expose reference binding + revision fields and
# invalidate an already-assembled final export whenever generation input changes.
replace_once(
    "src/app/api/projects/[id]/scenes/[sceneId]/route.ts",
    '      title, visualNote, dialogue,\n      // Internal-state resets (scene prompt editor + retry flow): clear the\n',
    '      title, visualNote, dialogue, characterIds, referenceImageUrl,\n      videoUrl, previousVideoUrl,\n      // Internal-state resets (scene prompt editor + retry flow): clear the\n',
    "scene route destructuring",
)
replace_once(
    "src/app/api/projects/[id]/scenes/[sceneId]/route.ts",
    '        ...(dialogue !== undefined && { dialogue: dialogue || null }),\n        // Prompt-editor / retry resets — null clears the stale state.\n',
    '        ...(dialogue !== undefined && { dialogue: dialogue || null }),\n        ...(characterIds !== undefined && { characterIds: characterIds || null }),\n        ...(referenceImageUrl !== undefined && { referenceImageUrl: referenceImageUrl || null }),\n        ...(videoUrl !== undefined && { videoUrl: videoUrl || null }),\n        ...(previousVideoUrl !== undefined && { previousVideoUrl: previousVideoUrl || null }),\n        // Prompt-editor / retry resets — null clears the stale state.\n',
    "scene route writable generation fields",
)
replace_once(
    "src/app/api/projects/[id]/scenes/[sceneId]/route.ts",
    '    return NextResponse.json({ success: true, scene });\n',
    '''    const invalidatesAssembly =\n      prompt !== undefined || enhancedPrompt !== undefined || characterIds !== undefined ||\n      referenceImageUrl !== undefined || videoUrl === null;\n    if (invalidatesAssembly) {\n      await db.videoProject.update({\n        where: { id },\n        data: { finalVideoUrl: null, ...(videoUrl === null ? { status: "draft" } : {}) },\n      });\n    }\n\n    return NextResponse.json({ success: true, scene });\n''',
    "scene route invalidate final video",
)

# Draft finalization: when exactly one pictured, non-narrator character exists,
# use it as the safe fallback subject for scenes the parser failed to link. Also
# persist a direct referenceImageUrl when a scene resolves to one pictured character.
replace_once(
    "src/app/api/projects/[id]/finalize-draft/route.ts",
    '''      const charIdByName = new Map(\n        finalCharacters.map((character) => [normalizedCharacterName(character.name), character.id]),\n      );\n''',
    '''      const charIdByName = new Map(\n        finalCharacters.map((character) => [normalizedCharacterName(character.name), character.id]),\n      );\n      const charById = new Map(finalCharacters.map((character) => [character.id, character]));\n      const picturedSubjects = finalCharacters.filter(\n        (character) => Boolean(character.imageUrl) && !/narrator/i.test(character.role || "") && !/narrator/i.test(character.name),\n      );\n''',
    "finalize pictured subject map",
)
replace_once(
    "src/app/api/projects/[id]/finalize-draft/route.ts",
    '''        const linkedIds = (scene.characterNames || [])\n          .map((name) => charIdByName.get(normalizedCharacterName(name)))\n          .filter((characterId): characterId is string => !!characterId);\n\n        await tx.videoScene.create({\n''',
    '''        let linkedIds = (scene.characterNames || [])\n          .map((name) => charIdByName.get(normalizedCharacterName(name)))\n          .filter((characterId): characterId is string => !!characterId);\n\n        // Birthday/custom projects commonly have one uploaded subject photo,\n        // while an LLM scene parse may omit the subject name on atmospheric or\n        // closing scenes. In that narrow case, keep identity continuity by\n        // binding the one pictured subject instead of silently switching faces.\n        if (linkedIds.length === 0 && picturedSubjects.length === 1) {\n          linkedIds = [picturedSubjects[0].id];\n        }\n        const linkedWithImages = linkedIds\n          .map((characterId) => charById.get(characterId))\n          .filter((character): character is NonNullable<typeof character> => Boolean(character?.imageUrl));\n        const directReference = linkedWithImages.length === 1 ? linkedWithImages[0].imageUrl : null;\n\n        await tx.videoScene.create({\n''',
    "finalize scene fallback binding",
)
replace_once(
    "src/app/api/projects/[id]/finalize-draft/route.ts",
    '''            characterIds: linkedIds.length ? JSON.stringify(linkedIds) : null,\n            duration,\n''',
    '''            characterIds: linkedIds.length ? JSON.stringify(linkedIds) : null,\n            referenceImageUrl: directReference,\n            duration,\n''',
    "finalize direct reference",
)

# Full-project preview: reuse the existing FFmpeg concatenator, but preview mode
# must not mark the project generating/completed or populate finalVideoUrl.
replace_once(
    "src/app/api/concatenate-video/route.ts",
    '    const { projectId } = await req.json();\n',
    '    const { projectId, previewOnly = false } = await req.json();\n',
    "concat preview input",
)
replace_once(
    "src/app/api/concatenate-video/route.ts",
    '''    if (completedScenes.length === 0) {\n      return NextResponse.json({ success: false, error: "No completed video scenes to concatenate" }, { status: 400 });\n    }\n\n    if (completedScenes.length === 1) {\n''',
    '''    if (completedScenes.length === 0) {\n      return NextResponse.json({ success: false, error: "No completed video scenes to concatenate" }, { status: 400 });\n    }\n    if (previewOnly && completedScenes.length !== project.scenes.length) {\n      return NextResponse.json({\n        success: false,\n        error: `Full preview requires every scene to be complete (${completedScenes.length}/${project.scenes.length} ready).`,\n      }, { status: 409 });\n    }\n\n    if (completedScenes.length === 1) {\n''',
    "concat preview completeness",
)
replace_once(
    "src/app/api/concatenate-video/route.ts",
    '''      // Just one scene — save as final video directly\n      await db.videoProject.update({\n        where: { id: projectId },\n        data: { finalVideoUrl: completedScenes[0].videoUrl, status: "completed" },\n      });\n      return NextResponse.json({\n        success: true,\n        finalVideoUrl: completedScenes[0].videoUrl,\n        sceneCount: 1,\n        message: "Single scene saved as final video",\n      });\n    }\n\n    // Mark as generating\n    await db.videoProject.update({ where: { id: projectId }, data: { status: "generating" } });\n''',
    '''      if (!previewOnly) {\n        await db.videoProject.update({\n          where: { id: projectId },\n          data: { finalVideoUrl: completedScenes[0].videoUrl, status: "completed" },\n        });\n      }\n      return NextResponse.json({\n        success: true,\n        ...(previewOnly ? { previewVideoUrl: completedScenes[0].videoUrl } : { finalVideoUrl: completedScenes[0].videoUrl }),\n        sceneCount: 1,\n        message: previewOnly ? "Full preview ready" : "Single scene saved as final video",\n      });\n    }\n\n    // A preview is a read-only review render. Export/final state must not move.\n    if (!previewOnly) {\n      await db.videoProject.update({ where: { id: projectId }, data: { status: "generating" } });\n    }\n''',
    "concat single/mark state",
)
replace_once(
    "src/app/api/concatenate-video/route.ts",
    '''      const finalFileName = "final_" + projectId + ".mp4";\n      const finalPath = generatedFilePath(finalFileName);\n      const finalData = await readFile(outputPath);\n      await mkdir(path.dirname(finalPath), { recursive: true });\n      await writeFile(finalPath, finalData);\n\n      const finalVideoUrl = "/generated/" + finalFileName;\n\n      // Update project\n      await db.videoProject.update({\n        where: { id: projectId },\n        data: { finalVideoUrl, status: "completed" },\n      });\n''',
    '''      const resultFileName = (previewOnly ? "preview_" : "final_") + projectId + ".mp4";\n      const resultPath = generatedFilePath(resultFileName);\n      const finalData = await readFile(outputPath);\n      await mkdir(path.dirname(resultPath), { recursive: true });\n      await writeFile(resultPath, finalData);\n\n      const resultVideoUrl = "/generated/" + resultFileName;\n\n      if (!previewOnly) {\n        await db.videoProject.update({\n          where: { id: projectId },\n          data: { finalVideoUrl: resultVideoUrl, status: "completed" },\n        });\n      }\n''',
    "concat result file",
)
replace_once(
    "src/app/api/concatenate-video/route.ts",
    '''        finalVideoUrl,\n        sceneCount: completedScenes.length,\n        estimatedDuration: durationStr,\n        message: "Full video created! (" + completedScenes.length + " scenes, ~" + durationStr + ")",\n''',
    '''        ...(previewOnly ? { previewVideoUrl: resultVideoUrl } : { finalVideoUrl: resultVideoUrl }),\n        sceneCount: completedScenes.length,\n        estimatedDuration: durationStr,\n        message: previewOnly\n          ? "Full project preview ready — review it before export."\n          : "Full video created! (" + completedScenes.length + " scenes, ~" + durationStr + ")",\n''',
    "concat response",
)
replace_once(
    "src/app/api/concatenate-video/route.ts",
    '''      await db.videoProject.update({ where: { id: projectId }, data: { status: "failed" } });\n      return NextResponse.json({ success: false, error: "Failed to concatenate videos" }, { status: 500 });\n''',
    '''      if (!previewOnly) {\n        await db.videoProject.update({ where: { id: projectId }, data: { status: "failed" } });\n      }\n      return NextResponse.json({ success: false, error: previewOnly ? "Failed to build full preview" : "Failed to concatenate videos" }, { status: 500 });\n''',
    "concat preview failure state",
)

# Dedicated completed-scene revision endpoint. It atomically binds the chosen
# uploaded character reference, retains the previous clip, invalidates stale
# final assembly, and prepares only that scene for a fresh generation charge.
regen = Path("src/app/api/projects/[id]/scenes/[sceneId]/regenerate/route.ts")
regen.parent.mkdir(parents=True, exist_ok=True)
regen.write_text('''import { NextRequest, NextResponse } from "next/server";\nimport { db } from "@/lib/db";\nimport { requireProjectAccess } from "@/lib/project-auth";\n\nexport const runtime = "nodejs";\n\nexport async function POST(\n  req: NextRequest,\n  { params }: { params: Promise<{ id: string; sceneId: string }> },\n) {\n  try {\n    const { id, sceneId } = await params;\n    const access = await requireProjectAccess(id, true);\n    if (!access.ok) return access.response;\n\n    const { prompt, characterId } = await req.json();\n    if (typeof prompt !== "string" || !prompt.trim()) {\n      return NextResponse.json({ success: false, error: "A correction prompt is required" }, { status: 400 });\n    }\n\n    const activeRun = await db.generationRun.findUnique({ where: { activeKey: `project:${id}` } });\n    if (activeRun) {\n      return NextResponse.json({\n        success: false,\n        error: "Finish or resume the current generation run before replacing a completed scene.",\n      }, { status: 409 });\n    }\n\n    const scene = await db.videoScene.findFirst({ where: { id: sceneId, projectId: id } });\n    if (!scene) {\n      return NextResponse.json({ success: false, error: "Scene not found" }, { status: 404 });\n    }\n\n    let selectedCharacter: { id: string; name: string; imageUrl: string | null } | null = null;\n    if (characterId) {\n      selectedCharacter = await db.character.findFirst({\n        where: { id: characterId, projectId: id },\n        select: { id: true, name: true, imageUrl: true },\n      });\n      if (!selectedCharacter) {\n        return NextResponse.json({ success: false, error: "Selected character is not part of this project" }, { status: 400 });\n      }\n      if (!selectedCharacter.imageUrl) {\n        return NextResponse.json({ success: false, error: "The selected character does not have an uploaded/generated reference image" }, { status: 400 });\n      }\n    }\n\n    const updated = await db.$transaction(async (tx) => {\n      const nextScene = await tx.videoScene.update({\n        where: { id: sceneId },\n        data: {\n          prompt: prompt.trim(),\n          enhancedPrompt: null,\n          ...(selectedCharacter ? {\n            characterIds: JSON.stringify([selectedCharacter.id]),\n            referenceImageUrl: selectedCharacter.imageUrl,\n          } : {}),\n          previousVideoUrl: scene.videoUrl || scene.previousVideoUrl || null,\n          videoUrl: null,\n          taskId: null,\n          status: "pending",\n          errorMessage: null,\n        },\n      });\n      await tx.videoProject.update({\n        where: { id },\n        data: { finalVideoUrl: null, status: "draft" },\n      });\n      return nextScene;\n    });\n\n    return NextResponse.json({\n      success: true,\n      scene: updated,\n      referenceCharacter: selectedCharacter,\n      previousClipPreserved: Boolean(updated.previousVideoUrl),\n    });\n  } catch (error) {\n    console.error("[scene-regenerate] failed", error);\n    return NextResponse.json({ success: false, error: "Failed to prepare scene regeneration" }, { status: 500 });\n  }\n}\n''')

# Page state: scene identity correction + full preview player.
replace_once(
    "src/app/page.tsx",
    '''  const [editPromptScene, setEditPromptScene] = useState<VideoScene | null>(null);\n  const [editPromptText, setEditPromptText] = useState("");\n  const [isSavingPrompt, setIsSavingPrompt] = useState(false);\n''',
    '''  const [editPromptScene, setEditPromptScene] = useState<VideoScene | null>(null);\n  const [editPromptText, setEditPromptText] = useState("");\n  const [editReferenceCharacterId, setEditReferenceCharacterId] = useState("");\n  const [isSavingPrompt, setIsSavingPrompt] = useState(false);\n  const [fullPreviewOpen, setFullPreviewOpen] = useState(false);\n  const [fullPreviewUrl, setFullPreviewUrl] = useState<string | null>(null);\n  const [isBuildingFullPreview, setIsBuildingFullPreview] = useState(false);\n''',
    "page edit/preview state",
)

# Completed clips get an explicit edit/regenerate action.
replace_once(
    "src/app/page.tsx",
    '''                      {scene.videoUrl && (\n                        <a\n                          href={scene.videoUrl}\n                          download\n                          className="inline-flex items-center gap-1 text-xs text-violet-500 hover:text-violet-700 mt-1"\n                        >\n                          <Download className="h-3.5 w-3.5" />Download video\n                        </a>\n                      )}\n''',
    '''                      {scene.videoUrl && (\n                        <div className="mt-1 flex items-center gap-2 flex-wrap">\n                          <button\n                            type="button"\n                            onClick={() => onEditPrompt(scene)}\n                            className="inline-flex items-center gap-1 text-xs font-medium text-violet-600 hover:text-violet-800"\n                          >\n                            <Pencil className="h-3.5 w-3.5" />Edit &amp; Regenerate\n                          </button>\n                          <a\n                            href={scene.videoUrl}\n                            download\n                            className="inline-flex items-center gap-1 text-xs text-violet-500 hover:text-violet-700"\n                          >\n                            <Download className="h-3.5 w-3.5" />Download clip\n                          </a>\n                        </div>\n                      )}\n''',
    "completed scene edit action",
)

# Editor open: preselect the scene-linked character, or the character whose
# persisted image already matches referenceImageUrl.
replace_once(
    "src/app/page.tsx",
    '''  const handleEditScenePrompt = (scene: VideoScene) => {\n    setEditPromptText(scene.enhancedPrompt || scene.prompt);\n    setEditPromptScene(scene);\n  };\n''',
    '''  const handleEditScenePrompt = (scene: VideoScene) => {\n    setEditPromptText(scene.enhancedPrompt || scene.prompt);\n    let linkedCharacterId = "";\n    try {\n      const parsed = scene.characterIds ? JSON.parse(scene.characterIds) : [];\n      if (Array.isArray(parsed) && typeof parsed[0] === "string") linkedCharacterId = parsed[0];\n    } catch { /* legacy malformed characterIds */ }\n    if (!linkedCharacterId && scene.referenceImageUrl) {\n      linkedCharacterId = safeCharacters.find((character) => character.imageUrl === scene.referenceImageUrl)?.id || "";\n    }\n    setEditReferenceCharacterId(linkedCharacterId);\n    setEditPromptScene(scene);\n  };\n''',
    "page editor character preselect",
)

# Replace save/regenerate handler. Save-only persists the correction/reference
# without destroying a completed clip. Save+Generate uses the revision endpoint
# so the old clip is retained while only this scene is regenerated.
regex_once(
    "src/app/page.tsx",
    r'  /\* Save the edited prompt \(clears the stale enhanced prompt \+ error\) and\n     optionally regenerates the scene right away\. \*/\n  const handleSaveScenePrompt = async \(andGenerate: boolean\) => \{.*?\n  \};\n  const handleDeleteClick',
    '''  /* Save a correction and optionally replace only this scene. */\n  const handleSaveScenePrompt = async (andGenerate: boolean) => {\n    if (!currentProject || !editPromptScene) return;\n    const text = editPromptText.trim();\n    if (!text) {\n      toast({ title: "Prompt can't be empty", variant: "destructive" });\n      return;\n    }\n    setIsSavingPrompt(true);\n    const sceneId = editPromptScene.id;\n    const selectedCharacter = safeCharacters.find((character) => character.id === editReferenceCharacterId);\n    try {\n      if (andGenerate) {\n        const prepRes = await fetch(`/api/projects/${currentProject.id}/scenes/${sceneId}/regenerate`, {\n          method: "POST",\n          headers: { "Content-Type": "application/json" },\n          body: JSON.stringify({\n            prompt: text,\n            characterId: selectedCharacter?.id || null,\n          }),\n        });\n        const prep = await prepRes.json();\n        if (!prepRes.ok || !prep.success) {\n          toast({ title: "Could not prepare replacement", description: getApiError(prep), variant: "destructive" });\n          return;\n        }\n        setEditPromptScene(null);\n        setFullPreviewUrl(null);\n        await refreshProject();\n        toast({\n          title: "Scene correction saved",\n          description: selectedCharacter?.imageUrl\n            ? `Using ${selectedCharacter.name}'s reference image for the replacement clip.`\n            : "Regenerating only this scene. The previous clip is preserved until replacement succeeds.",\n        });\n        await handleGenerateSingle(sceneId, text);\n      } else {\n        const res = await fetch(`/api/projects/${currentProject.id}/scenes/${sceneId}`, {\n          method: "PUT",\n          headers: { "Content-Type": "application/json" },\n          body: JSON.stringify({\n            prompt: text,\n            enhancedPrompt: null,\n            errorMessage: null,\n            ...(selectedCharacter ? {\n              characterIds: JSON.stringify([selectedCharacter.id]),\n              referenceImageUrl: selectedCharacter.imageUrl || null,\n            } : {}),\n          }),\n        });\n        const data = await res.json();\n        if (!res.ok || !data.success) {\n          toast({ title: "Could not save scene edit", description: getApiError(data), variant: "destructive" });\n          return;\n        }\n        setEditPromptScene(null);\n        setFullPreviewUrl(null);\n        await refreshProject();\n        toast({ title: "Scene edit saved", description: "The current clip is unchanged until you choose Regenerate." });\n      }\n    } catch {\n      toast({ title: "Could not save scene edit", variant: "destructive" });\n    } finally {\n      setIsSavingPrompt(false);\n    }\n  };\n  const handleDeleteClick''',
    "page save/regenerate handler",
)

# Full preview builder handler before branded export.
replace_once(
    "src/app/page.tsx",
    '''  // ── Branded Export ──\n  const handleExportBranded''',
    '''  const handleBuildFullPreview = async () => {\n    if (!currentProject || isBuildingFullPreview) return;\n    if (safeScenes.length === 0 || safeScenes.some((scene) => !scene.videoUrl)) {\n      toast({\n        title: "Finish all scenes first",\n        description: `Full preview needs every scene complete (${completedSceneCount}/${safeScenes.length} ready).`,\n        variant: "destructive",\n      });\n      return;\n    }\n    setIsBuildingFullPreview(true);\n    try {\n      const res = await fetch("/api/concatenate-video", {\n        method: "POST",\n        headers: { "Content-Type": "application/json" },\n        body: JSON.stringify({ projectId: currentProject.id, previewOnly: true }),\n      });\n      const data = await res.json();\n      if (!res.ok || !data.success || !data.previewVideoUrl) {\n        toast({ title: "Preview failed", description: getApiError(data, "Could not build the full preview."), variant: "destructive" });\n        return;\n      }\n      setFullPreviewUrl(data.previewVideoUrl);\n      setFullPreviewOpen(true);\n      toast({ title: "Full preview ready", description: "Review the entire video before exporting or downloading." });\n    } catch {\n      toast({ title: "Preview failed", description: "Could not build the full project preview.", variant: "destructive" });\n    } finally {\n      setIsBuildingFullPreview(false);\n    }\n  };\n\n  // ── Branded Export ──\n  const handleExportBranded''',
    "page full preview handler",
)

# Add full preview control immediately before Export Video.
replace_once(
    "src/app/page.tsx",
    '''                <Button\n                  onClick={() => setExportDialogOpen(true)}\n                  disabled={completedSceneCount === 0 || isExporting}\n''',
    '''                <Button\n                  onClick={handleBuildFullPreview}\n                  disabled={isBuildingFullPreview || safeScenes.length === 0 || completedSceneCount !== safeScenes.length || projectGenerationInterrupted}\n                  variant="outline"\n                  className="text-violet-600 border-violet-200 hover:bg-violet-50"\n                >\n                  {isBuildingFullPreview ? (\n                    <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Building Preview...</>\n                  ) : (\n                    <><Eye className="h-4 w-4 mr-1.5" />Preview Full Video</>\n                  )}\n                </Button>\n                <Button\n                  onClick={() => setExportDialogOpen(true)}\n                  disabled={completedSceneCount === 0 || isExporting}\n''',
    "page preview button",
)

# Expand the scene editor dialog with reference character/photo selection and
# make completed-scene intent explicit.
replace_once(
    "src/app/page.tsx",
    '''          <DialogHeader>\n            <DialogTitle>Edit Scene Prompt</DialogTitle>\n            <DialogDescription>\n              {editPromptScene?.status === "failed"\n                ? "Rephrase the scene description (e.g. replace real celebrity or brand names with your own description), then regenerate."\n                : "Adjust the scene description used for generation."}\n            </DialogDescription>\n          </DialogHeader>\n          <div className="space-y-3">\n            <Textarea\n''',
    '''          <DialogHeader>\n            <DialogTitle>{editPromptScene?.videoUrl ? "Edit & Regenerate Scene" : "Edit Scene Prompt"}</DialogTitle>\n            <DialogDescription>\n              {editPromptScene?.videoUrl\n                ? "Correct this completed scene without rebuilding the project. Choose the exact character/photo the replacement must follow."\n                : editPromptScene?.status === "failed"\n                  ? "Rephrase the scene and optionally bind a character reference before retrying."\n                  : "Adjust the scene description and character reference used for generation."}\n            </DialogDescription>\n          </DialogHeader>\n          <div className="space-y-3">\n            {safeCharacters.some((character) => character.imageUrl) && (\n              <div className="space-y-2">\n                <Label>Character / face reference</Label>\n                <Select value={editReferenceCharacterId || "none"} onValueChange={(value) => setEditReferenceCharacterId(value === "none" ? "" : value)}>\n                  <SelectTrigger>\n                    <SelectValue placeholder="Choose the person/character this scene must use" />\n                  </SelectTrigger>\n                  <SelectContent>\n                    <SelectItem value="none">Keep current scene reference</SelectItem>\n                    {safeCharacters.filter((character) => character.imageUrl).map((character) => (\n                      <SelectItem key={character.id} value={character.id}>{character.name}</SelectItem>\n                    ))}\n                  </SelectContent>\n                </Select>\n                {(() => {\n                  const selected = safeCharacters.find((character) => character.id === editReferenceCharacterId);\n                  return selected?.imageUrl ? (\n                    <div className="flex items-center gap-3 rounded-lg border border-violet-100 bg-violet-50/50 p-2.5">\n                      <img src={selected.imageUrl} alt={selected.name} className="h-14 w-14 rounded-lg object-cover border bg-white" />\n                      <div>\n                        <p className="text-sm font-semibold">Use {selected.name}'s uploaded image</p>\n                        <p className="text-xs text-muted-foreground">Vidora sends this image as the direct reference for the replacement video.</p>\n                      </div>\n                    </div>\n                  ) : null;\n                })()}\n              </div>\n            )}\n            <Label>Correction / scene prompt</Label>\n            <Textarea\n''',
    "page edit dialog reference picker",
)
replace_once(
    "src/app/page.tsx",
    '''                Save &amp; Generate\n''',
    '''                {editPromptScene?.videoUrl ? "Save & Regenerate Scene" : "Save & Generate"}\n''',
    "page regenerate button label",
)

# Add full preview dialog immediately before the scene prompt editor dialog.
replace_once(
    "src/app/page.tsx",
    '''      {/* ═══════════════════════════════════════════════════════\n          SCENE PROMPT EDITOR\n''',
    '''      <Dialog open={fullPreviewOpen} onOpenChange={setFullPreviewOpen}>\n        <DialogContent className="sm:max-w-4xl">\n          <DialogHeader>\n            <DialogTitle className="flex items-center gap-2"><Play className="h-5 w-5 text-violet-600" />Full Video Preview</DialogTitle>\n            <DialogDescription>\n              Watch the complete current cut before export. If anything is wrong, close this preview, edit that scene, and regenerate only the replacement.\n            </DialogDescription>\n          </DialogHeader>\n          {fullPreviewUrl ? (\n            <div className="space-y-3">\n              <video src={fullPreviewUrl} controls autoPlay className="w-full max-h-[70vh] rounded-xl bg-black" preload="metadata" />\n              <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">\n                <span>{completedSceneCount} scenes in the current cut</span>\n                <span>Preview generation does not export or charge download tokens.</span>\n              </div>\n            </div>\n          ) : (\n            <div className="py-12 flex items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-violet-500" /></div>\n          )}\n          <DialogFooter>\n            <Button variant="outline" onClick={() => setFullPreviewOpen(false)}>Back to Editing</Button>\n            <Button onClick={() => { setFullPreviewOpen(false); setExportDialogOpen(true); }} disabled={!fullPreviewUrl}>Export This Cut</Button>\n          </DialogFooter>\n        </DialogContent>\n      </Dialog>\n\n      {/* ═══════════════════════════════════════════════════════\n          SCENE PROMPT EDITOR\n''',
    "page full preview dialog",
)

print("Applied post-generation editing and full preview patch")
