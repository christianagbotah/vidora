from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str):
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected 1 match, found {count}")
    p.write_text(text.replace(old, new, 1))

# Prefer the project's intended visual subject when a scene links multiple
# characters. A direct scene.referenceImageUrl still wins over everything.
replace_once(
    "scripts/generation-worker.ts",
    '''      if (Array.isArray(ids)) {\n        const firstId = ids.find((id): id is string => typeof id === "string");\n        if (firstId) {\n          const character = await db.character.findUnique({ where: { id: firstId } });\n          if (character?.imageUrl && !character.imageUrl.startsWith("data:")) {\n            referenceImage = character.imageUrl;\n          }\n        }\n      }\n''',
    '''      if (Array.isArray(ids)) {\n        const linkedIds = ids.filter((id): id is string => typeof id === "string");\n        if (linkedIds.length > 0) {\n          const linkedCharacters = await db.character.findMany({\n            where: { id: { in: linkedIds }, projectId: scene.id ? undefined : undefined },\n            select: { id: true, role: true, imageUrl: true },\n          });\n          const byId = new Map(linkedCharacters.map((character) => [character.id, character]));\n          const ordered = linkedIds\n            .map((id) => byId.get(id))\n            .filter((character) => Boolean(character?.imageUrl))\n            .sort((a, b) => {\n              const priority = (role?: string | null) => /protagonist|primary|main|subject/i.test(role || "") ? 1 : 0;\n              return priority(b?.role) - priority(a?.role);\n            });\n          const character = ordered[0];\n          if (character?.imageUrl && !character.imageUrl.startsWith("data:")) {\n            referenceImage = character.imageUrl;\n          }\n        }\n      }\n''',
    "worker linked reference priority",
)

# The worker query above only needs linked IDs; remove accidental placeholder
# project filter from the generated replacement and retain a simple IN query.
replace_once(
    "scripts/generation-worker.ts",
    '            where: { id: { in: linkedIds }, projectId: scene.id ? undefined : undefined },\n',
    '            where: { id: { in: linkedIds } },\n',
    "worker linked character query cleanup",
)

# Single-scene route only needs to know whether a pictured linked character
# exists for model/cost selection. Prefer a protagonist when several do.
replace_once(
    "src/app/api/generate-video-scene/route.ts",
    '''        const charIds: string[] = JSON.parse(scene.characterIds);\n        const firstChar = project.characters.find((c) => charIds.includes(c.id));\n        if (firstChar?.imageUrl && !firstChar.imageUrl.startsWith("data:")) {\n          referenceImage = firstChar.imageUrl;\n        }\n''',
    '''        const charIds: string[] = JSON.parse(scene.characterIds);\n        const pictured = project.characters\n          .filter((character) => charIds.includes(character.id) && character.imageUrl && !character.imageUrl.startsWith("data:"))\n          .sort((a, b) => {\n            const priority = (role?: string | null) => /protagonist|primary|main|subject/i.test(role || "") ? 1 : 0;\n            return priority(b.role) - priority(a.role);\n          });\n        if (pictured[0]?.imageUrl) referenceImage = pictured[0].imageUrl;\n''',
    "single scene reference priority",
)

# When multiple linked characters have pictures, prefer the protagonist as the
# direct reference. This makes the initial draft generation deterministic for
# birthday/person-centric projects instead of depending on parser ordering.
replace_once(
    "src/app/api/projects/[id]/finalize-draft/route.ts",
    '''        const directReference = linkedWithImages.length === 1\n          ? linkedWithImages[0]?.imageUrl || null\n          : null;\n''',
    '''        const primaryReference = linkedWithImages.find(\n          (character) => /protagonist|primary|main|subject/i.test(character?.role || ""),\n        );\n        const directReference = primaryReference?.imageUrl\n          || (linkedWithImages.length === 1 ? linkedWithImages[0]?.imageUrl || null : null);\n''',
    "draft protagonist direct reference",
)

