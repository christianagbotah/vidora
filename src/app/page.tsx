"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAppStore } from "@/store/useAppStore";
import { useToast } from "@/hooks/use-toast";
import type {
  VideoProject, VideoScene, ClassicScene, InputMode,
  Character, ParsedSceneResult, DetectedCharacter, ContinuityIssue,
} from "@/types/video";
import {
  Film, Mic, MicOff, Upload, Sparkles, Play, Plus, Trash2,
  ChevronRight, Wand2, ArrowLeft, ImageIcon, LayoutGrid, Loader2,
  X, Download, Layers, Palette, Clapperboard,
  Copy, Eye, Volume2, Clock, Video, RefreshCw, Zap, Timer, Monitor,
  Smartphone, RectangleHorizontal, Square,
  Users, UserPlus, UploadCloud, FileText, MessageSquare,
  Crown, Star, Heart, Briefcase, PartyPopper, Camera,
  GripVertical, Quote, ArrowDownToLine, Music,
  CheckCircle, AlertTriangle, Shield, Search, Settings,
  Lightbulb, RotateCcw, Shrink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader,
  DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import DeviceSimulator from "@/components/DeviceSimulator";
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

/* ════════════════════════════════════════════════════════════════
   DATA CONSTANTS
   ════════════════════════════════════════════════════════════════ */

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
  { value: "4:3", label: "4:3", icon: Monitor, desc: "Classic" },
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

const CAMERA_MOVES = [
  "slow zoom in", "slow zoom out", "pan left", "pan right", "tracking shot",
  "crane shot ascending", "crane shot descending", "dolly forward", "dolly backward",
  "orbit shot", "tilt up", "tilt down", "static locked shot", "handheld shaky cam",
  "steady cam glide", "aerial drone shot", "low angle hero shot", "high angle overhead",
];

const MOODS = [
  "dramatic", "serene", "tense", "joyful", "melancholic", "epic", "mysterious",
  "romantic", "whimsical", "dark", "ethereal", "nostalgic", "triumphant", "suspenseful",
];

const LIGHTING_STYLES = [
  "golden hour", "blue hour", "neon lit", "candlelight", "moonlight", "overcast soft",
  "harsh sunlight", "studio lighting", "volumetric god rays", "backlit silhouette",
  "underwater caustics", "firelight warm glow", "fluorescent clinical", "dramatic chiaroscuro",
];

const TTS_VOICES = [
  { id: "tongtong", label: "TongTong", desc: "Warm & friendly" },
  { id: "chuichui", label: "ChuiChui", desc: "Playful & cute" },
  { id: "xiaochen", label: "XiaoChen", desc: "Professional" },
  { id: "jam", label: "Jam", desc: "British gentleman" },
  { id: "kazi", label: "Kazi", desc: "Clear & standard" },
  { id: "douji", label: "DouJi", desc: "Natural & smooth" },
  { id: "luodo", label: "LuoDo", desc: "Expressive" },
];

const GALLERY_CATEGORIES = ["All", "Nature", "Sci-Fi", "Fantasy", "Classic"];

const MOOD_COLORS: Record<string, string> = {
  dramatic: "bg-red-100 text-red-700 border-red-200",
  serene: "bg-sky-100 text-sky-700 border-sky-200",
  tense: "bg-orange-100 text-orange-700 border-orange-200",
  joyful: "bg-amber-100 text-amber-700 border-amber-200",
  melancholic: "bg-slate-200 text-slate-700 border-slate-300",
  epic: "bg-violet-100 text-violet-700 border-violet-200",
  mysterious: "bg-purple-100 text-purple-700 border-purple-200",
  romantic: "bg-pink-100 text-pink-700 border-pink-200",
  whimsical: "bg-emerald-100 text-emerald-700 border-emerald-200",
  dark: "bg-gray-200 text-gray-700 border-gray-300",
  ethereal: "bg-cyan-100 text-cyan-700 border-cyan-200",
  nostalgic: "bg-yellow-100 text-yellow-700 border-yellow-200",
  triumphant: "bg-amber-100 text-amber-700 border-amber-200",
  suspenseful: "bg-rose-100 text-rose-700 border-rose-200",
};

/* ════════════════════════════════════════════════════════════════
   ANIMATION VARIANTS
   ════════════════════════════════════════════════════════════════ */

const fadeUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -10 },
  transition: { duration: 0.35 },
};

const stagger = { animate: { transition: { staggerChildren: 0.08 } } };
const fadeItem = { initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 } };

/* ════════════════════════════════════════════════════════════════
   SORTABLE SCENE CARD
   ════════════════════════════════════════════════════════════════ */

