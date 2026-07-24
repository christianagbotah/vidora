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
  Copy, Eye, Volume2, Clock, Video, RefreshCw, Zap, Timer, Monitor,
  Smartphone, RectangleHorizontal, Square, Tv,
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
  { value: "16:9", label: "16:9", icon: Monitor, desc: "Landscape" },
  { value: "9:16", label: "9:16", icon: Smartphone, desc: "Portrait" },
  { value: "1:1", label: "1:1", icon: Square, desc: "Square" },
  { value: "4:3", label: "4:3", icon: Tv, desc: "Classic" },
  { value: "21:9", label: "21:9", icon: RectangleHorizontal, desc: "Ultra Wide" },
];

const TRANSITIONS = [
  { value: "fade", label: "Fade" }, { value: "slide", label: "Slide" },
  { value: "zoom", label: "Zoom" }, { value: "dissolve", label: "Dissolve" },
];

const DURATION_PRESETS = [
  { value: 10, label: "10s" },
  { value: 30, label: "30s" },
  { value: 60, label: "1 min" },
  { value: 120, label: "2 min" },
  { value: 180, label: "3 min" },
  { value: 300, label: "5 min" },
];

const fadeUp = {
  initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -10 }, transition: { duration: 0.35 },
};

const stagger = {
  animate: { transition: { staggerChildren: 0.08 } },
};

