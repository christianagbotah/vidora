"use client";

import { useEffect, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAppStore } from "@/store/useAppStore";
import { useToast } from "@/hooks/use-toast";
import type { VideoProject, ClassicScene, InputMode } from "@/types/video";
import {
  Film, Mic, MicOff, Upload, Sparkles, Play, Plus, Trash2,
  ChevronRight, Wand2, ArrowLeft, ImageIcon, LayoutGrid, Loader2,
  X, Download, Layers, Palette, Clapperboard, GripVertical,
  Copy, Eye, Volume2, SkipForward, Clock,
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

// ─── Data ────────────────────────────────────────────────
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
  const [projectTitle, setProjectTitle] = useState("");
  const [newScenePrompt, setNewScenePrompt] = useState("");
  const [newSceneDuration, setNewSceneDuration] = useState("3");
  const [newSceneTransition, setNewSceneTransition] = useState("fade");
  const [sceneFilter, setSceneFilter] = useState("all");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const videoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { fetchProjects(); }, []);

  const fetchProjects = async () => {
    try {
      const res = await fetch("/api/projects");
      if (!res.ok) { toast({ title: "Failed to load projects", description: "Server error " + res.status, variant: "destructive" }); return; }
      const data = await res.json();
      if (data.success) setProjects(data.projects);
    } catch (err) { toast({ title: "Failed to load projects", description: err instanceof Error ? err.message : "Network error", variant: "destructive" }); }
  };

  // Voice
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        setIsRecording(false);
        stream.getTracks().forEach((t) => t.stop());
        toast({ title: "Transcribing your voice..." });
        const formData = new FormData();
        formData.append("audio", blob, "recording.webm");
        try {
          const res = await fetch("/api/transcribe", { method: "POST", body: formData });
          const data = await res.json();
          if (data.success && data.transcription) { setTextPrompt(data.transcription); toast({ title: "Voice transcribed!" }); }
          else toast({ title: "Transcription failed", description: "Try typing instead", variant: "destructive" });
        } catch { toast({ title: "Transcription error", variant: "destructive" }); }
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
    } catch { toast({ title: "Microphone access denied", variant: "destructive" }); }
  };
  const stopRecording = () => { mediaRecorderRef.current?.stop(); };

  // Video Upload
  const handleVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setVideoFile(file);
    setVideoPreview(URL.createObjectURL(file));
  };
  const analyzeUploadedVideo = async () => {
    if (!videoFile) return;
    toast({ title: "Analyzing your video..." });
    const formData = new FormData();
    formData.append("video", videoFile);
    try {
      const res = await fetch("/api/analyze-video", { method: "POST", body: formData });
      const data = await res.json();
      if (data.success && data.suggestedPrompt) { setTextPrompt(data.suggestedPrompt); toast({ title: "Video analyzed!" }); setInputMode("text"); }
    } catch { toast({ title: "Video analysis failed", variant: "destructive" }); }
  };

  // Enhance
  const enhancePrompt = async () => {
    if (!textPrompt.trim()) return;
    setIsEnhancing(true);
    try {
      const res = await fetch("/api/enhance-prompt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: textPrompt, style: selectedStyle }) });
      const data = await res.json();
      if (data.success) { setEnhancedText(data.enhancedPrompt); toast({ title: "Prompt enhanced!" }); }
    } catch { toast({ title: "Enhancement failed", variant: "destructive" }); }
    finally { setIsEnhancing(false); }
  };

  // Create Project
  const createProject = async (prompt: string, title?: string) => {
    const pTitle = title || prompt.slice(0, 40) + (prompt.length > 40 ? "..." : "");
    try {
      const res = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: pTitle, description: prompt, style: selectedStyle, aspectRatio: selectedAspect }) });
      if (!res.ok) { toast({ title: "Failed to create project", description: "Server error " + res.status, variant: "destructive" }); return; }
      const data = await res.json();
      if (!data.success) { toast({ title: "Failed to create project", description: data.error || "Unknown error", variant: "destructive" }); return; }
      const sceneRes = await fetch(`/api/projects/${data.project.id}/scenes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, enhancedPrompt: enhancedText || undefined }) });
      if (sceneRes.ok) {
        const projRes = await fetch(`/api/projects/${data.project.id}`);
        const projData = await projRes.json();
        if (projData.success) { setCurrentProject(projData.project); setCurrentView("studio"); }
      }
      fetchProjects();
      setCreateDialogOpen(false);
      toast({ title: "Project created!" });
    } catch (err) { toast({ title: "Failed to create project", description: err instanceof Error ? err.message : "Network error", variant: "destructive" }); }
  };

  // Add Scene
  const addScene = async () => {
    if (!currentProject || !newScenePrompt.trim()) return;
    try {
      const res = await fetch(`/api/projects/${currentProject.id}/scenes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: newScenePrompt, duration: parseInt(newSceneDuration), transition: newSceneTransition }) });
      if (!res.ok) { toast({ title: "Failed to add scene", description: "Server error " + res.status, variant: "destructive" }); return; }
      const data = await res.json();
      if (data.success) { setNewScenePrompt(""); refreshProject(); toast({ title: "Scene added" }); }
      else { toast({ title: "Failed to add scene", description: data.error || "Unknown error", variant: "destructive" }); }
    } catch (err) { toast({ title: "Failed to add scene", description: err instanceof Error ? err.message : "Network error", variant: "destructive" }); }
  };

  const refreshProject = async () => {
    if (!currentProject) return;
    const r = await fetch(`/api/projects/${currentProject.id}`);
    const d = await r.json();
    if (d.success) setCurrentProject(d.project);
    fetchProjects();
  };

  const deleteScene = async (sceneId: string) => {
    if (!currentProject) return;
    try {
      const res = await fetch(`/api/projects/${currentProject.id}/scenes/${sceneId}`, { method: "DELETE" });
      if (res.ok) { refreshProject(); toast({ title: "Scene removed" }); }
      else { toast({ title: "Failed to remove scene", variant: "destructive" }); }
    } catch { toast({ title: "Failed to remove scene", variant: "destructive" }); }
  };

  const deleteProject = async (id: string) => {
    try {
      const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
      if (!res.ok) { toast({ title: "Failed to delete project", variant: "destructive" }); return; }
      fetchProjects();
      if (currentProject?.id === id) { setCurrentProject(null); setCurrentView("home"); }
      toast({ title: "Project deleted" });
    } catch { toast({ title: "Failed to delete project", variant: "destructive" }); }
  };

  const generateVideo = async () => {
    if (!currentProject || currentProject.scenes.length === 0) {
      toast({ title: "No scenes to generate", description: "Add at least one scene first", variant: "destructive" });
      return;
    }
    setIsGenerating(true);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000); // 2min timeout
    try {
      const res = await fetch("/api/generate-video", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: currentProject.id }), signal: controller.signal });
      if (!res.ok) { toast({ title: "Generation failed", description: "Server error (" + res.status + "). Try again.", variant: "destructive" }); return; }
      const data = await res.json();
      if (data.success) { refreshProject(); toast({ title: "Generation complete!", description: data.message }); }
      else { toast({ title: "Generation failed", description: data.error || "Unknown error", variant: "destructive" }); }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") { toast({ title: "Generation timed out", description: "The request took too long. Try generating individual scenes instead.", variant: "destructive" }); }
      else { toast({ title: "Generation failed", description: err instanceof Error ? err.message : "Network error. Check your connection.", variant: "destructive" }); }
    } finally { clearTimeout(timeoutId); setIsGenerating(false); }
  };

  const generateSceneImage = async (sceneId: string, prompt: string) => {
    if (!currentProject) return;
    try {
      // Mark as generating in the UI immediately
      setCurrentProject({ ...currentProject, scenes: currentProject.scenes.map(s => s.id === sceneId ? { ...s, status: "generating" } : s) });
      const res = await fetch("/api/generate-scene", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt }) });
      if (!res.ok) {
        toast({ title: "Scene generation failed", description: "Server error (" + res.status + "). Try again.", variant: "destructive" });
        refreshProject();
        return;
      }
      const data = await res.json();
      if (data.success && currentProject) {
        const updateRes = await fetch(`/api/projects/${currentProject.id}/scenes/${sceneId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ imageUrl: data.imageUrl, status: "completed" }) });
        if (updateRes.ok) { refreshProject(); toast({ title: "Scene generated!" }); }
        else { toast({ title: "Scene saved but update failed", variant: "destructive" }); refreshProject(); }
      } else {
        toast({ title: "Scene generation failed", description: data.error || "AI service unavailable. Try again.", variant: "destructive" });
        refreshProject();
      }
    } catch (err) {
      toast({ title: "Scene generation failed", description: err instanceof Error ? err.message : "Network error. Check your connection.", variant: "destructive" });
      refreshProject();
    }
  };

  const handleSelectClassicScene = (scene: ClassicScene) => {
    setTextPrompt(scene.prompt); setInputMode("text"); setCreateDialogOpen(true); setProjectTitle(scene.title);
  };

  const copyText = (text: string) => { navigator.clipboard.writeText(text); toast({ title: "Copied!" }); };

  const filteredScenes = CLASSIC_SCENES.filter((s) => sceneFilter === "all" || s.category === sceneFilter);

  // ─── RENDER ──────────────────────────────────────────────
  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* ── Header ── */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-lg">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
          <button onClick={() => { if (currentView === "studio") { setCurrentView("home"); setCurrentProject(null); } else setCurrentView("home"); }} className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            {currentView === "studio" && <ArrowLeft className="h-4 w-4" />}
            <Clapperboard className="h-5 w-5 text-primary" />
            <span className="font-bold text-lg tracking-tight">SceneForge<span className="text-muted-foreground font-normal text-sm ml-1">AI</span></span>
          </button>
          <nav className="flex items-center gap-1">
            {[["home","LayoutGrid","Home"],["create","Plus","Create"],["gallery","Film","Gallery"]].map(([v,Icon,l]) => (
              <Button key={v as string} variant={currentView === v ? "default" : "ghost"} size="sm" onClick={() => setCurrentView(v as typeof currentView)} className="rounded-lg">
                {v === "home" && <LayoutGrid className="h-4 w-4 mr-1.5" />}
                {v === "create" && <Plus className="h-4 w-4 mr-1.5" />}
                {v === "gallery" && <Film className="h-4 w-4 mr-1.5" />}
                <span className="hidden sm:inline">{l as string}</span>
              </Button>
            ))}
            {projects.length > 0 && (
              <Sheet>
                <SheetTrigger asChild>
                  <Button variant="outline" size="icon" className="ml-1 rounded-lg"><Layers className="h-4 w-4" /></Button>
                </SheetTrigger>
                <SheetContent><SheetHeader><SheetTitle>My Projects</SheetTitle></SheetHeader>
                  <ScrollArea className="h-[calc(100vh-100px)] mt-4"><div className="space-y-2 pr-3">
                    {projects.map((p) => (
                      <Card key={p.id} className="cursor-pointer hover:bg-accent/50 transition-colors" onClick={() => { setCurrentProject(p); setCurrentView("studio"); }}>
                        <CardContent className="p-3"><div className="flex items-center justify-between"><div className="min-w-0"><p className="font-medium text-sm truncate">{p.title}</p><p className="text-xs text-muted-foreground">{p.scenes.length} scenes · {p.style}</p></div><Badge variant={p.status === "completed" ? "default" : "outline"} className="ml-2 shrink-0 text-xs">{p.status}</Badge></div></CardContent>
                      </Card>))}
                  </div></ScrollArea>
                </SheetContent>
              </Sheet>)}
          </nav>
        </div>
      </header>

      {/* ── Main ── */}
      <main className="flex-1">
        <AnimatePresence mode="wait">

          {/* ═══ HOME ═══ */}
          {currentView === "home" && (
            <motion.div key="home" {...fadeUp} className="max-w-7xl mx-auto px-4 py-6 space-y-8">
              {/* Hero */}
              <section className="relative overflow-hidden rounded-2xl">
                <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: "url('/images/hero-bg.png')" }} />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/20" />
                <div className="relative z-10 px-6 py-12 sm:py-16 md:py-20 flex flex-col items-start justify-end min-h-[280px] sm:min-h-[340px]">
                  <Badge className="mb-3 bg-white/15 text-white border-white/20 backdrop-blur-sm"><Sparkles className="h-3 w-3 mr-1" />AI-Powered Video Creation</Badge>
                  <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold text-white leading-tight max-w-2xl">Create Stunning<br /><span className="text-amber-400">Cinematic Scenes</span></h1>
                  <p className="mt-3 text-white/80 text-sm sm:text-base max-w-lg">Transform your ideas into professional video scenes using text, voice, or video uploads. Powered by AI.</p>
                  <div className="flex flex-wrap gap-3 mt-6">
                    <Button size="lg" className="bg-white text-black hover:bg-white/90 rounded-xl" onClick={() => setCurrentView("create")}><Play className="h-4 w-4 mr-2" />Start Creating</Button>
                    <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10 rounded-xl" onClick={() => setCurrentView("gallery")}><ImageIcon className="h-4 w-4 mr-2" />Browse Scenes</Button>
                  </div>
                </div>
              </section>

              {/* Quick Actions */}
              <section><h2 className="text-xl font-bold mb-4">Quick Create</h2>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {[[Wand2, "Text to Scene", "Describe your vision"], [Mic, "Voice to Scene", "Speak your idea aloud"], [Upload, "Video to Scene", "Upload & recreate"]].map(([Icon, title, desc], i) => (
                    <Card key={i} className="cursor-pointer hover:shadow-lg hover:border-primary/30 transition-all group" onClick={() => { setCurrentView("create"); if (i === 1) setTimeout(() => setInputMode("voice"), 100); if (i === 2) setTimeout(() => setInputMode("video"), 100); }}>
                      <CardContent className="p-5 flex items-center gap-4">
                        <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/20 transition-colors">{Icon && <Icon className="h-6 w-6 text-primary" />}</div>
                        <div><p className="font-semibold">{title as string}</p><p className="text-sm text-muted-foreground">{desc as string}</p></div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </section>

              {/* Recent */}
              {projects.length > 0 && (
                <section>
                  <div className="flex items-center justify-between mb-4"><h2 className="text-xl font-bold">Recent Projects</h2><Button variant="ghost" size="sm" onClick={() => setCurrentView("gallery")}>View All <ChevronRight className="h-4 w-4 ml-1" /></Button></div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {projects.slice(0, 3).map((p) => (
                      <Card key={p.id} className="cursor-pointer hover:shadow-lg transition-all overflow-hidden group" onClick={() => { setCurrentProject(p); setCurrentView("studio"); }}>
                        {p.scenes[0]?.imageUrl && <div className="aspect-video overflow-hidden"><img src={p.scenes[0].imageUrl} alt={p.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" /></div>}
                        <CardHeader className="pb-2"><div className="flex items-center justify-between"><CardTitle className="text-base truncate">{p.title}</CardTitle><Badge variant="outline" className="text-xs shrink-0">{p.style}</Badge></div><CardDescription className="text-xs">{p.scenes.length} scene{p.scenes.length !== 1 ? "s" : ""} · {p.aspectRatio}</CardDescription></CardHeader>
                      </Card>
                    ))}
                  </div>
                </section>)}
            </motion.div>)}

          {/* ═══ CREATE ═══ */}
          {currentView === "create" && (
            <motion.div key="create" {...fadeUp} className="max-w-4xl mx-auto px-4 py-6 space-y-6">
              <div><h2 className="text-2xl font-bold">Create New Scene</h2><p className="text-muted-foreground mt-1">Describe your vision, speak it aloud, or upload a video to recreate</p></div>

              {/* Input Mode Tabs */}
              <Tabs value={inputMode} onValueChange={(v) => setInputMode(v as InputMode)}>
                <TabsList className="grid w-full grid-cols-3"><TabsTrigger value="text" className="gap-1.5"><Wand2 className="h-4 w-4" />Text</TabsTrigger><TabsTrigger value="voice" className="gap-1.5"><Mic className="h-4 w-4" />Voice</TabsTrigger><TabsTrigger value="video" className="gap-1.5"><Upload className="h-4 w-4" />Video</TabsTrigger></TabsList>

                <TabsContent value="text" className="space-y-4 mt-4">
                  <Textarea placeholder="Describe your cinematic scene in detail... e.g., 'A lone astronaut standing on the edge of a crater, looking at Earth rising over the lunar horizon, golden hour lighting, 2001 Space Odyssey style'" className="min-h-[120px] resize-y text-base" value={textPrompt} onChange={(e) => setTextPrompt(e.target.value)} />
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={enhancePrompt} disabled={isEnhancing || !textPrompt.trim()}>{isEnhancing ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1.5" />}{isEnhancing ? "Enhancing..." : "Enhance with AI"}</Button>
                    {textPrompt && <Button variant="ghost" size="sm" onClick={() => copyText(textPrompt)}><Copy className="h-4 w-4 mr-1.5" />Copy</Button>}
                  </div>
                  {enhancedText && (<Card className="border-primary/30 bg-primary/5"><CardContent className="p-4"><div className="flex items-start justify-between gap-2"><div><p className="text-xs font-medium text-primary mb-1"><Sparkles className="h-3 w-3 inline mr-1" />Enhanced Prompt</p><p className="text-sm">{enhancedText}</p></div><Button variant="ghost" size="icon" className="shrink-0 h-8 w-8" onClick={() => setEnhancedText("")}><X className="h-4 w-4" /></Button></div></CardContent></Card>)}
                </TabsContent>

                <TabsContent value="voice" className="space-y-4 mt-4">
                  <Card className="border-dashed"><CardContent className="p-8 flex flex-col items-center gap-4">
                    {isRecording ? (<><div className="h-16 w-16 rounded-full bg-red-500/20 flex items-center justify-center animate-pulse"><MicOff className="h-8 w-8 text-red-500" /></div><p className="text-sm font-medium">Recording... Tap to stop</p><Button variant="destructive" onClick={stopRecording}><MicOff className="h-4 w-4 mr-2" />Stop Recording</Button></>
                    ) : (<><div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center"><Volume2 className="h-8 w-8 text-primary" /></div><p className="text-sm text-muted-foreground">Tap to start recording your scene description</p><Button onClick={startRecording}><Mic className="h-4 w-4 mr-2" />Start Recording</Button></>)}
                  </CardContent></Card>
                  {textPrompt && (<Card><CardContent className="p-4"><p className="text-xs font-medium mb-1">Transcription</p><p className="text-sm">{textPrompt}</p></CardContent></Card>)}
                </TabsContent>

                <TabsContent value="video" className="space-y-4 mt-4">
                  <input ref={videoInputRef} type="file" accept="video/*" className="hidden" onChange={handleVideoUpload} />
                  {!videoPreview ? (<Card className="border-dashed cursor-pointer" onClick={() => videoInputRef.current?.click()}><CardContent className="p-8 flex flex-col items-center gap-4"><Upload className="h-12 w-12 text-muted-foreground" /><div className="text-center"><p className="font-medium">Upload a Video</p><p className="text-sm text-muted-foreground">We&apos;ll analyze it and generate a similar scene</p></div><Button variant="outline"><Upload className="h-4 w-4 mr-2" />Choose File</Button></CardContent></Card>
                  ) : (<Card className="overflow-hidden"><div className="aspect-video bg-black"><video src={videoPreview} controls className="w-full h-full object-contain" /></div><CardContent className="p-4"><div className="flex items-center justify-between"><p className="text-sm font-medium truncate">{videoFile?.name}</p><div className="flex gap-2"><Button variant="ghost" size="sm" onClick={() => { setVideoFile(null); setVideoPreview(null); }}><X className="h-4 w-4 mr-1" />Remove</Button><Button size="sm" onClick={analyzeUploadedVideo}><Sparkles className="h-4 w-4 mr-1.5" />Analyze</Button></div></div></CardContent></Card>)}
                </TabsContent>
              </Tabs>

              <Separator />

              {/* Settings */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-2"><Label>Visual Style</Label><Select value={selectedStyle} onValueChange={setSelectedStyle}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{STYLES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-2"><Label>Aspect Ratio</Label><Select value={selectedAspect} onValueChange={setSelectedAspect}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{ASPECTS.map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-2"><Label>Project Title</Label><Input placeholder="My Video Project" value={projectTitle} onChange={(e) => setProjectTitle(e.target.value)} /></div>
              </div>

              {/* Create Button */}
              <div className="flex justify-end"><Button size="lg" className="rounded-xl" disabled={!textPrompt.trim()} onClick={() => createProject(textPrompt, projectTitle || undefined)}><Sparkles className="h-5 w-5 mr-2" />Create Scene</Button></div>
            </motion.div>)}

          {/* ═══ GALLERY ═══ */}
          {currentView === "gallery" && (
            <motion.div key="gallery" {...fadeUp} className="max-w-7xl mx-auto px-4 py-6 space-y-6">
              <div><h2 className="text-2xl font-bold">Scene Gallery</h2><p className="text-muted-foreground mt-1">Browse classic cinematic scenes to use as inspiration or starting points</p></div>
              <div className="flex gap-2 flex-wrap">
                {["all","nature","sci-fi","fantasy","classic"].map((f) => (<Button key={f} variant={sceneFilter === f ? "default" : "outline"} size="sm" onClick={() => setSceneFilter(f)} className="rounded-full capitalize">{f}</Button>))}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {filteredScenes.map((scene) => (
                  <Card key={scene.id} className="overflow-hidden group cursor-pointer hover:shadow-xl transition-all duration-300">
                    <div className="aspect-video relative overflow-hidden bg-muted">
                      {scene.image ? (<img src={scene.image} alt={scene.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />) : (<div className="w-full h-full bg-gradient-to-br from-purple-900/40 via-slate-900/60 to-cyan-900/40 flex items-center justify-center"><Film className="h-12 w-12 text-white/30" /></div>)}
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100"><Button className="rounded-full" onClick={() => handleSelectClassicScene(scene)}><Play className="h-5 w-5 mr-2" />Use This Scene</Button></div>
                      <Badge className="absolute top-3 left-3 capitalize text-xs">{scene.category}</Badge>
                    </div>
                    <CardContent className="p-4"><h3 className="font-semibold">{scene.title}</h3><p className="text-sm text-muted-foreground mt-1 line-clamp-2">{scene.description}</p><div className="flex items-center gap-2 mt-3"><Button variant="outline" size="sm" className="flex-1" onClick={() => handleSelectClassicScene(scene)}><Sparkles className="h-3.5 w-3.5 mr-1.5" />Use</Button><Button variant="ghost" size="sm" onClick={() => copyText(scene.prompt)}><Copy className="h-3.5 w-3.5" /></Button></div></CardContent>
                  </Card>))}
              </div>
            </motion.div>)}

          {/* ═══ STUDIO ═══ */}
          {currentView === "studio" && currentProject && (
            <motion.div key="studio" {...fadeUp} className="max-w-7xl mx-auto px-4 py-6 space-y-6">
              {/* Project Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div><h2 className="text-2xl font-bold">{currentProject.title}</h2><p className="text-muted-foreground text-sm mt-0.5">{currentProject.scenes.length} scene{currentProject.scenes.length !== 1 ? "s" : ""} · {currentProject.style} · {currentProject.aspectRatio}</p></div>
                <div className="flex items-center gap-2">
                  <Badge variant={currentProject.status === "completed" ? "default" : currentProject.status === "generating" ? "secondary" : "outline"}>{currentProject.status}</Badge>
                  <Button onClick={generateVideo} disabled={isGenerating || currentProject.scenes.length === 0}>{isGenerating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}{isGenerating ? "Generating..." : "Generate All Scenes"}</Button>
                </div>
              </div>

              {/* Preview Area */}
              {currentProject.scenes.some((s) => s.imageUrl) && (
                <Card className="overflow-hidden"><div className="aspect-video bg-black relative"><img src={currentProject.scenes.find((s) => s.imageUrl)?.imageUrl || ""} alt="Preview" className="w-full h-full object-contain" /><div className="absolute bottom-3 left-3 right-3 flex items-center gap-2"><Badge variant="secondary" className="bg-black/60 text-white border-0 backdrop-blur-sm">Scene 1 of {currentProject.scenes.length}</Badge><div className="ml-auto flex gap-1">{currentProject.scenes.map((s, i) => (<button key={s.id} onClick={() => s.imageUrl && setPreviewImage(s.imageUrl)} className={`h-8 w-12 rounded overflow-hidden border-2 ${s.imageUrl ? (previewImage === s.imageUrl ? "border-white" : "border-white/30") : "border-transparent"}`}><div className="w-full h-full bg-muted" />{s.imageUrl && <img src={s.imageUrl} alt={"Scene thumbnail"} className="w-full h-full object-cover" />}</button>))}</div></div></div></Card>
              )}

              {/* Add Scene */}
              <Card><CardHeader className="pb-3"><CardTitle className="text-lg">Add New Scene</CardTitle></CardHeader><CardContent className="space-y-3">
                <div className="flex gap-3"><Textarea placeholder="Describe the next scene..." className="min-h-[80px] flex-1" value={newScenePrompt} onChange={(e) => setNewScenePrompt(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && e.metaKey) addScene(); }} /><Button className="self-end shrink-0" disabled={!newScenePrompt.trim()} onClick={addScene}><Plus className="h-4 w-4 mr-1.5" />Add</Button></div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="space-y-1"><Label className="text-xs">Duration (s)</Label><Select value={newSceneDuration} onValueChange={setNewSceneDuration}><SelectTrigger className="h-9"><SelectValue /></SelectTrigger><SelectContent>{["1","2","3","4","5"].map((d) => <SelectItem key={d} value={d}>{d}s</SelectItem>)}</SelectContent></Select></div>
                  <div className="space-y-1"><Label className="text-xs">Transition</Label><Select value={newSceneTransition} onValueChange={setNewSceneTransition}><SelectTrigger className="h-9"><SelectValue /></SelectTrigger><SelectContent>{TRANSITIONS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent></Select></div>
                </div>
              </CardContent></Card>

              {/* Scenes List */}
              <div><h3 className="text-lg font-semibold mb-3">Scenes ({currentProject.scenes.length})</h3>
                {currentProject.scenes.length === 0 ? (<Card className="border-dashed"><CardContent className="p-8 text-center"><Film className="h-10 w-10 mx-auto text-muted-foreground/40" /><p className="text-muted-foreground mt-3">No scenes yet. Add your first scene above.</p></CardContent></Card>
                ) : (<div className="space-y-3">
                  {currentProject.scenes.map((scene) => (
                    <Card key={scene.id} className="overflow-hidden"><div className="flex flex-col sm:flex-row">
                      <div className="sm:w-48 aspect-video sm:aspect-auto bg-muted relative shrink-0">{scene.imageUrl ? (<img src={scene.imageUrl} alt={`Scene ${scene.sceneNumber}`} className="w-full h-full object-cover" />) : (<div className="w-full h-full flex items-center justify-center"><ImageIcon className="h-8 w-8 text-muted-foreground/40" /></div>)}<Badge className="absolute top-2 left-2 text-xs">#{scene.sceneNumber}</Badge></div>
                      <CardContent className="p-4 flex-1 min-w-0"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="text-sm line-clamp-2">{scene.enhancedPrompt || scene.prompt}</p><div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground"><span className="flex items-center gap-1"><Clock className="h-3 w-3" />{scene.duration}s</span><Badge variant="outline" className="text-xs capitalize">{scene.transition}</Badge><Badge variant={scene.status === "completed" ? "default" : "outline"} className="text-xs capitalize">{scene.status}</Badge></div></div><div className="flex items-center gap-1 shrink-0"><Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => generateSceneImage(scene.id, scene.enhancedPrompt || scene.prompt)} disabled={scene.status === "generating"}><Eye className="h-4 w-4" /></Button><Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => deleteScene(scene.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button></div></div></CardContent>
                    </div></Card>))}
                </div>)}
              </div>

              {/* Project Actions */}
              <div className="flex items-center justify-between pt-4 border-t"><Button variant="outline" onClick={() => deleteProject(currentProject.id)} className="text-destructive hover:text-destructive"><Trash2 className="h-4 w-4 mr-2" />Delete Project</Button></div>
            </motion.div>)}
        </AnimatePresence>
      </main>

      {/* ── Create Dialog (for classic scenes) ── */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>Create from Template</DialogTitle><DialogDescription>Customize and create a new project from this classic scene</DialogDescription></DialogHeader>
        <div className="space-y-4 py-2"><div className="space-y-2"><Label>Title</Label><Input value={projectTitle} onChange={(e) => setProjectTitle(e.target.value)} /></div><div className="space-y-2"><Label>Prompt</Label><Textarea className="min-h-[100px]" value={textPrompt} onChange={(e) => setTextPrompt(e.target.value)} /></div><div className="grid grid-cols-2 gap-3"><div className="space-y-2"><Label>Style</Label><Select value={selectedStyle} onValueChange={setSelectedStyle}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{STYLES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label>Aspect Ratio</Label><Select value={selectedAspect} onValueChange={setSelectedAspect}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{ASPECTS.map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}</SelectContent></Select></div></div></div>
        <DialogFooter><Button variant="outline" onClick={() => setCreateDialogOpen(false)}>Cancel</Button><Button onClick={() => createProject(textPrompt, projectTitle || undefined)}><Sparkles className="h-4 w-4 mr-2" />Create</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Image Preview Dialog ── */}
      <Dialog open={!!previewImage} onOpenChange={() => setPreviewImage(null)}>
        <DialogContent className="sm:max-w-4xl p-0 overflow-hidden"><div className="aspect-video bg-black"><img src={previewImage || ""} alt="Preview" className="w-full h-full object-contain" /></div></DialogContent>
      </Dialog>

      {/* ── Footer ── */}
      <footer className="border-t border-border bg-background mt-auto">
        <div className="max-w-7xl mx-auto px-4 py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
          <p>SceneForge AI — Professional AI Video Scene Creator</p>
          <p>Powered by AI · Create cinematic magic in seconds</p>
        </div>
      </footer>
    </div>
  );
}