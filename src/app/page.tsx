"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAppStore } from "@/store/useAppStore";
import { useToast } from "@/hooks/use-toast";
import type { VideoProject, VideoScene, ClassicScene, InputMode, Character, ParsedSceneResult, DetectedCharacter } from "@/types/video";
import {
  Film, Mic, MicOff, Upload, Sparkles, Play, Plus, Trash2,
  ChevronRight, Wand2, ArrowLeft, ImageIcon, LayoutGrid, Loader2,
  X, Download, Layers, Palette, Clapperboard,
  Copy, Eye, Volume2, Clock, Video, RefreshCw, Zap, Timer, Monitor,
  Smartphone, RectangleHorizontal, Square, Tv,
  Users, UserPlus, UploadCloud, FileText, MessageSquare,
  Crown, Star, Heart, Briefcase, PartyPopper, Camera,
  GripVertical, Quote, ArrowDownToLine, Music,
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
import { Switch } from "@/components/ui/switch";
import DeviceSimulator from "@/components/DeviceSimulator";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// ── Data ──
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
  { value: "fade", label: "Fade" }, { value: "dissolve", label: "Dissolve" },
  { value: "wipe", label: "Wipe" }, { value: "slide", label: "Slide" },
  { value: "cut", label: "Hard Cut" },
];

const DURATION_PRESETS = [
  { value: 10, label: "10s" }, { value: 30, label: "30s" },
  { value: 60, label: "1 min" }, { value: 120, label: "2 min" },
  { value: 180, label: "3 min" }, { value: 300, label: "5 min" },
];

const EXPORT_QUALITY = [
  { value: "draft", label: "720p Draft", desc: "Fast encode, smaller file" },
  { value: "standard", label: "1080p Standard", desc: "Balanced quality" },
  { value: "high", label: "1080p High", desc: "Slower, higher quality" },
  { value: "ultra", label: "4K Ultra", desc: "Maximum quality" },
];

const PROJECT_TEMPLATES = [
  { id: "birthday", label: "Birthday Video", icon: PartyPopper, color: "from-pink-500 to-rose-500", desc: "Personalized birthday stories with characters" },
  { id: "commercial", label: "Commercial / Ad", icon: Briefcase, color: "from-amber-500 to-orange-500", desc: "Professional product and brand commercials" },
  { id: "event", label: "Event / Promo", icon: Camera, color: "from-violet-500 to-purple-500", desc: "Event promotion, publicity, announcements" },
  { id: "custom", label: "Custom / Creative", icon: Star, color: "from-teal-500 to-emerald-500", desc: "Full creative control for any concept" },
];

const FEATURES = [
  { icon: FileText, title: "AI Script Analysis", desc: "Paste any script and AI automatically identifies scenes, characters, and dialogue", color: "from-violet-500 to-purple-500" },
  { icon: Users, title: "Character System", desc: "Upload character images or generate them with AI for consistent animation", color: "from-fuchsia-500 to-pink-500" },
  { icon: Crown, title: "Brand Recognition", desc: "Recognizes 25+ popular characters (PAW Patrol, Bluey, Spider-Man) with accurate designs", color: "from-amber-500 to-orange-500" },
  { icon: Layers, title: "Drag & Drop Editing", desc: "Reorder scenes intuitively with drag and drop timeline editing", color: "from-teal-500 to-emerald-500" },
  { icon: Download, title: "Professional Export", desc: "Export in 720p to 4K with custom transitions and title cards", color: "from-rose-500 to-red-500" },
  { icon: Volume2, title: "Voice Narration", desc: "AI-generated narration for scene dialogue with natural voices", color: "from-cyan-500 to-sky-500" },
];

const STEPS = [
  { num: "1", title: "Write or Upload", desc: "Paste your script, upload an image, or record your voice", icon: UploadCloud },
  { num: "2", title: "AI Creates Scenes", desc: "AI identifies scenes, generates characters, and creates thumbnails", icon: Sparkles },
  { num: "3", title: "Export Video", desc: "Generate production-ready videos with transitions and narration", icon: ArrowDownToLine },
];

const TESTIMONIALS = [
  { name: "Sarah M.", role: "Content Creator", text: "Vidora saved us hours on birthday videos. The character recognition is incredible!", avatar: "SM" },
  { name: "David K.", role: "Marketing Director", text: "Professional quality commercials in minutes. The AI scene detection is spot-on.", avatar: "DK" },
  { name: "Maria L.", role: "Video Producer", text: "The drag-and-drop editor makes it so easy to rearrange scenes. Love the export options!", avatar: "ML" },
];

const fadeUp = {
  initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -10 }, transition: { duration: 0.35 },
};
const stagger = { animate: { transition: { staggerChildren: 0.08 } } };
const fadeItem = { initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 } };

