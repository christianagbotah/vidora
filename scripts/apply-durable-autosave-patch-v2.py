from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"Expected one anchor for {label}, found {count}")
    return text.replace(old, new, 1)


def replace_between(text: str, start: str, end: str, replacement: str, label: str) -> str:
    start_idx = text.find(start)
    if start_idx < 0:
        raise RuntimeError(f"Start marker missing for {label}")
    end_idx = text.find(end, start_idx + len(start))
    if end_idx < 0:
        raise RuntimeError(f"End marker missing for {label}")
    return text[:start_idx] + replacement + text[end_idx:]


# Prisma schema
path = Path("prisma/schema.prisma")
text = path.read_text()
text = replace_once(
    text,
    '  projectType     String     @default("custom")\n  videoModel      String?\n  finalVideoUrl   String?    @db.Text',
    '  projectType     String     @default("custom")\n  videoModel      String?\n  draftData       String?    @db.Text\n  lastAutosavedAt DateTime?\n  finalVideoUrl   String?    @db.Text',
    "VideoProject draft fields",
)
text = replace_once(
    text,
    '  @@index([userId])\n  @@index([shareSlug])',
    '  @@index([userId])\n  @@index([userId, lastAutosavedAt])\n  @@index([shareSlug])',
    "VideoProject autosave index",
)
path.write_text(text)


# Shared client type
path = Path("src/types/video.ts")
text = path.read_text()
text = replace_once(
    text,
    '  videoModel?: string | null;\n  finalVideoUrl?: string | null;',
    '  videoModel?: string | null;\n  /** True when the project has a resumable Create-page server draft. */\n  hasDraft?: boolean;\n  draftData?: string | null;\n  lastAutosavedAt?: string | null;\n  finalVideoUrl?: string | null;',
    "VideoProject draft client fields",
)
path.write_text(text)


# Project list: expose only a boolean marker, not potentially large draft JSON
path = Path("src/app/api/projects/route.ts")
text = path.read_text()
text = replace_once(
    text,
    '    return NextResponse.json({ success: true, projects });',
    '''    const projectsForClient = projects.map(({ draftData, ...project }) => ({
      ...project,
      hasDraft: Boolean(draftData),
    }));

    return NextResponse.json({ success: true, projects: projectsForClient });''',
    "project list draft marker",
)
path.write_text(text)


# Recovery precedence: exact remembered server draft, then synchronous local fallback,
# then latest server draft. This protects edits made inside the debounce window.
path = Path("src/hooks/use-create-draft-autosave.ts")
text = path.read_text()
text = replace_once(
    text,
    '''      let restored = false;
      if (remembered) restored = await loadDraft(remembered);
      if (!restored) restored = await loadDraft(null);
      if (!restored && !cancelled) restoreFallback();''',
    '''      let restored = false;
      if (remembered) restored = await loadDraft(remembered);
      // A synchronous fallback can be newer than the server when a refresh
      // happens inside the 700ms debounce window, so prefer it next.
      if (!restored && !cancelled) restored = restoreFallback();
      if (!restored) restored = await loadDraft(null);''',
    "autosave recovery precedence",
)
path.write_text(text)


# Main Create wizard integration
path = Path("src/app/page.tsx")
text = path.read_text()
text = replace_once(
    text,
    'import ScrollReveal from "@/components/ScrollReveal";',
    '''import ScrollReveal from "@/components/ScrollReveal";
import { useCreateDraftAutosave } from "@/hooks/use-create-draft-autosave";
import { CREATE_DRAFT_VERSION, type CreateDraftSnapshot } from "@/lib/create-draft-types";''',
    "autosave imports",
)

