from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str):
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected 1 match, found {count}")
    p.write_text(text.replace(old, new, 1))

# Keep finalization type-safe while selecting the one direct pictured subject.
replace_once(
    "src/app/api/projects/[id]/finalize-draft/route.ts",
    '''        const linkedWithImages = linkedIds\n          .map((characterId) => charById.get(characterId))\n          .filter((character): character is NonNullable<typeof character> => Boolean(character?.imageUrl));\n        const directReference = linkedWithImages.length === 1 ? linkedWithImages[0].imageUrl : null;\n''',
    '''        const linkedWithImages = linkedIds\n          .map((characterId) => charById.get(characterId))\n          .filter((character) => Boolean(character?.imageUrl));\n        const directReference = linkedWithImages.length === 1\n          ? linkedWithImages[0]?.imageUrl || null\n          : null;\n''',
    "finalize image filter",
)

# Prevent the studio pending-scene auto-generator from racing the explicit
# one-scene replacement submission after the revision endpoint returns.
replace_once(
    "src/app/page.tsx",
    '''        setEditPromptScene(null);\n        setFullPreviewUrl(null);\n        await refreshProject();\n        toast({\n''',
    '''        setEditPromptScene(null);\n        setFullPreviewUrl(null);\n        autoGenFiredRef.current.add(currentProject.id);\n        await refreshProject();\n        toast({\n''',
    "replacement auto-generation race guard",
)

# Preview_<projectId>.mp4 is deliberately not written to finalVideoUrl, so the
# generated-media route needs a narrowly scoped owner/admin authorization path.
replace_once(
    "src/app/generated/[...path]/route.ts",
    '''  if (rel.startsWith("users/")) {\n    const ownerId = rel.split("/")[1] || "";\n    const auth = await requireAuth();\n    if (!auth.ok) return { allowed: false, publicCache: false };\n    return {\n      allowed: auth.session.userId === ownerId || auth.session.role === "admin",\n      publicCache: false,\n    };\n  }\n\n  const mediaUrl = `/generated/${rel}`;\n''',
    '''  if (rel.startsWith("users/")) {\n    const ownerId = rel.split("/")[1] || "";\n    const auth = await requireAuth();\n    if (!auth.ok) return { allowed: false, publicCache: false };\n    return {\n      allowed: auth.session.userId === ownerId || auth.session.role === "admin",\n      publicCache: false,\n    };\n  }\n\n  // Review-cut files are private and intentionally are not stored in\n  // VideoProject.finalVideoUrl. Their filename contains only the project id;\n  // access is still resolved through the normal project authorization layer.\n  const reviewCut = /^preview_([A-Za-z0-9_-]+)\\.mp4$/.exec(rel);\n  if (reviewCut?.[1]) {\n    const access = await requireProjectAccess(reviewCut[1], false);\n    return { allowed: access.ok, publicCache: false };\n  }\n\n  const mediaUrl = `/generated/${rel}`;\n''',
    "preview generated-media authorization",
)
replace_once(
    "src/app/generated/[...path]/route.ts",
    '''                { imageUrl: mediaUrl },\n                { videoUrl: mediaUrl },\n                { referenceImageUrl: mediaUrl },\n''',
    '''                { imageUrl: mediaUrl },\n                { videoUrl: mediaUrl },\n                { previousVideoUrl: mediaUrl },\n                { referenceImageUrl: mediaUrl },\n''',
    "previous clip media authorization",
)

print("Applied post-generation review hardening")
