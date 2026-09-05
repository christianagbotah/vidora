import fs from "node:fs";

function replaceOnce(text, from, to, label) {
  const first = text.indexOf(from);
  if (first === -1) throw new Error(`Patch anchor not found: ${label}`);
  if (text.indexOf(from, first + from.length) !== -1) {
    throw new Error(`Patch anchor is not unique: ${label}`);
  }
  return text.slice(0, first) + to + text.slice(first + from.length);
}

function replaceBetween(text, startMarker, endMarker, replacement, label) {
  const start = text.indexOf(startMarker);
  if (start === -1) throw new Error(`Start marker not found: ${label}`);
  const end = text.indexOf(endMarker, start + startMarker.length);
  if (end === -1) throw new Error(`End marker not found: ${label}`);
  return text.slice(0, start) + replacement + text.slice(end);
}

// ── Prisma schema ────────────────────────────────────────────────
{
  const path = "prisma/schema.prisma";
  let text = fs.readFileSync(path, "utf8");
  text = replaceOnce(
    text,
    '  projectType     String     @default("custom")\n  videoModel      String?\n  finalVideoUrl   String?    @db.Text',
    '  projectType     String     @default("custom")\n  videoModel      String?\n  draftData       String?    @db.Text\n  lastAutosavedAt DateTime?\n  finalVideoUrl   String?    @db.Text',
    "VideoProject draft fields",
  );
  text = replaceOnce(
    text,
    '  @@index([userId])\n  @@index([shareSlug])',
    '  @@index([userId])\n  @@index([userId, lastAutosavedAt])\n  @@index([shareSlug])',
    "VideoProject autosave index",
  );
  fs.writeFileSync(path, text);
}

// ── Shared project type ─────────────────────────────────────────
{
  const path = "src/types/video.ts";
  let text = fs.readFileSync(path, "utf8");
  text = replaceOnce(
    text,
    '  videoModel?: string | null;\n  finalVideoUrl?: string | null;',
    '  videoModel?: string | null;\n  /** True when the project has a resumable Create-page server draft. */\n  hasDraft?: boolean;\n  draftData?: string | null;\n  lastAutosavedAt?: string | null;\n  finalVideoUrl?: string | null;',
    "VideoProject draft client fields",
  );
  fs.writeFileSync(path, text);
}

// ── Project list: expose a boolean, not the potentially large JSON blob ──
{
  const path = "src/app/api/projects/route.ts";
  let text = fs.readFileSync(path, "utf8");
  text = replaceOnce(
    text,
    '    return NextResponse.json({ success: true, projects });',
    '    const projectsForClient = projects.map(({ draftData, ...project }) => ({\n      ...project,\n      hasDraft: Boolean(draftData),\n    }));\n\n    return NextResponse.json({ success: true, projects: projectsForClient });',
    "project list draft marker",
  );
  fs.writeFileSync(path, text);
}

// ── Autosave hook recovery order: exact browser draft before older server draft ──
{
  const path = "src/hooks/use-create-draft-autosave.ts";
  let text = fs.readFileSync(path, "utf8");
  text = replaceOnce(
    text,
    '      let restored = false;\n      if (remembered) restored = await loadDraft(remembered);\n      if (!restored) restored = await loadDraft(null);\n      if (!restored && !cancelled) restoreFallback();',
    '      let restored = false;\n      if (remembered) restored = await loadDraft(remembered);\n      // A synchronous fallback can be newer than the server when a refresh\n      // happens inside the 700ms debounce window, so prefer it next.\n      if (!restored && !cancelled) restored = restoreFallback();\n      if (!restored) restored = await loadDraft(null);',
    "autosave recovery precedence",
  );
  fs.writeFileSync(path, text);
}