autosave_block = '''  /* ── Durable Create-page autosave ──
     Once a signed-in user enters a title, the project row is created in the
     background and the entire wizard snapshot is debounced to PostgreSQL.
     Character base64 images are moved into generated-store by the server. */
  const createDraftSnapshot = useMemo<CreateDraftSnapshot>(() => ({
    version: CREATE_DRAFT_VERSION,
    inputMode,
    scriptText,
    textPrompt,
    enhancedText,
    selectedStyle,
    selectedAspect,
    selectedModel,
    selectedDuration,
    customDuration,
    isCustomDuration,
    projectType,
    createStep,
    parsedScenes,
    parsedCharacters,
    parsedCelebration,
    parsedDefaultMusic,
    preCharImages,
    previewStoryboard,
    previewImageUrl,
    previewImageError,
  }), [
    inputMode, scriptText, textPrompt, enhancedText, selectedStyle, selectedAspect,
    selectedModel, selectedDuration, customDuration, isCustomDuration, projectType,
    createStep, parsedScenes, parsedCharacters, parsedCelebration, parsedDefaultMusic,
    preCharImages, previewStoryboard, previewImageUrl, previewImageError,
  ]);

  const restoreCreateDraft = useCallback((title: string, draft: CreateDraftSnapshot) => {
    setProjectTitle(title);
    setInputMode(draft.inputMode);
    setScriptText(draft.scriptText || "");
    setTextPrompt(draft.textPrompt || "");
    setEnhancedText(draft.enhancedText || "");
    setSelectedStyle(draft.selectedStyle || "cinematic");
    setSelectedAspect(draft.selectedAspect || "16:9");
    setSelectedModel(draft.selectedModel || DEFAULT_VIDEO_MODEL_ID);
    setSelectedDuration(draft.selectedDuration || 60);
    setCustomDuration(draft.customDuration || "");
    setIsCustomDuration(Boolean(draft.isCustomDuration));
    setProjectType(draft.projectType || "custom");
    setCreateStep(Math.max(0, Math.min(2, draft.createStep || 0)));
    setParsedScenes(Array.isArray(draft.parsedScenes) ? draft.parsedScenes : []);
    setParsedCharacters(Array.isArray(draft.parsedCharacters) ? draft.parsedCharacters : []);
    setParsedCelebration(draft.parsedCelebration || null);
    setParsedDefaultMusic(draft.parsedDefaultMusic || null);
    setPreCharImages(draft.preCharImages || {});
    setPreviewStoryboard(draft.previewStoryboard || null);
    setPreviewImageUrl(draft.previewImageUrl || null);
    setPreviewImageError(draft.previewImageError || null);
    setPreviewModalOpen(false);
  }, []);

  const acceptPersistedDraftImages = useCallback((images: Record<string, string>) => {
    setPreCharImages((previous) => {
      let changed = false;
      const next = { ...previous };
      for (const [name, url] of Object.entries(images)) {
        // Do not overwrite a newer local portrait with an older autosave response.
        if (!previous[name] || previous[name].startsWith("data:image/")) {
          if (previous[name] !== url) changed = true;
          next[name] = url;
        }
      }
      return changed ? next : previous;
    });
  }, []);

  const {
    autosaveStatus,
    ensureDraftSaved,
    resumeDraftProject,
    clearDraftReference,
  } = useCreateDraftAutosave({
    enabled: authStatus === "authenticated" && currentView === "create",
    title: projectTitle,
    snapshot: createDraftSnapshot,
    onRestore: restoreCreateDraft,
    onPersistedImages: acceptPersistedDraftImages,
  });

'''
text = replace_once(
    text,
    '  const mediaRecorderRef = useRef<MediaRecorder | null>(null);',
    autosave_block + '  const mediaRecorderRef = useRef<MediaRecorder | null>(null);',
    "autosave hook placement",
)

text = replace_once(
    text,
    '''  const openProject = (p: VideoProject) => {
    setCurrentProject(p);
    if (p.characters) setCharacters(p.characters);
    setCurrentView("studio");
  };''',
    '''  const openProject = async (p: VideoProject) => {
    if ((p.hasDraft || p.draftData) && p.scenes.length === 0) {
      setCurrentProject(null);
      const restored = await resumeDraftProject(p.id);
      if (restored) {
        setCurrentView("create");
        toast({
          title: "Draft restored",
          description: "Your script, characters and storyboard are back.",
        });
        return;
      }
    }
    setCurrentProject(p);
    if (p.characters) setCharacters(p.characters);
    setCurrentView("studio");
  };''',
    "openProject draft recovery",
)