// ─── Sortable Scene Card ─────────────────────────────────
function SortableSceneCard({ scene, sceneIndex, onPreview, onGenerate, onRetry, onDelete, onNarrate, onTransitionChange, isGeneratingNarration }: {
  scene: VideoScene; sceneIndex: number;
  onPreview: (url: string) => void;
  onGenerate: (id: string, prompt: string) => void;
  onRetry: (scene: VideoScene) => void;
  onDelete: (id: string, label: string) => void;
  onNarrate: (id: string) => void;
  onTransitionChange: (id: string, transition: string) => void;
  isGeneratingNarration: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition: dndTransition, isDragging } = useSortable({ id: scene.id });
  const style = { transform: CSS.Transform.toString(transform), transition: dndTransition, zIndex: isDragging ? 50 : undefined, opacity: isDragging ? 0.5 : 1 };

  const statusColor = scene.status === "completed" ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : scene.status === "generating" ? "bg-violet-50 text-violet-700 border-violet-200"
    : scene.status === "failed" ? "bg-red-50 text-red-700 border-red-200"
    : "bg-slate-50 text-slate-600 border-slate-200";

  return (
    <div ref={setNodeRef} style={style} className="group relative">
      <Card className="card-glow bg-white border-0 shadow-md shadow-black/5 overflow-hidden">
        <div className="flex">
          {/* Drag Handle */}
          <div className="flex items-center px-2 bg-slate-50 border-r border-slate-100 cursor-grab active:cursor-grabbing" {...attributes} {...listeners}>
            <GripVertical className="h-4 w-4 text-slate-300" />
          </div>
          {/* Thumbnail */}
          <div className="relative w-24 sm:w-32 shrink-0 bg-slate-100">
            {scene.imageUrl ? (
              <>
                <img src={scene.imageUrl} alt="" className="w-full h-full object-cover" />
                {scene.videoUrl && (
                  <button onClick={() => onPreview(scene.videoUrl!)} className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Play className="h-6 w-6 text-white" />
                  </button>
                )}
              </>
            ) : (
              <div className="w-full h-full flex items-center justify-center"><Film className="h-6 w-6 text-slate-300" /></div>
            )}
            <Badge className="absolute top-1 left-1 text-[9px] font-bold px-1.5 bg-black/60 text-white border-0">#{scene.sceneNumber}</Badge>
            <Badge className={`absolute top-1 right-1 text-[9px] font-semibold px-1.5 ${statusColor}`}>{scene.status}</Badge>
          </div>
          {/* Content */}
          <div className="flex-1 p-3 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap mb-1">
              {scene.title && <span className="text-xs font-bold truncate">{scene.title}</span>}
              {scene.dialogue && <Badge variant="outline" className="text-[9px] px-1 py-0"><MessageSquare className="h-2.5 w-2.5 mr-0.5" />Dialogue</Badge>}
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2">{scene.prompt}</p>
            {scene.dialogue && <p className="text-[10px] text-violet-500 mt-1 italic line-clamp-1">{scene.dialogue}</p>}
            {/* Narration audio player */}
            {scene.narrationUrl && (
              <div className="mt-1.5 flex items-center gap-1.5">
                <Volume2 className="h-3 w-3 text-emerald-500 shrink-0" />
                <audio controls src={scene.narrationUrl} className="h-6 w-full max-w-[180px]" preload="none" />
              </div>
            )}
            {/* Actions */}
            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
              {!scene.videoUrl && scene.status !== "generating" && (
                <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={() => onGenerate(scene.id, scene.enhancedPrompt || scene.prompt)}>
                  {scene.status === "generating" ? <Loader2 className="h-3 w-3 animate-spin mr-0.5" /> : <Play className="h-3 w-3 mr-0.5" />}Generate
                </Button>
              )}
              {scene.status === "failed" && (
                <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={() => onRetry(scene)}>
                  <RefreshCw className="h-3 w-3 mr-0.5" />Retry
                </Button>
              )}
              {scene.dialogue && !scene.narrationUrl && (
                <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={() => onNarrate(scene.id)} disabled={isGeneratingNarration}>
                  {isGeneratingNarration ? <Loader2 className="h-3 w-3 animate-spin mr-0.5" /> : <Volume2 className="h-3 w-3 mr-0.5" />}
                  {isGeneratingNarration ? "Generating..." : "Narrate"}
                </Button>
              )}
              <Select value={scene.transition} onValueChange={(v) => onTransitionChange(scene.id, v)}>
                <SelectTrigger className="h-6 w-20 text-[10px] px-1"><SelectValue /></SelectTrigger>
                <SelectContent>{TRANSITIONS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
              <Button size="sm" variant="ghost" className="h-6 text-[10px] px-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 ml-auto" onClick={() => onDelete(scene.id, "Scene " + scene.sceneNumber)}>
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────
export default function HomePage() {
  const { currentView, projects, currentProject, isGenerating, isEnhancing, isRecording,
    setCurrentView, setProjects, setCurrentProject, setIsGenerating, setIsEnhancing, setIsRecording } = useAppStore();
  const { toast } = useToast();

  // ── Form State ──
  const [inputMode, setInputMode] = useState<InputMode>("text");
  const [scriptText, setScriptText] = useState("");
  const [textPrompt, setTextPrompt] = useState("");
  const [enhancedText, setEnhancedText] = useState("");
  const [selectedStyle, setSelectedStyle] = useState("cinematic");
  const [selectedAspect, setSelectedAspect] = useState("16:9");
  const [selectedDuration, setSelectedDuration] = useState(60);
  const [customDuration, setCustomDuration] = useState("");
  const [isCustomDuration, setIsCustomDuration] = useState(false);
  const [projectTitle, setProjectTitle] = useState("");
  const [projectType, setProjectType] = useState("custom");
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
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [pendingDeleteAction, setPendingDeleteAction] = useState<{ type: "scene" | "project" | "character"; id: string; label: string } | null>(null);

  // ── Export State ──
  const [exportQuality, setExportQuality] = useState("standard");
  const [exportTransition, setExportTransition] = useState("fade");
  const [exportFormat, setExportFormat] = useState("mp4");
  const [exportTitleCard, setExportTitleCard] = useState(true);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);

  // ── Narration State ──
  const [generatingNarration, setGeneratingNarration] = useState<Set<string>>(new Set());

  // ── Characters State ──
  const [characters, setCharacters] = useState<Character[]>([]);
  const [newCharName, setNewCharName] = useState("");
  const [newCharRole, setNewCharRole] = useState("supporting");
  const [newCharDesc, setNewCharDesc] = useState("");
  const [charUploadInput, setCharUploadInput] = useState<HTMLInputElement | null>(null);
  const [charUploadTarget, setCharUploadTarget] = useState<string | null>(null);
  const [generatingCharImage, setGeneratingCharImage] = useState<string | null>(null);

  // ── Parsed Scenes State ──
  const [parsedScenes, setParsedScenes] = useState<ParsedSceneResult[]>([]);
  const [parsedCharacters, setParsedCharacters] = useState<DetectedCharacter[]>([]);
  const [isParsingScript, setIsParsingScript] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const autoGenTriggeredRef = useRef<Set<string>>(new Set());
  const projectPollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const prevSceneStatesRef = useRef<Map<string, string>>(new Map());

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const effectiveDuration = isCustomDuration
    ? Math.max(10, Math.min(300, parseInt(customDuration) || 60))
    : selectedDuration;
  const effectiveSceneCount = Math.ceil(effectiveDuration / 10);

  // ── Load characters when project changes ──
  useEffect(() => {
    if (currentView === "studio" && currentProject?.id) { fetchCharacters(currentProject.id); }
    else { setCharacters([]); }
  }, [currentView, currentProject?.id]);

  const fetchCharacters = async (projectId: string) => {
    try {
      const res = await fetch(`/api/projects/${projectId}/characters`);
      if (res.ok) { const data = await res.json(); if (data.success && Array.isArray(data.characters)) setCharacters(data.characters); }
    } catch { /* ignore */ }
  };

  // ── Auto-generate on studio load ──
  useEffect(() => {
    if (currentView !== "studio" || !currentProject?.scenes?.length || isGenerating) return;
    if (autoGenTriggeredRef.current.has(currentProject.id)) return;
    const hasPending = currentProject.scenes.some((s) => !s.videoUrl && s.status === "pending");
    if (hasPending) { autoGenTriggeredRef.current.add(currentProject.id); setTimeout(() => generateVideo(currentProject), 600); }
  }, [currentView, currentProject?.id]);

  useEffect(() => { fetchProjects(); }, []);
  useEffect(() => { return () => { if (projectPollTimerRef.current) clearInterval(projectPollTimerRef.current); }; }, []);

  // ── Project-level polling ──
  useEffect(() => {
    if (!currentProject?.scenes) return;
    const hasGenerating = currentProject.scenes.some((s) => s.status === "generating");
    if (hasGenerating) {
      if (projectPollTimerRef.current) clearInterval(projectPollTimerRef.current);
      projectPollTimerRef.current = setInterval(() => refreshProject(), 15000);
      setGeneratingScenes((prev) => { const next = new Set(prev); currentProject.scenes.forEach((s) => { if (s.status === "generating") next.add(s.id); }); return next; });
      const t = setTimeout(() => refreshProject(), 5000);
      return () => { clearTimeout(t); if (projectPollTimerRef.current) clearInterval(projectPollTimerRef.current); };
    } else {
      if (projectPollTimerRef.current) { clearInterval(projectPollTimerRef.current); projectPollTimerRef.current = null; }
      setGeneratingScenes(new Set());
    }
  }, [currentProject?.id, currentProject?.scenes?.map((s) => s.status).join(",")]);

  // ── Scene status change toasts ──
  useEffect(() => {
    if (!currentProject?.scenes) return;
    for (const scene of currentProject.scenes) {
      const prev = prevSceneStatesRef.current.get(scene.id);
      if (prev === "generating" && scene.status === "completed" && scene.videoUrl) { toast({ title: "Video ready!", description: "Scene " + scene.sceneNumber + " generated." }); }
      else if (prev === "generating" && scene.status === "failed") { toast({ title: "Scene " + scene.sceneNumber + " failed", description: "Try retrying.", variant: "destructive" }); }
      prevSceneStatesRef.current.set(scene.id, scene.status);
    }
  }, [currentProject?.scenes]);

  // ── Data fetching ──
  const fetchProjects = async () => {
    try { const res = await fetch("/api/projects"); if (!res.ok) return; const data = await res.json(); if (data.success && Array.isArray(data.projects)) setProjects(data.projects); } catch { /* ignore */ }
  };

  const refreshProject = async () => {
    if (!currentProject) return;
    try { const res = await fetch(`/api/projects/${currentProject.id}`); if (res.ok) { const data = await res.json(); if (data.success) { setCurrentProject(data.project); setProjects((prev) => (Array.isArray(prev) ? prev : []).map((p) => p.id === data.project.id ? data.project : p)); } } } catch { /* ignore */ }
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
        try { const res = await fetch("/api/transcribe", { method: "POST", body: formData }); const data = await res.json(); if (data.success && data.transcription) { setTextPrompt(data.transcription); toast({ title: "Transcribed!" }); } else toast({ title: "Transcription failed", variant: "destructive" }); } catch { toast({ title: "Transcription error", variant: "destructive" }); }
      };
      recorder.start(); mediaRecorderRef.current = recorder; setIsRecording(true);
    } catch { toast({ title: "Microphone denied", variant: "destructive" }); }
  };
  const stopRecording = () => { mediaRecorderRef.current?.stop(); };

  // ── Video upload ──
  const handleVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return; setVideoFile(file); setVideoPreview(URL.createObjectURL(file));
  };

  // ── Enhance prompt ──
  const enhancePrompt = async () => {
    if (!textPrompt.trim()) return;
    setIsEnhancing(true);
    try { const res = await fetch("/api/enhance-prompt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: textPrompt, style: selectedStyle }) }); const data = await res.json(); if (data.success) { setEnhancedText(data.enhancedPrompt); setTextPrompt(data.enhancedPrompt); toast({ title: "Prompt enhanced!" }); } else toast({ title: "Enhancement failed", variant: "destructive" }); } catch { toast({ title: "Enhancement error", variant: "destructive" }); }
    finally { setIsEnhancing(false); }
  };

  // ── Parse Script ──
  const parseScript = async () => {
    const text = scriptText.trim() || textPrompt.trim();
    if (!text) { toast({ title: "Enter a script or prompt first", variant: "destructive" }); return; }
    setIsParsingScript(true);
    try { const res = await fetch("/api/split-scenes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: text, targetDuration: effectiveDuration }) }); const data = await res.json(); if (data.success) { setParsedScenes(data.scenes || []); setParsedCharacters(data.characters || []); toast({ title: `Parsed ${data.scenes?.length || 0} scenes, detected ${data.characters?.length || 0} characters` }); } else toast({ title: "Failed to parse script", variant: "destructive" }); } catch { toast({ title: "Parse error", variant: "destructive" }); }
    finally { setIsParsingScript(false); }
  };

  // ── Generate Character Image ──
  const generateCharImage = async (charId: string) => {
    if (!currentProject) return; setGeneratingCharImage(charId);
    try { const res = await fetch(`/api/projects/${currentProject.id}/characters/${charId}/generate-image`, { method: "POST" }); const data = await res.json(); if (data.success) { setCharacters((prev) => prev.map((c) => c.id === charId ? data.character : c)); toast({ title: "Character image generated!" }); } else toast({ title: "Failed", variant: "destructive" }); } catch { toast({ title: "Error", variant: "destructive" }); }
    finally { setGeneratingCharImage(null); }
  };

  // ── Upload Character Image ──
  const uploadCharImage = async (e: React.ChangeEvent<HTMLInputElement>, charId: string) => {
    const file = e.target.files?.[0]; if (!file || !currentProject) return;
    const formData = new FormData(); formData.append("image", file); formData.append("characterId", charId);
    try { const res = await fetch(`/api/projects/${currentProject.id}/characters/upload`, { method: "POST", body: formData }); const data = await res.json(); if (data.success) { setCharacters((prev) => prev.map((c) => c.id === charId ? data.character : c)); toast({ title: "Character image uploaded!" }); } else toast({ title: "Upload failed", variant: "destructive" }); } catch { toast({ title: "Error", variant: "destructive" }); }
  };

  // ── Add Character ──
  const addCharacter = async () => {
    if (!currentProject || !newCharName.trim()) return;
    try { const res = await fetch(`/api/projects/${currentProject.id}/characters`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newCharName.trim(), role: newCharRole, description: newCharDesc || null }) }); const data = await res.json(); if (data.success) { setCharacters((prev) => [...prev, data.character]); setNewCharName(""); setNewCharDesc(""); toast({ title: "Character added" }); } } catch { toast({ title: "Failed", variant: "destructive" }); }
  };

  // ── Generate narration for scene ──
  const generateNarration = async (sceneId: string) => {
    if (!currentProject) return;
    setGeneratingNarration((prev) => new Set(prev).add(sceneId));
    try { const res = await fetch("/api/generate-narration", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: currentProject.id, sceneId }) }); const data = await res.json(); if (data.success) { toast({ title: "Narration generated!" }); setTimeout(() => refreshProject(), 1000); } else toast({ title: "Failed to generate narration", variant: "destructive" }); } catch { toast({ title: "Error", variant: "destructive" }); }
    finally { setGeneratingNarration((prev) => { const n = new Set(prev); n.delete(sceneId); return n; }); }
  };

  // ── Change scene transition ──
  const changeSceneTransition = async (sceneId: string, transition: string) => {
    if (!currentProject) return;
    try { await fetch(`/api/projects/${currentProject.id}/scenes/${sceneId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transition }) }); refreshProject(); } catch { /* ignore */ }
  };

  // ── Handle drag end ──
  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !currentProject) return;
    const scenes = currentProject.scenes;
    const oldIdx = scenes.findIndex((s) => s.id === active.id);
    const newIdx = scenes.findIndex((s) => s.id === over.id);
    if (oldIdx === -1 || newIdx === -1) return;
    const newOrder = [...scenes];
    const [moved] = newOrder.splice(oldIdx, 1);
    newOrder.splice(newIdx, 0, moved);
    const sceneIds = newOrder.map((s) => s.id);
    try {
      const res = await fetch(`/api/projects/${currentProject.id}/scenes/reorder`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sceneIds }) });
      if (res.ok) { const data = await res.json(); if (data.success) refreshProject(); }
    } catch { toast({ title: "Reorder failed", variant: "destructive" }); }
  }, [currentProject]);

  // ── Create project ──
  const createProject = async (promptOverride?: string, titleOverride?: string) => {
    const prompt = promptOverride || scriptText.trim() || textPrompt;
    if (!prompt.trim()) { toast({ title: "Enter a prompt first", variant: "destructive" }); return; }
    setIsCreatingProject(true);
    try {
      toast({ title: "Analyzing your script..." });
      const splitRes = await fetch("/api/split-scenes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, targetDuration: effectiveDuration }) });
      const splitData = await splitRes.json(); if (!splitData.success) { toast({ title: "Failed to analyze", variant: "destructive" }); return; }
      const sceneDescriptions = splitData.scenes || [prompt]; const detectedChars = splitData.characters || [];
      const projRes = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: titleOverride || projectTitle || ("Video — " + new Date().toLocaleDateString()), style: selectedStyle, aspectRatio: selectedAspect, targetDuration: effectiveDuration, projectType, characters: detectedChars.map((c: DetectedCharacter) => ({ name: c.name, role: c.role, description: c.description, stylePrompt: c.stylePrompt })) }) });
      const projData = await projRes.json(); if (!projData.success) { toast({ title: "Failed to create project", variant: "destructive" }); return; }
      const project = projData.project;
      if (sceneDescriptions.length > 0) {
        for (const s of sceneDescriptions) {
          await fetch(`/api/projects/${project.id}/scenes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: s.prompt, title: s.title || null, dialogue: s.dialogue || null, characterIds: s.characterNames ? JSON.stringify([]) : null, duration: 10, transition: "fade" }) });
        }
      }
      const fullRes = await fetch(`/api/projects/${project.id}`); const fullData = await fullRes.json();
      if (fullData.success) { setCurrentProject(fullData.project); setProjects((prev) => [fullData.project, ...(Array.isArray(prev) ? prev : [])]); setCurrentView("studio"); setCreateDialogOpen(false); toast({ title: "Project created with " + sceneDescriptions.length + " scenes!" }); setTextPrompt(""); setEnhancedText(""); setScriptText(""); setProjectTitle(""); setParsedScenes([]); setParsedCharacters([]); setVideoFile(null); setVideoPreview(null); }
    } catch (err) { toast({ title: "Error creating project", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" }); }
    finally { setIsCreatingProject(false); }
  };

  // ── Generate all videos ──
  const generateVideo = async (projectOverride?: VideoProject) => {
    const proj = projectOverride || currentProject; if (!proj || !proj.scenes || proj.scenes.length === 0) { toast({ title: "No scenes to generate", variant: "destructive" }); return; }
    setIsGenerating(true);
    try { const res = await fetch("/api/generate-video", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: proj.id }) }); if (!res.ok) { toast({ title: "Generation failed", variant: "destructive" }); return; } const data = await res.json(); if (data.success) { setTimeout(() => refreshProject(), 2000); toast({ title: "Video generation started!", description: data.message }); } else toast({ title: "Generation failed", description: data.error, variant: "destructive" }); } catch (err) { toast({ title: "Generation failed", description: err instanceof Error ? err.message : "Network error", variant: "destructive" }); }
    finally { setIsGenerating(false); }
  };

  // ── Retry scene ──
  const retryScene = async (scene: { id: string; enhancedPrompt?: string | null; prompt: string }) => {
    if (!currentProject) return;
    try { await fetch(`/api/projects/${currentProject.id}/scenes/${scene.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "pending", taskId: null }) }); toast({ title: "Retrying scene..." }); generateSceneVideo(scene.id, scene.enhancedPrompt || scene.prompt); } catch { toast({ title: "Retry failed", variant: "destructive" }); }
  };

  const generateSceneVideo = async (sceneId: string, prompt: string) => {
    if (!currentProject) return; setGeneratingScenes((prev) => new Set(prev).add(sceneId));
    setCurrentProject({ ...currentProject, scenes: currentProject.scenes.map((s) => s.id === sceneId ? { ...s, status: "generating" } : s) });
    try { const res = await fetch("/api/generate-video-scene", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, sceneId, projectId: currentProject.id }) }); if (!res.ok) { toast({ title: "Failed", variant: "destructive" }); refreshProject(); return; } const data = await res.json(); if (data.success) { if (data.videoUrl) { toast({ title: "Video generated!" }); setGeneratingScenes((prev) => { const n = new Set(prev); n.delete(sceneId); return n; }); } else toast({ title: "Generating..." }); refreshProject(); } else { toast({ title: "Failed", variant: "destructive" }); refreshProject(); } } catch { toast({ title: "Failed", variant: "destructive" }); refreshProject(); }
    finally { setGeneratingScenes((prev) => { const n = new Set(prev); n.delete(sceneId); return n; }); }
  };

  // ── Export with quality options ──
  const exportFullVideo = async () => {
    if (!currentProject?.scenes) return;
    const completedCount = currentProject.scenes.filter((s) => s.videoUrl).length;
    if (completedCount === 0) { toast({ title: "No videos ready", variant: "destructive" }); return; }
    setIsExporting(true); setExportDialogOpen(false);
    toast({ title: "Exporting video...", description: `${exportQuality} quality, ${exportTransition} transitions` });
    try {
      const res = await fetch("/api/export-video", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: currentProject.id, quality: exportQuality, transition: exportTransition, format: exportFormat, withTitleCard: exportTitleCard }) });
      const data = await res.json();
      if (data.success) { toast({ title: "Video exported!", description: data.message }); refreshProject(); } else toast({ title: "Export failed", description: data.error, variant: "destructive" });
    } catch { toast({ title: "Export error", variant: "destructive" }); }
    finally { setIsExporting(false); }
  };

  // ── Add scene ──
  const addScene = async () => {
    if (!currentProject || !newScenePrompt.trim()) return;
    try { await fetch(`/api/projects/${currentProject.id}/scenes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: newScenePrompt, duration: 10, transition: newSceneTransition }) }); setNewScenePrompt(""); refreshProject(); toast({ title: "Scene added" }); } catch { toast({ title: "Failed", variant: "destructive" }); }
  };

  // ── Delete operations ──
  const requestDelete = (type: "scene" | "project" | "character", id: string, label: string) => { setPendingDeleteAction({ type, id, label }); setConfirmDeleteOpen(true); };
  const confirmDelete = async () => {
    if (!pendingDeleteAction) return; setConfirmDeleteOpen(false);
    const { type, id } = pendingDeleteAction; setPendingDeleteAction(null);
    if (type === "scene") { if (!currentProject) return; try { await fetch(`/api/projects/${currentProject.id}/scenes/${id}`, { method: "DELETE" }); refreshProject(); toast({ title: "Scene removed" }); } catch { toast({ title: "Failed", variant: "destructive" }); } }
    else if (type === "character") { if (!currentProject) return; try { await fetch(`/api/projects/${currentProject.id}/characters/${id}`, { method: "DELETE" }); setCharacters((prev) => prev.filter((c) => c.id !== id)); toast({ title: "Character removed" }); } catch { toast({ title: "Failed", variant: "destructive" }); } }
    else { try { await fetch(`/api/projects/${id}`, { method: "DELETE" }); fetchProjects(); if (currentProject?.id === id) { setCurrentProject(null); setCurrentView("home"); } toast({ title: "Project deleted" }); } catch { toast({ title: "Failed", variant: "destructive" }); } }
  };
  const cancelDelete = () => { setConfirmDeleteOpen(false); setPendingDeleteAction(null); };

  const openVideoPreview = (url: string) => setPreviewVideoUrl(url);
  const openImagePreview = (url: string) => setPreviewImage(url);
  const closePreview = () => { setPreviewVideoUrl(null); setPreviewImage(null); };
  const handleSelectClassicScene = (scene: ClassicScene) => { setTextPrompt(scene.prompt); setInputMode("text"); setCreateDialogOpen(true); setProjectTitle(scene.title); };

  const safeProjects = Array.isArray(projects) ? projects : [];
  const safeScenes = currentProject?.scenes && Array.isArray(currentProject.scenes) ? currentProject.scenes : [];
  const isAnyGenerating = safeScenes.some((s) => s.status === "generating") || false;
  const completedSceneCount = safeScenes.filter((s) => s.videoUrl).length || 0;

  const formatDuration = (sec: number) => { if (sec < 60) return sec + "s"; const m = Math.floor(sec / 60); const s = sec % 60; return s > 0 ? `${m}m ${s}s` : `${m}m`; };

  // ─── RENDER ────────────────────────────────────────────
  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* ── Header ── */}
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <button onClick={() => currentView !== "home" ? setCurrentView("home") : null} className="flex items-center gap-2.5 font-bold text-lg hover:opacity-80 transition-opacity">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-violet-500/20"><Clapperboard className="h-4 w-4 text-white" /></div>
            <span className="bg-gradient-to-r from-violet-600 to-fuchsia-600 bg-clip-text text-transparent font-extrabold tracking-tight">Vidora</span>
            <Badge variant="outline" className="text-[10px] font-semibold text-violet-500 border-violet-200 ml-1">PRO</Badge>
          </button>
          <div className="flex items-center gap-2">
            {currentView === "home" && <Button onClick={() => setCurrentView("create")} size="sm" className="btn-gradient"><Sparkles className="h-4 w-4 mr-1.5" />Create Video</Button>}
            {currentView !== "home" && <Button variant="ghost" size="sm" onClick={() => setCurrentView("home")} className="hover:bg-violet-50"><ArrowLeft className="h-4 w-4 mr-1" />Back</Button>}
          </div>
        </div>
      </header>

      {/* ── Main Content ── */}
      <main className="flex-1">
        <AnimatePresence mode="wait">

          {/* ═══ HOME VIEW ═══ */}
          {currentView === "home" && (
            <motion.div key="home" {...fadeUp}>
              {/* Hero */}
              <section className="relative overflow-hidden min-h-[520px] sm:min-h-[600px]">
                <div className="absolute inset-0"><img src="/images/hero-bg.png" alt="" className="w-full h-full object-cover" /><div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/50 to-black/70" /></div>
                <div className="orb orb-violet w-[400px] h-[400px] -top-20 -left-32" />
                <div className="orb orb-amber w-[300px] h-[300px] top-10 right-10" />
                <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 py-20 sm:py-28 lg:py-36 text-center">
                  <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }} className="space-y-6">
                    <Badge className="px-4 py-1.5 text-xs font-semibold glass-card text-violet-200 hover:bg-white/10 cursor-default"><Zap className="h-3 w-3 mr-1.5 text-amber-400" />Professional AI Video Studio</Badge>
                    <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-tight">
                      <span className="text-white">Create Production-Ready</span><br />
                      <span className="hero-text-gradient">AI Videos</span>
                    </h1>
                    <p className="text-lg sm:text-xl text-violet-200/80 max-w-2xl mx-auto leading-relaxed">Write scripts, design characters, generate cinematic scenes. From birthday stories to commercials — all powered by AI.</p>
                    <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
                      <Button size="lg" onClick={() => setCurrentView("create")} className="btn-gradient text-base px-8 py-6 h-auto"><Sparkles className="h-5 w-5 mr-2" />Start Creating</Button>
                      <Button size="lg" variant="outline" onClick={() => setCurrentView("gallery")} className="glass-card text-white/80 hover:text-white hover:bg-white/10 px-8 py-6 h-auto"><LayoutGrid className="h-5 w-5 mr-2" />Browse Templates</Button>
                    </div>
                    <div className="flex items-center justify-center gap-8 pt-4 text-sm">
                      {[{ icon: Users, label: "Character", sub: "System" }, { icon: FileText, label: "Script", sub: "Parsing" }, { icon: Film, label: "10s – 5min", sub: "Duration" }, { icon: Monitor, label: "5 Aspect", sub: "Ratios" }].map((s) => (
                        <div key={s.label} className="flex items-center gap-2 text-violet-300/70"><s.icon className="h-4 w-4" /><div className="text-left"><p className="font-semibold text-white/90">{s.label}</p><p className="text-xs">{s.sub}</p></div></div>
                      ))}
                    </div>
                  </motion.div>
                </div>
                <div className="absolute bottom-0 inset-x-0 h-24 bg-gradient-to-t from-background to-transparent" />
              </section>

              {/* Features Showcase */}
              <section className="max-w-6xl mx-auto px-4 sm:px-6 py-16">
                <div className="text-center mb-10">
                  <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Everything You Need for Professional Videos</h2>
                  <p className="text-muted-foreground mt-2 max-w-2xl mx-auto">From script analysis to final export, Vidora handles every step of your video production pipeline.</p>
                </div>
                <motion.div {...stagger} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                  {FEATURES.map((f) => (
                    <motion.div key={f.title} {...fadeItem}>
                      <Card className="card-glow border-0 shadow-lg shadow-black/5 bg-white h-full">
                        <CardHeader className="pb-3">
                          <div className={`mb-3 h-10 w-10 rounded-xl bg-gradient-to-br ${f.color} flex items-center justify-center text-white shadow-lg`}><f.icon className="h-5 w-5" /></div>
                          <CardTitle className="text-base font-bold">{f.title}</CardTitle>
                          <CardDescription className="text-sm leading-relaxed">{f.desc}</CardDescription>
                        </CardHeader>
                      </Card>
                    </motion.div>
                  ))}
                </motion.div>
              </section>

              {/* How It Works */}
              <section className="max-w-4xl mx-auto px-4 sm:px-6 py-12">
                <div className="text-center mb-10">
                  <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">How It Works</h2>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                  {STEPS.map((step) => (
                    <div key={step.num} className="text-center">
                      <div className="mx-auto mb-4 h-14 w-14 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center text-white text-xl font-extrabold shadow-lg shadow-violet-500/20">{step.num}</div>
                      <h3 className="font-bold text-lg mb-1">{step.title}</h3>
                      <p className="text-sm text-muted-foreground leading-relaxed">{step.desc}</p>
                    </div>
                  ))}
                </div>
              </section>

              {/* Testimonials */}
              <section className="max-w-5xl mx-auto px-4 sm:px-6 py-12">
                <div className="text-center mb-10"><h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Loved by Creators</h2></div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
                  {TESTIMONIALS.map((t) => (
                    <Card key={t.name} className="card-glow border-0 shadow-md bg-white">
                      <CardContent className="pt-6">
                        <Quote className="h-6 w-6 text-violet-200 mb-3" />
                        <p className="text-sm text-foreground leading-relaxed mb-4">&ldquo;{t.text}&rdquo;</p>
                        <div className="flex items-center gap-3">
                          <div className="h-9 w-9 rounded-full bg-gradient-to-br from-violet-400 to-fuchsia-400 flex items-center justify-center text-white text-xs font-bold">{t.avatar}</div>
                          <div><p className="text-sm font-bold">{t.name}</p><p className="text-xs text-muted-foreground">{t.role}</p></div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </section>

              {/* Quick Create Cards */}
              <section className="max-w-5xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
                <div className="section-divider mb-10" />
                <motion.div {...stagger} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
                  {[
                    { icon: <FileText className="h-6 w-6" />, title: "Script to Video", desc: "Write a full script with scenes, dialogue, and characters", color: "from-violet-500 to-purple-500", action: () => { setInputMode("script"); setCurrentView("create"); } },
                    { icon: <Wand2 className="h-6 w-6" />, title: "Text to Video", desc: "Describe your scene and let AI generate video", color: "from-fuchsia-500 to-pink-500", action: () => { setInputMode("text"); setCurrentView("create"); } },
                    { icon: <Mic className="h-6 w-6" />, title: "Voice to Video", desc: "Speak your idea, we transcribe and create it", color: "from-amber-500 to-orange-500", action: () => { setInputMode("voice"); setCurrentView("create"); } },
                    { icon: <Upload className="h-6 w-6" />, title: "Image to Video", desc: "Upload an image and animate it into video", color: "from-teal-500 to-emerald-500", action: () => { setInputMode("video"); setCurrentView("create"); } },
                  ].map((card) => (
                    <motion.div key={card.title} {...fadeItem}>
                      <Card className="card-glow cursor-pointer border-0 shadow-lg shadow-black/5 bg-white group h-full" onClick={card.action}>
                        <CardHeader className="pb-3">
                          <div className={`mb-3 h-11 w-11 rounded-xl bg-gradient-to-br ${card.color} flex items-center justify-center text-white shadow-lg group-hover:scale-110 transition-transform duration-300`}>{card.icon}</div>
                          <CardTitle className="text-base font-bold">{card.title}</CardTitle>
                          <CardDescription className="text-sm leading-relaxed">{card.desc}</CardDescription>
                        </CardHeader>
                      </Card>
                    </motion.div>
                  ))}
                </motion.div>
              </section>

              {/* Recent Projects */}
              {safeProjects.length > 0 && (
                <section className="max-w-5xl mx-auto px-4 sm:px-6 pb-12 sm:pb-16">
                  <div className="section-divider mb-10" />
                  <div className="flex items-center justify-between mb-6"><h2 className="text-xl sm:text-2xl font-bold tracking-tight">Recent Projects</h2></div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {safeProjects.slice(0, 6).map((p) => (
                      <Card key={p.id} className="card-glow cursor-pointer bg-white border-0 shadow-md shadow-black/5" onClick={() => { setCurrentProject(p); setCurrentView("studio"); }}>
                        <CardHeader className="pb-2">
                          <div className="flex items-start justify-between">
                            <CardTitle className="text-base font-bold truncate pr-2">{p.title}</CardTitle>
                            <Badge className={`text-[10px] font-semibold px-2 shrink-0 ${p.status === "completed" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : p.status === "generating" ? "bg-violet-50 text-violet-700 border-violet-200" : p.status === "failed" ? "bg-red-50 text-red-700 border-red-200" : "bg-slate-50 text-slate-600 border-slate-200"}`}>{p.status}</Badge>
                          </div>
                        </CardHeader>
                        <CardContent>
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground flex-wrap">
                            <Badge variant="outline" className="text-[10px]">{p.aspectRatio}</Badge>
                            <Badge variant="outline" className="text-[10px]">{p.style}</Badge>
                            <span className="flex items-center gap-0.5"><Clock className="h-3 w-3" />{formatDuration(p.targetDuration)}</span>
                            {p.projectType && p.projectType !== "custom" && <Badge className="text-[10px] bg-violet-50 text-violet-600 border-violet-200">{p.projectType}</Badge>}
                          </div>
                          <div className="flex items-center gap-1.5 mt-2 text-xs text-muted-foreground">
                            <Film className="h-3 w-3" /><span>{p.scenes?.length || 0} scenes</span>
                            {(p as VideoProject).characters && (p as VideoProject).characters!.length > 0 && <span className="flex items-center gap-0.5"><Users className="h-3 w-3" />{(p as VideoProject).characters!.length} chars</span>}
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
            <motion.div key="create" {...fadeUp} className="max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-6">
              <div><h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Create New Video</h1><p className="text-muted-foreground mt-1">Write a script, describe a scene, or choose a template</p></div>

              {/* Project Type */}
              <Card className="border-0 shadow-lg shadow-black/5 bg-white card-glow">
                <CardHeader className="pb-3"><CardTitle className="text-base font-bold flex items-center gap-2"><div className="h-7 w-7 rounded-lg bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center text-white"><Star className="h-3.5 w-3.5" /></div>Project Type</CardTitle></CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    {PROJECT_TEMPLATES.map((t) => (
                      <button key={t.id} onClick={() => setProjectType(t.id)} className={`relative p-3 rounded-xl border-2 text-left transition-all duration-200 ${projectType === t.id ? "border-violet-400 bg-violet-50" : "border-slate-100 hover:border-slate-200"}`}>
                        <div className={`h-8 w-8 rounded-lg bg-gradient-to-br ${t.color} flex items-center justify-center text-white mb-2`}><t.icon className="h-4 w-4" /></div>
                        <p className="text-xs font-bold">{t.label}</p><p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{t.desc}</p>
                        {projectType === t.id && <div className="absolute top-2 right-2 h-2.5 w-2.5 rounded-full bg-violet-500" />}
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Settings */}
              <Card className="border-0 shadow-lg shadow-black/5 bg-white card-glow">
                <CardHeader className="pb-4"><CardTitle className="text-base font-bold flex items-center gap-2"><div className="h-7 w-7 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center text-white"><Layers className="h-3.5 w-3.5" /></div>Project Settings</CardTitle></CardHeader>
                <CardContent className="space-y-5">
                  <div className="space-y-1.5"><Label className="text-sm font-medium">Project Title</Label><Input placeholder="My Cinematic Video" value={projectTitle} onChange={(e) => setProjectTitle(e.target.value)} className="h-10" /></div>
                  <div className="space-y-1.5">
                    <Label className="text-sm font-medium">Duration</Label>
                    <div className="flex items-center gap-3 flex-wrap">
                      <div className="flex gap-1.5 flex-wrap">
                        {DURATION_PRESETS.map((d) => (
                          <button key={d.value} onClick={() => { setSelectedDuration(d.value); setIsCustomDuration(false); }} className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${!isCustomDuration && selectedDuration === d.value ? "bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow-md shadow-violet-500/25" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{d.label}</button>
                        ))}
                      </div>
                      <button onClick={() => setIsCustomDuration(true)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${isCustomDuration ? "bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-md" : "bg-amber-50 text-amber-600 hover:bg-amber-100 border border-amber-200"}`}>Custom</button>
                      {isCustomDuration && (<div className="flex items-center gap-1.5"><Input type="number" min={10} max={300} placeholder="seconds" value={customDuration} onChange={(e) => setCustomDuration(e.target.value)} className="w-24 h-9 text-xs" /><span className="text-xs text-muted-foreground">sec (10–300)</span></div>)}
                    </div>
                    <div className="flex items-center gap-2 mt-1"><Badge variant="outline" className="text-[10px]"><Film className="h-2.5 w-2.5 mr-1" />~{effectiveSceneCount} scene{effectiveSceneCount > 1 ? "s" : ""}</Badge><Badge variant="outline" className="text-[10px]"><Clock className="h-2.5 w-2.5 mr-1" />{formatDuration(effectiveDuration)} total</Badge></div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="space-y-1.5"><Label className="text-sm font-medium">Style</Label><Select value={selectedStyle} onValueChange={setSelectedStyle}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{STYLES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent></Select></div>
                    <div className="space-y-1.5"><Label className="text-sm font-medium">Aspect Ratio</Label><Select value={selectedAspect} onValueChange={setSelectedAspect}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{ASPECTS.map((a) => <SelectItem key={a.value} value={a.value}>{a.label} {a.desc}</SelectItem>)}</SelectContent></Select></div>
                    <div className="space-y-1.5"><Label className="text-sm font-medium">Transition</Label><Select value={newSceneTransition} onValueChange={setNewSceneTransition}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{TRANSITIONS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent></Select></div>
                  </div>
                </CardContent>
              </Card>

              {/* Input Tabs */}
              <Card className="border-0 shadow-lg shadow-black/5 bg-white">
                <CardContent className="pt-6">
                  <Tabs value={inputMode} onValueChange={(v) => setInputMode(v as InputMode)}>
                    <TabsList className="grid w-full grid-cols-4 bg-slate-100 p-1">
                      <TabsTrigger value="script" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm text-xs"><FileText className="h-4 w-4 mr-1" />Script</TabsTrigger>
                      <TabsTrigger value="text" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm text-xs"><Wand2 className="h-4 w-4 mr-1" />Text</TabsTrigger>
                      <TabsTrigger value="voice" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm text-xs"><Mic className="h-4 w-4 mr-1" />Voice</TabsTrigger>
                      <TabsTrigger value="video" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm text-xs"><Upload className="h-4 w-4 mr-1" />Image</TabsTrigger>
                    </TabsList>

                    <TabsContent value="script" className="space-y-4 mt-4">
                      <div className="bg-violet-50 border border-violet-100 rounded-xl p-4">
                        <div className="flex items-center gap-2 mb-2"><MessageSquare className="h-4 w-4 text-violet-500" /><p className="text-sm font-semibold text-violet-700">Script Mode</p></div>
                        <p className="text-xs text-violet-600 leading-relaxed">Write a full screenplay. AI will identify scenes, characters, and dialogue. Recognizes 25+ brand characters (PAW Patrol, Bluey, Spider-Man, etc.)</p>
                      </div>
                      <Textarea placeholder={"🎬 Scene 1 – A Special Morning\nVisual: A bright colorful town comes to life.\nNarrator: \"Today is a magical day!\"\nChase: \"Everything is ready!\""} className="min-h-[220px] text-sm leading-relaxed resize-none font-mono" value={scriptText} onChange={(e) => setScriptText(e.target.value)} />
                      <Button variant="outline" size="sm" onClick={parseScript} disabled={isParsingScript || (!scriptText.trim() && !textPrompt.trim())} className="hover:bg-violet-50">{isParsingScript ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Layers className="h-4 w-4 mr-1.5" />}{isParsingScript ? "Parsing..." : "Parse Script"}</Button>
                      {(parsedScenes.length > 0 || parsedCharacters.length > 0) && (
                        <div className="space-y-3 pt-2">
                          <div className="section-divider" />
                          {parsedCharacters.length > 0 && (<div><p className="text-sm font-bold mb-2 flex items-center gap-2"><Users className="h-4 w-4 text-violet-500" />Detected Characters ({parsedCharacters.length})</p><div className="flex gap-2 flex-wrap">{parsedCharacters.map((c, i) => (<Badge key={i} variant="outline" className="text-xs">{c.role === "protagonist" && <><Crown className="h-3 w-3 mr-1 text-amber-500" />{c.name}</>}{c.role !== "protagonist" && c.name}</Badge>))}</div></div>)}
                          {parsedScenes.length > 0 && (<div><p className="text-sm font-bold mb-2 flex items-center gap-2"><Layers className="h-4 w-4 text-violet-500" />Scenes ({parsedScenes.length})</p><div className="space-y-2 max-h-64 overflow-y-auto">{parsedScenes.map((s, i) => (<div key={i} className="bg-slate-50 rounded-lg p-3 border border-slate-100"><div className="flex items-center gap-2 mb-1"><Badge className="text-[10px] font-bold bg-violet-500 text-white">#{i + 1}</Badge>{s.title && <span className="text-xs font-semibold">{s.title}</span>}</div><p className="text-xs text-muted-foreground line-clamp-2">{s.prompt}</p></div>))}</div></div>)}
                        </div>
                      )}
                    </TabsContent>

                    <TabsContent value="text" className="space-y-3 mt-4">
                      <Textarea placeholder="Describe your video scene in detail..." className="min-h-[180px] text-sm leading-relaxed resize-none" value={textPrompt} onChange={(e) => setTextPrompt(e.target.value)} />
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={enhancePrompt} disabled={isEnhancing || !textPrompt.trim()} className="hover:bg-violet-50">{isEnhancing ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Enhancing...</> : <><Sparkles className="h-4 w-4 mr-1.5" /> AI Enhance</>}</Button>
                      </div>
                      {enhancedText && <div className="bg-violet-50 rounded-lg p-3 border border-violet-100"><p className="text-[10px] font-semibold text-violet-500 mb-1">Enhanced Prompt</p><p className="text-xs text-violet-700 leading-relaxed">{enhancedText}</p></div>}
                    </TabsContent>

                    <TabsContent value="voice" className="space-y-3 mt-4">
                      <div className="bg-amber-50 border border-amber-100 rounded-xl p-6 text-center">
                        <Mic className="h-10 w-10 mx-auto text-amber-500 mb-3" />
                        <p className="text-sm font-semibold text-amber-700">Voice Input</p>
                        <p className="text-xs text-amber-600 mt-1">Record your idea and AI will transcribe it</p>
                        <div className="mt-4">{isRecording ? (<Button variant="destructive" size="sm" onClick={stopRecording}><MicOff className="h-4 w-4 mr-1.5" />Stop Recording</Button>) : (<Button size="sm" onClick={startRecording} className="bg-gradient-to-r from-amber-500 to-orange-500 text-white"><Mic className="h-4 w-4 mr-1.5" />Start Recording</Button>)}</div>
                      </div>
                      {textPrompt && <div className="bg-slate-50 rounded-lg p-3 border border-slate-100"><p className="text-[10px] font-semibold text-muted-foreground mb-1">Transcription</p><p className="text-sm leading-relaxed">{textPrompt}</p></div>}
                    </TabsContent>

                    <TabsContent value="video" className="space-y-3 mt-4">
                      <div className="bg-teal-50 border border-teal-100 rounded-xl p-6 text-center">
                        <UploadCloud className="h-10 w-10 mx-auto text-teal-500 mb-3" />
                        <p className="text-sm font-semibold text-teal-700">Upload an Image</p>
                        <p className="text-xs text-teal-600 mt-1">Upload a character image to animate into video</p>
                        <input ref={videoInputRef} type="file" accept="image/*" className="hidden" onChange={handleVideoUpload} />
                        <Button variant="outline" size="sm" className="mt-3" onClick={() => videoInputRef.current?.click()}>Choose File</Button>
                      </div>
                      {videoPreview && <div className="relative rounded-xl overflow-hidden border"><img src={videoPreview} alt="preview" className="w-full max-h-64 object-contain bg-black/5" /></div>}
                    </TabsContent>
                  </Tabs>
                </CardContent>
              </Card>

              {/* Create Button */}
              <div className="flex justify-center pb-8">
                <Button size="lg" onClick={() => createProject()} disabled={isCreatingProject || (!textPrompt.trim() && !scriptText.trim())} className="btn-gradient px-10 text-base h-12">
                  {isCreatingProject ? <Loader2 className="h-5 w-5 mr-2 animate-spin" /> : <Sparkles className="h-5 w-5 mr-2" />}
                  {isCreatingProject ? "Creating..." : "Create & Generate Video"}
                </Button>
              </div>
            </motion.div>
          )}

          {/* ═══ STUDIO VIEW ═══ */}
          {currentView === "studio" && currentProject && (
            <motion.div key="studio" {...fadeUp} className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-6">
              {/* Project Header */}
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <h1 className="text-xl sm:text-2xl font-bold truncate">{currentProject.title}</h1>
                    <Badge className={`text-[10px] font-semibold px-2 ${currentProject.status === "completed" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : currentProject.status === "generating" ? "bg-violet-50 text-violet-700 border-violet-200" : "bg-slate-50 text-slate-600 border-slate-200"}`}>{currentProject.status}</Badge>
                    {currentProject.projectType && currentProject.projectType !== "custom" && <Badge className="text-[10px] bg-violet-50 text-violet-700 border-violet-200">{currentProject.projectType}</Badge>}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                    <span className="flex items-center gap-1"><Film className="h-3 w-3" />{safeScenes.length} scenes</span>
                    <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{formatDuration(currentProject.targetDuration)}</span>
                    <span>{currentProject.style} · {currentProject.aspectRatio}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {completedSceneCount >= 2 && (
                    <Button size="sm" variant="outline" onClick={() => setExportDialogOpen(true)} disabled={isExporting} className="hover:bg-violet-50"><Download className="h-4 w-4 mr-1.5" />Export</Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => requestDelete("project", currentProject.id, currentProject.title)} className="text-red-400 hover:text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>

              {/* Progress */}
              {safeScenes.length > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Progress: {completedSceneCount}/{safeScenes.length} scenes</span>
                    <span className="font-semibold">{Math.round((completedSceneCount / safeScenes.length) * 100)}%</span>
                  </div>
                  <Progress value={(completedSceneCount / safeScenes.length) * 100} className="h-2" />
                </div>
              )}

              {/* Final Video */}
              {currentProject.finalVideoUrl && (
                <Card className="border-0 shadow-lg bg-gradient-to-br from-violet-50 to-fuchsia-50">
                  <CardContent className="pt-6 text-center">
                    <p className="text-sm font-bold mb-3 flex items-center justify-center gap-2"><Heart className="h-4 w-4 text-rose-500" />Final Video Ready!</p>
                    <video controls src={currentProject.finalVideoUrl} className="mx-auto rounded-xl max-h-80 shadow-lg" />
                  </CardContent>
                </Card>
              )}

              {/* Actions Bar */}
              <div className="flex items-center gap-2 flex-wrap">
                {!isAnyGenerating && safeScenes.some((s) => !s.videoUrl) && (
                  <Button size="sm" onClick={() => generateVideo()} className="btn-gradient"><Play className="h-4 w-4 mr-1.5" />Generate All</Button>
                )}
                {isAnyGenerating && <div className="flex items-center gap-2 text-sm text-violet-600"><Loader2 className="h-4 w-4 animate-spin" />Generating videos...</div>}
              </div>

              {/* Characters Panel */}
              {characters.length > 0 && (
                <Card className="border-0 shadow-md bg-white">
                  <CardHeader className="pb-3"><CardTitle className="text-sm font-bold flex items-center gap-2"><Users className="h-4 w-4 text-violet-500" />Characters ({characters.length})</CardTitle></CardHeader>
                  <CardContent>
                    <div className="flex gap-3 overflow-x-auto pb-2">
                      {characters.map((c) => (
                        <div key={c.id} className="shrink-0 w-28 rounded-xl border border-slate-100 p-2 text-center relative group">
                          {c.imageUrl ? <img src={c.imageUrl} alt={c.name} className="w-full h-20 object-cover rounded-lg mb-1" /> : <div className="w-full h-20 bg-slate-100 rounded-lg mb-1 flex items-center justify-center"><Users className="h-6 w-6 text-slate-300" /></div>}
                          <p className="text-[10px] font-bold truncate">{c.name}</p>
                          <p className="text-[9px] text-muted-foreground">{c.role}</p>
                          <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => requestDelete("character", c.id, c.name)} className="h-5 w-5 rounded-full bg-red-500 text-white flex items-center justify-center"><X className="h-3 w-3" /></button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Add Scene */}
              <Card className="border-0 shadow-md bg-white">
                <CardContent className="pt-4">
                  <div className="flex gap-2 items-end">
                    <div className="flex-1"><Textarea placeholder="Describe a new scene..." value={newScenePrompt} onChange={(e) => setNewScenePrompt(e.target.value)} className="min-h-[60px] text-sm resize-none" /></div>
                    <div className="flex flex-col gap-1">
                      <Select value={newSceneTransition} onValueChange={setNewSceneTransition}><SelectTrigger className="h-8 w-24 text-xs"><SelectValue /></SelectTrigger><SelectContent>{TRANSITIONS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent></Select>
                      <Button size="sm" onClick={addScene} disabled={!newScenePrompt.trim()} className="btn-gradient h-8"><Plus className="h-4 w-4" /></Button>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Scene List — Drag & Drop */}
              {safeScenes.length > 0 && (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext items={safeScenes.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                    <div className="space-y-3">
                      {safeScenes.map((scene) => (
                        <SortableSceneCard
                          key={scene.id}
                          scene={scene}
                          sceneIndex={scene.sceneNumber}
                          onPreview={openVideoPreview}
                          onGenerate={generateSceneVideo}
                          onRetry={retryScene}
                          onDelete={(id, label) => requestDelete("scene", id, label)}
                          onNarrate={generateNarration}
                          onTransitionChange={changeSceneTransition}
                          isGeneratingNarration={generatingNarration.has(scene.id)}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              )}

              {/* Add Character Form */}
              <Card className="border-0 shadow-md bg-white">
                <CardHeader className="pb-3"><CardTitle className="text-sm font-bold flex items-center gap-2"><UserPlus className="h-4 w-4 text-violet-500" />Add Character</CardTitle></CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-end">
                    <div className="space-y-1"><Label className="text-[10px] text-muted-foreground">Name</Label><Input placeholder="Character name" value={newCharName} onChange={(e) => setNewCharName(e.target.value)} className="h-8 text-xs" /></div>
                    <div className="space-y-1"><Label className="text-[10px] text-muted-foreground">Description</Label><Input placeholder="Appearance, clothing..." value={newCharDesc} onChange={(e) => setNewCharDesc(e.target.value)} className="h-8 text-xs" /></div>
                    <Button size="sm" onClick={addCharacter} disabled={!newCharName.trim()} className="h-8 btn-gradient text-xs"><Plus className="h-3 w-3 mr-1" />Add</Button>
                  </div>
                  {characters.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {characters.map((c) => (
                        <div key={c.id} className="flex items-center gap-2 p-2 rounded-lg border border-slate-100">
                          {c.imageUrl ? <img src={c.imageUrl} alt={c.name} className="h-10 w-10 rounded-lg object-cover" /> : <div className="h-10 w-10 rounded-lg bg-slate-100 flex items-center justify-center"><Users className="h-5 w-5 text-slate-300" /></div>}
                          <div className="flex-1 min-w-0"><p className="text-xs font-bold truncate">{c.name}</p><p className="text-[10px] text-muted-foreground truncate">{c.role}{c.description ? " · " + c.description : ""}</p></div>
                          <Button size="sm" variant="outline" className="h-6 text-[10px] px-1.5" onClick={() => generateCharImage(c.id)} disabled={generatingCharImage === c.id}>{generatingCharImage === c.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}</Button>
                          <input type="file" accept="image/*" className="hidden" ref={(el) => { if (el) { el.onchange = (e) => uploadCharImage(e as unknown as React.ChangeEvent<HTMLInputElement>, c.id); } }} />
                          <Button size="sm" variant="outline" className="h-6 text-[10px] px-1.5" onClick={() => { const input = document.createElement("input"); input.type = "file"; input.accept = "image/*"; input.onchange = (e) => uploadCharImage(e as unknown as React.ChangeEvent<HTMLInputElement>, c.id); input.click(); }}><Upload className="h-3 w-3" /></Button>
                          <Button size="sm" variant="ghost" className="h-6 text-[10px] px-1.5 text-red-400 hover:text-red-600 hover:bg-red-50" onClick={() => requestDelete("character", c.id, c.name)}><Trash2 className="h-3 w-3" /></Button>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Studio padding */}
              <div className="h-4" />
            </motion.div>
          )}

          {/* ═══ GALLERY VIEW ═══ */}
          {currentView === "gallery" && (
            <motion.div key="gallery" {...fadeUp} className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-6">
              <div><h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Scene Templates</h1><p className="text-muted-foreground mt-1">Choose a preset scene to get started quickly</p></div>
              <div className="flex gap-2 flex-wrap">
                {["all", "nature", "sci-fi", "fantasy", "classic"].map((cat) => (<button key={cat} onClick={() => setSceneFilter(cat)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${sceneFilter === cat ? "bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow-md" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{cat === "all" ? "All" : cat.charAt(0).toUpperCase() + cat.slice(1)}</button>))}
              </div>
              <motion.div {...stagger} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                {CLASSIC_SCENES.filter((s) => sceneFilter === "all" || s.category === sceneFilter).map((scene) => (
                  <motion.div key={scene.id} {...fadeItem}>
                    <Card className="card-glow cursor-pointer border-0 shadow-lg bg-white group overflow-hidden" onClick={() => handleSelectClassicScene(scene)}>
                      {scene.image ? <div className="relative h-40 overflow-hidden"><img src={scene.image} alt={scene.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" /><div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" /><div className="absolute bottom-3 left-3"><p className="text-white font-bold text-sm">{scene.title}</p></div></div> : <div className="h-40 bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center"><Film className="h-8 w-8 text-slate-300" /></div>}
                      <CardContent className="pt-3"><p className="text-sm text-muted-foreground leading-relaxed">{scene.description}</p><div className="mt-2"><Badge variant="outline" className="text-[10px]">{scene.category}</Badge></div></CardContent>
                    </Card>
                  </motion.div>
                ))}
              </motion.div>
            </motion.div>
          )}

        </AnimatePresence>
      </main>

      {/* ── Footer ── */}
      <footer className="mt-auto border-t bg-background/50 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
          <p>&copy; 2025 Vidora AI Video Studio. Powered by AI.</p>
          <div className="flex items-center gap-4">
            <button onClick={() => { setCurrentView("home"); setTimeout(() => document.querySelector("[data-section=features]")?.scrollIntoView({ behavior: "smooth" }), 100); }} className="hover:text-foreground transition-colors">Features</button>
            <button onClick={() => setCurrentView("gallery")} className="hover:text-foreground transition-colors">Templates</button>
            <span className="hover:text-foreground transition-colors cursor-default">Built with ❤️ by Z.ai</span>
          </div>
        </div>
      </footer>

      {/* ── Delete Confirmation Dialog ── */}
      <Dialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <DialogContent><DialogHeader><DialogTitle>Delete {pendingDeleteAction?.type}</DialogTitle><DialogDescription>Are you sure you want to delete &ldquo;{pendingDeleteAction?.label}&rdquo;? This action cannot be undone.</DialogDescription></DialogHeader><DialogFooter><Button variant="ghost" onClick={cancelDelete}>Cancel</Button><Button variant="destructive" onClick={confirmDelete}>Delete</Button></DialogFooter></DialogContent>
      </Dialog>

      {/* ── Export Dialog ── */}
      <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
        <DialogContent><DialogHeader><DialogTitle className="flex items-center gap-2"><Download className="h-5 w-5" />Export Video</DialogTitle><DialogDescription>Choose your export settings</DialogDescription></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5"><Label className="text-sm font-medium">Quality</Label><Select value={exportQuality} onValueChange={setExportQuality}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{EXPORT_QUALITY.map((q) => <SelectItem key={q.value} value={q.value}><div><p className="font-medium">{q.label}</p><p className="text-xs text-muted-foreground">{q.desc}</p></div></SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1.5"><Label className="text-sm font-medium">Transition Effect</Label><Select value={exportTransition} onValueChange={setExportTransition}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{TRANSITIONS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1.5"><Label className="text-sm font-medium">Format</Label><Select value={exportFormat} onValueChange={setExportFormat}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="mp4">MP4 (H.264)</SelectItem><SelectItem value="webm">WebM (VP8)</SelectItem></SelectContent></Select></div>
            <div className="flex items-center justify-between"><Label className="text-sm font-medium">Include Title Card</Label><Switch checked={exportTitleCard} onCheckedChange={setExportTitleCard} /></div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setExportDialogOpen(false)}>Cancel</Button>
            <Button onClick={exportFullVideo} disabled={isExporting} className="btn-gradient">{isExporting ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Download className="h-4 w-4 mr-1.5" />}{isExporting ? "Exporting..." : "Export Video"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Video Preview Dialog ── */}
      <Dialog open={!!previewVideoUrl} onOpenChange={closePreview}>
        <DialogContent className="max-w-3xl"><div className="flex items-center justify-center">{previewVideoUrl && <video controls src={previewVideoUrl} className="rounded-xl max-h-[70vh] shadow-lg" autoPlay />}</div></DialogContent>
      </Dialog>

      {/* ── Image Preview Dialog ── */}
      <Dialog open={!!previewImage} onOpenChange={closePreview}>
        <DialogContent className="max-w-3xl"><div className="flex items-center justify-center">{previewImage && <img src={previewImage} alt="preview" className="rounded-xl max-h-[70vh] object-contain" />}</div></DialogContent>
      </Dialog>

      {/* ── Create Dialog ── */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent><DialogHeader><DialogTitle>Use Template Scene</DialogTitle><DialogDescription>Create a new video project using this template</DialogDescription></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5"><Label className="text-sm font-medium">Project Title</Label><Input placeholder="My Video" value={projectTitle} onChange={(e) => setProjectTitle(e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label className="text-sm font-medium">Style</Label><Select value={selectedStyle} onValueChange={setSelectedStyle}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{STYLES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-1.5"><Label className="text-sm font-medium">Aspect</Label><Select value={selectedAspect} onValueChange={setSelectedAspect}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{ASPECTS.map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}</SelectContent></Select></div>
            </div>
          </div>
          <DialogFooter><Button variant="ghost" onClick={() => setCreateDialogOpen(false)}>Cancel</Button><Button onClick={() => createProject(undefined, projectTitle)} disabled={isCreatingProject} className="btn-gradient">{isCreatingProject ? <><Loader2 className="h-4 w-4 animate-spin" /> Creating...</> : <><Sparkles className="h-4 w-4 mr-1.5" /> Create</>}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