const fadeItem = {
  initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 },
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
  const [customDuration, setCustomDuration] = useState("");
  const [isCustomDuration, setIsCustomDuration] = useState(false);
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

  // Effective duration
  const effectiveDuration = isCustomDuration
    ? Math.max(10, Math.min(300, parseInt(customDuration) || 60))
    : selectedDuration;

  const effectiveSceneCount = Math.ceil(effectiveDuration / 10);

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
      if (data.success && Array.isArray(data.projects)) setProjects(data.projects);
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
          setProjects((prev) => (Array.isArray(prev) ? prev : []).map((p) => p.id === data.project.id ? data.project : p));
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
      toast({ title: "Analyzing your prompt..." });
      const splitRes = await fetch("/api/split-scenes", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, targetDuration: effectiveDuration }),
      });
      const splitData = await splitRes.json();
      if (!splitData.success) { toast({ title: "Failed to analyze prompt", variant: "destructive" }); return; }

      const sceneDescriptions = splitData.scenes || [prompt];

      const projRes = await fetch("/api/projects", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: titleOverride || projectTitle || ("Video — " + new Date().toLocaleDateString()),
          style: selectedStyle, aspectRatio: selectedAspect, targetDuration: effectiveDuration,
        }),
      });
      const projData = await projRes.json();
      if (!projData.success) { toast({ title: "Failed to create project", variant: "destructive" }); return; }
      const project = projData.project;

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

      const fullRes = await fetch(`/api/projects/${project.id}`);
      const fullData = await fullRes.json();
      if (fullData.success) {
        setCurrentProject(fullData.project);
        setProjects((prev) => [fullData.project, ...(Array.isArray(prev) ? prev : [])]);
        setCurrentView("studio");
        setCreateDialogOpen(false);
        toast({ title: "Project created with " + sceneDescriptions.length + " scenes!", description: "Video generation will start automatically." });
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

  // Safety: ensure projects is always an array
  const safeProjects = Array.isArray(projects) ? projects : [];
  const safeScenes = currentProject?.scenes && Array.isArray(currentProject.scenes) ? currentProject.scenes : [];
  const isAnyGenerating = safeScenes.some((s) => s.status === "generating") || false;
  const completedSceneCount = safeScenes.filter((s) => s.videoUrl).length || 0;

  const formatDuration = (sec: number) => {
    if (sec < 60) return sec + "s";
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  };

  // ─── RENDER ────────────────────────────────────────────
  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* ── Header ── */}
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <button
            onClick={() => currentView !== "home" ? setCurrentView("home") : null}
            className="flex items-center gap-2.5 font-bold text-lg hover:opacity-80 transition-opacity"
          >
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-violet-500/20">
              <Clapperboard className="h-4 w-4 text-white" />
            </div>
            <span className="bg-gradient-to-r from-violet-600 to-fuchsia-600 bg-clip-text text-transparent font-extrabold tracking-tight">
              Vidora
            </span>
          </button>
          <div className="flex items-center gap-2">
            {currentView === "home" && (
              <Button onClick={() => setCurrentView("create")} size="sm" className="btn-gradient">
                <Sparkles className="h-4 w-4 mr-1.5" />Create Video
              </Button>
            )}
            {currentView !== "home" && (
              <Button variant="ghost" size="sm" onClick={() => setCurrentView("home")} className="hover:bg-violet-50">
                <ArrowLeft className="h-4 w-4 mr-1" />Back
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* ── Main Content ── */}
      <main className="flex-1">
        <AnimatePresence mode="wait">
          {/* ═══ HOME VIEW ═══ */}
          {currentView === "home" && (
            <motion.div key="home" {...fadeUp}>
              {/* ── Hero Section ── */}
              <section className="hero-gradient relative overflow-hidden">
                <div className="orb orb-violet w-[400px] h-[400px] -top-20 -left-32" />
                <div className="orb orb-amber w-[300px] h-[300px] top-10 right-10" />
                <div className="orb orb-rose w-[250px] h-[250px] -bottom-10 left-1/3" />
                <div className="orb orb-violet w-[200px] h-[200px] bottom-20 right-1/4" />

                <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 py-20 sm:py-28 lg:py-36 text-center">
                  <motion.div
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6, ease: "easeOut" }}
                    className="space-y-6"
                  >
                    {/* Badge */}
                    <motion.div
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: 0.1 }}
                    >
                      <Badge className="px-4 py-1.5 text-xs font-semibold glass-card text-violet-200 hover:bg-white/10 cursor-default">
                        <Zap className="h-3 w-3 mr-1.5 text-amber-400" />
                        AI-Powered Video Generation
                      </Badge>
                    </motion.div>

                    {/* Heading */}
                    <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-tight">
                      <span className="text-white">Create Stunning</span>
                      <br />
                      <span className="hero-text-gradient">AI Videos</span>
                    </h1>

                    {/* Subtitle */}
                    <p className="text-lg sm:text-xl text-violet-200/80 max-w-2xl mx-auto leading-relaxed">
                      Transform your ideas into cinematic video scenes. Generate professional videos
                      from <span className="text-amber-300 font-medium">10 seconds to 5 minutes</span> with any aspect ratio.
                    </p>

                    {/* CTA Buttons */}
                    <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
                      <Button
                        size="lg"
                        onClick={() => setCurrentView("create")}
                        className="btn-gradient text-base px-8 py-6 h-auto"
                      >
                        <Sparkles className="h-5 w-5 mr-2" />Start Creating
                      </Button>
                      <Button
                        size="lg"
                        variant="outline"
                        onClick={() => setCurrentView("gallery")}
                        className="glass-card text-white/80 hover:text-white hover:bg-white/10 px-8 py-6 h-auto"
                      >
                        <LayoutGrid className="h-5 w-5 mr-2" />Browse Templates
                      </Button>
                    </div>

                    {/* Stats */}
                    <div className="flex items-center justify-center gap-8 pt-4 text-sm">
                      {[
                        { icon: Film, label: "Multi-Scene", sub: "Videos" },
                        { icon: Timer, label: "10s – 5min", sub: "Duration" },
                        { icon: Monitor, label: "5 Aspect", sub: "Ratios" },
                      ].map((s) => (
                        <div key={s.label} className="flex items-center gap-2 text-violet-300/70">
                          <s.icon className="h-4 w-4" />
                          <div className="text-left">
                            <p className="font-semibold text-white/90">{s.label}</p>
                            <p className="text-xs">{s.sub}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                </div>

                {/* Bottom fade */}
                <div className="absolute bottom-0 inset-x-0 h-24 bg-gradient-to-t from-background to-transparent" />
              </section>

              {/* ── Quick Create Cards ── */}
              <section className="max-w-5xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
                <motion.div {...stagger} className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
                  {[
                    { icon: <Wand2 className="h-7 w-7" />, title: "Text to Video", desc: "Describe your scene and let AI generate cinematic video", color: "from-violet-500 to-purple-500", action: () => { setInputMode("text"); setCurrentView("create"); } },
                    { icon: <Mic className="h-7 w-7" />, title: "Voice to Video", desc: "Speak your idea and we'll transcribe & create it", color: "from-fuchsia-500 to-pink-500", action: () => { setInputMode("voice"); setCurrentView("create"); } },
                    { icon: <Upload className="h-7 w-7" />, title: "Video to Video", desc: "Upload a video and we'll recreate it with AI", color: "from-amber-500 to-orange-500", action: () => { setInputMode("video"); setCurrentView("create"); } },
                  ].map((card) => (
                    <motion.div key={card.title} {...fadeItem}>
                      <Card
                        className="card-glow cursor-pointer border-0 shadow-lg shadow-black/5 bg-white group h-full"
                        onClick={card.action}
                      >
                        <CardHeader className="pb-3">
                          <div className={`mb-3 h-12 w-12 rounded-xl bg-gradient-to-br ${card.color} flex items-center justify-center text-white shadow-lg group-hover:scale-110 transition-transform duration-300`}>
                            {card.icon}
                          </div>
                          <CardTitle className="text-lg font-bold text-foreground">{card.title}</CardTitle>
                          <CardDescription className="text-sm text-muted-foreground leading-relaxed">{card.desc}</CardDescription>
                        </CardHeader>
                      </Card>
                    </motion.div>
                  ))}
                </motion.div>
              </section>

              {/* ── Recent Projects ── */}
              {safeProjects.length > 0 && (
                <section className="max-w-5xl mx-auto px-4 sm:px-6 pb-12 sm:pb-16">
                  <div className="section-divider mb-10" />
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="text-xl sm:text-2xl font-bold tracking-tight">Recent Projects</h2>
                    {safeProjects.length > 3 && (
                      <Button variant="ghost" size="sm" className="text-violet-600 hover:text-violet-700 hover:bg-violet-50">
                        View All <ChevronRight className="h-4 w-4 ml-1" />
                      </Button>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {safeProjects.slice(0, 6).map((p) => (
                      <Card
                        key={p.id}
                        className="card-glow cursor-pointer bg-white border-0 shadow-md shadow-black/5"
                        onClick={() => { setCurrentProject(p); setCurrentView("studio"); }}
                      >
                        <CardHeader className="pb-2">
                          <div className="flex items-start justify-between">
                            <CardTitle className="text-base font-bold truncate pr-2">{p.title}</CardTitle>
                            <Badge
                              className={`text-[10px] font-semibold px-2 shrink-0 ${
                                p.status === "completed" ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                                p.status === "generating" ? "bg-violet-50 text-violet-700 border-violet-200" :
                                p.status === "failed" ? "bg-red-50 text-red-700 border-red-200" :
                                "bg-slate-50 text-slate-600 border-slate-200"
                              }`}
                            >
                              {p.status}
                            </Badge>
                          </div>
                        </CardHeader>
                        <CardContent>
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground flex-wrap">
                            <Badge variant="outline" className="text-[10px] font-medium">{p.aspectRatio}</Badge>
                            <Badge variant="outline" className="text-[10px] font-medium">{p.style}</Badge>
                            <span className="flex items-center gap-0.5"><Clock className="h-3 w-3" />{formatDuration(p.targetDuration)}</span>
                          </div>
                          <div className="flex items-center gap-1.5 mt-2.5 text-xs text-muted-foreground">
                            <Film className="h-3 w-3" />
                            <span>{p.scenes?.length || 0} scenes</span>
                            {p.finalVideoUrl && <Badge className="text-[10px] bg-amber-50 text-amber-700 border-amber-200 ml-auto"><Video className="h-2.5 w-2.5 mr-0.5" />Exported</Badge>}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </section>
              )}
            </motion.div>
          )}

          {/* ═══ CREATE VIEW ═══ */}
          {currentView === "create" && (
            <motion.div key="create" {...fadeUp} className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-6">
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Create New Video</h1>
                <p className="text-muted-foreground mt-1">Describe your scene and choose settings</p>
              </div>

              {/* Settings Card */}
              <Card className="border-0 shadow-lg shadow-black/5 bg-white card-glow">
                <CardHeader className="pb-4">
                  <CardTitle className="text-base font-bold flex items-center gap-2">
                    <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center text-white">
                      <Layers className="h-3.5 w-3.5" />
                    </div>
                    Project Settings
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="space-y-1.5">
                    <Label className="text-sm font-medium">Project Title</Label>
                    <Input placeholder="My Cinematic Video" value={projectTitle} onChange={(e) => setProjectTitle(e.target.value)} className="h-10" />
                  </div>

                  {/* Duration with Custom Option */}
                  <div className="space-y-1.5">
                    <Label className="text-sm font-medium">Duration</Label>
                    <div className="flex items-center gap-3 flex-wrap">
                      <div className="flex gap-1.5 flex-wrap">
                        {DURATION_PRESETS.map((d) => (
                          <button
                            key={d.value}
                            onClick={() => { setSelectedDuration(d.value); setIsCustomDuration(false); }}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 ${
                              !isCustomDuration && selectedDuration === d.value
                                ? "bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow-md shadow-violet-500/25"
                                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                            }`}
                          >
                            {d.label}
                          </button>
                        ))}
                      </div>
                      <button
                        onClick={() => setIsCustomDuration(true)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 ${
                          isCustomDuration
                            ? "bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-md shadow-amber-500/25"
                            : "bg-amber-50 text-amber-600 hover:bg-amber-100 border border-amber-200"
                        }`}
                      >
                        Custom
                      </button>
                      {isCustomDuration && (
                        <div className="flex items-center gap-1.5">
                          <Input
                            type="number"
                            min={10}
                            max={300}
                            placeholder="seconds"
                            value={customDuration}
                            onChange={(e) => setCustomDuration(e.target.value)}
                            className="w-24 h-9 text-xs"
                          />
                          <span className="text-xs text-muted-foreground">sec (10–300)</span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="outline" className="text-[10px]">
                        <Film className="h-2.5 w-2.5 mr-1" />~{effectiveSceneCount} scene{effectiveSceneCount > 1 ? "s" : ""}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        <Clock className="h-2.5 w-2.5 mr-1" />{formatDuration(effectiveDuration)} total
                      </Badge>
                    </div>
                  </div>

                  {/* Style + Aspect + Transition */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium">Style</Label>
                      <Select value={selectedStyle} onValueChange={setSelectedStyle}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{STYLES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium">Aspect Ratio</Label>
                      <Select value={selectedAspect} onValueChange={setSelectedAspect}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{ASPECTS.map((a) => <SelectItem key={a.value} value={a.value}>{a.label} {a.desc}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium">Transition</Label>
                      <Select value="fade">
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{TRANSITIONS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Input Tabs */}
              <Card className="border-0 shadow-lg shadow-black/5 bg-white">
                <CardContent className="pt-6">
                  <Tabs value={inputMode} onValueChange={(v) => setInputMode(v as InputMode)}>
                    <TabsList className="grid w-full grid-cols-3 bg-slate-100 p-1">
                      <TabsTrigger value="text" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm">
                        <Wand2 className="h-4 w-4 mr-1.5" />Text
                      </TabsTrigger>
                      <TabsTrigger value="voice" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm">
                        <Mic className="h-4 w-4 mr-1.5" />Voice
                      </TabsTrigger>
                      <TabsTrigger value="video" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm">
                        <Upload className="h-4 w-4 mr-1.5" />Video
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent value="text" className="space-y-3 mt-4">
                      <Textarea
                        placeholder="Describe your video scene in detail. The more detail, the better the result..."
                        className="min-h-[150px] text-sm leading-relaxed resize-none"
                        value={textPrompt}
                        onChange={(e) => setTextPrompt(e.target.value)}
                      />
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={enhancePrompt} disabled={isEnhancing || !textPrompt.trim()} className="hover:bg-violet-50 hover:text-violet-700 hover:border-violet-200">
                          {isEnhancing ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Palette className="h-4 w-4 mr-1.5" />}
                          {isEnhancing ? "Enhancing..." : "Enhance with AI"}
                        </Button>
                      </div>
                      {enhancedText && enhancedText !== textPrompt && (
                        <Card className="bg-gradient-to-r from-violet-50 to-fuchsia-50 border-violet-100"><CardContent className="p-4"><p className="text-xs font-semibold text-violet-600 mb-1">AI Enhanced Version:</p><p className="text-sm text-foreground leading-relaxed">{enhancedText}</p></CardContent></Card>
                      )}
                    </TabsContent>

                    <TabsContent value="voice" className="space-y-3 mt-4">
                      <div className="flex flex-col items-center gap-4 py-10 border-2 border-dashed border-slate-200 rounded-xl">
                        <div className={`h-16 w-16 rounded-full flex items-center justify-center ${isRecording ? "bg-red-100 animate-pulse" : "bg-violet-100"}`}>
                          <Button
                            size="lg"
                            variant={isRecording ? "destructive" : "default"}
                            onClick={isRecording ? stopRecording : startRecording}
                            className={`rounded-full h-12 w-12 ${!isRecording ? "btn-gradient" : ""}`}
                          >
                            {isRecording ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                          </Button>
                        </div>
                        <p className="text-sm text-muted-foreground">{isRecording ? "Recording... speak now" : "Click to record your voice"}</p>
                      </div>
                    </TabsContent>

                    <TabsContent value="video" className="space-y-3 mt-4">
                      <div className="border-2 border-dashed border-slate-200 rounded-xl p-8 text-center space-y-4">
                        {videoPreview ? (
                          <><video src={videoPreview} controls className="max-h-64 rounded-lg mx-auto" /><div className="flex gap-2 justify-center"><Button size="sm" className="btn-gradient">Analyze &amp; Use</Button><Button size="sm" variant="outline" onClick={() => { setVideoFile(null); setVideoPreview(null); }}>Remove</Button></div></>
                        ) : (
                          <><Upload className="h-10 w-10 mx-auto text-slate-300" /><p className="text-sm text-muted-foreground">Upload a video to analyze</p><input ref={videoInputRef} type="file" accept="video/*" className="hidden" onChange={handleVideoUpload} /><Button variant="outline" onClick={() => videoInputRef.current?.click()}>Choose File</Button></>
                        )}
                      </div>
                    </TabsContent>
                  </Tabs>
                </CardContent>
              </Card>

              {/* Create Button */}
              <div className="flex gap-3">
                <Button
                  className="flex-1 btn-gradient text-base h-12"
                  onClick={() => createProject()}
                  disabled={isCreatingProject || (!textPrompt.trim() && !videoFile)}
                >
                  {isCreatingProject ? <><Loader2 className="h-5 w-5 mr-2 animate-spin" />Creating...</> : <><Sparkles className="h-5 w-5 mr-2" />Create &amp; Generate</>}
                </Button>
              </div>
            </motion.div>
          )}

          {/* ═══ GALLERY VIEW ═══ */}
          {currentView === "gallery" && (
            <motion.div key="gallery" {...fadeUp} className="max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-6">
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Scene Templates</h1>
                <p className="text-muted-foreground mt-1">Choose a template to get started quickly</p>
              </div>
              <div className="flex gap-2 flex-wrap">
                {["all", "nature", "sci-fi", "fantasy", "classic"].map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setSceneFilter(cat)}
                    className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 ${
                      sceneFilter === cat
                        ? "bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow-md shadow-violet-500/25"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    {cat.charAt(0).toUpperCase() + cat.slice(1)}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {CLASSIC_SCENES.filter((s) => sceneFilter === "all" || s.category === sceneFilter).map((scene) => (
                  <Card key={scene.id} className="card-glow overflow-hidden group border-0 shadow-lg shadow-black/5 bg-white cursor-pointer">
                    <div className="aspect-video bg-slate-100 relative overflow-hidden">
                      {scene.image ? (
                        <img src={scene.image} alt={scene.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                      ) : (
                        <div className="w-full h-full bg-gradient-to-br from-violet-100 to-fuchsia-100 flex items-center justify-center">
                          <ImageIcon className="h-12 w-12 text-violet-300" />
                        </div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-end justify-center pb-4">
                        <Button size="sm" className="btn-gradient text-xs">
                          <Sparkles className="h-3.5 w-3.5 mr-1" />Use Template
                        </Button>
                      </div>
                      <Badge className="absolute top-2.5 right-2.5 text-[10px] font-semibold glass-card text-white">{scene.category}</Badge>
                    </div>
                    <CardHeader className="pb-2 pt-4">
                      <CardTitle className="text-base font-bold">{scene.title}</CardTitle>
                      <CardDescription className="text-xs leading-relaxed">{scene.description}</CardDescription>
                    </CardHeader>
                    <CardContent className="pt-0 pb-4">
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full hover:bg-violet-50 hover:text-violet-700 hover:border-violet-200"
                        onClick={() => handleSelectClassicScene(scene)}
                      >
                        <Copy className="h-3.5 w-3.5 mr-1.5" />Use Template
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </motion.div>
          )}

          {/* ═══ STUDIO VIEW ═══ */}
          {currentView === "studio" && currentProject && (
            <motion.div key="studio" {...fadeUp} className="max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-6">
              {/* Project Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{currentProject.title}</h1>
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <Badge variant="outline" className="text-xs font-medium">{currentProject.aspectRatio}</Badge>
                    <Badge variant="outline" className="text-xs font-medium">{currentProject.style}</Badge>
                    <Badge variant="outline" className="text-xs font-medium"><Clock className="h-2.5 w-2.5 mr-1" />{formatDuration(currentProject.targetDuration)}</Badge>
                    <Badge
                      className={`text-[10px] font-semibold px-2 ${
                        currentProject.status === "completed" ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                        currentProject.status === "generating" ? "bg-violet-50 text-violet-700 border-violet-200" :
                        currentProject.status === "failed" ? "bg-red-50 text-red-700 border-red-200" :
                        "bg-slate-50 text-slate-600 border-slate-200"
                      }`}
                    >
                      {currentProject.status}
                    </Badge>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={exportFullVideo} disabled={isExporting || completedSceneCount === 0} className="hover:bg-violet-50 hover:text-violet-700">
                    {isExporting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}
                    {isExporting ? "Exporting..." : "Export Video"}
                  </Button>
                  <Button onClick={() => generateVideo(currentProject)} disabled={isGenerating || isAnyGenerating || safeScenes.length === 0} className="btn-gradient">
                    {(isGenerating || isAnyGenerating) ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
                    {(isGenerating || isAnyGenerating) ? "Generating..." : "Generate All"}
                  </Button>
                </div>
              </div>

              {/* Progress bar */}
              {isAnyGenerating && (
                <Card className="border-0 shadow-md shadow-black/5 bg-gradient-to-r from-violet-50/50 to-fuchsia-50/50">
                  <CardContent className="p-4 sm:p-5">
                    <div className="flex items-center justify-between mb-2.5">
                      <div className="flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin text-violet-500" />
                        <span className="text-sm font-semibold text-foreground">Generating scenes...</span>
                      </div>
                      <span className="text-sm text-muted-foreground font-medium">{completedSceneCount}/{safeScenes.length} completed</span>
                    </div>
                    <div className="relative h-2 bg-slate-200 rounded-full overflow-hidden">
                      <div
                        className="progress-gradient h-full rounded-full transition-all duration-700 ease-out"
                        style={{ width: `${(completedSceneCount / safeScenes.length) * 100}%` }}
                      />
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Final Video */}
              {currentProject.finalVideoUrl && (
                <Card className="border-0 shadow-lg shadow-black/5 bg-white overflow-hidden">
                  <CardHeader>
                    <CardTitle className="text-lg font-bold flex items-center gap-2">
                      <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center text-white">
                        <Video className="h-3.5 w-3.5" />
                      </div>
                      Final Video
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <DeviceSimulator aspectRatio={currentProject.aspectRatio} showLabel={false}>
                      <video src={currentProject.finalVideoUrl} controls className="w-full h-full object-contain" />
                    </DeviceSimulator>
                  </CardContent>
                </Card>
              )}

              {/* Add Scene */}
              <Card className="border-0 shadow-md shadow-black/5 bg-white">
                <CardHeader>
                  <CardTitle className="text-base font-bold flex items-center gap-2">
                    <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center text-white">
                      <Plus className="h-3.5 w-3.5" />
                    </div>
                    Add Scene
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Textarea placeholder="Describe a new scene..." className="min-h-[60px] flex-1 text-sm" value={newScenePrompt} onChange={(e) => setNewScenePrompt(e.target.value)} />
                    <div className="flex gap-2 sm:flex-col">
                      <Select value={newSceneTransition} onValueChange={setNewSceneTransition}>
                        <SelectTrigger className="w-[120px] text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>{TRANSITIONS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                      </Select>
                      <Button onClick={addScene} disabled={!newScenePrompt.trim()} className="btn-amber text-xs">
                        <Plus className="h-4 w-4 mr-1" />Add
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Scenes List */}
              <div>
                <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                  <Layers className="h-4 w-4 text-violet-500" />
                  Scenes ({safeScenes.length})
                </h3>
                {safeScenes.length === 0 ? (
                  <Card className="border-dashed border-2 bg-slate-50/50"><CardContent className="p-10 text-center"><Film className="h-10 w-10 mx-auto text-slate-300" /><p className="text-muted-foreground mt-3 font-medium">No scenes yet. Add your first scene above.</p></CardContent></Card>
                ) : (
                  <div className="space-y-3">
                    {safeScenes.map((scene) => (
                      <Card key={scene.id} className="card-glow overflow-hidden bg-white border-0 shadow-md shadow-black/5">
                        <div className="flex flex-col sm:flex-row">
                          {/* Thumbnail */}
                          <div className="sm:w-64 aspect-video sm:aspect-auto bg-slate-100 relative shrink-0 cursor-pointer" onClick={() => scene.videoUrl ? openVideoPreview(scene.videoUrl) : scene.imageUrl ? openImagePreview(scene.imageUrl) : null}>
                            {scene.videoUrl ? (
                              <DeviceSimulator aspectRatio={currentProject.aspectRatio} compact showLabel={false}>
                                <video src={scene.videoUrl} className="w-full h-full object-cover" muted />
                              </DeviceSimulator>
                            ) : scene.imageUrl ? (
                              <img src={scene.imageUrl} alt={"Scene " + scene.sceneNumber} className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center">
                                <ImageIcon className="h-8 w-8 text-slate-300" />
                              </div>
                            )}
                            {scene.status === "generating" && (
                              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60 backdrop-blur-sm">
                                <Loader2 className="h-8 w-8 animate-spin text-white" />
                                <span className="text-xs text-white font-semibold">Generating...</span>
                              </div>
                            )}
                            <Badge className="absolute top-2 left-2 text-[10px] font-bold shadow-sm">#{scene.sceneNumber}</Badge>
                            {scene.videoUrl && scene.status !== "generating" && (
                              <div className="absolute inset-0 flex items-center justify-center bg-black/0 hover:bg-black/30 transition-colors duration-200">
                                <div className="h-10 w-10 rounded-full bg-white/90 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity shadow-lg">
                                  <Play className="h-5 w-5 text-black ml-0.5" />
                                </div>
                              </div>
                            )}
                          </div>
                          {/* Info */}
                          <CardContent className="p-4 flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <p
                                  className={`text-sm cursor-pointer hover:text-violet-600 transition-colors ${expandedSceneId === scene.id ? "" : "line-clamp-2"}`}
                                  onClick={() => setExpandedSceneId(expandedSceneId === scene.id ? null : scene.id)}
                                >
                                  {scene.enhancedPrompt || scene.prompt}
                                </p>
                                {expandedSceneId === scene.id && (
                                  <button onClick={() => setExpandedSceneId(null)} className="text-[10px] text-violet-500 hover:text-violet-700 mt-1 font-medium">Show less</button>
                                )}
                                <div className="flex items-center gap-2.5 mt-2.5 text-xs flex-wrap">
                                  <span className="flex items-center gap-1 text-muted-foreground"><Clock className="h-3 w-3" />{scene.duration}s</span>
                                  <Badge variant="outline" className="text-[10px]">{scene.transition}</Badge>
                                  {scene.videoUrl ? (
                                    <Badge className="text-[10px] font-semibold bg-emerald-50 text-emerald-700 border-emerald-200"><Video className="h-2.5 w-2.5 mr-1" />Ready</Badge>
                                  ) : scene.status === "generating" ? (
                                    <Badge className="text-[10px] font-semibold bg-violet-50 text-violet-700 border-violet-200"><Loader2 className="h-2.5 w-2.5 mr-1 animate-spin" />Generating</Badge>
                                  ) : scene.status === "failed" ? (
                                    <Badge className="text-[10px] font-semibold bg-red-50 text-red-700 border-red-200">Failed</Badge>
                                  ) : (
                                    <Badge className="text-[10px] font-semibold bg-slate-50 text-slate-600 border-slate-200 capitalize">{scene.status}</Badge>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                {scene.status === "failed" && (
                                  <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-amber-50" onClick={() => retryScene(scene)} title="Retry"><RefreshCw className="h-4 w-4 text-amber-500" /></Button>
                                )}
                                <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-violet-50" onClick={() => generateSceneVideo(scene.id, scene.enhancedPrompt || scene.prompt)} disabled={scene.status === "generating"} title="Generate"><Eye className="h-4 w-4 text-violet-500" /></Button>
                                <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-red-50" onClick={() => deleteScene(scene.id)}><Trash2 className="h-4 w-4 text-red-400" /></Button>
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
              <div className="flex items-center justify-between pt-4 border-t border-slate-200">
                <Button variant="ghost" onClick={() => deleteProject(currentProject.id)} className="text-red-500 hover:text-red-600 hover:bg-red-50">
                  <Trash2 className="h-4 w-4 mr-2" />Delete Project
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* ── Create Dialog ── */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>Create from Template</DialogTitle><DialogDescription>Customize and create a new project from this template</DialogDescription></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5"><Label>Title</Label><Input value={projectTitle} onChange={(e) => setProjectTitle(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Prompt</Label><Textarea className="min-h-[100px]" value={textPrompt} onChange={(e) => setTextPrompt(e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Style</Label><Select value={selectedStyle} onValueChange={setSelectedStyle}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{STYLES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-1.5"><Label>Aspect</Label><Select value={selectedAspect} onValueChange={setSelectedAspect}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{ASPECTS.map((a) => <SelectItem key={a.value} value={a.value}>{a.label} {a.desc}</SelectItem>)}</SelectContent></Select></div>
            </div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setCreateDialogOpen(false)}>Cancel</Button><Button onClick={() => createProject()} className="btn-gradient"><Sparkles className="h-4 w-4 mr-2" />Create</Button></DialogFooter>
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
      <footer className="border-t bg-background mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-5 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-md bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center">
              <Clapperboard className="h-3 w-3 text-white" />
            </div>
            <span className="text-sm font-semibold bg-gradient-to-r from-violet-600 to-fuchsia-600 bg-clip-text text-transparent">Vidora</span>
            <span className="text-xs text-muted-foreground">— Professional AI Video Creator</span>
          </div>
          <p className="text-xs text-muted-foreground">Powered by AI · Create cinematic videos in seconds</p>
        </div>
      </footer>
    </div>
  );
}