new_create_handler = '''  const handleCreateAndGenerate = async () => {
    const text = inputMode === "script" ? scriptText : textPrompt;
    if (!projectTitle.trim()) {
      toast({
        title: "Give your project a title first",
        description: "The title starts background autosave and recovery.",
        variant: "destructive",
      });
      return;
    }
    if (!text.trim() && parsedScenes.length === 0) {
      toast({ title: "Please provide content", variant: "destructive" });
      return;
    }
    if (authStatus !== "authenticated") {
      setAuthMode("login");
      setAuthDialogOpen(true);
      return;
    }

    setIsCreating(true);
    try {
      // Flush the latest keystrokes/character portraits before materializing.
      const saved = await ensureDraftSaved();
      if (!saved?.projectId) {
        toast({
          title: "Could not save project draft",
          description: "Your local recovery copy is still preserved. Check your connection and try again.",
          variant: "destructive",
        });
        return;
      }

      // Atomically convert the autosaved wizard snapshot into Character +
      // VideoScene rows on the SAME project. No duplicate project is created.
      const finalizeRes = await fetch(
        "/api/projects/" + saved.projectId + "/finalize-draft",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        },
      );
      const finalizeData = await finalizeRes.json();
      if (!finalizeRes.ok || !finalizeData.success || !finalizeData.project) {
        toast({
          title: "Could not prepare project",
          description: finalizeData.error || "The saved draft is safe. Please try again.",
          variant: "destructive",
        });
        return;
      }

      const project = finalizeData.project as VideoProject;

      // Enter studio with the generation lock already engaged.
      autoGenFiredRef.current.add(project.id);
      seenGeneratingRef.current = false;
      allTerminalSinceRef.current = null;
      setCurrentProject(project);
      if (project.characters) setCharacters(project.characters);
      setCurrentView("studio");
      setGenerationStartedAt(Date.now());
      setGenerationPhase("starting");
      clearDraftReference();
      setCreateStep(0);
      setParsedScenes([]);
      setParsedCharacters([]);
      setParsedCelebration(null);
      setParsedDefaultMusic(null);
      setScriptText("");
      setTextPrompt("");
      setEnhancedText("");
      setProjectTitle("");
      setPreCharImages({});
      setPreviewStoryboard(null);
      setPreviewImageUrl(null);
      setPreviewImageError(null);
      void fetchProjects();
      toast({ title: "Project created!", description: "Your draft was saved. Generating videos..." });

      try {
        const genRes = await fetch("/api/generate-video", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: project.id }),
        });
        const genData = await genRes.json();
        if (genData.success) {
          setGenerationPhase(genData.alreadyDone ? "completed" : "generating");
          if (!genData.alreadyDone) setTimeout(refreshProject, 3000);
        } else {
          setGenerationPhase("idle");
          toast({
            title: "Video generation could not start",
            description: getApiError(genData),
            variant: "destructive",
          });
        }
      } catch {
        setGenerationPhase("idle");
        toast({
          title: "Video generation could not start",
          description: "Network error — the project is saved; retry from the studio.",
          variant: "destructive",
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("Error finalizing project draft:", msg);
      toast({
        title: "Error preparing project",
        description: "The background draft is still saved. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsCreating(false);
    }
  };

'''
text = replace_between(
    text,
    '  const handleCreateAndGenerate = async () => {',
    '  /* ──────────────────────────────────────────────────────────────\n     FREE PREVIEW HANDLERS',
    new_create_handler,
    "create and generate handler",
)

text = replace_once(
    text,
    '''                          <Label className="text-sm font-medium">Project Title</Label>
                          <Input placeholder="My Cinematic Video" value={projectTitle} onChange={(e) => setProjectTitle(e.target.value)} className="h-10" />''',
    '''                          <div className="flex items-center justify-between gap-3">
                            <Label className="text-sm font-medium">Project Title</Label>
                            {projectTitle.trim() && authStatus === "authenticated" && (
                              <span className={`text-[11px] font-medium flex items-center gap-1 ${autosaveStatus === "error" ? "text-amber-600" : autosaveStatus === "saved" ? "text-emerald-600" : "text-muted-foreground"}`}>
                                {autosaveStatus === "saving" ? <><Loader2 className="h-3 w-3 animate-spin" />Saving…</>
                                  : autosaveStatus === "saved" ? <><CheckCircle className="h-3 w-3" />Saved</>
                                  : autosaveStatus === "error" ? <><AlertCircle className="h-3 w-3" />Save retry pending</>
                                  : <>Autosave ready</>}
                              </span>
                            )}
                          </div>
                          <Input placeholder="My Cinematic Video" value={projectTitle} onChange={(e) => setProjectTitle(e.target.value)} className="h-10" />''',
    "project title autosave indicator",
)
path.write_text(text)

print("Durable create autosave integration patch applied successfully.")