# Do not force the lone pictured subject into a title/end card that should be
# text-only. All other unlinked scenes can inherit the one project subject.
replace_once(
    "src/app/api/projects/[id]/finalize-draft/route.ts",
    '''        if (linkedIds.length === 0 && picturedSubjects.length === 1) {\n          linkedIds = [picturedSubjects[0].id];\n        }\n''',
    '''        const titleOnlyScene = /final screen|title card|end card|closing screen|end screen/i.test(\n          `${scene.title || ""} ${scene.prompt || ""}`,\n        );\n        if (linkedIds.length === 0 && picturedSubjects.length === 1 && !titleOnlyScene) {\n          linkedIds = [picturedSubjects[0].id];\n        }\n''',
    "draft subject fallback title-card guard",
)

# Any timeline-structure change invalidates the locally cached review cut.
replace_once(
    "src/app/page.tsx",
    '''      if (data.success) {\n        setNewScenePrompt("");\n        refreshProject();\n        toast({ title: "Scene added" });\n''',
    '''      if (data.success) {\n        setNewScenePrompt("");\n        setFullPreviewUrl(null);\n        refreshProject();\n        toast({ title: "Scene added" });\n''',
    "add scene invalidates preview",
)
replace_once(
    "src/app/page.tsx",
    '''        await fetch(`/api/projects/${currentProject.id}/scenes/${id}`, { method: "DELETE" });\n        refreshProject();\n        toast({ title: "Scene removed" });\n''',
    '''        await fetch(`/api/projects/${currentProject.id}/scenes/${id}`, { method: "DELETE" });\n        setFullPreviewUrl(null);\n        refreshProject();\n        toast({ title: "Scene removed" });\n''',
    "delete scene invalidates preview",
)
replace_once(
    "src/app/page.tsx",
    '''      await fetch(`/api/projects/${currentProject.id}/scenes/reorder`, {\n        method: "POST",\n        headers: { "Content-Type": "application/json" },\n        body: JSON.stringify({ sceneIds }),\n      });\n      refreshProject();\n''',
    '''      await fetch(`/api/projects/${currentProject.id}/scenes/reorder`, {\n        method: "POST",\n        headers: { "Content-Type": "application/json" },\n        body: JSON.stringify({ sceneIds }),\n      });\n      setFullPreviewUrl(null);\n      refreshProject();\n''',
    "reorder invalidates preview",
)

# Force a review cut before export after any reload/edit/timeline change.
replace_once(
    "src/app/page.tsx",
    '''                <Button\n                  onClick={() => setExportDialogOpen(true)}\n                  disabled={completedSceneCount === 0 || isExporting}\n                  variant="outline"\n                  className="text-emerald-600 border-emerald-200 hover:bg-emerald-50"\n                >\n                  <Download className="h-4 w-4 mr-1.5" />Export Video\n                </Button>\n''',
    '''                <Button\n                  onClick={() => fullPreviewUrl ? setExportDialogOpen(true) : handleBuildFullPreview()}\n                  disabled={\n                    isExporting || isBuildingFullPreview || projectGenerationInterrupted ||\n                    safeScenes.length === 0 || completedSceneCount !== safeScenes.length\n                  }\n                  variant="outline"\n                  className="text-emerald-600 border-emerald-200 hover:bg-emerald-50"\n                >\n                  {isBuildingFullPreview ? (\n                    <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Building Preview...</>\n                  ) : fullPreviewUrl ? (\n                    <><Download className="h-4 w-4 mr-1.5" />Export Video</>\n                  ) : (\n                    <><Eye className="h-4 w-4 mr-1.5" />Review &amp; Export</>\n                  )}\n                </Button>\n''',
    "preview before export gate",
)

# Be explicit about the cost of a replacement vs a save-only edit.
replace_once(
    "src/app/page.tsx",
    '''            {editPromptScene?.errorMessage && (\n              <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200">\n''',
    '''            {editPromptScene?.videoUrl && (\n              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">\n                <strong>Billing:</strong> Save Only changes the instructions/reference without generating or charging.\n                Regenerate Scene creates one replacement clip and uses the normal Vidora generation-token charge for that one scene.\n              </div>\n            )}\n            {editPromptScene?.errorMessage && (\n              <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200">\n''',
    "scene revision billing note",
)

print("Applied final post-generation editor review")