function SortableSceneCard({
  scene, sceneIndex, totalScenes, projectStyle,
  onPreview, onGenerate, onRetry, onDelete, onNarrate,
  onTransitionChange, onEnhanceScene, onMoodChange, onCameraChange, onLightingChange,
  isGeneratingNarration,
}: {
  scene: VideoScene; sceneIndex: number; totalScenes: number; projectStyle: string;
  onPreview: (url: string) => void;
  onGenerate: (id: string, prompt: string) => void;
  onRetry: (scene: VideoScene) => void;
  onDelete: (id: string, label: string) => void;
  onNarrate: (id: string, voice?: string) => void;
  onTransitionChange: (id: string, transition: string) => void;
  onEnhanceScene: (scene: VideoScene) => void;
  onMoodChange: (id: string, mood: string) => void;
  onCameraChange: (id: string, camera: string) => void;
  onLightingChange: (id: string, lighting: string) => void;
  isGeneratingNarration: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition: dndTransition, isDragging } = useSortable({ id: scene.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition: dndTransition,
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.5 : 1,
  };

  const [expandedPrompt, setExpandedPrompt] = useState(false);
  const [narrationVoice, setNarrationVoice] = useState(scene.narrationVoice || "tongtong");

  const statusColor = scene.status === "completed"
    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : scene.status === "generating"
    ? "bg-violet-50 text-violet-700 border-violet-200"
    : scene.status === "failed"
    ? "bg-red-50 text-red-700 border-red-200"
    : "bg-slate-50 text-slate-600 border-slate-200";

  const moodBadge = scene.mood ? MOOD_COLORS[scene.mood] || "bg-slate-100 text-slate-600 border-slate-200" : null;

  return (
    <div ref={setNodeRef} style={style} className="group relative">
      <Card className="card-glow bg-white border-0 shadow-md shadow-black/5 overflow-hidden">
        <div className="flex flex-col sm:flex-row">
          {/* Drag Handle */}
          <div
            className="flex items-center px-2 py-3 sm:py-0 bg-slate-50 border-r border-slate-100 cursor-grab active:cursor-grabbing sm:w-8 shrink-0 justify-center"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-4 w-4 text-slate-300" />
          </div>
          {/* Thumbnail */}
          <div className="relative w-full sm:w-32 h-24 sm:h-auto shrink-0 bg-slate-100">
            {scene.imageUrl ? (
              <>
                <img src={scene.imageUrl} alt="" className="w-full h-full object-cover" />
                {scene.videoUrl && (
                  <button
                    onClick={() => onPreview(scene.videoUrl!)}
                    className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Play className="h-6 w-6 text-white" />
                  </button>
                )}
              </>
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Film className="h-6 w-6 text-slate-300" />
              </div>
            )}
            <Badge className="absolute top-1 left-1 text-[9px] font-bold px-1.5 bg-black/60 text-white border-0">
              #{scene.sceneNumber}
            </Badge>
            <Badge className={`absolute top-1 right-1 text-[9px] font-semibold px-1.5 ${statusColor}`}>
              {scene.status}
            </Badge>
          </div>
          {/* Content */}
          <div className="flex-1 p-3 min-w-0">
            {/* Title Row */}
            <div className="flex items-center gap-1.5 flex-wrap mb-1">
              {scene.title && (
                <span className="text-xs font-bold truncate">{scene.title}</span>
              )}
              {scene.dialogue && (
                <Badge variant="outline" className="text-[9px] px-1 py-0">
                  <MessageSquare className="h-2.5 w-2.5 mr-0.5" />Dialogue
                </Badge>
              )}
              {scene.mood && moodBadge && (
                <Badge className={`text-[9px] px-1.5 py-0 ${moodBadge}`}>{scene.mood}</Badge>
              )}
              {scene.cameraMove && (
                <Badge variant="outline" className="text-[9px] px-1 py-0 border-cyan-200 text-cyan-600">
                  <Camera className="h-2.5 w-2.5 mr-0.5" />{scene.cameraMove}
                </Badge>
              )}
              {scene.lighting && (
                <Badge variant="outline" className="text-[9px] px-1 py-0 border-amber-200 text-amber-600">
                  <Lightbulb className="h-2.5 w-2.5 mr-0.5" />{scene.lighting}
                </Badge>
              )}
            </div>

            {/* Prompt */}
            <p
              className={`text-[11px] text-muted-foreground leading-relaxed ${expandedPrompt ? "" : "line-clamp-2"}`}
            >
              {scene.enhancedPrompt || scene.prompt}
            </p>
            {(scene.enhancedPrompt || scene.prompt).length > 120 && (
              <button
                onClick={() => setExpandedPrompt(!expandedPrompt)}
                className="text-[10px] text-violet-500 mt-0.5 hover:underline"
              >
                {expandedPrompt ? "Show less" : "Show more"}
              </button>
            )}
            {scene.dialogue && (
              <p className="text-[10px] text-violet-500 mt-1 italic line-clamp-1">
                {scene.dialogue}
              </p>
            )}

            {/* Narration audio player */}
            {scene.narrationUrl && (
              <div className="mt-1.5 flex items-center gap-1.5">
                <Volume2 className="h-3 w-3 text-emerald-500 shrink-0" />
                <audio controls src={scene.narrationUrl} className="h-6 w-full max-w-[180px]" preload="none" />
              </div>
            )}

            {/* Video player for completed scenes */}
            {scene.videoUrl && (
              <div className="mt-2">
                <video
                  src={scene.videoUrl}
                  controls
                  className="w-full max-h-40 rounded-lg bg-black"
                  preload="metadata"
                />
                <a
                  href={scene.videoUrl}
                  download
                  className="inline-flex items-center gap-1 text-[10px] text-violet-500 hover:text-violet-700 mt-1"
                >
                  <Download className="h-3 w-3" />Download video
                </a>
              </div>
            )}

            {/* Progress spinner */}
            {scene.status === "generating" && (
              <div className="mt-2 flex items-center gap-2 text-[10px] text-violet-500">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>Generating video...</span>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
              {!scene.videoUrl && scene.status !== "generating" && (
                <Button
                  size="sm" variant="outline" className="h-6 text-[10px] px-2"
                  onClick={() => onGenerate(scene.id, scene.enhancedPrompt || scene.prompt)}
                >
                  <Play className="h-3 w-3 mr-0.5" />Generate Video
                </Button>
              )}
              {scene.status === "failed" && (
                <Button
                  size="sm" variant="outline" className="h-6 text-[10px] px-2"
                  onClick={() => onRetry(scene)}
                >
                  <RefreshCw className="h-3 w-3 mr-0.5" />Retry
                </Button>
              )}
              {scene.dialogue && !scene.narrationUrl && (
                <div className="flex items-center gap-1">
                  <Select value={narrationVoice} onValueChange={setNarrationVoice}>
                    <SelectTrigger className="h-6 w-20 text-[10px] px-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TTS_VOICES.map((v) => (
                        <SelectItem key={v.id} value={v.id}>
                          <span className="text-[10px]">{v.label}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm" variant="outline" className="h-6 text-[10px] px-2"
                    onClick={() => onNarrate(scene.id, narrationVoice)}
                    disabled={isGeneratingNarration}
                  >
                    {isGeneratingNarration
                      ? <><Loader2 className="h-3 w-3 animate-spin mr-0.5" />Generating...</>
                      : <><Volume2 className="h-3 w-3 mr-0.5" />Narrate</>
                    }
                  </Button>
                </div>
              )}
              <Button
                size="sm" variant="outline" className="h-6 text-[10px] px-2"
                onClick={() => onEnhanceScene(scene)}
              >
                <Wand2 className="h-3 w-3 mr-0.5" />AI Enhance
              </Button>
              <Select value={scene.transition} onValueChange={(v) => onTransitionChange(scene.id, v)}>
                <SelectTrigger className="h-6 w-20 text-[10px] px-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TRANSITIONS.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      <span className="text-[10px]">{t.label}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm" variant="ghost"
                className="h-6 text-[10px] px-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 ml-auto"
                onClick={() => onDelete(scene.id, "Scene " + scene.sceneNumber)}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>

            {/* AI Director Controls */}
            <div className="mt-2 pt-2 border-t border-slate-100">
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label className="text-[9px] text-muted-foreground uppercase tracking-wider">Mood</Label>
                  <Select value={scene.mood || ""} onValueChange={(v) => onMoodChange(scene.id, v)}>
                    <SelectTrigger className="h-7 text-[10px] px-1 mt-0.5">
                      <SelectValue placeholder="Set mood" />
                    </SelectTrigger>
                    <SelectContent>
                      {MOODS.map((m) => (
                        <SelectItem key={m} value={m}>
                          <span className="text-[10px] capitalize">{m}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-[9px] text-muted-foreground uppercase tracking-wider">Camera</Label>
                  <Select value={scene.cameraMove || ""} onValueChange={(v) => onCameraChange(scene.id, v)}>
                    <SelectTrigger className="h-7 text-[10px] px-1 mt-0.5">
                      <SelectValue placeholder="Camera move" />
                    </SelectTrigger>
                    <SelectContent>
                      {CAMERA_MOVES.map((c) => (
                        <SelectItem key={c} value={c}>
                          <span className="text-[10px] capitalize">{c}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-[9px] text-muted-foreground uppercase tracking-wider">Lighting</Label>
                  <Select value={scene.lighting || ""} onValueChange={(v) => onLightingChange(scene.id, v)}>
                    <SelectTrigger className="h-7 text-[10px] px-1 mt-0.5">
                      <SelectValue placeholder="Lighting" />
                    </SelectTrigger>
                    <SelectContent>
                      {LIGHTING_STYLES.map((l) => (
                        <SelectItem key={l} value={l}>
                          <span className="text-[10px] capitalize">{l}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   MAIN PAGE COMPONENT
   ════════════════════════════════════════════════════════════════ */

export default function HomePage() {
  const {
    currentView, projects, currentProject, isGenerating, isEnhancing, isRecording,
    setCurrentView, setProjects, setCurrentProject, setIsGenerating,
    setIsEnhancing, setIsRecording,
  } = useAppStore();
  const { toast } = useToast();

  /* ── Form State ── */
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
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [previewVideoUrl, setPreviewVideoUrl] = useState<string | null>(null);
  const [generatingScenes, setGeneratingScenes] = useState<Set<string>>(new Set());
  const [characters, setCharacters] = useState<Character[]>([]);
  const [parsedScenes, setParsedScenes] = useState<ParsedSceneResult[]>([]);
  const [parsedCharacters, setParsedCharacters] = useState<DetectedCharacter[]>([]);
  const [isAnalyzingScript, setIsAnalyzingScript] = useState(false);
  const [isEnhancingPrompt, setIsEnhancingPrompt] = useState(false);
  const [isGeneratingNarration, setIsGeneratingNarration] = useState(false);
  const [newCharName, setNewCharName] = useState("");
  const [newCharRole, setNewCharRole] = useState("");
  const [newCharDesc, setNewCharDesc] = useState("");
  const [charImageFile, setCharImageFile] = useState<File | null>(null);
  const [charUploadTargetId, setCharUploadTargetId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportQuality, setExportQuality] = useState("standard");
  const [exportTransition, setExportTransition] = useState("fade");
  const [exportFormat, setExportFormat] = useState("mp4");
  const [exportTitleCard, setExportTitleCard] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [galleryCategory, setGalleryCategory] = useState("All");
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [pendingDeleteAction, setPendingDeleteAction] = useState<{ type: string; id: string } | null>(null);
  const [continuityResult, setContinuityResult] = useState<{ score: number; issues: ContinuityIssue[]; summary?: string } | null>(null);
  const [isCheckingContinuity, setIsCheckingContinuity] = useState(false);
  const [continuityDialogOpen, setContinuityDialogOpen] = useState(false);
  const [isRecordingAudio, setIsRecordingAudio] = useState(false);
  const [uploadedImagePreview, setUploadedImagePreview] = useState<string | null>(null);
  const [charVoiceAssign, setCharVoiceAssign] = useState<Record<string, string>>({});
  const [sceneFilter, setSceneFilter] = useState("all");
  const [editingProjectTitle, setEditingProjectTitle] = useState(false);
  const [editableTitle, setEditableTitle] = useState("");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const charFileInputRef = useRef<HTMLInputElement>(null);

  /* ── Computed values ── */
  const effectiveDuration = isCustomDuration && customDuration
    ? Math.max(10, Math.min(300, parseInt(customDuration) || 60))
    : selectedDuration;
  const effectiveSceneCount = Math.max(1, Math.ceil(effectiveDuration / 10));

  const safeProjects = Array.isArray(projects) ? projects : [];
  const safeScenes = currentProject?.scenes && Array.isArray(currentProject.scenes)
    ? currentProject.scenes : [];
  const safeCharacters = currentProject?.characters && Array.isArray(currentProject.characters)
    ? currentProject.characters : [];
  const isAnyGenerating = safeScenes.some((s) => s.status === "generating");
  const completedSceneCount = safeScenes.filter((s) => s.videoUrl).length;
  const failedSceneCount = safeScenes.filter((s) => s.status === "failed").length;
  const filteredScenes = sceneFilter === "all"
    ? safeScenes
    : safeScenes.filter((s) => s.status === sceneFilter);

  /* ── DnD sensors ── */
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  /* ── API Handlers ── */

  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch("/api/projects");
      const data = await res.json();
      if (data.success) setProjects(data.projects);
    } catch { /* silent */ }
  }, [setProjects]);

  const refreshProject = useCallback(async () => {
    if (!currentProject) return;
    try {
      const res = await fetch(`/api/projects/${currentProject.id}`);
      const data = await res.json();
      if (data.success) {
        setCurrentProject(data.project);
        if (data.project.characters) setCharacters(data.project.characters);
      }
    } catch { /* silent */ }
  }, [currentProject, setCurrentProject]);

  // Auto-refresh project every 15s when in studio
  useEffect(() => {
    if (currentView !== "studio" || !currentProject) return;
    const interval = setInterval(refreshProject, 15000);
    return () => clearInterval(interval);
  }, [currentView, currentProject, refreshProject]);

  // Load projects on mount
  useEffect(() => { fetchProjects(); }, [fetchProjects]);

  // Auto-trigger generation on entering studio if there are pending scenes
  useEffect(() => {
    if (currentView === "studio" && currentProject && safeScenes.length > 0) {
      const hasPending = safeScenes.some(
        (s) => s.status === "pending" && !s.videoUrl,
      );
      if (hasPending && !isAnyGenerating && !isGenerating) {
        handleGenerateAll();
      }
    }
  }, [currentView]);

  const handleGenerateAll = async () => {
    if (!currentProject) return;
    setIsGenerating(true);
    try {
      const res = await fetch("/api/generate-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: currentProject.id }),
      });
      const data = await res.json();
      if (data.success) {
        toast({ title: "Generation started", description: data.message });
        setTimeout(refreshProject, 5000);
      } else {
        toast({ title: "Generation failed", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to start generation", variant: "destructive" });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerateSingle = async (sceneId: string, prompt: string) => {
    if (!currentProject) return;
    setGeneratingScenes((prev) => new Set(prev).add(sceneId));
    try {
      const res = await fetch(`/api/generate-video`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: currentProject.id }),
      });
      const data = await res.json();
      if (data.success) {
        toast({ title: "Generating video..." });
        setTimeout(refreshProject, 5000);
      } else {
        toast({ title: "Failed", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", variant: "destructive" });
    } finally {
      setGeneratingScenes((prev) => { const n = new Set(prev); n.delete(sceneId); return n; });
    }
  };

  const handleRetryScene = async (scene: VideoScene) => {
    if (!currentProject) return;
    try {
      await fetch(`/api/projects/${currentProject.id}/scenes/${scene.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "pending", taskId: null }),
      });
      toast({ title: "Queued for retry" });
      handleGenerateAll();
    } catch {
      toast({ title: "Retry failed", variant: "destructive" });
    }
  };

  const handleDeleteClick = (type: string, id: string) => {
    setPendingDeleteAction({ type, id });
    setConfirmDeleteOpen(true);
  };

  const confirmDelete = async () => {
    if (!pendingDeleteAction) return;
    setConfirmDeleteOpen(false);
    const { type, id } = pendingDeleteAction;
    setPendingDeleteAction(null);

    if (type === "scene") {
      if (!currentProject) return;
      try {
        await fetch(`/api/projects/${currentProject.id}/scenes/${id}`, { method: "DELETE" });
        refreshProject();
        toast({ title: "Scene removed" });
      } catch {
        toast({ title: "Failed", variant: "destructive" });
      }
    } else if (type === "character") {
      if (!currentProject) return;
      try {
        await fetch(`/api/projects/${currentProject.id}/characters/${id}`, { method: "DELETE" });
        setCharacters((prev) => prev.filter((c) => c.id !== id));
        refreshProject();
        toast({ title: "Character removed" });
      } catch {
        toast({ title: "Failed", variant: "destructive" });
      }
    } else {
      try {
        await fetch(`/api/projects/${id}`, { method: "DELETE" });
        fetchProjects();
        if (currentProject?.id === id) {
          setCurrentProject(null);
          setCurrentView("home");
        }
        toast({ title: "Project deleted" });
      } catch {
        toast({ title: "Failed", variant: "destructive" });
      }
    }
  };

  const cancelDelete = () => {
    setConfirmDeleteOpen(false);
    setPendingDeleteAction(null);
  };

  const handleAddScene = async () => {
    if (!currentProject || !newScenePrompt.trim()) return;
    try {
      const res = await fetch(`/api/projects/${currentProject.id}/scenes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: newScenePrompt, transition: newSceneTransition }),
      });
      const data = await res.json();
      if (data.success) {
        setNewScenePrompt("");
        refreshProject();
        toast({ title: "Scene added" });
      }
    } catch {
      toast({ title: "Failed to add scene", variant: "destructive" });
    }
  };

  const handleAddCharacter = async () => {
    if (!currentProject || !newCharName.trim()) return;
    try {
      const res = await fetch(`/api/projects/${currentProject.id}/characters`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newCharName,
          role: newCharRole || "supporting",
          description: newCharDesc || null,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setNewCharName("");
        setNewCharRole("");
        setNewCharDesc("");
        refreshProject();
        toast({ title: "Character added" });
      }
    } catch {
      toast({ title: "Failed to add character", variant: "destructive" });
    }
  };

  const handleUploadCharImage = async (characterId: string) => {
    if (!currentProject || !charImageFile) return;
    try {
      const fd = new FormData();
      fd.append("image", charImageFile);
      fd.append("characterId", characterId);
      const res = await fetch(`/api/projects/${currentProject.id}/characters/upload`, {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (data.success) {
        toast({ title: "Character image uploaded" });
        refreshProject();
        setCharImageFile(null);
      }
    } catch {
      toast({ title: "Upload failed", variant: "destructive" });
    }
  };

  const handleGenerateCharPortrait = async (characterId: string) => {
    if (!currentProject) return;
    try {
      const res = await fetch(`/api/projects/${currentProject.id}/characters/${characterId}/generate-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (data.success) {
        toast({ title: "AI portrait generated" });
        refreshProject();
      } else {
        toast({ title: "Generation failed", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Portrait generation failed", variant: "destructive" });
    }
  };

  const handleAssignVoice = async (characterId: string, voiceId: string) => {
    if (!currentProject) return;
    setCharVoiceAssign((prev) => ({ ...prev, [characterId]: voiceId }));
    try {
      await fetch(`/api/projects/${currentProject.id}/characters/${characterId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voiceId }),
      });
      refreshProject();
      toast({ title: "Voice assigned" });
    } catch {
      toast({ title: "Failed to assign voice", variant: "destructive" });
    }
  };

  const handleNarrateScene = async (sceneId: string, voice?: string) => {
    if (!currentProject) return;
    setIsGeneratingNarration(true);
    try {
      const res = await fetch("/api/generate-narration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: currentProject.id,
          sceneId,
          voice: voice || "tongtong",
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast({ title: "Narration generated" });
        refreshProject();
      } else {
        toast({ title: "Narration failed", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Narration error", variant: "destructive" });
    } finally {
      setIsGeneratingNarration(false);
    }
  };

  const handleEnhanceScene = async (scene: VideoScene) => {
    if (!currentProject) return;
    try {
      const totalScenes = safeScenes.length;
      const res = await fetch("/api/enhance-scene", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: scene.prompt,
          sceneIndex: scene.sceneNumber - 1,
          totalScenes,
          style: currentProject.style,
          mood: scene.mood,
          cameraMove: scene.cameraMove,
          lighting: scene.lighting,
        }),
      });
      const data = await res.json();
      if (data.success) {
        await fetch(`/api/projects/${currentProject.id}/scenes/${scene.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            enhancedPrompt: data.enhancedPrompt,
            mood: data.mood,
            cameraMove: data.cameraMove,
            lighting: data.lighting,
          }),
        });
        refreshProject();
        toast({ title: "Scene enhanced by AI Director" });
      } else {
        toast({ title: "Enhancement failed", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Error enhancing scene", variant: "destructive" });
    }
  };

  const handleSceneMoodChange = async (sceneId: string, mood: string) => {
    if (!currentProject) return;
    try {
      await fetch(`/api/projects/${currentProject.id}/scenes/${sceneId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mood }),
      });
      refreshProject();
    } catch { /* silent */ }
  };

  const handleSceneCameraChange = async (sceneId: string, cameraMove: string) => {
    if (!currentProject) return;
    try {
      await fetch(`/api/projects/${currentProject.id}/scenes/${sceneId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cameraMove }),
      });
      refreshProject();
    } catch { /* silent */ }
  };

  const handleSceneLightingChange = async (sceneId: string, lighting: string) => {
    if (!currentProject) return;
    try {
      await fetch(`/api/projects/${currentProject.id}/scenes/${sceneId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lighting }),
      });
      refreshProject();
    } catch { /* silent */ }
  };

  const handleSceneTransitionChange = async (sceneId: string, transition: string) => {
    if (!currentProject) return;
    try {
      await fetch(`/api/projects/${currentProject.id}/scenes/${sceneId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transition }),
      });
      refreshProject();
    } catch { /* silent */ }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    if (!currentProject) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = safeScenes.findIndex((s) => s.id === active.id);
    const newIndex = safeScenes.findIndex((s) => s.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = [...safeScenes];
    const [moved] = reordered.splice(oldIndex, 1);
    reordered.splice(newIndex, 0, moved);

    const sceneIds = reordered.map((s) => s.id);
    try {
      await fetch(`/api/projects/${currentProject.id}/scenes/reorder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sceneIds }),
      });
      refreshProject();
    } catch {
      toast({ title: "Reorder failed", variant: "destructive" });
    }
  };

  const handleCheckContinuity = async () => {
    if (!currentProject) return;
    setIsCheckingContinuity(true);
    try {
      const res = await fetch("/api/check-continuity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: currentProject.id }),
      });
      const data = await res.json();
      if (data.success) {
        setContinuityResult({ score: data.score, issues: data.issues || [], summary: data.summary });
        setContinuityDialogOpen(true);
      } else {
        toast({ title: "Continuity check failed", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", variant: "destructive" });
    } finally {
      setIsCheckingContinuity(false);
    }
  };

  const handleApplyFix = async (issue: ContinuityIssue) => {
    if (!currentProject) return;
    const scene = safeScenes[issue.sceneIndex];
    if (!scene) return;
    try {
      await fetch(`/api/projects/${currentProject.id}/scenes/${scene.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: issue.fix }),
      });
      refreshProject();
      toast({ title: "Fix applied", description: issue.fix.slice(0, 60) + "..." });
    } catch {
      toast({ title: "Failed to apply fix", variant: "destructive" });
    }
  };

  const handleExport = async () => {
    if (!currentProject) return;
    setIsExporting(true);
    try {
      const res = await fetch("/api/export-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: currentProject.id,
          quality: exportQuality,
          transition: exportTransition,
          format: exportFormat,
          withTitleCard: exportTitleCard,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast({ title: "Export complete!", description: data.message });
        refreshProject();
      } else {
        toast({ title: "Export failed", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Export error", variant: "destructive" });
    } finally {
      setIsExporting(false);
    }
  };

  const handleAnalyzeScript = async () => {
    const text = inputMode === "script" ? scriptText : textPrompt;
    if (!text.trim()) return;
    setIsAnalyzingScript(true);
    try {
      const res = await fetch("/api/split-scenes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text, targetDuration: effectiveDuration }),
      });
      const data = await res.json();
      if (data.success) {
        setParsedScenes(data.scenes);
        setParsedCharacters(data.characters || []);
        toast({
          title: "Script analyzed",
          description: `Found ${data.scenes.length} scene${data.scenes.length > 1 ? "s" : ""}${data.characters?.length ? ` and ${data.characters.length} character${data.characters.length > 1 ? "s" : ""}` : ""}`,
        });
      } else {
        toast({ title: "Analysis failed", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Error analyzing script", variant: "destructive" });
    } finally {
      setIsAnalyzingScript(false);
    }
  };

  const handleEnhanceTextPrompt = async () => {
    if (!textPrompt.trim()) return;
    setIsEnhancingPrompt(true);
    try {
      const res = await fetch("/api/enhance-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: textPrompt, style: selectedStyle }),
      });
      const data = await res.json();
      if (data.success) {
        setEnhancedText(data.enhancedPrompt);
        toast({ title: "Prompt enhanced" });
      }
    } catch {
      toast({ title: "Enhancement failed", variant: "destructive" });
    } finally {
      setIsEnhancingPrompt(false);
    }
  };

  const handleCreateAndGenerate = async () => {
    const text = inputMode === "script" ? scriptText : textPrompt;
    if (!text.trim() && parsedScenes.length === 0) {
      toast({ title: "Please provide content", variant: "destructive" });
      return;
    }

    setIsCreating(true);
    try {
      // Step 1: Create project
      const projRes = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: projectTitle || "Untitled Project",
          description: text.slice(0, 200),
          style: selectedStyle,
          aspectRatio: selectedAspect,
          targetDuration: effectiveDuration,
          projectType,
          characters: parsedCharacters.length > 0 ? parsedCharacters.map((c) => ({
            name: c.name,
            role: c.role || "supporting",
            description: c.description || null,
            stylePrompt: c.stylePrompt || null,
          })) : undefined,
        }),
      });
      const projData = await projRes.json();

      if (!projData.success) {
        toast({ title: "Failed to create project", description: projData.error, variant: "destructive" });
        return;
      }

      const project = projData.project;

      // Step 2: Create scenes
      const scenesToCreate = parsedScenes.length > 0 ? parsedScenes : [{
        prompt: enhancedText || text,
        title: projectTitle || null,
        dialogue: null,
        characterNames: undefined,
      }];

      for (let i = 0; i < scenesToCreate.length; i++) {
        const s = scenesToCreate[i];
        await fetch(`/api/projects/${project.id}/scenes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: s.prompt,
            title: s.title || undefined,
            dialogue: s.dialogue || undefined,
            characterIds: s.characterNames ? JSON.stringify([]) : undefined,
            duration: Math.floor(effectiveDuration / scenesToCreate.length),
          }),
        });
      }

      // Step 3: Set current project and go to studio
      setCurrentProject(project);
      setCurrentView("studio");
      setParsedScenes([]);
      setParsedCharacters([]);
      setScriptText("");
      setTextPrompt("");
      setEnhancedText("");
      setProjectTitle("");
      toast({ title: "Project created!", description: "Generating videos..." });

      // Step 4: Trigger generation after entering studio
      setTimeout(async () => {
        await fetch("/api/generate-video", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: project.id }),
        });
      }, 2000);
    } catch {
      toast({ title: "Error creating project", variant: "destructive" });
    } finally {
      setIsCreating(false);
    }
  };

  const handleRecordAudio = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => audioChunksRef.current.push(e.data);
      recorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        const file = new File([blob], "recording.webm", { type: "audio/webm" });
        setVideoFile(file);
        setIsRecording(false);
        toast({ title: "Recording saved" });
        // Auto-transcribe
        const fd = new FormData();
        fd.append("audio", file);
        fetch("/api/transcribe", { method: "POST", body: fd })
          .then((r) => r.json())
          .then((d) => {
            if (d.success && d.text) setTextPrompt(d.text);
          })
          .catch(() => { /* transcription failed */ });
        stream.getTracks().forEach((t) => t.stop());
      };
      recorder.start();
      setIsRecording(true);
      setIsRecordingAudio(true);
      mediaRecorderRef.current = recorder;
    } catch {
      toast({ title: "Microphone access denied", variant: "destructive" });
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
      setIsRecordingAudio(false);
    }
  };

  const handleUploadImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setVideoFile(file);
    const url = URL.createObjectURL(file);
    setUploadedImagePreview(url);
    setVideoPreview(url);
    // Also use the file name as prompt hint
    const baseName = file.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ");
    if (!textPrompt) setTextPrompt(baseName);
  };

  const handleCharImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCharImageFile(file);
  };

  const handleSelectClassicScene = (scene: ClassicScene) => {
    setTextPrompt(scene.prompt);
    setInputMode("text");
    setCreateDialogOpen(true);
    setProjectTitle(scene.title);
  };

  const openVideoPreview = (url: string) => setPreviewVideoUrl(url);
  const closePreview = () => { setPreviewVideoUrl(null); setPreviewImage(null); };

  const handleUpdateProjectTitle = async () => {
    if (!currentProject || !editableTitle.trim()) return;
    try {
      await fetch(`/api/projects/${currentProject.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: editableTitle }),
      });
      refreshProject();
      setEditingProjectTitle(false);
      toast({ title: "Title updated" });
    } catch {
      toast({ title: "Failed to update title", variant: "destructive" });
    }
  };

  const formatDuration = (sec: number) => {
    if (sec < 60) return sec + "s";
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  const openProject = (p: VideoProject) => {
    setCurrentProject(p);
    if (p.characters) setCharacters(p.characters);
    setCurrentView("studio");
  };

  /* ════════════════════════════════════════════════════════════════
     RENDER
     ════════════════════════════════════════════════════════════════ */

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* ── Header ── */}
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <button
            onClick={() => currentView !== "home" ? setCurrentView("home") : undefined}
            className="flex items-center gap-2.5 font-bold text-lg hover:opacity-80 transition-opacity"
          >
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-violet-500/20">
              <Clapperboard className="h-4 w-4 text-white" />
            </div>
            <span className="bg-gradient-to-r from-violet-600 to-fuchsia-600 bg-clip-text text-transparent font-extrabold tracking-tight">
              Vidora
            </span>
            <Badge variant="outline" className="text-[10px] font-semibold text-violet-500 border-violet-200 ml-1">
              PRO
            </Badge>
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

          {/* ═══════════════════════════════════════════════════════
              HOME VIEW
              ═══════════════════════════════════════════════════════ */}
          {currentView === "home" && (
            <motion.div key="home" {...fadeUp}>
              {/* Hero */}
              <section className="relative overflow-hidden min-h-[520px] sm:min-h-[600px]">
                {/* Hero Background Image */}
                <img
                  src="/images/hero-bg.png"
                  alt="Vidora AI Video Studio"
                  className="absolute inset-0 w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-violet-950/60 to-black/80" />
                <div className="orb orb-violet w-[400px] h-[400px] -top-20 -left-32" />
                <div className="orb orb-amber w-[300px] h-[300px] top-10 right-10" />
                <div className="orb orb-rose w-[250px] h-[250px] bottom-20 left-1/2" />
                <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 py-20 sm:py-28 lg:py-36 text-center">
                  <motion.div
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6 }}
                    className="space-y-6"
                  >
                    <Badge className="px-4 py-1.5 text-xs font-semibold glass-card text-violet-200 hover:bg-white/10 cursor-default">
                      <Zap className="h-3 w-3 mr-1.5 text-amber-400" />Professional AI Video Studio
                    </Badge>
                    <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-tight">
                      <span className="text-white">Create Production-Ready</span>
                      <br />
                      <span className="hero-text-gradient">AI Videos</span>
                    </h1>
                    <p className="text-lg sm:text-xl text-violet-200/80 max-w-2xl mx-auto leading-relaxed">
                      Write scripts, design characters, generate cinematic scenes with AI Director controls. From birthday stories to commercials — all powered by AI.
                    </p>
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
                    <div className="flex items-center justify-center gap-6 sm:gap-8 pt-4 text-sm flex-wrap">
                      {[
                        { icon: Users, label: "Character", sub: "System" },
                        { icon: FileText, label: "Script", sub: "Parsing" },
                        { icon: Film, label: "10s – 5min", sub: "Duration" },
                        { icon: Monitor, label: "5 Aspect", sub: "Ratios" },
                        { icon: Wand2, label: "AI Director", sub: "Controls" },
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
                <div className="absolute bottom-0 inset-x-0 h-24 bg-gradient-to-t from-background to-transparent" />
              </section>

              {/* Quick Create Cards */}
              <section className="max-w-5xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
                <div className="text-center mb-8">
                  <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Quick Create</h2>
                  <p className="text-muted-foreground mt-1">Choose how you want to start</p>
                </div>
                <motion.div {...stagger} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
                  {[
                    { icon: <FileText className="h-6 w-6" />, title: "Script to Video", desc: "Write a full screenplay with scenes, dialogue, and characters", color: "from-violet-500 to-purple-500", action: () => { setInputMode("script"); setCurrentView("create"); } },
                    { icon: <Wand2 className="h-6 w-6" />, title: "Text to Video", desc: "Describe your scene and let AI enhance and generate video", color: "from-fuchsia-500 to-pink-500", action: () => { setInputMode("text"); setCurrentView("create"); } },
                    { icon: <Mic className="h-6 w-6" />, title: "Voice to Video", desc: "Record your idea, we transcribe and create it automatically", color: "from-amber-500 to-orange-500", action: () => { setInputMode("voice"); setCurrentView("create"); } },
                    { icon: <Upload className="h-6 w-6" />, title: "Image to Video", desc: "Upload an image and animate it into a stunning video", color: "from-teal-500 to-emerald-500", action: () => { setInputMode("video"); setCurrentView("create"); } },
                  ].map((card) => (
                    <motion.div key={card.title} {...fadeItem}>
                      <Card
                        className="card-glow cursor-pointer border-0 shadow-lg shadow-black/5 bg-white group h-full"
                        onClick={card.action}
                      >
                        <CardHeader className="pb-3">
                          <div className={`mb-3 h-11 w-11 rounded-xl bg-gradient-to-br ${card.color} flex items-center justify-center text-white shadow-lg group-hover:scale-110 transition-transform duration-300`}>
                            {card.icon}
                          </div>
                          <CardTitle className="text-base font-bold">{card.title}</CardTitle>
                          <CardDescription className="text-sm leading-relaxed">{card.desc}</CardDescription>
                        </CardHeader>
                      </Card>
                    </motion.div>
                  ))}
                </motion.div>
              </section>

              {/* Features Showcase */}
              <section className="max-w-6xl mx-auto px-4 sm:px-6 py-12">
                <div className="section-divider mb-12" />
                <div className="text-center mb-10">
                  <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Everything You Need for Professional Videos</h2>
                  <p className="text-muted-foreground mt-2 max-w-2xl mx-auto">From script analysis to AI Director controls, Vidora handles every step.</p>
                </div>
                <motion.div {...stagger} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                  {FEATURES.map((f) => (
                    <motion.div key={f.title} {...fadeItem}>
                      <Card className="card-glow border-0 shadow-lg shadow-black/5 bg-white h-full">
                        <CardHeader className="pb-3">
                          <div className={`mb-3 h-10 w-10 rounded-xl bg-gradient-to-br ${f.color} flex items-center justify-center text-white shadow-lg`}>
                            <f.icon className="h-5 w-5" />
                          </div>
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
                <div className="section-divider mb-12" />
                <div className="text-center mb-10">
                  <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">How It Works</h2>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                  {STEPS.map((step, i) => (
                    <div key={step.num} className="text-center relative">
                      <div className="mx-auto mb-4 h-14 w-14 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center text-white text-xl font-extrabold shadow-lg shadow-violet-500/20">
                        {step.num}
                      </div>
                      <h3 className="font-bold text-lg mb-1">{step.title}</h3>
                      <p className="text-sm text-muted-foreground leading-relaxed">{step.desc}</p>
                      {i < STEPS.length - 1 && (
                        <ChevronRight className="h-5 w-5 text-violet-300 absolute top-7 -right-3 hidden sm:block" />
                      )}
                    </div>
                  ))}
                </div>
              </section>

              {/* Testimonials */}
              <section className="max-w-5xl mx-auto px-4 sm:px-6 py-12">
                <div className="section-divider mb-12" />
                <div className="text-center mb-10">
                  <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Loved by Creators</h2>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
                  {TESTIMONIALS.map((t) => (
                    <Card key={t.name} className="card-glow border-0 shadow-md bg-white">
                      <CardContent className="pt-6">
                        <Quote className="h-6 w-6 text-violet-200 mb-3" />
                        <p className="text-sm text-foreground leading-relaxed mb-4">&ldquo;{t.text}&rdquo;</p>
                        <div className="flex items-center gap-3">
                          <div className="h-9 w-9 rounded-full bg-gradient-to-br from-violet-400 to-fuchsia-400 flex items-center justify-center text-white text-xs font-bold">
                            {t.avatar}
                          </div>
                          <div>
                            <p className="text-sm font-bold">{t.name}</p>
                            <p className="text-xs text-muted-foreground">{t.role}</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </section>

              {/* Recent Projects */}
              {safeProjects.length > 0 && (
                <section className="max-w-5xl mx-auto px-4 sm:px-6 pb-12 sm:pb-16">
                  <div className="section-divider mb-12" />
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="text-xl sm:text-2xl font-bold tracking-tight">Recent Projects</h2>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {safeProjects.slice(0, 6).map((p) => (
                      <Card
                        key={p.id}
                        className="card-glow cursor-pointer bg-white border-0 shadow-md shadow-black/5"
                        onClick={() => openProject(p)}
                      >
                        <CardHeader className="pb-2">
                          <div className="flex items-start justify-between">
                            <CardTitle className="text-base font-bold truncate pr-2">{p.title}</CardTitle>
                            <Badge className={`text-[10px] font-semibold px-2 shrink-0 ${
                              p.status === "completed" ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                              : p.status === "generating" ? "bg-violet-50 text-violet-700 border-violet-200"
                              : p.status === "failed" ? "bg-red-50 text-red-700 border-red-200"
                              : "bg-slate-50 text-slate-600 border-slate-200"
                            }`}>
                              {p.status}
                            </Badge>
                          </div>
                        </CardHeader>
                        <CardContent>
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground flex-wrap">
                            <Badge variant="outline" className="text-[10px]">{p.aspectRatio}</Badge>
                            <Badge variant="outline" className="text-[10px]">{p.style}</Badge>
                            <span className="flex items-center gap-0.5"><Clock className="h-3 w-3" />{formatDuration(p.targetDuration)}</span>
                            {p.projectType && p.projectType !== "custom" && (
                              <Badge className="text-[10px] bg-violet-50 text-violet-600 border-violet-200">{p.projectType}</Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 mt-2 text-xs text-muted-foreground">
                            <Film className="h-3 w-3" /><span>{p.scenes?.length || 0} scenes</span>
                            {p.characters && p.characters.length > 0 && (
                              <span className="flex items-center gap-0.5"><Users className="h-3 w-3" />{p.characters.length} chars</span>
                            )}
                          </div>
                          {p.finalVideoUrl && (
                            <div className="mt-2">
                              <Badge className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">
                                <CheckCircle className="h-3 w-3 mr-1" />Exported
                              </Badge>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </section>
              )}

              {/* Footer */}
              <footer className="mt-auto border-t bg-slate-50/50">
                <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-8">
                    <div className="sm:col-span-2">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center">
                          <Clapperboard className="h-3.5 w-3.5 text-white" />
                        </div>
                        <span className="font-extrabold text-lg bg-gradient-to-r from-violet-600 to-fuchsia-600 bg-clip-text text-transparent">Vidora</span>
                      </div>
                      <p className="text-sm text-muted-foreground leading-relaxed max-w-sm">
                        Professional AI video studio. Create stunning videos from scripts, text prompts, voice, or images with AI-powered scene generation.
                      </p>
                    </div>
                    <div>
                      <h4 className="font-bold text-sm mb-3">Product</h4>
                      <ul className="space-y-2 text-sm text-muted-foreground">
                        <li><button onClick={() => setCurrentView("create")} className="hover:text-violet-500 transition-colors">Create Video</button></li>
                        <li><button onClick={() => setCurrentView("gallery")} className="hover:text-violet-500 transition-colors">Templates</button></li>
                        <li><span className="hover:text-violet-500 transition-colors cursor-default">Features</span></li>
                      </ul>
                    </div>
                    <div>
                      <h4 className="font-bold text-sm mb-3">Support</h4>
                      <ul className="space-y-2 text-sm text-muted-foreground">
                        <li><span className="hover:text-violet-500 transition-colors cursor-default">Documentation</span></li>
                        <li><span className="hover:text-violet-500 transition-colors cursor-default">API Reference</span></li>
                        <li><span className="hover:text-violet-500 transition-colors cursor-default">Contact</span></li>
                      </ul>
                    </div>
                  </div>
                  <Separator className="my-6" />
                  <p className="text-xs text-muted-foreground text-center">&copy; {new Date().getFullYear()} Vidora AI. Professional AI Video Studio.</p>
                </div>
              </footer>
            </motion.div>
          )}

          {/* ═══════════════════════════════════════════════════════
              CREATE VIEW
              ═══════════════════════════════════════════════════════ */}
          {currentView === "create" && (
            <motion.div key="create" {...fadeUp} className="max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-6">
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Create New Video</h1>
                <p className="text-muted-foreground mt-1">Write a script, describe a scene, or choose a template</p>
              </div>

              {/* Project Settings — Always at the top */}
              <Card className="border-0 shadow-lg shadow-black/5 bg-white card-glow">
                <CardHeader className="pb-4">
                  <CardTitle className="text-base font-bold flex items-center gap-2">
                    <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center text-white">
                      <Settings className="h-3.5 w-3.5" />
                    </div>
                    Project Settings
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="space-y-1.5">
                    <Label className="text-sm font-medium">Project Title</Label>
                    <Input placeholder="My Cinematic Video" value={projectTitle} onChange={(e) => setProjectTitle(e.target.value)} className="h-10" />
                  </div>

                  {/* Project Type */}
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Project Type</Label>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                      {PROJECT_TEMPLATES.map((t) => (
                        <button
                          key={t.id}
                          onClick={() => setProjectType(t.id)}
                          className={`relative p-3 rounded-xl border-2 text-left transition-all duration-200 ${
                            projectType === t.id
                              ? "border-violet-400 bg-violet-50"
                              : "border-slate-100 hover:border-slate-200"
                          }`}
                        >
                          <div className={`h-8 w-8 rounded-lg bg-gradient-to-br ${t.color} flex items-center justify-center text-white mb-2`}>
                            <t.icon className="h-4 w-4" />
                          </div>
                          <p className="text-xs font-bold">{t.label}</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{t.desc}</p>
                          {projectType === t.id && (
                            <div className="absolute top-2 right-2 h-2.5 w-2.5 rounded-full bg-violet-500" />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Duration */}
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Duration</Label>
                    <div className="flex items-center gap-3 flex-wrap">
                      <div className="flex gap-1.5 flex-wrap">
                        {DURATION_PRESETS.map((d) => (
                          <button
                            key={d.value}
                            onClick={() => { setSelectedDuration(d.value); setIsCustomDuration(false); }}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
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
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                          isCustomDuration
                            ? "bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-md"
                            : "bg-amber-50 text-amber-600 hover:bg-amber-100 border border-amber-200"
                        }`}
                      >
                        Custom
                      </button>
                      {isCustomDuration && (
                        <div className="flex items-center gap-1.5">
                          <Input type="number" min={10} max={300} placeholder="seconds" value={customDuration} onChange={(e) => setCustomDuration(e.target.value)} className="w-24 h-9 text-xs" />
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

                  {/* Style, Aspect Ratio */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium">Visual Style</Label>
                      <Select value={selectedStyle} onValueChange={setSelectedStyle}>
                        <SelectTrigger className="h-10">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {STYLES.map((s) => (
                            <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium">Aspect Ratio</Label>
                      <div className="grid grid-cols-5 gap-2">
                        {ASPECTS.map((a) => (
                          <button
                            key={a.value}
                            onClick={() => setSelectedAspect(a.value)}
                            className={`p-2 rounded-lg border-2 text-center transition-all ${
                              selectedAspect === a.value
                                ? "border-violet-400 bg-violet-50"
                                : "border-slate-100 hover:border-slate-200"
                            }`}
                          >
                            <a.icon className={`h-4 w-4 mx-auto ${selectedAspect === a.value ? "text-violet-600" : "text-slate-400"}`} />
                            <p className="text-[9px] mt-0.5 font-bold">{a.label}</p>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Input Tabs */}
              <Tabs value={inputMode} onValueChange={(v) => setInputMode(v as InputMode)}>
                <TabsList className="grid grid-cols-4 w-full">
                  <TabsTrigger value="script"><FileText className="h-4 w-4 mr-1.5 hidden sm:inline" />Script</TabsTrigger>
                  <TabsTrigger value="text"><Wand2 className="h-4 w-4 mr-1.5 hidden sm:inline" />Text</TabsTrigger>
                  <TabsTrigger value="voice"><Mic className="h-4 w-4 mr-1.5 hidden sm:inline" />Voice</TabsTrigger>
                  <TabsTrigger value="video"><ImageIcon className="h-4 w-4 mr-1.5 hidden sm:inline" />Image</TabsTrigger>
                </TabsList>

                {/* Script Tab */}
                <TabsContent value="script" className="space-y-4 mt-4">
                  <Card className="border-0 shadow-lg shadow-black/5 bg-white card-glow">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base font-bold flex items-center gap-2">
                        <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-violet-500 to-purple-500 flex items-center justify-center text-white">
                          <FileText className="h-3.5 w-3.5" />
                        </div>
                        Screenplay Input
                      </CardTitle>
                      <CardDescription>Write your full script with scenes, dialogue, and character names. AI will automatically parse scenes.</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Textarea
                        placeholder={`Scene 1 – Opening\nA majestic sunrise over a vast mountain range, golden light breaking through clouds.\n\nNarrator: "In a world where dreams come alive..."\n\nScene 2 – The Journey\nOur hero walks through an enchanted forest with glowing trees.`}
                        value={scriptText}
                        onChange={(e) => setScriptText(e.target.value)}
                        className="min-h-[200px] font-mono text-sm"
                      />
                      <div className="flex items-center gap-2 mt-3">
                        <Button onClick={handleAnalyzeScript} disabled={isAnalyzingScript || !scriptText.trim()} className="btn-gradient">
                          {isAnalyzingScript ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Search className="h-4 w-4 mr-1.5" />}
                          {isAnalyzingScript ? "Analyzing..." : "Analyze Script"}
                        </Button>
                        <span className="text-xs text-muted-foreground">AI will detect scenes and characters</span>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Text Tab */}
                <TabsContent value="text" className="space-y-4 mt-4">
                  <Card className="border-0 shadow-lg shadow-black/5 bg-white card-glow">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base font-bold flex items-center gap-2">
                        <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-fuchsia-500 to-pink-500 flex items-center justify-center text-white">
                          <Wand2 className="h-3.5 w-3.5" />
                        </div>
                        Scene Description
                      </CardTitle>
                      <CardDescription>Describe what you want to see. AI will enhance your prompt with cinematic details.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <Textarea
                        placeholder="A majestic eagle soaring over a snow-capped mountain at golden hour, cinematic drone shot..."
                        value={textPrompt}
                        onChange={(e) => setTextPrompt(e.target.value)}
                        className="min-h-[120px]"
                      />
                      <div className="flex items-center gap-2">
                        <Button onClick={handleEnhanceTextPrompt} disabled={isEnhancingPrompt || !textPrompt.trim()} variant="outline" size="sm">
                          {isEnhancingPrompt ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1.5" />}
                          {isEnhancingPrompt ? "Enhancing..." : "AI Enhance"}
                        </Button>
                      </div>
                      {enhancedText && (
                        <div className="mt-2 p-3 rounded-lg bg-violet-50 border border-violet-100">
                          <Label className="text-xs font-semibold text-violet-700">Enhanced Prompt</Label>
                          <p className="text-sm text-violet-600 mt-1">{enhancedText}</p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Voice Tab */}
                <TabsContent value="voice" className="space-y-4 mt-4">
                  <Card className="border-0 shadow-lg shadow-black/5 bg-white card-glow">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base font-bold flex items-center gap-2">
                        <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center text-white">
                          <Mic className="h-3.5 w-3.5" />
                        </div>
                        Voice Recording
                      </CardTitle>
                      <CardDescription>Record your idea and AI will transcribe it and create a video.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex items-center gap-4">
                        {!isRecordingAudio ? (
                          <Button onClick={handleRecordAudio} size="lg" className="btn-amber px-8">
                            <Mic className="h-5 w-5 mr-2" />Start Recording
                          </Button>
                        ) : (
                          <Button onClick={stopRecording} size="lg" variant="destructive" className="px-8">
                            <MicOff className="h-5 w-5 mr-2" />Stop Recording
                          </Button>
                        )}
                        {isRecordingAudio && (
                          <div className="flex items-center gap-2">
                            <div className="h-3 w-3 rounded-full bg-red-500 animate-pulse" />
                            <span className="text-sm text-red-500 font-semibold">Recording...</span>
                          </div>
                        )}
                      </div>
                      <Textarea
                        placeholder="Your transcribed text will appear here..."
                        value={textPrompt}
                        onChange={(e) => setTextPrompt(e.target.value)}
                        className="min-h-[100px]"
                      />
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Image Tab */}
                <TabsContent value="video" className="space-y-4 mt-4">
                  <Card className="border-0 shadow-lg shadow-black/5 bg-white card-glow">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base font-bold flex items-center gap-2">
                        <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-teal-500 to-emerald-500 flex items-center justify-center text-white">
                          <Upload className="h-3.5 w-3.5" />
                        </div>
                        Image Upload
                      </CardTitle>
                      <CardDescription>Upload an image to animate it into a video.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <input
                        type="file"
                        accept="image/*"
                        ref={fileInputRef}
                        onChange={handleUploadImage}
                        className="hidden"
                      />
                      {!uploadedImagePreview ? (
                        <button
                          onClick={() => fileInputRef.current?.click()}
                          className="w-full h-48 border-2 border-dashed border-slate-200 rounded-xl flex flex-col items-center justify-center gap-3 hover:border-violet-300 hover:bg-violet-50/50 transition-colors"
                        >
                          <UploadCloud className="h-10 w-10 text-slate-300" />
                          <p className="text-sm text-muted-foreground">Click to upload image</p>
                          <p className="text-xs text-muted-foreground">PNG, JPG, WebP supported</p>
                        </button>
                      ) : (
                        <div className="relative">
                          <img src={uploadedImagePreview} alt="Upload" className="max-h-60 rounded-xl mx-auto" />
                          <Button
                            variant="destructive" size="sm"
                            className="absolute top-2 right-2"
                            onClick={() => { setUploadedImagePreview(null); setVideoFile(null); }}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      )}
                      <Textarea
                        placeholder="Describe how you want the image animated..."
                        value={textPrompt}
                        onChange={(e) => setTextPrompt(e.target.value)}
                        className="min-h-[80px]"
                      />
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>

              {/* Script Preview Panel */}
              {(parsedScenes.length > 0 || parsedCharacters.length > 0) && (
                <Card className="border-0 shadow-lg shadow-black/5 bg-white card-glow">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base font-bold flex items-center gap-2">
                      <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center text-white">
                        <Eye className="h-3.5 w-3.5" />
                      </div>
                      Script Analysis Preview
                      <Badge className="ml-auto text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">
                        {parsedScenes.length} scenes, {parsedCharacters.length} characters
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="max-h-64">
                      <div className="space-y-3 pr-4">
                        {parsedScenes.map((s, i) => (
                          <div key={i} className="p-3 rounded-lg border border-slate-100 bg-slate-50/50">
                            <div className="flex items-center gap-2 mb-1">
                              <Badge className="text-[9px] bg-violet-100 text-violet-700 border-violet-200">Scene {i + 1}</Badge>
                              {s.title && <span className="text-xs font-bold">{s.title}</span>}
                            </div>
                            <p className="text-[11px] text-muted-foreground line-clamp-2">{s.prompt}</p>
                            {s.dialogue && (
                              <p className="text-[10px] text-violet-500 mt-1 italic">{s.dialogue}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                    {parsedCharacters.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-slate-100">
                        <p className="text-xs font-bold mb-2">Detected Characters:</p>
                        <div className="flex flex-wrap gap-2">
                          {parsedCharacters.map((c, i) => (
                            <Badge key={i} variant="outline" className="text-[10px]">
                              <Users className="h-2.5 w-2.5 mr-1" />
                              {c.name} ({c.role})
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Create Button */}
              <div className="flex items-center gap-4 pt-2">
                <Button
                  onClick={handleCreateAndGenerate}
                  disabled={isCreating}
                  size="lg"
                  className="btn-gradient text-base px-8"
                >
                  {isCreating ? (
                    <><Loader2 className="h-5 w-5 mr-2 animate-spin" />Creating...</>
                  ) : (
                    <><Sparkles className="h-5 w-5 mr-2" />Create & Generate</>
                  )}
                </Button>
                <Button variant="outline" onClick={() => setCurrentView("home")}>Cancel</Button>
              </div>
            </motion.div>
          )}

          {/* ═══════════════════════════════════════════════════════
              STUDIO VIEW
              ═══════════════════════════════════════════════════════ */}
          {currentView === "studio" && currentProject && (
            <motion.div key="studio" {...fadeUp} className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
              {/* ── A. Project Header ── */}
              <div className="flex items-center gap-3 flex-wrap">
                <Button variant="ghost" size="sm" onClick={() => setCurrentView("home")} className="hover:bg-violet-50">
                  <ArrowLeft className="h-4 w-4 mr-1" />Back
                </Button>
                <div className="flex-1 min-w-0">
                  {editingProjectTitle ? (
                    <div className="flex items-center gap-2">
                      <Input
                        value={editableTitle}
                        onChange={(e) => setEditableTitle(e.target.value)}
                        className="h-8 text-lg font-bold max-w-xs"
                        onKeyDown={(e) => e.key === "Enter" && handleUpdateProjectTitle()}
                      />
                      <Button size="sm" onClick={handleUpdateProjectTitle}>
                        <CheckCircle className="h-4 w-4" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingProjectTitle(false)}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setEditableTitle(currentProject.title); setEditingProjectTitle(true); }}
                      className="text-lg font-bold truncate hover:text-violet-600 transition-colors"
                    >
                      {currentProject.title}
                    </button>
                  )}
                </div>
                <Badge className={`text-xs font-semibold px-2.5 ${
                  currentProject.status === "completed" ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : currentProject.status === "generating" ? "bg-violet-50 text-violet-700 border-violet-200"
                  : currentProject.status === "failed" ? "bg-red-50 text-red-700 border-red-200"
                  : "bg-slate-50 text-slate-600 border-slate-200"
                }`}>
                  {currentProject.status}
                </Badge>
                <Button
                  variant="ghost" size="sm"
                  className="text-red-400 hover:text-red-600 hover:bg-red-50"
                  onClick={() => handleDeleteClick("project", currentProject.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>

              {/* Project Info Bar */}
              <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
                <Badge variant="outline" className="text-[10px]">{currentProject.aspectRatio}</Badge>
                <Badge variant="outline" className="text-[10px]">{currentProject.style}</Badge>
                <span className="flex items-center gap-0.5"><Clock className="h-3 w-3" />{formatDuration(currentProject.targetDuration)}</span>
                <span className="flex items-center gap-0.5"><Film className="h-3 w-3" />{safeScenes.length} scenes</span>
                {safeCharacters.length > 0 && (
                  <span className="flex items-center gap-0.5"><Users className="h-3 w-3" />{safeCharacters.length} chars</span>
                )}
              </div>

              {/* ── Progress Bar ── */}
              {safeScenes.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      Progress: {completedSceneCount}/{safeScenes.length} scenes
                    </span>
                    <span className="font-semibold text-violet-600">
                      {safeScenes.length > 0 ? Math.round((completedSceneCount / safeScenes.length) * 100) : 0}%
                    </span>
                  </div>
                  <Progress
                    value={safeScenes.length > 0 ? (completedSceneCount / safeScenes.length) * 100 : 0}
                    className="h-2"
                  />
                </div>
              )}

              {/* ── B. & C. Generation Controls & AI Tools ── */}
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  onClick={handleGenerateAll}
                  disabled={isAnyGenerating || isGenerating}
                  className="btn-gradient"
                >
                  {isGenerating ? (
                    <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Generating...</>
                  ) : isAnyGenerating ? (
                    <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />In Progress...</>
                  ) : (
                    <><Play className="h-4 w-4 mr-1.5" />Generate All Videos</>
                  )}
                </Button>
                {failedSceneCount > 0 && (
                  <Button onClick={handleGenerateAll} variant="outline" className="text-amber-600 border-amber-200 hover:bg-amber-50">
                    <RotateCcw className="h-4 w-4 mr-1.5" />Retry Failed ({failedSceneCount})
                  </Button>
                )}
                <Button
                  onClick={handleCheckContinuity}
                  disabled={isCheckingContinuity || safeScenes.length < 2}
                  variant="outline"
                >
                  {isCheckingContinuity ? (
                    <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Checking...</>
                  ) : (
                    <><Shield className="h-4 w-4 mr-1.5" />Check Continuity</>
                  )}
                </Button>
                <Button
                  onClick={() => setExportDialogOpen(true)}
                  disabled={completedSceneCount === 0 || isExporting}
                  variant="outline"
                  className="text-emerald-600 border-emerald-200 hover:bg-emerald-50"
                >
                  <Download className="h-4 w-4 mr-1.5" />Export Video
                </Button>
                {currentProject.finalVideoUrl && (
                  <a href={currentProject.finalVideoUrl} download>
                    <Button variant="outline" className="text-emerald-600 border-emerald-200 hover:bg-emerald-50">
                      <ArrowDownToLine className="h-4 w-4 mr-1.5" />Download Final
                    </Button>
                  </a>
                )}
              </div>

              {/* ── Character Panel ── */}
              <Card className="border-0 shadow-lg shadow-black/5 bg-white card-glow">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base font-bold flex items-center gap-2">
                      <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-fuchsia-500 to-pink-500 flex items-center justify-center text-white">
                        <Users className="h-3.5 w-3.5" />
                      </div>
                      Characters
                      <Badge variant="outline" className="text-[10px] ml-1">{safeCharacters.length}</Badge>
                    </CardTitle>
                    <Button size="sm" variant="outline" onClick={() => setCreateDialogOpen(true)}>
                      <Plus className="h-3 w-3 mr-1" />Add Character
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {safeCharacters.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {safeCharacters.map((char) => (
                        <div key={char.id} className="flex items-center gap-3 p-3 rounded-xl border border-slate-100 bg-slate-50/50 hover:border-violet-200 transition-colors">
                          <div className="h-10 w-10 rounded-full overflow-hidden bg-gradient-to-br from-violet-200 to-fuchsia-200 flex items-center justify-center shrink-0">
                            {char.imageUrl ? (
                              <img src={char.imageUrl} alt={char.name} className="h-full w-full object-cover" />
                            ) : (
                              <Users className="h-4 w-4 text-violet-500" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-bold truncate">{char.name}</p>
                            {char.role && (
                              <Badge variant="outline" className="text-[8px] px-1 py-0">{char.role}</Badge>
                            )}
                          </div>
                          <div className="flex flex-col gap-1 shrink-0">
                            <Button
                              size="sm" variant="ghost" className="h-6 w-6 p-0"
                              onClick={() => { setCharUploadTargetId(char.id); charFileInputRef.current?.click(); }}
                              title="Upload Image"
                            >
                              <UploadCloud className="h-3 w-3" />
                            </Button>
                            <Button
                              size="sm" variant="ghost" className="h-6 w-6 p-0"
                              onClick={() => handleGenerateCharPortrait(char.id)}
                              title="Generate AI Portrait"
                            >
                              <Wand2 className="h-3 w-3" />
                            </Button>
                            <Select value={char.voiceId || charVoiceAssign[char.id] || ""} onValueChange={(v) => handleAssignVoice(char.id, v)}>
                              <SelectTrigger className="h-6 w-16 text-[8px] px-0.5">
                                <Volume2 className="h-2.5 w-2.5" />
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {TTS_VOICES.map((v) => (
                                  <SelectItem key={v.id} value={v.id}>
                                    <span className="text-[10px]">{v.label}</span>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Button
                              size="sm" variant="ghost" className="h-6 w-6 p-0 text-red-400 hover:text-red-600 hover:bg-red-50"
                              onClick={() => handleDeleteClick("character", char.id)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-4">No characters yet. Add characters or let AI detect them from your script.</p>
                  )}
                </CardContent>
              </Card>

              {/* Hidden file input for character image upload */}
              <input
                type="file"
                accept="image/*"
                ref={charFileInputRef}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file && charUploadTargetId) {
                    setCharImageFile(file);
                    handleUploadCharImage(charUploadTargetId);
                  }
                  setCharUploadTargetId(null);
                }}
                className="hidden"
              />

              {/* ── D. Scene Timeline ── */}
              <Card className="border-0 shadow-lg shadow-black/5 bg-white card-glow">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <CardTitle className="text-base font-bold flex items-center gap-2">
                      <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-violet-500 to-purple-500 flex items-center justify-center text-white">
                        <Layers className="h-3.5 w-3.5" />
                      </div>
                      Scene Timeline
                      <Badge variant="outline" className="text-[10px] ml-1">{safeScenes.length}</Badge>
                    </CardTitle>
                    <div className="flex items-center gap-2">
                      <Select value={sceneFilter} onValueChange={setSceneFilter}>
                        <SelectTrigger className="h-7 w-28 text-[10px] px-2">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all"><span className="text-[10px]">All</span></SelectItem>
                          <SelectItem value="pending"><span className="text-[10px]">Pending</span></SelectItem>
                          <SelectItem value="generating"><span className="text-[10px]">Generating</span></SelectItem>
                          <SelectItem value="completed"><span className="text-[10px]">Completed</span></SelectItem>
                          <SelectItem value="failed"><span className="text-[10px]">Failed</span></SelectItem>
                        </SelectContent>
                      </Select>
                      <Button size="sm" variant="outline" onClick={() => setCreateDialogOpen(true)}>
                        <Plus className="h-3 w-3 mr-1" />Add Scene
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {filteredScenes.length > 0 ? (
                    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                      <SortableContext items={filteredScenes.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                        <div className="space-y-3 max-h-[800px] overflow-y-auto pr-1">
                          {filteredScenes.map((scene, idx) => (
                            <SortableSceneCard
                              key={scene.id}
                              scene={scene}
                              sceneIndex={idx}
                              totalScenes={safeScenes.length}
                              projectStyle={currentProject.style}
                              onPreview={openVideoPreview}
                              onGenerate={handleGenerateSingle}
                              onRetry={handleRetryScene}
                              onDelete={handleDeleteClick}
                              onNarrate={handleNarrateScene}
                              onTransitionChange={handleSceneTransitionChange}
                              onEnhanceScene={handleEnhanceScene}
                              onMoodChange={handleSceneMoodChange}
                              onCameraChange={handleSceneCameraChange}
                              onLightingChange={handleSceneLightingChange}
                              isGeneratingNarration={isGeneratingNarration}
                            />
                          ))}
                        </div>
                      </SortableContext>
                    </DndContext>
                  ) : (
                    <div className="text-center py-12">
                      <Film className="h-10 w-10 text-slate-300 mx-auto mb-3" />
                      <p className="text-sm text-muted-foreground">No scenes yet. Add a scene or go back to create one.</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* ── Add Scene Quick Form ── */}
              <Card className="border-0 shadow-md bg-white">
                <CardContent className="pt-4">
                  <div className="flex items-center gap-2">
                    <Input
                      placeholder="Quick add scene prompt..."
                      value={newScenePrompt}
                      onChange={(e) => setNewScenePrompt(e.target.value)}
                      className="flex-1 h-9 text-sm"
                      onKeyDown={(e) => e.key === "Enter" && handleAddScene()}
                    />
                    <Select value={newSceneTransition} onValueChange={setNewSceneTransition}>
                      <SelectTrigger className="h-9 w-24 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {TRANSITIONS.map((t) => (
                          <SelectItem key={t.value} value={t.value}><span className="text-xs">{t.label}</span></SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button size="sm" onClick={handleAddScene} disabled={!newScenePrompt.trim()}>
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* ── Final Video Preview ── */}
              {currentProject.finalVideoUrl && (
                <Card className="border-0 shadow-lg bg-white card-glow">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base font-bold flex items-center gap-2">
                      <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center text-white">
                        <CheckCircle className="h-3.5 w-3.5" />
                      </div>
                      Final Video
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <DeviceSimulator aspectRatio={currentProject.aspectRatio} compact>
                      <video src={currentProject.finalVideoUrl} controls className="w-full h-full object-contain bg-black" preload="metadata" />
                    </DeviceSimulator>
                    <div className="mt-4 flex items-center gap-3">
                      <a href={currentProject.finalVideoUrl} download>
                        <Button className="btn-amber">
                          <Download className="h-4 w-4 mr-1.5" />Download Video
                        </Button>
                      </a>
                    </div>
                  </CardContent>
                </Card>
              )}
            </motion.div>
          )}

          {/* ═══════════════════════════════════════════════════════
              GALLERY VIEW
              ═══════════════════════════════════════════════════════ */}
          {currentView === "gallery" && (
            <motion.div key="gallery" {...fadeUp} className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-6">
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Scene Templates</h1>
                <p className="text-muted-foreground mt-1">Choose a pre-designed scene to start creating</p>
              </div>

              {/* Category Filter */}
              <div className="flex items-center gap-2 flex-wrap">
                {GALLERY_CATEGORIES.map((cat) => (
                  <Button
                    key={cat}
                    variant={galleryCategory === cat ? "default" : "outline"}
                    size="sm"
                    onClick={() => setGalleryCategory(cat)}
                    className={galleryCategory === cat ? "btn-gradient" : ""}
                  >
                    {cat}
                  </Button>
                ))}
              </div>

              {/* Template Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                {CLASSIC_SCENES
                  .filter((s) => galleryCategory === "All" || s.category === galleryCategory.toLowerCase())
                  .map((scene) => (
                    <motion.div key={scene.id} {...fadeItem}>
                      <Card
                        className="card-glow cursor-pointer border-0 shadow-lg shadow-black/5 bg-white group h-full"
                        onClick={() => handleSelectClassicScene(scene)}
                      >
                        {scene.image && (
                          <div className="relative h-44 overflow-hidden">
                            <img
                              src={scene.image}
                              alt={scene.title}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                            <div className="absolute bottom-3 left-3 right-3">
                              <h3 className="text-white font-bold text-sm">{scene.title}</h3>
                            </div>
                          </div>
                        )}
                        {!scene.image && (
                          <CardHeader>
                            <CardTitle className="text-base font-bold">{scene.title}</CardTitle>
                          </CardHeader>
                        )}
                        <CardContent>
                          <p className="text-sm text-muted-foreground leading-relaxed">{scene.description}</p>
                          <Badge variant="outline" className="mt-2 text-[10px] capitalize">{scene.category}</Badge>
                        </CardContent>
                      </Card>
                    </motion.div>
                  ))}
              </div>

              {/* Empty state */}
              {CLASSIC_SCENES.filter((s) => galleryCategory === "All" || s.category === galleryCategory.toLowerCase()).length === 0 && (
                <div className="text-center py-12">
                  <Search className="h-10 w-10 text-slate-300 mx-auto mb-3" />
                  <p className="text-muted-foreground">No templates found in this category.</p>
                </div>
              )}

              {/* Back button */}
              <div className="pt-4">
                <Button variant="outline" onClick={() => setCurrentView("home")}>
                  <ArrowLeft className="h-4 w-4 mr-1.5" />Back to Home
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* ═══════════════════════════════════════════════════════
          DIALOGS
          ═══════════════════════════════════════════════════════ */}

      {/* Delete Confirmation Dialog */}
      <Dialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Delete</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this {pendingDeleteAction?.type || "item"}? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={cancelDelete}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDelete}>
              <Trash2 className="h-4 w-4 mr-1.5" />Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Video Preview Dialog */}
      <Dialog open={!!previewVideoUrl} onOpenChange={closePreview}>
        <DialogContent className="max-w-3xl p-0 overflow-hidden">
          <div className="relative">
            <Button
              variant="ghost" size="sm"
              className="absolute top-2 right-2 z-10 bg-black/50 text-white hover:bg-black/70"
              onClick={closePreview}
            >
              <X className="h-4 w-4" />
            </Button>
            {previewVideoUrl && (
              <video src={previewVideoUrl} controls autoPlay className="w-full bg-black" />
            )}
          </div>
          {previewVideoUrl && (
            <div className="p-4">
              <a href={previewVideoUrl} download className="inline-flex items-center gap-1.5 text-sm text-violet-600 hover:text-violet-800">
                <Download className="h-4 w-4" />Download this video
              </a>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Export Dialog */}
      <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Download className="h-5 w-5" />Export Video
            </DialogTitle>
            <DialogDescription>Configure export settings for your final video.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Quality</Label>
              <Select value={exportQuality} onValueChange={setExportQuality}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EXPORT_QUALITY.map((q) => (
                    <SelectItem key={q.value} value={q.value}>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{q.label}</span>
                        <span className="text-xs text-muted-foreground">{q.desc}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Transition</Label>
              <Select value={exportTransition} onValueChange={setExportTransition}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TRANSITIONS.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      <span className="text-sm">{t.label}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Format</Label>
              <Select value={exportFormat} onValueChange={setExportFormat}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="mp4"><span className="text-sm">MP4 (H.264)</span></SelectItem>
                  <SelectItem value="webm"><span className="text-sm">WebM (VP9)</span></SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-medium">Title Card</Label>
                <p className="text-xs text-muted-foreground">Add a title card at the beginning</p>
              </div>
              <Switch checked={exportTitleCard} onCheckedChange={setExportTitleCard} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExportDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleExport} disabled={isExporting} className="btn-gradient">
              {isExporting ? (
                <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Exporting...</>
              ) : (
                <><Download className="h-4 w-4 mr-1.5" />Export Full Video</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Continuity Check Dialog */}
      <Dialog open={continuityDialogOpen} onOpenChange={setContinuityDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />AI Continuity Check
            </DialogTitle>
            <DialogDescription>
              {continuityResult?.summary || "Analysis of scene continuity and visual consistency"}
            </DialogDescription>
          </DialogHeader>
          {continuityResult && (
            <div className="space-y-4 py-2">
              {/* Score */}
              <div className="flex items-center justify-center">
                <div className="relative h-24 w-24">
                  <svg className="h-24 w-24 -rotate-90" viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="40" fill="none" stroke="currentColor" strokeWidth="8" className="text-slate-100" />
                    <circle
                      cx="50" cy="50" r="40" fill="none"
                      stroke={continuityResult.score >= 80 ? "#10b981" : continuityResult.score >= 50 ? "#f59e0b" : "#ef4444"}
                      strokeWidth="8"
                      strokeDasharray={`${continuityResult.score * 2.51} 251`}
                      strokeLinecap="round"
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-2xl font-bold">{continuityResult.score}</span>
                  </div>
                </div>
              </div>

              {/* Issues */}
              {continuityResult.issues.length > 0 ? (
                <ScrollArea className="max-h-64">
                  <div className="space-y-2">
                    {continuityResult.issues.map((issue, i) => (
                      <div
                        key={i}
                        className={`p-3 rounded-lg border ${
                          issue.severity === "high"
                            ? "border-red-200 bg-red-50"
                            : issue.severity === "medium"
                            ? "border-amber-200 bg-amber-50"
                            : "border-slate-200 bg-slate-50"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1">
                            <div className="flex items-center gap-1.5 mb-1">
                              <Badge className={`text-[9px] px-1.5 ${
                                issue.type === "inconsistency"
                                  ? "bg-red-100 text-red-700"
                                  : issue.type === "warning"
                                  ? "bg-amber-100 text-amber-700"
                                  : "bg-sky-100 text-sky-700"
                              }`}>
                                {issue.type}
                              </Badge>
                              <Badge variant="outline" className="text-[9px]">
                                Scene {issue.sceneIndex + 1}
                              </Badge>
                              <Badge variant="outline" className={`text-[9px] ${
                                issue.severity === "high" ? "border-red-200 text-red-600"
                                : issue.severity === "medium" ? "border-amber-200 text-amber-600"
                                : "border-slate-200 text-slate-600"
                              }`}>
                                {issue.severity}
                              </Badge>
                            </div>
                            <p className="text-xs text-foreground">{issue.description}</p>
                            <p className="text-[10px] text-muted-foreground mt-1 italic">Fix: {issue.fix}</p>
                          </div>
                          <Button
                            size="sm" variant="outline" className="h-6 text-[10px] px-2 shrink-0"
                            onClick={() => handleApplyFix(issue)}
                          >
                            Apply Fix
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              ) : (
                <div className="text-center py-6">
                  <CheckCircle className="h-8 w-8 text-emerald-500 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No continuity issues detected. Your scenes look great!</p>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setContinuityDialogOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Scene / Add Character Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add to Project</DialogTitle>
            <DialogDescription>Add a new scene or character to your project.</DialogDescription>
          </DialogHeader>
          <Tabs defaultValue="scene">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="scene">Scene</TabsTrigger>
              <TabsTrigger value="character">Character</TabsTrigger>
            </TabsList>
            <TabsContent value="scene" className="space-y-3 pt-3">
              <div className="space-y-1.5">
                <Label>Scene Prompt</Label>
                <Textarea
                  placeholder="Describe the scene..."
                  value={newScenePrompt}
                  onChange={(e) => setNewScenePrompt(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Transition</Label>
                <Select value={newSceneTransition} onValueChange={setNewSceneTransition}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TRANSITIONS.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={() => { handleAddScene(); setCreateDialogOpen(false); }} disabled={!newScenePrompt.trim()}>
                <Plus className="h-4 w-4 mr-1.5" />Add Scene
              </Button>
            </TabsContent>
            <TabsContent value="character" className="space-y-3 pt-3">
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input placeholder="Character name" value={newCharName} onChange={(e) => setNewCharName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Role</Label>
                <Select value={newCharRole || "supporting"} onValueChange={setNewCharRole}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="protagonist">Protagonist</SelectItem>
                    <SelectItem value="supporting">Supporting</SelectItem>
                    <SelectItem value="narrator">Narrator</SelectItem>
                    <SelectItem value="background">Background</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Description</Label>
                <Textarea placeholder="Describe appearance, personality..." value={newCharDesc} onChange={(e) => setNewCharDesc(e.target.value)} />
              </div>
              <Button onClick={() => { handleAddCharacter(); setCreateDialogOpen(false); }} disabled={!newCharName.trim()}>
                <UserPlus className="h-4 w-4 mr-1.5" />Add Character
              </Button>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

    </div>
  );
}
