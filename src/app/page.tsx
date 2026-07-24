"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAppStore } from "@/store/useAppStore";
import { useToast } from "@/hooks/use-toast";
import type { VideoProject, ClassicScene, InputMode } from "@/types/video";
import {
  Film, Mic, MicOff, Upload, Sparkles, Play, Plus, Trash2,
  ChevronRight, Wand2, ArrowLeft, ImageIcon, LayoutGrid, Loader2,
  X, Download, Layers, Palette, Clapperboard,
  Copy, Eye, Volume2, Clock, Video, RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import DeviceSimulator from "@/components/DeviceSimulator";

// --- Data ---
const CLASSIC_SCENES: ClassicScene[] = [
  { id: "sunset", title: "Golden Sunset", description: "Dramatic ocean sunset with golden hour lighting", prompt: "Cinematic wide shot of a breathtaking ocean sunset, golden hour lighting casting warm amber rays across gentle waves, dramatic clouds painted in deep orange and magenta, film grain texture, professional cinematography, 4K quality", image: "/images/scene-sunset.png", category: "nature" },
  { id: "cyberpunk", title: "Neon City", description: "Futuristic cyberpunk metropolis with neon lights", prompt: "Futuristic cyberpunk city at night, neon signs reflecting on rain-soaked streets, holographic billboards, flying vehicles in the distance, cinematic wide shot, moody atmosphere, deep purple and electric cyan color palette, professional film look", image: "/images/scene-cyberpunk.png", category: "sci-fi" },
  { id: "fantasy", title: "Enchanted Forest", description: "Magical forest with bioluminescent trees", prompt: "Enchanted ancient forest with massive bioluminescent trees, magical glowing particles floating in the air, mystical fog weaving between trunks, ethereal teal and gold lighting, fairy tale atmosphere, cinematic depth of field", image: "/images/scene-fantasy.png", category: "fantasy" },
  { id: "mountain", title: "Epic Peaks", description: "Aerial mountain landscape above clouds at sunrise", prompt: "Dramatic aerial shot of snow-capped mountain peaks piercing through a sea of clouds at sunrise, golden sun rays breaking through the cloud layer, epic landscape photography, warm and cool contrast, cinematic wide angle composition", image: "/images/scene-mountain.png", category: "nature" },
  { id: "noir", title: "Film Noir Alley", description: "Moody black-and-white alley with dramatic shadows", prompt: "Classic film noir style alley at night, dramatic chiaroscuro lighting, rain-slicked cobblestones reflecting a single street lamp, silhouettes in fog, black and white with high contrast, vintage 1940s cinematic style, deep shadows", image: "", category: "classic" },
  { id: "space", title: "Cosmic Voyage", description: "Deep space with nebulas and distant galaxies", prompt: "Deep space vista with vibrant colorful nebula clouds in purple and teal, a massive spiral galaxy visible in the distance, scattered star field, cinematic composition with sense of scale and wonder, ultra high detail, 8K quality", image: "", category: "sci-fi" },
];

const STYLES = [
  { value: "cinematic", label: "Cinematic" }, { value: "anime", label: "Anime" },
  { value: "photorealistic", label: "Photorealistic" }, { value: "oil-painting", label: "Oil Painting" },
  { value: "watercolor", label: "Watercolor" }, { value: "noir", label: "Film Noir" },
  { value: "retro", label: "Retro/Vintage" }, { value: "3d-render", label: "3D Render" },
];

const ASPECTS = [
  { value: "16:9", label: "16:9 Landscape" }, { value: "9:16", label: "9:16 Portrait" },
  { value: "1:1", label: "1:1 Square" }, { value: "4:3", label: "4:3 Classic" },
  { value: "21:9", label: "21:9 Ultra Wide" },
];

const TRANSITIONS = [
  { value: "fade", label: "Fade" }, { value: "slide", label: "Slide" },
  { value: "zoom", label: "Zoom" }, { value: "dissolve", label: "Dissolve" },
];

const DURATIONS = [
  { value: 15, label: "15 seconds" },
  { value: 30, label: "30 seconds" },
  { value: 60, label: "1 minute" },
  { value: 120, label: "2 minutes" },
  { value: 180, label: "3 minutes" },
  { value: 300, label: "5 minutes" },
];

const fadeUp = {
  initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -10 }, transition: { duration: 0.3 },
};