// ── Main Create wizard integration ──────────────────────────────
{
  const path = "src/app/page.tsx";
  let text = fs.readFileSync(path, "utf8");

  text = replaceOnce(
    text,
    'import ScrollReveal from "@/components/ScrollReveal";',
    'import ScrollReveal from "@/components/ScrollReveal";\nimport { useCreateDraftAutosave } from "@/hooks/use-create-draft-autosave";\nimport { CREATE_DRAFT_VERSION, type CreateDraftSnapshot } from "@/lib/create-draft-types";',
    "autosave imports",
  );

  const autosaveBlock = `  /* ── Durable Create-page autosave ──\n     Once a signed-in user enters a title, the project row is created in the\n     background and the entire wizard snapshot is debounced to PostgreSQL.\n     Character base64 images are moved into generated-store by the server. */\n  const createDraftSnapshot = useMemo<CreateDraftSnapshot>(() => ({\n    version: CREATE_DRAFT_VERSION,\n    inputMode,\n    scriptText,\n    textPrompt,\n    enhancedText,\n    selectedStyle,\n    selectedAspect,\n    selectedModel,\n    selectedDuration,\n    customDuration,\n    isCustomDuration,\n    projectType,\n    createStep,\n    parsedScenes,\n    parsedCharacters,\n    parsedCelebration,\n    parsedDefaultMusic,\n    preCharImages,\n    previewStoryboard,\n    previewImageUrl,\n    previewImageError,\n  }), [\n    inputMode, scriptText, textPrompt, enhancedText, selectedStyle, selectedAspect,\n    selectedModel, selectedDuration, customDuration, isCustomDuration, projectType,\n    createStep, parsedScenes, parsedCharacters, parsedCelebration, parsedDefaultMusic,\n    preCharImages, previewStoryboard, previewImageUrl, previewImageError,\n  ]);\n\n  const restoreCreateDraft = useCallback((title: string, draft: CreateDraftSnapshot) => {\n    setProjectTitle(title);\n    setInputMode(draft.inputMode);\n    setScriptText(draft.scriptText || \"\");\n    setTextPrompt(draft.textPrompt || \"\");\n    setEnhancedText(draft.enhancedText || \"\");\n    setSelectedStyle(draft.selectedStyle || \"cinematic\");\n    setSelectedAspect(draft.selectedAspect || \"16:9\");\n    setSelectedModel(draft.selectedModel || DEFAULT_VIDEO_MODEL_ID);\n    setSelectedDuration(draft.selectedDuration || 60);\n    setCustomDuration(draft.customDuration || \"\");\n    setIsCustomDuration(Boolean(draft.isCustomDuration));\n    setProjectType(draft.projectType || \"custom\");\n    setCreateStep(Math.max(0, Math.min(2, draft.createStep || 0)));\n    setParsedScenes(Array.isArray(draft.parsedScenes) ? draft.parsedScenes : []);\n    setParsedCharacters(Array.isArray(draft.parsedCharacters) ? draft.parsedCharacters : []);\n    setParsedCelebration(draft.parsedCelebration || null);\n    setParsedDefaultMusic(draft.parsedDefaultMusic || null);\n    setPreCharImages(draft.preCharImages || {});\n    setPreviewStoryboard(draft.previewStoryboard || null);\n    setPreviewImageUrl(draft.previewImageUrl || null);\n    setPreviewImageError(draft.previewImageError || null);\n    setPreviewModalOpen(false);\n  }, []);\n\n  const acceptPersistedDraftImages = useCallback((images: Record<string, string>) => {\n    setPreCharImages((previous) => {\n      let changed = false;\n      const next = { ...previous };\n      for (const [name, url] of Object.entries(images)) {\n        // Do not overwrite a newer local portrait with an older autosave response.\n        if (!previous[name] || previous[name].startsWith(\"data:image/\")) {\n          if (previous[name] !== url) changed = true;\n          next[name] = url;\n        }\n      }\n      return changed ? next : previous;\n    });\n  }, []);\n\n  const {\n    autosaveStatus,\n    ensureDraftSaved,\n    resumeDraftProject,\n    clearDraftReference,\n  } = useCreateDraftAutosave({\n    enabled: authStatus === \"authenticated\" && currentView === \"create\",\n    title: projectTitle,\n    snapshot: createDraftSnapshot,\n    onRestore: restoreCreateDraft,\n    onPersistedImages: acceptPersistedDraftImages,\n  });\n\n`;

  text = replaceOnce(
    text,
    '  const mediaRecorderRef = useRef<MediaRecorder | null>(null);',
    autosaveBlock + '  const mediaRecorderRef = useRef<MediaRecorder | null>(null);',
    "autosave hook placement",
  );

  text = replaceOnce(
    text,
    `  const openProject = (p: VideoProject) => {\n    setCurrentProject(p);\n    if (p.characters) setCharacters(p.characters);\n    setCurrentView(\"studio\");\n  };`,
    `  const openProject = async (p: VideoProject) => {\n    if ((p.hasDraft || p.draftData) && p.scenes.length === 0) {\n      setCurrentProject(null);\n      const restored = await resumeDraftProject(p.id);\n      if (restored) {\n        setCurrentView(\"create\");\n        toast({ title: \"Draft restored\", description: \"Your script, characters and storyboard are back.\" });\n        return;\n      }\n    }\n    setCurrentProject(p);\n    if (p.characters) setCharacters(p.characters);\n    setCurrentView(\"studio\");\n  };`,
    "openProject draft recovery",
  );

  const newCreateHandler = `  const handleCreateAndGenerate = async () => {\n    const text = inputMode === \"script\" ? scriptText : textPrompt;\n    if (!projectTitle.trim()) {\n      toast({ title: \"Give your project a title first\", description: \"The title starts background autosave and recovery.\", variant: \"destructive\" });\n      return;\n    }\n    if (!text.trim() && parsedScenes.length === 0) {\n      toast({ title: \"Please provide content\", variant: \"destructive\" });\n      return;\n    }\n    if (authStatus !== \"authenticated\") {\n      setAuthMode(\"login\");\n      setAuthDialogOpen(true);\n      return;\n    }\n\n    setIsCreating(true);\n    try {\n      // Flush the latest keystrokes/character portraits before materializing.\n      const saved = await ensureDraftSaved();\n      if (!saved?.projectId) {\n        toast({\n          title: \"Could not save project draft\",\n          description: \"Your local recovery copy is still preserved. Check your connection and try again.\",\n          variant: \"destructive\",\n        });\n        return;\n      }\n\n      // Atomically convert the autosaved wizard snapshot into Character +\n      // VideoScene rows on the SAME project. No duplicate project is created.\n      const finalizeRes = await fetch(\\`/api/projects/\\${saved.projectId}/finalize-draft\\`, {\n        method: \"POST\",\n        headers: { \"Content-Type\": \"application/json\" },\n      });\n      const finalizeData = await finalizeRes.json();\n      if (!finalizeRes.ok || !finalizeData.success || !finalizeData.project) {\n        toast({\n          title: \"Could not prepare project\",\n          description: finalizeData.error || \"The saved draft is safe. Please try again.\",\n          variant: \"destructive\",\n        });\n        return;\n      }\n\n      const project = finalizeData.project as VideoProject;\n\n      // Enter the studio with generation lock already engaged.\n      autoGenFiredRef.current.add(project.id);\n      seenGeneratingRef.current = false;\n      allTerminalSinceRef.current = null;\n      setCurrentProject(project);\n      if (project.characters) setCharacters(project.characters);\n      setCurrentView(\"studio\");\n      setGenerationStartedAt(Date.now());\n      setGenerationPhase(\"starting\");\n      clearDraftReference();\n      setCreateStep(0);\n      setParsedScenes([]);\n      setParsedCharacters([]);\n      setParsedCelebration(null);\n      setParsedDefaultMusic(null);\n      setScriptText(\"\");\n      setTextPrompt(\"\");\n      setEnhancedText(\"\");\n      setProjectTitle(\"\");\n      setPreCharImages({});\n      setPreviewStoryboard(null);\n      setPreviewImageUrl(null);\n      setPreviewImageError(null);\n      void fetchProjects();\n      toast({ title: \"Project created!\", description: \"Your draft was saved. Generating videos...\" });\n\n      // Trigger generation. The API returns quickly and the durable worker\n      // continues even if the browser later refreshes.\n      try {\n        const genRes = await fetch(\"/api/generate-video\", {\n          method: \"POST\",\n          headers: { \"Content-Type\": \"application/json\" },\n          body: JSON.stringify({ projectId: project.id }),\n        });\n        const genData = await genRes.json();\n        if (genData.success) {\n          setGenerationPhase(genData.alreadyDone ? \"completed\" : \"generating\");\n          if (!genData.alreadyDone) setTimeout(refreshProject, 3000);\n        } else {\n          setGenerationPhase(\"idle\");\n          toast({ title: \"Video generation could not start\", description: getApiError(genData), variant: \"destructive\" });\n        }\n      } catch {\n        setGenerationPhase(\"idle\");\n        toast({ title: \"Video generation could not start\", description: \"Network error — the project is saved; retry from the studio.\", variant: \"destructive\" });\n      }\n    } catch (err) {\n      const msg = err instanceof Error ? err.message : String(err);\n      console.error(\"Error finalizing project draft:\", msg);\n      toast({\n        title: \"Error preparing project\",\n        description: \"The background draft is still saved. Please try again.\",\n        variant: \"destructive\",\n      });\n    } finally {\n      setIsCreating(false);\n    }\n  };\n\n`;

  text = replaceBetween(
    text,
    '  const handleCreateAndGenerate = async () => {',
    '  /* ──────────────────────────────────────────────────────────────\n     FREE PREVIEW HANDLERS',
    newCreateHandler,
    "create and generate handler",
  );

  text = replaceOnce(
    text,
    '                          <Label className="text-sm font-medium">Project Title</Label>\n                          <Input placeholder="My Cinematic Video" value={projectTitle} onChange={(e) => setProjectTitle(e.target.value)} className="h-10" />',
    '                          <div className="flex items-center justify-between gap-3">\n                            <Label className="text-sm font-medium">Project Title</Label>\n                            {projectTitle.trim() && authStatus === "authenticated" && (\n                              <span className={`text-[11px] font-medium flex items-center gap-1 ${autosaveStatus === "error" ? "text-amber-600" : autosaveStatus === "saved" ? "text-emerald-600" : "text-muted-foreground"}`}>\n                                {autosaveStatus === "saving" ? <><Loader2 className="h-3 w-3 animate-spin" />Saving…</>\n                                  : autosaveStatus === "saved" ? <><CheckCircle className="h-3 w-3" />Saved</>\n                                  : autosaveStatus === "error" ? <><AlertCircle className="h-3 w-3" />Save retry pending</>\n                                  : <>Autosave ready</>}\n                              </span>\n                            )}\n                          </div>\n                          <Input placeholder="My Cinematic Video" value={projectTitle} onChange={(e) => setProjectTitle(e.target.value)} className="h-10" />',
    "project title autosave indicator",
  );

  fs.writeFileSync(path, text);
}

console.log("Durable create autosave integration patch applied successfully.");