// ─── Main Page ───────────────────────────────────────────
export default function HomePage() {
  const { currentView, projects, currentProject, isGenerating, isEnhancing, isRecording,
    setCurrentView, setProjects, setCurrentProject, setIsGenerating, setIsEnhancing, setIsRecording } = useAppStore();
  const { toast } = useToast();

  const [inputMode, setInputMode] = useState<InputMode>("text");
  const [textPrompt, setTextPrompt] = useState("");
  const [enhancedText, setEnhancedText] = useState("");
  const [selectedStyle, setSelectedStyle] = useState("cinematic");
  const [selectedAspect, setSelectedAspect] = useState("16:9");
  const [selectedDuration, setSelectedDuration] = useState(60);
  const [projectTitle, setProjectTitle] = useState("");
  const [newScenePrompt, setNewScenePrompt] = useState("");
  const [newSceneTransition, setNewSceneTransition] = useState("fade");
  const [sceneFilter, setSceneFilter] = useState("all");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [previewVideoUrl, setPreviewVideoUrl] = useState<string | null>(null);
  const [generatingScenes, setGeneratingScenes] = useState<Set<string>>(new Set());
  const [expandedSceneId, setExpandedSceneId] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isCreatingProject, setIsCreatingProject] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const autoGenTriggeredRef = useRef<Set<string>>(new Set());
  const projectPollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const prevSceneStatesRef = useRef<Map<string, string>>(new Map());

  // ── Auto-generate on studio load ──
  useEffect(() => {
    if (currentView !== "studio" || !currentProject?.scenes?.length || isGenerating) return;
    if (autoGenTriggeredRef.current.has(currentProject.id)) return;
    const hasPending = currentProject.scenes.some((s) => !s.videoUrl && s.status === "pending");
    if (hasPending) {
      autoGenTriggeredRef.current.add(currentProject.id);
      setTimeout(() => generateVideo(currentProject), 600);
    }
  }, [currentView, currentProject?.id]);

  // ── Fetch projects on mount ──
  useEffect(() => { fetchProjects(); }, []);

  // ── Cleanup poll timer on unmount ──
  useEffect(() => {
    return () => { if (projectPollTimerRef.current) clearInterval(projectPollTimerRef.current); };
  }, []);

  // ── Project-level polling: refresh every 15s when scenes are generating ──
  useEffect(() => {
    if (!currentProject?.scenes) return;
    const hasGenerating = currentProject.scenes.some((s) => s.status === "generating");
    if (hasGenerating) {
      if (projectPollTimerRef.current) clearInterval(projectPollTimerRef.current);
      projectPollTimerRef.current = setInterval(() => refreshProject(), 15000);
      setGeneratingScenes((prev) => {
        const next = new Set(prev);
        currentProject.scenes.forEach((s) => { if (s.status === "generating") next.add(s.id); });
        return next;
      });
      const t = setTimeout(() => refreshProject(), 5000);
      return () => { clearTimeout(t); if (projectPollTimerRef.current) clearInterval(projectPollTimerRef.current); };
    } else {
      if (projectPollTimerRef.current) { clearInterval(projectPollTimerRef.current); projectPollTimerRef.current = null; }
      setGeneratingScenes(new Set());
    }
  }, [currentProject?.id, currentProject?.scenes?.map((s) => s.status).join(",")]);

  // ── Detect scene status changes → toasts ──
  useEffect(() => {
    if (!currentProject?.scenes) return;
    for (const scene of currentProject.scenes) {
      const prev = prevSceneStatesRef.current.get(scene.id);
      if (prev === "generating" && scene.status === "completed" && scene.videoUrl) {
        toast({ title: "Video ready!", description: "Scene " + scene.sceneNumber + " generated." });
      } else if (prev === "generating" && scene.status === "failed") {
        toast({ title: "Scene " + scene.sceneNumber + " failed", description: "Try retrying.", variant: "destructive" });
      }
      prevSceneStatesRef.current.set(scene.id, scene.status);
    }
  }, [currentProject?.scenes]);

  // ── Data fetching ──
  const fetchProjects = async () => {
    try {
      const res = await fetch("/api/projects");
      if (!res.ok) return;
      const data = await res.json();
      if (data.success) setProjects(data.projects);
    } catch { /* ignore */ }
  };

  const refreshProject = async () => {
    if (!currentProject) return;
    try {
      const res = await fetch(`/api/projects/${currentProject.id}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setCurrentProject(data.project);
          setProjects((prev) => prev.map((p) => p.id === data.project.id ? data.project : p));
        }
      }
    } catch { /* ignore */ }
  };

  // ── Voice recording ──
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        setIsRecording(false); stream.getTracks().forEach((t) => t.stop());
        toast({ title: "Transcribing..." });
        const formData = new FormData(); formData.append("audio", blob, "recording.webm");
        try {
          const res = await fetch("/api/transcribe", { method: "POST", body: formData });
          const data = await res.json();
          if (data.success && data.transcription) { setTextPrompt(data.transcription); toast({ title: "Transcribed!" }); }
          else toast({ title: "Transcription failed", variant: "destructive" });
        } catch { toast({ title: "Transcription error", variant: "destructive" }); }
      };
      recorder.start(); mediaRecorderRef.current = recorder; setIsRecording(true);
    } catch { toast({ title: "Microphone denied", variant: "destructive" }); }
  };
  const stopRecording = () => { mediaRecorderRef.current?.stop(); };

  // ── Video upload ──
  const handleVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setVideoFile(file); setVideoPreview(URL.createObjectURL(file));
  };
  const analyzeUploadedVideo = async () => {
    if (!videoFile) return;
    toast({ title: "Analyzing video..." });
    const formData = new FormData(); formData.append("video", videoFile);
    try {
      const res = await fetch("/api/analyze-video", { method: "POST", body: formData });
      const data = await res.json();
      if (data.success) { setTextPrompt(data.suggestedPrompt || data.description); toast({ title: "Analyzed!" }); }
      else toast({ title: "Analysis failed", variant: "destructive" });
    } catch { toast({ title: "Analysis error", variant: "destructive" }); }
  };

  // ── Enhance prompt ──
  const enhancePrompt = async () => {
    if (!textPrompt.trim()) return;
    setIsEnhancing(true);
    try {
      const res = await fetch("/api/enhance-prompt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: textPrompt, style: selectedStyle }) });
      const data = await res.json();
      if (data.success) { setEnhancedText(data.enhancedPrompt); setTextPrompt(data.enhancedPrompt); toast({ title: "Prompt enhanced!" }); }
      else toast({ title: "Enhancement failed", variant: "destructive" });
    } catch { toast({ title: "Enhancement error", variant: "destructive" }); }
    finally { setIsEnhancing(false); }
  };

  // ── Create project (split-scenes flow) ──
  const createProject = async (promptOverride?: string, titleOverride?: string) => {
    const prompt = promptOverride || textPrompt;
    if (!prompt.trim()) { toast({ title: "Enter a prompt first", variant: "destructive" }); return; }
    setIsCreatingProject(true);
    try {
      // Step 1: Split prompt into scenes
      toast({ title: "Analyzing your prompt..." });
      const splitRes = await fetch("/api/split-scenes", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, targetDuration: selectedDuration }),
      });
      const splitData = await splitRes.json();
      if (!splitData.success) { toast({ title: "Failed to analyze prompt", variant: "destructive" }); return; }

      const sceneDescriptions = splitData.scenes || [prompt];

      // Step 2: Create project
      const projRes = await fetch("/api/projects", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: titleOverride || projectTitle || ("Video — " + new Date().toLocaleDateString()),
          style: selectedStyle, aspectRatio: selectedAspect, targetDuration: selectedDuration,
        }),
      });
      const projData = await projRes.json();
      if (!projData.success) { toast({ title: "Failed to create project", variant: "destructive" }); return; }
      const project = projData.project;

      // Step 3: Create scenes
      if (sceneDescriptions.length > 0) {
        await fetch(`/api/projects/${project.id}/scenes`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scenes: sceneDescriptions.map((s: string, i: number) => ({
              prompt: s, duration: 10, transition: "fade",
            })),
          }),
        });
      }

      // Refresh and go to studio
      const fullRes = await fetch(`/api/projects/${project.id}`);
      const fullData = await fullRes.json();
      if (fullData.success) {
        setCurrentProject(fullData.project);
        setProjects((prev) => [fullData.project, ...prev]);
        setCurrentView("studio");
        setCreateDialogOpen(false);
        toast({ title: "Project created with " + sceneDescriptions.length + " scenes!", description: "Video generation will start automatically." });
        // Clear form
        setTextPrompt(""); setEnhancedText(""); setProjectTitle("");
        setVideoFile(null); setVideoPreview(null);
      }
    } catch (err) {
      toast({ title: "Error creating project", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally { setIsCreatingProject(false); }
  };

  // ── Generate all videos for a project ──
  const generateVideo = async (projectOverride?: VideoProject) => {
    const proj = projectOverride || currentProject;
    if (!proj || !proj.scenes || proj.scenes.length === 0) {
      toast({ title: "No scenes to generate", variant: "destructive" }); return;
    }
    setIsGenerating(true);
    try {
      const res = await fetch("/api/generate-video", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: proj.id }),
      });
      if (!res.ok) { toast({ title: "Generation failed", description: "Server error (" + res.status + ")", variant: "destructive" }); return; }
      const data = await res.json();
      if (data.success) {
        setTimeout(() => refreshProject(), 2000);
        toast({ title: "Video generation started!", description: data.message });
      } else { toast({ title: "Generation failed", description: data.error || "Unknown error", variant: "destructive" }); }
    } catch (err) {
      toast({ title: "Generation failed", description: err instanceof Error ? err.message : "Network error", variant: "destructive" });
    } finally { setIsGenerating(false); }
  };

  // ── Retry a failed scene ──
  const retryScene = async (scene: { id: string; enhancedPrompt?: string | null; prompt: string }) => {
    if (!currentProject) return;
    try {
      await fetch(`/api/projects/${currentProject.id}/scenes/${scene.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "pending", taskId: null }),
      });
      toast({ title: "Retrying scene..." });
      generateSceneVideo(scene.id, scene.enhancedPrompt || scene.prompt);
    } catch { toast({ title: "Retry failed", variant: "destructive" }); }
  };

  // ── Generate single scene video ──
  const generateSceneVideo = async (sceneId: string, prompt: string) => {
    if (!currentProject) return;
    setGeneratingScenes((prev) => new Set(prev).add(sceneId));
    setCurrentProject({ ...currentProject, scenes: currentProject.scenes.map((s) => s.id === sceneId ? { ...s, status: "generating" } : s) });
    try {
      const res = await fetch("/api/generate-video-scene", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, sceneId, projectId: currentProject.id }),
      });
      if (!res.ok) { toast({ title: "Generation failed", description: "Server error", variant: "destructive" }); refreshProject(); return; }
      const data = await res.json();
      if (data.success) {
        if (data.videoUrl) { toast({ title: "Video generated!" }); setGeneratingScenes((prev) => { const n = new Set(prev); n.delete(sceneId); return n; }); }
        else { toast({ title: "Generating video...", description: "We will notify you when ready." }); }
        refreshProject();
      } else { toast({ title: "Failed", description: data.error, variant: "destructive" }); refreshProject(); }
    } catch {
      toast({ title: "Failed", variant: "destructive" }); refreshProject();
    } finally { setGeneratingScenes((prev) => { const n = new Set(prev); n.delete(sceneId); return n; }); }
  };

  // ── Export/concatenate full video ──
  const exportFullVideo = async () => {
    if (!currentProject?.scenes) return;
    const completedCount = currentProject.scenes.filter((s) => s.videoUrl).length;
    if (completedCount === 0) { toast({ title: "No videos ready", variant: "destructive" }); return; }
    setIsExporting(true);
    toast({ title: "Exporting full video...", description: "Concatenating " + completedCount + " scenes." });
    try {
      const res = await fetch("/api/concatenate-video", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: currentProject.id }),
      });
      const data = await res.json();
      if (data.success) {
        toast({ title: "Full video exported!", description: data.message });
        refreshProject();
      } else { toast({ title: "Export failed", description: data.error, variant: "destructive" }); }
    } catch { toast({ title: "Export error", variant: "destructive" }); }
    finally { setIsExporting(false); }
  };

  // ── Delete/add scenes ──
  const addScene = async () => {
    if (!currentProject || !newScenePrompt.trim()) return;
    try {
      await fetch(`/api/projects/${currentProject.id}/scenes`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: newScenePrompt, duration: 10, transition: newSceneTransition }),
      });
      setNewScenePrompt(""); refreshProject();
      toast({ title: "Scene added" });
    } catch { toast({ title: "Failed to add scene", variant: "destructive" }); }
  };

  const deleteScene = async (sceneId: string) => {
    if (!currentProject) return;
    try {
      await fetch(`/api/projects/${currentProject.id}/scenes/${sceneId}`, { method: "DELETE" });
      refreshProject(); toast({ title: "Scene removed" });
    } catch { toast({ title: "Failed", variant: "destructive" }); }
  };

  const deleteProject = async (id: string) => {
    try {
      await fetch(`/api/projects/${id}`, { method: "DELETE" });
      fetchProjects();
      if (currentProject?.id === id) { setCurrentProject(null); setCurrentView("home"); }
      toast({ title: "Project deleted" });
    } catch { toast({ title: "Failed", variant: "destructive" }); }
  };

  const openVideoPreview = (url: string) => setPreviewVideoUrl(url);
  const openImagePreview = (url: string) => setPreviewImage(url);
  const closePreview = () => { setPreviewVideoUrl(null); setPreviewImage(null); };
  const handleSelectClassicScene = (scene: ClassicScene) => {
    setTextPrompt(scene.prompt); setInputMode("text"); setCreateDialogOpen(true); setProjectTitle(scene.title);
  };

  const isAnyGenerating = currentProject?.scenes.some((s) => s.status === "generating") || false;
  const completedSceneCount = currentProject?.scenes.filter((s) => s.videoUrl).length || 0;

  // ─── RENDER ────────────────────────────────────────────
  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* ── Header ── */}
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
          <button onClick={() => currentView !== "home" ? setCurrentView("home") : null} className="flex items-center gap-2 font-bold text-lg hover:opacity-80 transition-opacity">
            <Clapperboard className="h-5 w-5 text-primary" />
            <span>Vidora</span>
          </button>
          <div className="flex items-center gap-2">
            {currentView === "home" && (
              <Button onClick={() => setCurrentView("create")} size="sm"><Sparkles className="h-4 w-4 mr-1" />Create</Button>
            )}
            {currentView !== "home" && (
              <Button variant="ghost" size="sm" onClick={() => setCurrentView("home")}><ArrowLeft className="h-4 w-4 mr-1" />Back</Button>
            )}
          </div>
        </div>
      </header>

      {/* ── Main Content ── */}
      <main className="flex-1">
        <AnimatePresence mode="wait">
          {/* ═══ HOME VIEW ═══ */}
          {currentView === "home" && (
            <motion.div key="home" {...fadeUp} className="max-w-7xl mx-auto px-4 py-8 space-y-12">
              {/* Hero */}
              <div className="text-center space-y-4">
                <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">Create Stunning <span className="text-primary">AI Videos</span></h1>
                <p className="text-muted-foreground text-lg max-w-2xl mx-auto">Transform your ideas into cinematic video scenes. Text, voice, or video — Vidora brings your vision to life.</p>
                <div className="flex gap-3 justify-center">
                  <Button size="lg" onClick={() => setCurrentView("create")}><Sparkles className="h-5 w-5 mr-2" />Start Creating</Button>
                  <Button size="lg" variant="outline" onClick={() => setCurrentView("gallery")}><LayoutGrid className="h-5 w-5 mr-2" />Gallery</Button>
                </div>
              </div>

              {/* Quick Create Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {[
                  { icon: <Wand2 className="h-6 w-6" />, title: "Text to Video", desc: "Describe your scene and let AI generate it", action: () => { setInputMode("text"); setCurrentView("create"); } },
                  { icon: <Mic className="h-6 w-6" />, title: "Voice to Video", desc: "Speak your idea and we'll create it", action: () => { setInputMode("voice"); setCurrentView("create"); } },
                  { icon: <Upload className="h-6 w-6" />, title: "Video to Video", desc: "Upload a video and we'll recreate it", action: () => { setInputMode("video"); setCurrentView("create"); } },
                ].map((card) => (
                  <Card key={card.title} className="cursor-pointer hover:shadow-lg transition-shadow group" onClick={card.action}>
                    <CardHeader><div className="mb-2 text-primary group-hover:scale-110 transition-transform">{card.icon}</div><CardTitle className="text-lg">{card.title}</CardTitle><CardDescription>{card.desc}</CardDescription></CardHeader>
                  </Card>
                ))}
              </div>

              {/* Recent Projects */}
              {projects.length > 0 && (
                <div>
                  <h2 className="text-xl font-semibold mb-4">Recent Projects</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {projects.slice(0, 6).map((p) => (
                      <Card key={p.id} className="cursor-pointer hover:shadow-lg transition-shadow" onClick={() => { setCurrentProject(p); setCurrentView("studio"); }}>
                        <CardHeader className="pb-2"><CardTitle className="text-base truncate">{p.title}</CardTitle></CardHeader>
                        <CardContent>
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Badge variant="outline" className="text-xs">{p.aspectRatio}</Badge>
                            <Badge variant="outline" className="text-xs">{p.style}</Badge>
                            <span>{p.targetDuration}s target</span>
                            <Badge variant={p.status === "completed" ? "default" : p.status === "generating" ? "secondary" : p.status === "failed" ? "destructive" : "outline"} className="text-xs ml-auto capitalize">{p.status}</Badge>
                          </div>
                          <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
                            <Film className="h-3 w-3" /><span>{p.scenes?.length || 0} scenes</span>
                            {p.finalVideoUrl && <Video className="h-3 w-3 ml-1" />}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {/* ═══ CREATE VIEW ═══ */}
          {currentView === "create" && (
            <motion.div key="create" {...fadeUp} className="max-w-3xl mx-auto px-4 py-8 space-y-6">
              <div><h1 className="text-2xl font-bold">Create New Video</h1><p className="text-muted-foreground mt-1">Describe your scene and choose settings</p></div>

              {/* Title + Duration + Style + Aspect */}
              <Card>
                <CardContent className="pt-6 space-y-4">
                  <div className="space-y-2"><Label>Project Title</Label><Input placeholder="My Video" value={projectTitle} onChange={(e) => setProjectTitle(e.target.value)} /></div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="space-y-2"><Label>Duration</Label>
                      <Select value={String(selectedDuration)} onValueChange={(v) => setSelectedDuration(Number(v))}>
                        <SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{DURATIONS.map((d) => <SelectItem key={d.value} value={String(d.value)}>{d.label}</SelectItem>)}</SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">~{Math.ceil(selectedDuration / 10)} scenes</p>
                    </div>
                    <div className="space-y-2"><Label>Style</Label>
                      <Select value={selectedStyle} onValueChange={setSelectedStyle}>
                        <SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{STYLES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2"><Label>Aspect Ratio</Label>
                      <Select value={selectedAspect} onValueChange={setSelectedAspect}>
                        <SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{ASPECTS.map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2"><Label>Transition</Label>
                      <Select value="fade"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{TRANSITIONS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent></Select>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Input Tabs */}
              <Card>
                <CardContent className="pt-6">
                  <Tabs value={inputMode} onValueChange={(v) => setInputMode(v as InputMode)}>
                    <TabsList className="grid w-full grid-cols-3"><TabsTrigger value="text"><Wand2 className="h-4 w-4 mr-1" />Text</TabsTrigger><TabsTrigger value="voice"><Mic className="h-4 w-4 mr-1" />Voice</TabsTrigger><TabsTrigger value="video"><Upload className="h-4 w-4 mr-1" />Video</TabsTrigger></TabsList>
                    <TabsContent value="text" className="space-y-3 mt-3">
                      <Textarea placeholder="Describe your video scene in detail..." className="min-h-[140px]" value={textPrompt} onChange={(e) => setTextPrompt(e.target.value)} />
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={enhancePrompt} disabled={isEnhancing || !textPrompt.trim()}><Palette className="h-4 w-4 mr-1" />{isEnhancing ? "Enhancing..." : "Enhance Prompt"}</Button>
                      </div>
                      {enhancedText && enhancedText !== textPrompt && (<Card className="bg-muted/50"><CardContent className="p-3"><p className="text-xs font-medium text-muted-foreground mb-1">Enhanced version:</p><p className="text-sm">{enhancedText}</p></CardContent></Card>)}
                    </TabsContent>
                    <TabsContent value="voice" className="space-y-3 mt-3">
                      <div className="flex flex-col items-center gap-4 py-8 border-2 border-dashed rounded-lg">
                        <Button size="lg" variant={isRecording ? "destructive" : "default"} onClick={isRecording ? stopRecording : startRecording}>
                          {isRecording ? <><MicOff className="h-5 w-5 mr-2" />Stop Recording</> : <><Mic className="h-5 w-5 mr-2" />Start Recording</>}
                        </Button>
                        <p className="text-sm text-muted-foreground">{isRecording ? "Recording... speak now" : "Click to record your voice"}</p>
                      </div>
                    </TabsContent>
                    <TabsContent value="video" className="space-y-3 mt-3">
                      <div className="border-2 border-dashed rounded-lg p-8 text-center space-y-4">
                        {videoPreview ? (<><video src={videoPreview} controls className="max-h-64 rounded-lg mx-auto" /><div className="flex gap-2 justify-center"><Button size="sm" onClick={analyzeUploadedVideo}>Analyze &amp; Use</Button><Button size="sm" variant="outline" onClick={() => { setVideoFile(null); setVideoPreview(null); }}>Remove</Button></div></>
                        ) : (<><Upload className="h-10 w-10 mx-auto text-muted-foreground/40" /><p className="text-sm text-muted-foreground">Upload a video to analyze</p><input ref={videoInputRef} type="file" accept="video/*" className="hidden" onChange={handleVideoUpload} /><Button variant="outline" onClick={() => videoInputRef.current?.click()}>Choose File</Button></>)}
                      </div>
                    </TabsContent>
                  </Tabs>
                </CardContent>
              </Card>

              {/* Create Button */}
              <div className="flex gap-3">
                <Button className="flex-1" size="lg" onClick={() => createProject()} disabled={isCreatingProject || (!textPrompt.trim() && !videoFile)}>
                  {isCreatingProject ? <><Loader2 className="h-5 w-5 mr-2 animate-spin" />Creating...</> : <><Sparkles className="h-5 w-5 mr-2" />Create &amp; Generate</>}
                </Button>
                <Button variant="outline" size="lg" onClick={() => setCurrentView("gallery")}><LayoutGrid className="h-5 w-5 mr-2" />Templates</Button>
              </div>
            </motion.div>
          )}

          {/* ═══ GALLERY VIEW ═══ */}
          {currentView === "gallery" && (
            <motion.div key="gallery" {...fadeUp} className="max-w-7xl mx-auto px-4 py-8 space-y-6">
              <div><h1 className="text-2xl font-bold">Scene Templates</h1><p className="text-muted-foreground mt-1">Choose a template to get started quickly</p></div>
              <div className="flex gap-2 flex-wrap">
                {["all", "nature", "sci-fi", "fantasy", "classic"].map((cat) => (
                  <Button key={cat} size="sm" variant={sceneFilter === cat ? "default" : "outline"} onClick={() => setSceneFilter(cat)}>{cat.charAt(0).toUpperCase() + cat.slice(1)}</Button>
                ))}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {CLASSIC_SCENES.filter((s) => sceneFilter === "all" || s.category === sceneFilter).map((scene) => (
                  <Card key={scene.id} className="cursor-pointer hover:shadow-lg transition-shadow overflow-hidden group">
                    <div className="aspect-video bg-muted relative">{scene.image ? <img src={scene.image} alt={scene.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" /> : <div className="w-full h-full flex items-center justify-center"><ImageIcon className="h-12 w-12 text-muted-foreground/30" /></div>}
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100"><Button size="sm"><Sparkles className="h-4 w-4 mr-1" />Use</Button></div>
                    <Badge className="absolute top-2 right-2 text-xs">{scene.category}</Badge>
                    </div>
                    <CardHeader className="pb-2"><CardTitle className="text-base">{scene.title}</CardTitle><CardDescription className="text-xs">{scene.description}</CardDescription></CardHeader>
                    <CardContent className="pt-0"><Button variant="outline" size="sm" className="w-full" onClick={() => handleSelectClassicScene(scene)}><Copy className="h-4 w-4 mr-1" />Use Template</Button></CardContent>
                  </Card>
                ))}
              </div>
            </motion.div>
          )}

          {/* ═══ STUDIO VIEW ═══ */}
          {currentView === "studio" && currentProject && (
            <motion.div key="studio" {...fadeUp} className="max-w-7xl mx-auto px-4 py-8 space-y-6">
              {/* Project Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div><h1 className="text-2xl font-bold">{currentProject.title}</h1>
                  <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
                    <Badge variant="outline">{currentProject.aspectRatio}</Badge><Badge variant="outline">{currentProject.style}</Badge>
                    <span>{currentProject.targetDuration}s target</span>
                    <Badge variant={currentProject.status === "completed" ? "default" : currentProject.status === "generating" ? "secondary" : "outline"} className="capitalize">{currentProject.status}</Badge>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={exportFullVideo} disabled={isExporting || completedSceneCount === 0}>
                    {isExporting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}
                    {isExporting ? "Exporting..." : "Export Video"}
                  </Button>
                  <Button onClick={() => generateVideo(currentProject)} disabled={isGenerating || isAnyGenerating || !currentProject.scenes.length}>
                    {(isGenerating || isAnyGenerating) ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
                    {(isGenerating || isAnyGenerating) ? "Generating..." : "Generate All"}
                  </Button>
                </div>
              </div>

              {/* Progress bar when generating */}
              {isAnyGenerating && (
                <Card className="bg-muted/30">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium">Generating scenes...</span>
                      <span className="text-sm text-muted-foreground">{completedSceneCount}/{currentProject.scenes.length} completed</span>
                    </div>
                    <Progress value={(completedSceneCount / currentProject.scenes.length) * 100} className="h-2" />
                  </CardContent>
                </Card>
              )}

              {/* Final Video */}
              {currentProject.finalVideoUrl && (
                <Card>
                  <CardHeader><CardTitle className="text-lg">Final Video</CardTitle></CardHeader>
                  <CardContent>
                    <DeviceSimulator aspectRatio={currentProject.aspectRatio} showLabel={false}>
                      <video src={currentProject.finalVideoUrl} controls className="w-full h-full object-contain" />
                    </DeviceSimulator>
                  </CardContent>
                </Card>
              )}

              {/* Add Scene */}
              <Card>
                <CardHeader><CardTitle className="text-lg">Add Scene</CardTitle></CardHeader>
                <CardContent>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Textarea placeholder="Describe a new scene..." className="min-h-[60px] flex-1" value={newScenePrompt} onChange={(e) => setNewScenePrompt(e.target.value)} />
                    <div className="flex gap-2 sm:flex-col">
                      <Select value={newSceneTransition} onValueChange={setNewSceneTransition}><SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger><SelectContent>{TRANSITIONS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent></Select>
                      <Button onClick={addScene} disabled={!newScenePrompt.trim()}><Plus className="h-4 w-4 mr-1" />Add</Button>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Scenes List */}
              <div><h3 className="text-lg font-semibold mb-3">Scenes ({currentProject.scenes.length})</h3>
                {currentProject.scenes.length === 0 ? (
                  <Card className="border-dashed"><CardContent className="p-8 text-center"><Film className="h-10 w-10 mx-auto text-muted-foreground/40" /><p className="text-muted-foreground mt-3">No scenes yet. Add your first scene above.</p></CardContent></Card>
                ) : (
                  <div className="space-y-3">
                    {currentProject.scenes.map((scene) => (
                      <Card key={scene.id} className="overflow-hidden">
                        <div className="flex flex-col sm:flex-row">
                          {/* Thumbnail/Video Preview */}
                          <div className="sm:w-56 aspect-video sm:aspect-auto bg-muted relative shrink-0 cursor-pointer" onClick={() => scene.videoUrl ? openVideoPreview(scene.videoUrl) : scene.imageUrl ? openImagePreview(scene.imageUrl) : null}>
                            {scene.videoUrl ? (
                              <DeviceSimulator aspectRatio={currentProject.aspectRatio} compact showLabel={false}>
                                <video src={scene.videoUrl} className="w-full h-full object-cover" muted />
                              </DeviceSimulator>
                            ) : scene.imageUrl ? (
                              <img src={scene.imageUrl} alt={"Scene " + scene.sceneNumber} className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center"><ImageIcon className="h-8 w-8 text-muted-foreground/40" /></div>
                            )}
                            {scene.status === "generating" && (
                              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/50 backdrop-blur-[2px]"><Loader2 className="h-8 w-8 animate-spin text-white" /><span className="text-xs text-white font-medium">Generating...</span></div>
                            )}
                            <Badge className="absolute top-2 left-2 text-xs">#{scene.sceneNumber}</Badge>
                            {scene.videoUrl && !scene.status.includes("generating") && (
                              <div className="absolute inset-0 flex items-center justify-center bg-black/30 hover:bg-black/40 transition-colors">
                                <div className="h-10 w-10 rounded-full bg-white/90 flex items-center justify-center"><Play className="h-5 w-5 text-black ml-0.5" /></div>
                              </div>
                            )}
                          </div>
                          {/* Scene Info */}
                          <CardContent className="p-4 flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                {/* Expandable prompt */}
                                <p
                                  className={`text-sm cursor-pointer hover:text-primary transition-colors ${expandedSceneId === scene.id ? "" : "line-clamp-2"}`}
                                  onClick={() => setExpandedSceneId(expandedSceneId === scene.id ? null : scene.id)}
                                >
                                  {scene.enhancedPrompt || scene.prompt}
                                </p>
                                {expandedSceneId === scene.id && (
                                  <button onClick={() => setExpandedSceneId(null)} className="text-xs text-muted-foreground hover:text-primary mt-1">Show less</button>
                                )}
                                <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground flex-wrap">
                                  <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{scene.duration}s</span>
                                  <Badge variant="outline" className="text-xs">{scene.transition}</Badge>
                                  {scene.videoUrl ? (
                                    <Badge variant="default" className="text-xs"><Video className="h-3 w-3 mr-1" />Ready</Badge>
                                  ) : scene.status === "generating" ? (
                                    <Badge variant="secondary" className="text-xs"><Loader2 className="h-3 w-3 mr-1 animate-spin" />Generating</Badge>
                                  ) : scene.status === "failed" ? (
                                    <Badge variant="destructive" className="text-xs">Failed</Badge>
                                  ) : (
                                    <Badge variant="outline" className="text-xs capitalize">{scene.status}</Badge>
                                  )}
                                </div>
                              </div>
                              {/* Action buttons */}
                              <div className="flex items-center gap-1 shrink-0">
                                {scene.status === "failed" && (
                                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => retryScene(scene)} title="Retry"><RefreshCw className="h-4 w-4" /></Button>
                                )}
                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => generateSceneVideo(scene.id, scene.enhancedPrompt || scene.prompt)} disabled={scene.status === "generating"} title="Generate video"><Eye className="h-4 w-4" /></Button>
                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => deleteScene(scene.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                              </div>
                            </div>
                          </CardContent>
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </div>

              {/* Delete project */}
              <div className="flex items-center justify-between pt-4 border-t">
                <Button variant="outline" onClick={() => deleteProject(currentProject.id)} className="text-destructive hover:text-destructive"><Trash2 className="h-4 w-4 mr-2" />Delete Project</Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* ── Create Dialog ── */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>Create from Template</DialogTitle><DialogDescription>Customize and create a new project from this template</DialogDescription></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2"><Label>Title</Label><Input value={projectTitle} onChange={(e) => setProjectTitle(e.target.value)} /></div>
            <div className="space-y-2"><Label>Prompt</Label><Textarea className="min-h-[100px]" value={textPrompt} onChange={(e) => setTextPrompt(e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>Style</Label><Select value={selectedStyle} onValueChange={setSelectedStyle}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{STYLES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-2"><Label>Aspect</Label><Select value={selectedAspect} onValueChange={setSelectedAspect}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{ASPECTS.map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}</SelectContent></Select></div>
            </div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setCreateDialogOpen(false)}>Cancel</Button><Button onClick={() => createProject()}><Sparkles className="h-4 w-4 mr-2" />Create</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Media Preview Dialog ── */}
      <Dialog open={!!previewVideoUrl || !!previewImage} onOpenChange={closePreview}>
        <DialogContent className="sm:max-w-4xl p-0 overflow-hidden"><DialogTitle className="sr-only">Preview</DialogTitle>
          <div className="bg-black">
            {previewVideoUrl ? (
              <DeviceSimulator aspectRatio={currentProject?.aspectRatio || "16:9"} showLabel={false}>
                <video src={previewVideoUrl} controls autoPlay className="w-full h-full object-contain" />
              </DeviceSimulator>
            ) : previewImage ? (
              <img src={previewImage} alt="Preview" className="w-full h-auto max-h-[80vh] object-contain" />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Footer ── */}
      <footer className="border-t border-border bg-background mt-auto">
        <div className="max-w-7xl mx-auto px-4 py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
          <p>Vidora — Professional AI Video Creator</p>
          <p>Powered by AI · Create cinematic videos in seconds</p>
        </div>
      </footer>
    </div>
  );
}
