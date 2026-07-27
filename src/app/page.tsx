"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAppStore } from "@/store/useAppStore";
import { useToast } from "@/hooks/use-toast";
import { signIn, signOut, useSession, SessionProvider } from "next-auth/react";
import type {
  VideoProject, VideoScene, ClassicScene, InputMode,
  Character, ParsedSceneResult, DetectedCharacter, ContinuityIssue,
} from "@/types/video";
import {
  Film, Mic, MicOff, Upload, Sparkles, Play, Plus, Trash2,
  ChevronRight, Wand2, ArrowLeft, ImageIcon, LayoutGrid, Loader2,
  X, Download, Layers, Palette, Clapperboard,
  Copy, Eye, EyeOff, Volume2, Clock, Video, RefreshCw, Zap, Timer, Monitor,
  Smartphone, RectangleHorizontal, Square,
  Users, UserPlus, UploadCloud, FileText, MessageSquare,
  Crown, Star, Heart, Briefcase, PartyPopper, Camera,
  GripVertical, Quote, ArrowDownToLine, Music,
  CheckCircle, AlertTriangle, Shield, Search, Settings,
  Lightbulb, RotateCcw, Shrink,
  LogIn, LogOut, User, CreditCard, Wallet, Coins, ShieldCheck,
  Building2, DollarSign, BarChart3, TrendingUp, KeyRound,
  Package, ShoppingBag, Bell, Mail, History, ArrowRight, UserCircle, Calendar, TrendingDown,
  Check, Menu, Home, FolderPlus,
  Pencil, Power, Save, ChevronUp, ChevronDown, Sparkle, AlertCircle,
  Share2, Music2, Subtitles, Languages, BarChart2, Globe, Image as ImageIcon2,
  Building, Youtube, Instagram, Facebook, Send,
  ArrowUp, MessageCircle, Bot, Phone, BookOpen, Code, Mail as MailIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
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
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter,
} from "@/components/ui/sheet";
import DeviceSimulator from "@/components/DeviceSimulator";
import { AIStatusBadge } from "@/components/AIStatusBadge";
import { PackageEditDialog } from "@/components/PackageEditDialog";
import { ShareDialog } from "@/components/ShareDialog";
import { BrandKitDialog } from "@/components/BrandKitDialog";
import AIAssistant from "@/components/AIAssistant";
import ScrollToTop from "@/components/ScrollToTop";
import { DUBBING_LANGUAGE_GROUPS, ALL_DUBBING_LANGUAGES, DUBBING_LANGUAGE_COUNT } from "@/lib/dubbing-languages";
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
   ADMIN: Token Package type (mirrors DB-backed package shape)
   ════════════════════════════════════════════════════════════════ */
interface AdminTokenPackage {
  id: string;
  slug: string;
  name: string;
  tokens: number;
  priceGHS: number;
  priceUSD: number;
  bonusPct: number;
  popular: boolean;
  isActive: boolean;
  sortOrder: number;
  features: string[];
  effectiveTokens: number;
  effectiveTokenPriceGHS: number;
  effectiveTokenPriceUSD: number;
  createdAt?: string;
  updatedAt?: string;
}

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
  onSetMusic, onGenerateSubtitles, onToggleBurnSubtitles, onGenerateDubbing, onDeleteDubbing, musicTracks,
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
  onSetMusic: (sceneId: string, trackUrl: string | null, volume: number) => void;
  onGenerateSubtitles: (sceneId: string) => void;
  onToggleBurnSubtitles: (sceneId: string, burn: boolean) => void;
  onGenerateDubbing: (sceneId: string, lang: string, langName: string) => void;
  onDeleteDubbing: (sceneId: string, lang: string, langName: string) => void;
  musicTracks: Array<{ id: string; title: string; mood: string; url: string; duration: number }>;
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
          {/* Content — portrait thumbnail + script column on sm+ */}
          <div className="flex-1 min-w-0">
            <div className="flex flex-col sm:flex-row sm:gap-3 p-4">
              {/* ── PORTRAIT THUMBNAIL COLUMN (narrow) ── */}
              <div className="sm:w-20 md:w-24 shrink-0 order-1 sm:order-1">
                <div className="relative">
                  <Badge className="absolute top-1 left-1 text-[10px] font-bold px-1.5 bg-black/60 text-white border-0 z-10">
                    #{scene.sceneNumber}
                  </Badge>
                  {scene.imageUrl ? (
                    <img src={scene.imageUrl} alt="" className="w-full aspect-[9/16] object-cover rounded-lg border border-slate-200" />
                  ) : scene.videoUrl ? (
                    <video src={scene.videoUrl} className="w-full aspect-[9/16] object-cover rounded-lg border border-slate-200 bg-black" preload="metadata" muted />
                  ) : (
                    <div className="w-full aspect-[9/16] rounded-lg bg-slate-50 border border-dashed border-slate-200 flex items-center justify-center">
                      <Film className="h-6 w-6 text-slate-300" />
                    </div>
                  )}
                  <Badge className={`absolute bottom-1 right-1 text-[9px] font-semibold px-1.5 z-10 ${statusColor}`}>
                    {scene.status}
                  </Badge>
                </div>
              </div>

              {/* ── SCRIPT COLUMN ── */}
              <div className="flex-1 min-w-0 order-2 sm:order-2">
                {/* Row 1: Script Details */}
                {/* Title Row */}
                <div className="flex items-center gap-1.5 flex-wrap mb-1">
                  {scene.title && (
                    <span className="text-sm font-bold truncate">{scene.title}</span>
                  )}
                  {scene.dialogue && (
                    <Badge variant="outline" className="text-xs px-1.5 py-0">
                      <MessageSquare className="h-3 w-3 mr-0.5" />Dialogue
                    </Badge>
                  )}
                  {scene.mood && moodBadge && (
                    <Badge className={`text-xs px-2 py-0 ${moodBadge}`}>{scene.mood}</Badge>
                  )}
                  {scene.cameraMove && (
                    <Badge variant="outline" className="text-xs px-1.5 py-0 border-cyan-200 text-cyan-600">
                      <Camera className="h-3 w-3 mr-0.5" />{scene.cameraMove}
                    </Badge>
                  )}
                  {scene.lighting && (
                    <Badge variant="outline" className="text-xs px-1.5 py-0 border-amber-200 text-amber-600">
                      <Lightbulb className="h-3 w-3 mr-0.5" />{scene.lighting}
                    </Badge>
                  )}
                </div>

                {/* Prompt */}
                <p
                  className={`text-xs text-muted-foreground leading-relaxed ${expandedPrompt ? "" : "line-clamp-2"}`}
                >
                  {scene.enhancedPrompt || scene.prompt}
                </p>
                {(scene.enhancedPrompt || scene.prompt).length > 120 && (
                  <button
                    onClick={() => setExpandedPrompt(!expandedPrompt)}
                    className="text-sm text-violet-500 mt-0.5 hover:underline"
                  >
                    {expandedPrompt ? "Show less" : "Show more"}
                  </button>
                )}
                {scene.dialogue && (
                  <p className="text-xs text-violet-500 mt-1.5 italic line-clamp-1">
                    {scene.dialogue}
                  </p>
                )}

                {/* Row 2: Video Player (left) + Settings (right) */}
                <div className="mt-3 pt-3 border-t border-slate-100">
                  <div className="flex flex-col sm:flex-row sm:gap-4">
                    {/* Row 2a: Video Player */}
                    <div className="sm:w-[220px] md:w-[260px] lg:w-[300px] shrink-0">
                      {scene.videoUrl ? (
                        <video
                          src={scene.videoUrl}
                          controls
                          className="w-full rounded-lg bg-black"
                          preload="metadata"
                        />
                      ) : scene.imageUrl ? (
                        /* Clickable thumbnail preview */
                        <button
                          onClick={() => onGenerate(scene.id, scene.enhancedPrompt || scene.prompt)}
                          className="w-full group/preview relative rounded-lg overflow-hidden border border-slate-200 hover:border-violet-300 transition-colors"
                        >
                          <img src={scene.imageUrl} alt="" className="w-full aspect-video object-cover" />
                          <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover/preview:bg-black/40 transition-colors">
                            <Play className="h-8 w-8 text-white drop-shadow-lg" />
                          </div>
                        </button>
                      ) : (
                        /* Placeholder */
                        <div className="w-full aspect-video rounded-lg bg-slate-50 border border-dashed border-slate-200 flex items-center justify-center">
                          <Film className="h-8 w-8 text-slate-300" />
                        </div>
                      )}
                      {scene.videoUrl && (
                        <a
                          href={scene.videoUrl}
                          download
                          className="inline-flex items-center gap-1 text-xs text-violet-500 hover:text-violet-700 mt-1"
                        >
                          <Download className="h-3.5 w-3.5" />Download video
                        </a>
                      )}

                      {/* Narration audio player */}
                      {scene.narrationUrl && (
                        <div className="mt-2 flex items-center gap-1.5">
                          <Volume2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                          <audio controls src={scene.narrationUrl} className="h-7 w-full" preload="none" />
                        </div>
                      )}
                      {/* Progress spinner */}
                      {scene.status === "generating" && (
                        <div className="mt-2 flex items-center gap-2 text-xs text-violet-500">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          <span>Generating video...</span>
                        </div>
                      )}
                    </div>

                    {/* Row 2b: Settings */}
                    <div className="flex-1 min-w-0">
                      {/* Actions */}
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {!scene.videoUrl && scene.status !== "generating" && (
                          <Button
                            size="sm" variant="outline" className="h-7 text-xs px-2.5"
                            onClick={() => onGenerate(scene.id, scene.enhancedPrompt || scene.prompt)}
                          >
                            <Play className="h-3.5 w-3.5 mr-1" />Generate Video
                          </Button>
                        )}
                        {scene.status === "failed" && (
                          <Button
                            size="sm" variant="outline" className="h-7 text-xs px-2.5"
                            onClick={() => onRetry(scene)}
                          >
                            <RefreshCw className="h-3.5 w-3.5 mr-1" />Retry
                          </Button>
                        )}
                        {scene.dialogue && !scene.narrationUrl && (
                          <div className="flex items-center gap-1">
                            <Select value={narrationVoice} onValueChange={setNarrationVoice}>
                              <SelectTrigger className="h-7 w-24 text-xs px-1.5">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {TTS_VOICES.map((v) => (
                                  <SelectItem key={v.id} value={v.id}>
                                    <span className="text-xs">{v.label}</span>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Button
                              size="sm" variant="outline" className="h-7 text-xs px-2.5"
                              onClick={() => onNarrate(scene.id, narrationVoice)}
                              disabled={isGeneratingNarration}
                            >
                              {isGeneratingNarration
                                ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />...</>
                                : <><Volume2 className="h-3.5 w-3.5 mr-1" />Narrate</>
                              }
                            </Button>
                          </div>
                        )}
                        <Button
                          size="sm" variant="outline" className="h-7 text-xs px-2.5"
                          onClick={() => onEnhanceScene(scene)}
                        >
                          <Wand2 className="h-3.5 w-3.5 mr-1" />AI Enhance
                        </Button>
                        {/* ── Music Picker ── */}
                        <Select
                          value={scene.musicTrackUrl || "none"}
                          onValueChange={(v) => onSetMusic(scene.id, v === "none" ? null : v, scene.musicVolume || 30)}
                        >
                          <SelectTrigger className="h-7 w-28 text-xs px-1.5">
                            <Music2 className="h-3 w-3 mr-1 inline shrink-0" />
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none"><span className="text-xs">No music</span></SelectItem>
                            {musicTracks.map((t) => (
                              <SelectItem key={t.id} value={t.url}>
                                <span className="text-xs">{t.title}</span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {/* ── Subtitle Button ── */}
                        <Button
                          size="sm" variant="outline" className="h-7 text-xs px-2.5"
                          onClick={() => onGenerateSubtitles(scene.id)}
                          title="Generate AI subtitles"
                        >
                          <Subtitles className="h-3.5 w-3.5 mr-1" />
                          {scene.subtitleStatus === "ready" ? "Subs ✓" : scene.subtitleStatus === "generating" ? "..." : "Subs"}
                        </Button>
                        {scene.subtitleStatus === "ready" && (
                          <Button
                            size="sm" variant="outline" className="h-7 text-xs px-2.5"
                            onClick={() => onToggleBurnSubtitles(scene.id, !scene.burnSubtitles)}
                            title={scene.burnSubtitles ? "Subtitles will be burned into video" : "Click to burn subtitles into video"}
                          >
                            <Subtitles className={`h-3.5 w-3.5 mr-1 ${scene.burnSubtitles ? "text-violet-600" : ""}`} />
                            {scene.burnSubtitles ? "Burn ✓" : "Burn"}
                          </Button>
                        )}
                        {/* ── Dubbing Selector (30+ languages, grouped) ── */}
                        <Select
                          value=""
                          onValueChange={(v) => {
                            const lang = ALL_DUBBING_LANGUAGES.find((l) => l.code === v);
                            if (lang) onGenerateDubbing(scene.id, lang.code, lang.name);
                          }}
                        >
                          <SelectTrigger className="h-7 w-[88px] text-xs px-1.5 gap-1">
                            <Languages className="h-3 w-3 shrink-0" />
                            <SelectValue placeholder="Dub" />
                          </SelectTrigger>
                          <SelectContent className="min-w-[240px] max-h-[320px]">
                            <div className="px-2 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                              {DUBBING_LANGUAGE_COUNT} languages
                            </div>
                            {DUBBING_LANGUAGE_GROUPS.map((group) => (
                              <SelectGroup key={group.label}>
                                <SelectLabel className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground px-2 pt-2">
                                  {group.label}
                                </SelectLabel>
                                {group.languages.map((lang) => (
                                  <SelectItem key={lang.code} value={lang.code} className="text-xs">
                                    <span className="mr-1.5">{lang.flag}</span>
                                    {lang.name}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select value={scene.transition} onValueChange={(v) => onTransitionChange(scene.id, v)}>
                          <SelectTrigger className="h-7 w-24 text-xs px-1.5">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {TRANSITIONS.map((t) => (
                              <SelectItem key={t.value} value={t.value}>
                                <span className="text-xs">{t.label}</span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          size="sm" variant="ghost"
                          className="h-7 text-xs px-2 text-red-400 hover:text-red-600 hover:bg-red-50 ml-auto"
                          onClick={() => onDelete(scene.id, "Scene " + scene.sceneNumber)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>

                      {/* AI Director Controls */}
                      <div className="mt-3 pt-3 border-t border-slate-100">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-2">
                          <div>
                            <Label className="text-xs text-muted-foreground uppercase tracking-wider">Mood</Label>
                            <Select value={scene.mood || ""} onValueChange={(v) => onMoodChange(scene.id, v)}>
                              <SelectTrigger className="h-9 text-sm px-2 mt-1 w-full">
                                <SelectValue placeholder="Set mood" />
                              </SelectTrigger>
                              <SelectContent>
                                {MOODS.map((m) => (
                                  <SelectItem key={m} value={m}>
                                    <span className="text-xs capitalize">{m}</span>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label className="text-xs text-muted-foreground uppercase tracking-wider">Camera</Label>
                            <Select value={scene.cameraMove || ""} onValueChange={(v) => onCameraChange(scene.id, v)}>
                              <SelectTrigger className="h-9 text-sm px-2 mt-1 w-full">
                                <SelectValue placeholder="Camera move" />
                              </SelectTrigger>
                              <SelectContent>
                                {CAMERA_MOVES.map((c) => (
                                  <SelectItem key={c} value={c}>
                                    <span className="text-xs capitalize">{c}</span>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label className="text-xs text-muted-foreground uppercase tracking-wider">Lighting</Label>
                            <Select value={scene.lighting || ""} onValueChange={(v) => onLightingChange(scene.id, v)}>
                              <SelectTrigger className="h-9 text-sm px-2 mt-1 w-full">
                                <SelectValue placeholder="Lighting" />
                              </SelectTrigger>
                              <SelectContent>
                                {LIGHTING_STYLES.map((l) => (
                                  <SelectItem key={l} value={l}>
                                    <span className="text-xs capitalize">{l}</span>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </div>

                      {/* ── Dubbed Audio Tracks (translations) ── */}
                      {scene.translations && scene.translations.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-slate-100">
                          <div className="flex items-center gap-1.5 mb-2">
                            <Languages className="h-3.5 w-3.5 text-violet-500" />
                            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                              Dubbed Audio ({scene.translations.length})
                            </span>
                          </div>
                          <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
                            {scene.translations
                              .filter((t) => t.status === "ready" && t.narrationUrl)
                              .map((t) => {
                                const langMeta = ALL_DUBBING_LANGUAGES.find((l) => l.code === t.lang);
                                return (
                                  <div
                                    key={t.id}
                                    className="flex items-center gap-2 rounded-lg bg-violet-50/50 border border-violet-100 p-1.5"
                                  >
                                    <span className="text-base shrink-0">{langMeta?.flag || "🌐"}</span>
                                    <span className="text-xs font-medium shrink-0 min-w-[70px]">{t.langName}</span>
                                    <audio
                                      controls
                                      src={t.narrationUrl!}
                                      className="h-7 flex-1 min-w-0"
                                      preload="none"
                                    />
                                    <button
                                      onClick={() => onDeleteDubbing(scene.id, t.lang, t.langName)}
                                      className="shrink-0 p-1 rounded text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                                      title={`Delete ${t.langName} dubbing`}
                                      aria-label={`Delete ${t.langName} dubbing`}
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                );
                              })}
                            {scene.translations.some((t) => t.status === "generating") && (
                              <div className="flex items-center gap-2 text-xs text-violet-500 px-1">
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                <span>Generating dubbing…</span>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>{/* end settings column */}
                  </div>{/* end row 2 flex */}
                </div>{/* end row 2 border-t wrapper */}
              </div>{/* end script column */}
            </div>{/* end flex portrait + script */}
          </div>{/* end content flex-1 outer */}
        </div>
      </Card>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   HERO SLIDER
   ════════════════════════════════════════════════════════════════
   Professional cinematic auto-advancing slider with:
   - Crossfade transitions + Ken Burns zoom on images
   - Staggered text entrance animations per slide
   - Auto-play with pause on hover
   - Dot indicators + thin progress bar
   - Responsive layout
   ════════════════════════════════════════════════════════════════ */

const HERO_SLIDES = [
  {
    image: "/images/hero-bg.png",
    badge: "AI-Powered Studio",
    badgeIcon: <Zap className="h-3 w-3 mr-1.5 text-amber-400" />,
    headline: "Create Production-Ready",
    headlineAccent: "AI Videos",
    description: "Write scripts, design characters, generate cinematic scenes with AI Director controls. From birthday stories to commercials — all powered by AI.",
    gradient: "from-black/80 via-violet-950/70 to-black/85",
    orbColor: "violet",
  },
  {
    image: "/images/hero-slide-2.png",
    badge: "Endless Creativity",
    badgeIcon: <Wand2 className="h-3 w-3 mr-1.5 text-fuchsia-400" />,
    headline: "From Script to Screen",
    headlineAccent: "in Minutes",
    description: "Upload your script, choose a style, and let AI transform your words into stunning cinematic scenes with professional quality.",
    gradient: "from-black/80 via-fuchsia-950/60 to-black/85",
    orbColor: "amber",
  },
  {
    image: "/images/hero-slide-3.png",
    badge: "Hollywood Quality",
    badgeIcon: <Sparkles className="h-3 w-3 mr-1.5 text-emerald-400" />,
    headline: "Cinematic Scenes",
    headlineAccent: "on Demand",
    description: "AI Director controls for mood, camera moves, lighting, and transitions. Every scene looks like it was shot by a professional crew.",
    gradient: "from-black/80 via-emerald-950/60 to-black/85",
    orbColor: "rose",
  },
  {
    image: "/images/hero-slide-4.png",
    badge: "Team Ready",
    badgeIcon: <Users className="h-3 w-3 mr-1.5 text-cyan-400" />,
    headline: "Character Systems",
    headlineAccent: "& Storyboarding",
    description: "Build character profiles with voice casting, manage multi-scene storyboards, and export broadcast-ready videos in any format.",
    gradient: "from-black/80 via-cyan-950/60 to-black/85",
    orbColor: "violet",
  },
] as const;

const SLIDE_INTERVAL = 7000; // ms per slide
const KEN_BURNS_DURATION = 10; // seconds for slow zoom

function HeroSlider({
  onNavigateCreate,
  onNavigateDemo,
  onNavigateGallery,
  isCreatingDemo,
}: {
  onNavigateCreate: () => void;
  onNavigateDemo: () => void;
  onNavigateGallery: () => void;
  isCreatingDemo: boolean;
}) {
  const [activeSlide, setActiveSlide] = useState(0);
  const [progress, setProgress] = useState(0);
  const rafRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startRef = useRef(performance.now());

  // Auto-advance timer
  useEffect(() => {
    startRef.current = performance.now();
    const tick = (now: number) => {
      const elapsed = now - startRef.current;
      setProgress(Math.min(100, (elapsed / SLIDE_INTERVAL) * 100));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    intervalRef.current = setInterval(() => {
      setActiveSlide((prev) => (prev + 1) % HERO_SLIDES.length);
      startRef.current = performance.now();
      setProgress(0);
    }, SLIDE_INTERVAL);

    return () => {
      cancelAnimationFrame(rafRef.current);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [activeSlide]);

  const goToSlide = (idx: number) => {
    setActiveSlide(idx);
    startRef.current = performance.now();
    setProgress(0);
  };

  const slide = HERO_SLIDES[activeSlide];

  return (
    <div
      className="relative w-full min-h-[520px] sm:min-h-[600px]"
      role="region"
      aria-label="Hero slider"
      aria-roledescription="carousel"
    >
      {/* ── Slides ── */}
      {HERO_SLIDES.map((s, idx) => {
        const isActive = idx === activeSlide;
        const prevActive = idx === (activeSlide - 1 + HERO_SLIDES.length) % HERO_SLIDES.length;
        return (
          <div
            key={idx}
            className="absolute inset-0 transition-opacity duration-[1200ms] ease-in-out"
            style={{ opacity: isActive || prevActive ? (isActive ? 1 : 0) : 0 }}
          >
            {/* Ken Burns image */}
            <div
              className="absolute inset-0"
              style={{
                transform: isActive ? "scale(1)" : "scale(1.08)",
                transition: `transform ${KEN_BURNS_DURATION}s ease-out`,
              }}
            >
              <img
                src={s.image}
                alt=""
                className="w-full h-full object-cover"
                loading={idx === 0 ? "eager" : "lazy"}
              />
            </div>
          </div>
        );
      })}

      {/* ── Active slide gradient overlay ── */}
      <div className={`absolute inset-0 bg-gradient-to-b ${slide.gradient} transition-all duration-1000`} />

      {/* ── Floating orbs (matches active slide color) ── */}
      <div className={`orb orb-${slide.orbColor} w-[400px] h-[400px] -top-20 -left-32 transition-all duration-1000`} />
      <div className="orb orb-amber w-[300px] h-[300px] top-10 right-10 opacity-60 transition-all duration-1000" />
      <div className="orb orb-rose w-[250px] h-[250px] bottom-20 left-1/2 opacity-50 transition-all duration-1000" />

      {/* ── Content ── */}
      <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 py-16 sm:py-20 lg:py-24 text-center">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeSlide}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6 }}
            className="space-y-6"
          >
            {/* Badge */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
            >
              <Badge className="px-4 py-1.5 text-xs font-semibold glass-card text-violet-200 hover:bg-white/10 cursor-default">
                {slide.badgeIcon}{slide.badge}
              </Badge>
            </motion.div>

            {/* Headline */}
            <motion.h1
              className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight leading-tight"
              initial={{ opacity: 0, y: 25 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
            >
              <span className="text-white">{slide.headline}</span>
              <br />
              <span className="hero-text-gradient">{slide.headlineAccent}</span>
            </motion.h1>

            {/* Description */}
            <motion.p
              className="text-base sm:text-lg text-violet-200/80 max-w-2xl mx-auto leading-relaxed"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.35 }}
            >
              {slide.description}
            </motion.p>

            {/* CTA Buttons */}
            <motion.div
              className="flex flex-col sm:flex-row gap-3 justify-center pt-2"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.5 }}
            >
              <Button
                size="lg"
                onClick={onNavigateCreate}
                className="btn-gradient text-sm sm:text-base px-6 py-4 h-auto"
              >
                <Sparkles className="h-4 w-4 sm:h-5 sm:w-5 mr-2" />Start Creating
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={() => onNavigateDemo()}
                disabled={isCreatingDemo}
                className="glass-card text-white hover:text-white hover:bg-violet-500/20 px-6 py-4 h-auto !border-2 !border-violet-400/70 hover:!border-violet-300 shadow-lg shadow-violet-500/20"
              >
                {isCreatingDemo ? (
                  <><Loader2 className="h-4 w-4 sm:h-5 sm:w-5 mr-2 animate-spin" />Loading demo…</>
                ) : (
                  <><Play className="h-4 w-4 sm:h-5 sm:w-5 mr-2 text-violet-300" />Try Live Demo</>
                )}
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={onNavigateGallery}
                className="glass-card text-white/90 hover:text-white hover:bg-fuchsia-500/20 px-6 py-4 h-auto !border-2 !border-fuchsia-400/70 hover:!border-fuchsia-300 shadow-lg shadow-fuchsia-500/20"
              >
                <LayoutGrid className="h-4 w-4 sm:h-5 sm:w-5 mr-2" />Browse Templates
              </Button>
            </motion.div>

            {/* Subtext */}
            <motion.p
              className="text-xs text-amber-200/80 pt-1"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.65 }}
            >
              ✨ No signup needed — the demo loads a finished video project instantly.
            </motion.p>

            {/* Feature pills */}
            <motion.div
              className="flex items-center justify-center gap-6 sm:gap-8 pt-4 text-sm flex-wrap"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.75 }}
            >
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
            </motion.div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* ── Dot Indicators ── */}
      <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2.5">
        {HERO_SLIDES.map((_, idx) => (
          <button
            key={idx}
            onClick={() => goToSlide(idx)}
            className="relative flex items-center justify-center group/dot"
            aria-label={`Go to slide ${idx + 1}`}
            aria-current={idx === activeSlide ? "true" : undefined}
          >
            {/* Progress ring background */}
            <span className={`block h-2.5 w-2.5 rounded-full transition-all duration-500 ${
              idx === activeSlide ? "bg-white/40 scale-100" : "bg-white/20 scale-75 group-hover/dot:bg-white/30 group-hover/dot:scale-100"
            }`} />
            {/* Animated progress fill */}
            {idx === activeSlide && (
              <span
                className="absolute inset-0 rounded-full bg-white"
                style={{
                  clipPath: `inset(0 ${100 - progress}% 0 0)`,
                  transition: "none",
                }}
              />
            )}
          </button>
        ))}
      </div>

      {/* ── Thin progress bar at very bottom ── */}
      <div className="absolute bottom-0 inset-x-0 z-20 h-[2px] bg-white/10">
        <div
          className="h-full bg-gradient-to-r from-violet-400 via-fuchsia-400 to-amber-400"
          style={{
            width: `${progress}%`,
            transition: "width 0.1s linear",
          }}
        />
      </div>

      {/* ── Bottom fade to background ── */}
      <div className="absolute bottom-0 inset-x-0 h-16 bg-gradient-to-t from-background to-transparent z-10 pointer-events-none" />
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   MAIN PAGE COMPONENT
   ════════════════════════════════════════════════════════════════ */

export default function HomePage() {
  return (
    <SessionProvider session={undefined}>
      <VidoraApp />
    </SessionProvider>
  );
}

function VidoraApp() {
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
  const [showProjectSettings, setShowProjectSettings] = useState(true);
  const [updatingSettings, setUpdatingSettings] = useState(false);

  /* ── Free Preview State ── */
  // The "try before you buy" funnel: users can generate a free AI storyboard
  // and a free watermarked style image BEFORE buying tokens. Rate-limited/day.
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [previewStoryboard, setPreviewStoryboard] = useState<Record<string, unknown> | null>(null);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [isGeneratingStoryboard, setIsGeneratingStoryboard] = useState(false);
  const [isGeneratingPreviewImage, setIsGeneratingPreviewImage] = useState(false);
  const [previewQuota, setPreviewQuota] = useState<{ storyboard: { used: number; limit: number }; image: { used: number; limit: number } } | null>(null);

  /* ── Demo Mode State ── */
  // Lets users experience the FULL video generation UX (storyboard → scene
  // images → video clips → playback) using pre-rendered assets, WITHOUT
  // requiring Z.ai balance or tokens. Great for evaluation & demos.
  const [isCreatingDemo, setIsCreatingDemo] = useState(false);
  const [demoTemplates, setDemoTemplates] = useState<Array<{
    id: string; title: string; description: string; style: string;
    coverImage: string; accentColor: string; tagline: string; sceneCount: number;
    targetDuration: number; projectType: string; aspectRatio: string;
  }>>([]);

  /* ── Advanced Features State ── */
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [analyticsDialogOpen, setAnalyticsDialogOpen] = useState(false);
  const [brandKitDialogOpen, setBrandKitDialogOpen] = useState(false);
  const [socialDialogOpen, setSocialDialogOpen] = useState(false);
  const [marketplaceView, setMarketplaceView] = useState(false);
  const [marketplaceTemplates, setMarketplaceTemplates] = useState<Array<{
    slug: string; title: string; description: string; category: string;
    coverImage: string; accentColor: string; sceneCount: number;
    isFeatured: boolean; targetDuration: number; style: string; aspectRatio: string;
  }>>([]);
  const [marketplaceCategory, setMarketplaceCategory] = useState("all");
  const [marketplaceCategories, setMarketplaceCategories] = useState<string[]>([]);
  const [usingTemplate, setUsingTemplate] = useState<string | null>(null);
  const [analyticsData, setAnalyticsData] = useState<Record<string, unknown> | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [musicTracks, setMusicTracks] = useState<Array<{
    id: string; title: string; mood: string; url: string; duration: number;
  }>>([]);
  const [selectedSceneForMusic, setSelectedSceneForMusic] = useState<string | null>(null);
  const [socialConnections, setSocialConnections] = useState<Array<{
    platform: string; isConnected: boolean; accountName: string | null;
  }>>([]);
  const [publishHistory, setPublishHistory] = useState<Array<{
    platform: string; externalUrl: string | null; status: string; publishedAt: string | null;
  }>>([]);
  const [publishingPlatform, setPublishingPlatform] = useState<string | null>(null);

  /* ── Auth State ── */
  const { data: session, status: authStatus } = useSession();
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register" | "forgot" | "reset">("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authName, setAuthName] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authFieldError, setAuthFieldError] = useState<"email" | "password" | "name" | "confirm" | "">("");
  const [authShowPassword, setAuthShowPassword] = useState(false);
  const [authShowConfirm, setAuthShowConfirm] = useState(false);
  const [authConfirmPassword, setAuthConfirmPassword] = useState("");
  const [authRemember, setAuthRemember] = useState(true);
  const [authResetToken, setAuthResetToken] = useState("");
  const [authSuccess, setAuthSuccess] = useState("");
  const [userTokens, setUserTokens] = useState(0);
  const [userProfile, setUserProfile] = useState<{ id: string; email: string; name: string; role: string; tokens: number } | null>(null);

  // ── Password strength meter (register + reset modes) ──
  const passwordStrength = useMemo(() => {
    const p = authPassword;
    if (!p) return { score: 0, label: "", color: "", pct: 0 };
    let score = 0;
    if (p.length >= 8) score++;
    if (p.length >= 12) score++;
    if (/[A-Z]/.test(p)) score++;
    if (/[0-9]/.test(p)) score++;
    if (/[^A-Za-z0-9]/.test(p)) score++;
    const levels = [
      { label: "Too weak", color: "bg-red-500", pct: 20 },
      { label: "Weak", color: "bg-red-400", pct: 35 },
      { label: "Fair", color: "bg-amber-400", pct: 55 },
      { label: "Good", color: "bg-lime-500", pct: 75 },
      { label: "Strong", color: "bg-emerald-500", pct: 90 },
      { label: "Very strong", color: "bg-emerald-600", pct: 100 },
    ];
    return { score, ...levels[Math.min(score, 5)] };
  }, [authPassword]);

  // ── Z.ai error differentiation helper ──
  // Picks the right error string to show in toasts based on user role:
  //  - Admins see `adminDetail` (raw diagnostic — e.g. "[ZAI auth (non-retryable) [HTTP 429]] Insufficient balance…")
  //    so they can diagnose / recharge the Z.ai account.
  //  - Regular users see `error` (friendly copy — e.g. "This AI feature is temporarily unavailable…")
  //    so they're not exposed to internal billing/config details.
  // Falls back to `fallback` when neither field is present.
  const getApiError = useCallback(
    (data: { error?: string; adminDetail?: string } | null | undefined, fallback = "Something went wrong. Please try again."): string => {
      if (!data) return fallback;
      if (userProfile?.role === "admin" && data.adminDetail) return data.adminDetail;
      return data.error || fallback;
    },
    [userProfile],
  );

  /* ── Admin State ── */
  const [adminUsers, setAdminUsers] = useState<unknown[]>([]);
  const [adminPayments, setAdminPayments] = useState<unknown[]>([]);
  const [adminAnalytics, setAdminAnalytics] = useState<Record<string, unknown> | null>(null);
  const [adminConfigs, setAdminConfigs] = useState<Record<string, { value: string; description: string }>>({});
  // configForm is the editable working copy — separate from adminConfigs (loaded snapshot)
  // This prevents mid-edit reloads from wiping unsaved field changes.
  const [configForm, setConfigForm] = useState<Record<string, string>>({});
  const [adminLoading, setAdminLoading] = useState(false);
  const [savingConfigKey, setSavingConfigKey] = useState<string | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // ── Sticky header: transparent at top, solid (with shadow) after scroll ──
  const [headerScrolled, setHeaderScrolled] = useState(false);
  // ── Contact dialog (opened from footer) ──
  const [contactDialogOpen, setContactDialogOpen] = useState(false);
  // ── Docs & API Reference dialogs (opened from footer) ──
  const [docsDialogOpen, setDocsDialogOpen] = useState(false);
  const [apiRefDialogOpen, setApiRefDialogOpen] = useState(false);
  // ── Admin: Token Package Management ──
  const [adminPackages, setAdminPackages] = useState<AdminTokenPackage[]>([]);
  const [editingPackage, setEditingPackage] = useState<AdminTokenPackage | null>(null);
  const [packageDialogOpen, setPackageDialogOpen] = useState(false);
  const [savingPackage, setSavingPackage] = useState(false);
  const [resettingPackages, setResettingPackages] = useState(false);

  /* ── Payment State ── */
  const [tokenPackages, setTokenPackages] = useState<unknown[]>([]);

  /* ── Dashboard / Profile State ── */
  const [tokenHistory, setTokenHistory] = useState<Record<string, unknown>[]>([]);
  const [profileData, setProfileData] = useState<{ id: string; email: string; name: string; role: string; tokens: number; createdAt: string } | null>(null);
  const [profileName, setProfileName] = useState("");
  const [profileOldPassword, setProfileOldPassword] = useState("");
  const [profileNewPassword, setProfileNewPassword] = useState("");
  const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);
  const [profileHistoryPage, setProfileHistoryPage] = useState(1);

  /* ── Download Gate State ── */
  const [downloadGateOpen, setDownloadGateOpen] = useState(false);
  const [downloadCost, setDownloadCost] = useState(0);
  const [downloadBreakdown, setDownloadBreakdown] = useState<{ quality: number; duration: number } | null>(null);
  const [downloadInsufficient, setDownloadInsufficient] = useState(false);
  const [downloadQuality, setDownloadQuality] = useState("standard");
  const [downloadProjectId, setDownloadProjectId] = useState("");
  const [isRequestingDownload, setIsRequestingDownload] = useState(false);

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

  // Load projects on mount — then signal the global preloader that the
  // initial critical data fetch has resolved so it can dismiss.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await fetchProjects();
      if (cancelled) return;
      // Allow a tick for the first data-render to paint, then dismiss preloader
      requestAnimationFrame(() => {
        if (typeof window !== "undefined" && !cancelled) {
          window.dispatchEvent(new Event("vidora:ready"));
        }
      });
    })();
    return () => { cancelled = true; };
  }, [fetchProjects]);

  // ── Sticky header: add shadow + stronger bg once the user scrolls past 10px ──
  useEffect(() => {
    const onScroll = () => setHeaderScrolled(window.scrollY > 10);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // ── Scroll to top whenever the view changes (so the new view starts at top) ──
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [currentView]);

  // ── Show ViewTransitionOverlay on view changes ──
  useEffect(() => {
    if (typeof window === "undefined") return;
    const viewLabels: Record<string, string> = {
      home: "Loading Home",
      create: "Preparing Creator",
      studio: "Opening Studio",
      gallery: "Loading Gallery",
      dashboard: "Loading Dashboard",
      "buy-tokens": "Loading Tokens",
      profile: "Loading Profile",
      admin: "Loading Admin",
    };
    const label = viewLabels[currentView] || "Loading";
    window.dispatchEvent(
      new CustomEvent("vidora:view-loading", { detail: { label } })
    );
    // Let the view render, then signal ready after a brief hold
    const timer = setTimeout(() => {
      window.dispatchEvent(new Event("vidora:view-ready"));
    }, 800);
    return () => clearTimeout(timer);
  }, [currentView]);

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
        toast({ title: "Generation failed", description: getApiError(data), variant: "destructive" });
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
      const res = await fetch(`/api/generate-video-scene`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          sceneId,
          projectId: currentProject.id,
          duration: currentProject.targetDuration || 10,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast({ title: "Generating video...", description: data.videoUrl ? "Video ready!" : "This may take a few minutes." });
        if (!data.videoUrl) {
          // Start polling for this scene's video
          const pollScene = async () => {
            try {
              const statusRes = await fetch(`/api/video-status`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sceneId }),
              });
              const statusData = await statusRes.json();
              if (statusData.videoUrl) {
                await refreshProject();
                return true; // done
              }
              if (statusData.status === "failed") {
                toast({ title: "Generation failed", description: "The video could not be generated.", variant: "destructive" });
                return true; // stop polling
              }
              return false; // still processing
            } catch {
              return false;
            }
          };
          for (let i = 0; i < 40; i++) {
            await new Promise((r) => setTimeout(r, 15000));
            const done = await pollScene();
            if (done) break;
          }
        } else {
          await refreshProject();
        }
      } else {
        toast({ title: "Failed", description: getApiError(data), variant: "destructive" });
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
        toast({ title: "Generation failed", description: getApiError(data), variant: "destructive" });
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
        toast({ title: "Narration failed", description: getApiError(data), variant: "destructive" });
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
        toast({ title: "Enhancement failed", description: getApiError(data), variant: "destructive" });
      }
    } catch {
      toast({ title: "Error enhancing scene", variant: "destructive" });
    }
  };

  /**
   * Optimistically updates a scene field in the local store so the UI
   * reflects the change immediately (before the API round-trip completes).
   * Then persists to the API and re-fetches the authoritative version.
   */
  const updateSceneField = async (
    sceneId: string,
    field: string,
    value: string
  ) => {
    if (!currentProject) return;
    // Optimistic local update
    setCurrentProject({
      ...currentProject,
      scenes: currentProject.scenes.map((s) =>
        s.id === sceneId ? { ...s, [field]: value } : s
      ),
    });
    try {
      await fetch(`/api/projects/${currentProject.id}/scenes/${sceneId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      refreshProject();
    } catch { /* silent */ }
  };

  const handleSceneMoodChange = (sceneId: string, mood: string) =>
    updateSceneField(sceneId, "mood", mood);

  const handleSceneCameraChange = (sceneId: string, cameraMove: string) =>
    updateSceneField(sceneId, "cameraMove", cameraMove);

  const handleSceneLightingChange = (sceneId: string, lighting: string) =>
    updateSceneField(sceneId, "lighting", lighting);

  const handleSceneTransitionChange = (sceneId: string, transition: string) =>
    updateSceneField(sceneId, "transition", transition);

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
        toast({ title: "Continuity check failed", description: getApiError(data), variant: "destructive" });
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
        toast({ title: "Export failed", description: getApiError(data), variant: "destructive" });
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
        toast({ title: "Analysis failed", description: getApiError(data), variant: "destructive" });
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
        toast({ title: "Prompt enhanced", description: "Review the enhanced version below." });
      } else {
        toast({ title: "Enhancement failed", description: getApiError(data, "Could not enhance your prompt. Please try again."), variant: "destructive" });
      }
    } catch {
      toast({ title: "Enhancement failed", description: "Could not connect to the server. Please try again.", variant: "destructive" });
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

  /* ──────────────────────────────────────────────────────────────
     FREE PREVIEW HANDLERS
     Lets users see a storyboard + watermarked style image BEFORE
     buying tokens. Rate-limited per user/day by the backend.
  ────────────────────────────────────────────────────────────── */

  const fetchPreviewUsage = useCallback(async () => {
    if (authStatus !== "authenticated") return;
    try {
      const res = await fetch("/api/preview/usage");
      const data = await res.json();
      if (data.success) setPreviewQuota(data.usage);
    } catch { /* non-fatal */ }
  }, [authStatus]);

  // Fetch preview quota whenever the create view is shown
  useEffect(() => {
    if (currentView === "create") fetchPreviewUsage();
  }, [currentView, fetchPreviewUsage]);

  const getCurrentIdeaText = (): string => {
    if (inputMode === "script") return scriptText;
    if (enhancedText) return enhancedText;
    return textPrompt;
  };

  /* ──────────────────────────────────────────────────────────────
     DEMO MODE HANDLER
     Creates a fully-populated demo project (with pre-rendered scene
     images + video clips) so users can explore the studio end-to-end
     without needing tokens or Z.ai balance.
     ────────────────────────────────────────────────────────────── */
  const handleTryDemo = async (templateId?: string) => {
    setIsCreatingDemo(true);
    try {
      const res = await fetch("/api/demo/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: templateId ?? null }),
      });
      const data = await res.json();
      if (data.success && data.project) {
        toast({
          title: "Demo project ready! 🎬",
          description: data.message || "Explore the studio to see all scenes.",
        });
        // Open the demo project in the studio exactly like a real project
        const p = data.project as VideoProject;
        setCurrentProject(p);
        if (p.characters) setCharacters(p.characters);
        setCurrentView("studio");
        // Refresh projects list so it appears in the gallery too
        fetchProjects();
      } else {
        toast({
          title: "Demo failed",
          description: data.error || "Could not create demo project.",
          variant: "destructive",
        });
      }
    } catch {
      toast({
        title: "Error",
        description: "Failed to create demo project. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsCreatingDemo(false);
    }
  };

  // Fetch demo templates for the home showcase
  const fetchDemoTemplates = useCallback(async () => {
    try {
      const res = await fetch("/api/demo/templates");
      const data = await res.json();
      if (data.success && Array.isArray(data.templates)) {
        setDemoTemplates(data.templates);
      }
    } catch { /* non-fatal */ }
  }, []);

  useEffect(() => { fetchDemoTemplates(); }, [fetchDemoTemplates]);

  /* ──────────────────────────────────────────────────────────────
     ADVANCED FEATURE HANDLERS
     ────────────────────────────────────────────────────────────── */

  // ── Template Marketplace ──
  const fetchMarketplaceTemplates = useCallback(async () => {
    try {
      const res = await fetch(`/api/templates?category=${marketplaceCategory}`);
      const data = await res.json();
      if (data.success) {
        setMarketplaceTemplates(data.templates);
        setMarketplaceCategories(data.categories || []);
      }
    } catch { /* non-fatal */ }
  }, [marketplaceCategory]);

  useEffect(() => {
    if (marketplaceView || currentView === "gallery") fetchMarketplaceTemplates();
  }, [marketplaceView, currentView, fetchMarketplaceTemplates]);

  const handleUseTemplate = async (slug: string) => {
    setUsingTemplate(slug);
    try {
      const res = await fetch(`/api/templates/${slug}/use`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.success) {
        toast({ title: "Project created!", description: data.message });
        setCurrentProject(data.project);
        if (data.project.characters) setCharacters(data.project.characters);
        setMarketplaceView(false);
        setCurrentView("studio");
        fetchProjects();
      } else {
        toast({ title: "Failed", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", variant: "destructive" });
    } finally {
      setUsingTemplate(null);
    }
  };

  // ── Music Library ──
  const fetchMusicTracks = useCallback(async () => {
    try {
      const res = await fetch("/api/music/tracks");
      const data = await res.json();
      if (data.success) setMusicTracks(data.tracks);
    } catch { /* non-fatal */ }
  }, []);

  useEffect(() => { fetchMusicTracks(); }, [fetchMusicTracks]);

  const handleSetSceneMusic = async (sceneId: string, trackUrl: string | null, volume: number) => {
    try {
      await fetch(`/api/scenes/${sceneId}/music`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ musicTrackUrl: trackUrl, musicVolume: volume }),
      });
      if (currentProject) refreshProject();
      toast({ title: "Music updated" });
    } catch {
      toast({ title: "Failed to update music", variant: "destructive" });
    }
  };

  // ── Subtitles ──
  const handleGenerateSubtitles = async (sceneId: string) => {
    try {
      const res = await fetch(`/api/scenes/${sceneId}/subtitles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lang: "en" }),
      });
      const data = await res.json();
      if (data.success) {
        toast({ title: "Subtitles generated!", description: "SRT captions are ready for this scene." });
        if (currentProject) refreshProject();
      } else {
        toast({ title: "Subtitle generation failed", description: getApiError(data), variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", variant: "destructive" });
    }
  };

  const handleToggleBurnSubtitles = async (sceneId: string, burn: boolean) => {
    try {
      await fetch(`/api/scenes/${sceneId}/subtitles`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ burnSubtitles: burn }),
      });
      if (currentProject) refreshProject();
    } catch { /* non-fatal */ }
  };

  // ── Dubbing ──
  const handleGenerateDubbing = async (sceneId: string, lang: string, langName: string) => {
    toast({ title: `Generating ${langName} dubbing...`, description: "Translating and synthesizing voice." });
    try {
      const res = await fetch(`/api/scenes/${sceneId}/dubbing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lang }),
      });
      const data = await res.json();
      if (data.success) {
        toast({
          title: `${langName} dubbing ready!`,
          description: data.chunks > 1 ? `Translation + voice generated (${data.chunks} segments).` : "Translation + voice generated.",
        });
        // Reload project so the new translation + audio URL appear in the scene card
        if (currentProject) refreshProject();
      } else {
        // The API now returns a friendly user-facing message by default.
        // Admins get the raw diagnostic via `adminDetail`; users see "service
        // temporarily unavailable" instead of internal billing details.
        toast({
          title: "Dubbing failed",
          description: getApiError(data, "Please try again in a moment."),
          variant: "destructive",
        });
      }
    } catch {
      toast({ title: "Network error", description: "Could not reach the dubbing service.", variant: "destructive" });
    }
  };

  const handleDeleteDubbing = async (sceneId: string, lang: string, langName: string) => {
    try {
      const res = await fetch(`/api/scenes/${sceneId}/dubbing?lang=${encodeURIComponent(lang)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (data.success) {
        toast({ title: `${langName} dubbing removed`, description: "The translation was deleted." });
        if (currentProject) refreshProject();
      } else {
        toast({ title: "Could not delete", description: getApiError(data, "Please try again."), variant: "destructive" });
      }
    } catch {
      toast({ title: "Network error", description: "Could not reach the dubbing service.", variant: "destructive" });
    }
  };

  // ── Analytics ──
  const handleOpenAnalytics = async () => {
    if (!currentProject) return;
    setAnalyticsDialogOpen(true);
    setAnalyticsLoading(true);
    try {
      const res = await fetch(`/api/analytics/${currentProject.id}/summary`);
      const data = await res.json();
      if (data.success) setAnalyticsData(data);
    } catch { /* non-fatal */ }
    setAnalyticsLoading(false);
  };

  // ── Social Publishing ──
  const fetchSocialConnections = useCallback(async () => {
    if (authStatus !== "authenticated") return;
    try {
      const res = await fetch("/api/social/connections");
      const data = await res.json();
      if (data.success) setSocialConnections(data.connections);
    } catch { /* non-fatal */ }
  }, [authStatus]);

  const fetchPublishHistory = useCallback(async () => {
    if (!currentProject) return;
    try {
      const res = await fetch(`/api/social/publish?projectId=${currentProject.id}`);
      const data = await res.json();
      if (data.success) setPublishHistory(data.publishes);
    } catch { /* non-fatal */ }
  }, [currentProject]);

  useEffect(() => {
    if (socialDialogOpen) {
      fetchSocialConnections();
      fetchPublishHistory();
    }
  }, [socialDialogOpen, fetchSocialConnections, fetchPublishHistory]);

  const handleToggleConnection = async (platform: string) => {
    try {
      await fetch("/api/social/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform }),
      });
      fetchSocialConnections();
    } catch { /* non-fatal */ }
  };

  const handlePublish = async (platform: string) => {
    if (!currentProject) return;
    setPublishingPlatform(platform);
    try {
      const res = await fetch("/api/social/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: currentProject.id, platform }),
      });
      const data = await res.json();
      if (data.success) {
        toast({ title: `Published to ${platform}!`, description: data.message });
        fetchPublishHistory();
      } else {
        toast({ title: "Publish failed", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", variant: "destructive" });
    } finally {
      setPublishingPlatform(null);
    }
  };

  // ── Branded Export ──
  const handleExportBranded = async (options: { burnSubtitles?: boolean; addMusic?: boolean; addWatermark?: boolean }) => {
    if (!currentProject) return;
    toast({ title: "Exporting branded video...", description: "Adding watermark, music, and subtitles." });
    try {
      const res = await fetch("/api/export-branded", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: currentProject.id, options }),
      });
      const data = await res.json();
      if (data.success) {
        toast({ title: "Branded export ready!", description: "Your video has been exported with branding." });
        if (currentProject) refreshProject();
      } else {
        toast({ title: "Export failed", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", variant: "destructive" });
    }
  };

  const handleGenerateStoryboardPreview = async () => {
    if (authStatus !== "authenticated") {
      toast({ title: "Please sign in", description: "Sign in to generate a free preview.", variant: "destructive" });
      setAuthDialogOpen(true);
      return;
    }
    const idea = getCurrentIdeaText();
    if (!idea.trim() || idea.trim().length < 10) {
      toast({ title: "Describe your idea first", description: "Write at least a sentence about your video so the AI can build a storyboard.", variant: "destructive" });
      return;
    }

    setIsGeneratingStoryboard(true);
    setPreviewStoryboard(null);
    setPreviewImageUrl(null);
    setPreviewModalOpen(true);
    try {
      const res = await fetch("/api/preview/storyboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idea,
          style: selectedStyle,
          aspectRatio: selectedAspect,
          targetDuration: effectiveDuration,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setPreviewStoryboard(data.storyboard);
        setPreviewQuota(data.previewQuota ? { storyboard: data.previewQuota, image: previewQuota?.image ?? { used: 0, limit: 3 } } : previewQuota);
        toast({ title: "Storyboard ready!", description: "See your scene-by-scene plan below." });
      } else {
        toast({ title: "Preview failed", description: getApiError(data), variant: "destructive" });
      }
      // Always refresh quota (backend may have refunded on server-side failure)
      fetchPreviewUsage();
    } catch {
      toast({ title: "Preview failed", description: "Network error. Please try again.", variant: "destructive" });
    } finally {
      setIsGeneratingStoryboard(false);
    }
  };

  const handleGeneratePreviewImage = async () => {
    if (authStatus !== "authenticated") {
      toast({ title: "Please sign in", description: "Sign in to generate a free preview.", variant: "destructive" });
      setAuthDialogOpen(true);
      return;
    }
    // Use the first scene's visualPrompt from the storyboard, or fall back to the raw idea
    let prompt = "";
    const scenes = previewStoryboard?.scenes as Array<Record<string, unknown>> | undefined;
    if (scenes && scenes.length > 0 && typeof scenes[0].visualPrompt === "string") {
      prompt = scenes[0].visualPrompt as string;
    } else {
      prompt = getCurrentIdeaText();
    }
    if (!prompt.trim() || prompt.trim().length < 10) {
      toast({ title: "Generate a storyboard first", description: "Create the storyboard, then preview the visual style.", variant: "destructive" });
      return;
    }

    setIsGeneratingPreviewImage(true);
    setPreviewImageUrl(null);
    setPreviewModalOpen(true);
    try {
      const res = await fetch("/api/preview/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, style: selectedStyle }),
      });
      const data = await res.json();
      if (data.success) {
        setPreviewImageUrl(data.imageUrl);
        setPreviewQuota(data.previewQuota ? { image: data.previewQuota, storyboard: previewQuota?.storyboard ?? { used: 0, limit: 10 } } : previewQuota);
        toast({ title: "Style preview ready!", description: "Watermarked preview — buy tokens for the full HD video." });
      } else {
        toast({ title: "Preview failed", description: getApiError(data), variant: "destructive" });
      }
      // Always refresh quota (backend may have refunded on server-side failure)
      fetchPreviewUsage();
    } catch {
      toast({ title: "Preview failed", description: "Network error. Please try again.", variant: "destructive" });
    } finally {
      setIsGeneratingPreviewImage(false);
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
        setIsRecording(false);
        toast({ title: "Processing recording..." });
        // Auto-transcribe
        const fd = new FormData();
        fd.append("audio", blob, "recording.webm");
        fetch("/api/transcribe", { method: "POST", body: fd })
          .then((r) => r.json())
          .then((d) => {
            if (d.success && d.transcription) {
              setTextPrompt(d.transcription);
              toast({ title: "Transcription complete!" });
            } else {
              toast({ title: "Transcription failed", description: getApiError(d, "Could not process your audio. Please try again."), variant: "destructive" });
            }
          })
          .catch(() => {
            toast({ title: "Transcription failed", description: "Could not connect to the server. Please try again.", variant: "destructive" });
          });
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

  const handleUpdateProjectSetting = async (key: string, value: string | number) => {
    if (!currentProject) return;
    setUpdatingSettings(true);
    try {
      await fetch(`/api/projects/${currentProject.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: value }),
      });
      refreshProject();
      toast({ title: `${key === "style" ? "Style" : key === "aspectRatio" ? "Aspect Ratio" : key === "targetDuration" ? "Duration" : "Setting"} updated` });
    } catch {
      toast({ title: "Failed to update setting", variant: "destructive" });
    } finally {
      setUpdatingSettings(false);
    }
  };

  /* ── Auth Handlers ── */
  const handleLogin = async () => {
    setAuthLoading(true);
    setAuthError("");
    try {
      const res = await signIn("credentials", {
        email: authEmail,
        password: authPassword,
        redirect: false,
      });
      if (res?.error) {
        setAuthError("Invalid email or password");
      } else {
        setAuthDialogOpen(false);
        toast({ title: "Welcome back!" });
      }
    } catch {
      setAuthError("Login failed. Please try again.");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleRegister = async () => {
    setAuthLoading(true);
    setAuthError("");
    setAuthFieldError("");

    // ── Client-side validation ──
    if (!authName.trim()) {
      setAuthError("Please enter your full name.");
      setAuthFieldError("name");
      setAuthLoading(false);
      return;
    }
    if (authName.trim().length < 2) {
      setAuthError("Name must be at least 2 characters long.");
      setAuthFieldError("name");
      setAuthLoading(false);
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(authEmail)) {
      setAuthError("Please enter a valid email address (e.g. you@example.com).");
      setAuthFieldError("email");
      setAuthLoading(false);
      return;
    }
    if (authPassword.length < 8) {
      setAuthError("Password must be at least 8 characters long.");
      setAuthFieldError("password");
      setAuthLoading(false);
      return;
    }
    if (!/[A-Z]/.test(authPassword)) {
      setAuthError("Password must contain at least one uppercase letter (A-Z).");
      setAuthFieldError("password");
      setAuthLoading(false);
      return;
    }
    if (!/[0-9]/.test(authPassword)) {
      setAuthError("Password must contain at least one number (0-9).");
      setAuthFieldError("password");
      setAuthLoading(false);
      return;
    }
    if (!/[^A-Za-z0-9]/.test(authPassword)) {
      setAuthError("Password must contain at least one special character (e.g. !@#$%^&*).");
      setAuthFieldError("password");
      setAuthLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: authEmail, name: authName, password: authPassword }),
      });
      const data = await res.json();
      if (data.success) {
        setAuthDialogOpen(false);
        setAuthEmail("");
        setAuthPassword("");
        setAuthName("");
        toast({
          title: "Account created successfully!",
          description: "Please sign in with your new credentials.",
        });
        // Attempt auto-login (non-blocking)
        try {
          await signIn("credentials", {
            email: authEmail,
            password: authPassword,
            redirect: false,
          });
        } catch {
          // Auto-login may fail in dialog context — user can sign in manually
        }
      } else {
        setAuthError(data.error || "Registration failed. Please try again.");
        setAuthFieldError(data.field || "");
      }
    } catch {
      setAuthError("Could not connect to the server. Please check your internet connection and try again.");
      setAuthFieldError("");
    } finally {
      setAuthLoading(false);
    }
  };

  /* ── Forgot Password ──
     Sends a reset link to the user's email (server logs the link since SMTP
     isn't configured in this environment). Always shows the same success
     message regardless of whether the email exists (anti-enumeration). */
  const handleForgotPassword = async () => {
    setAuthLoading(true);
    setAuthError("");
    setAuthFieldError("");
    setAuthSuccess("");

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!authEmail.trim()) {
      setAuthError("Please enter your email address.");
      setAuthFieldError("email");
      setAuthLoading(false);
      return;
    }
    if (!emailRegex.test(authEmail)) {
      setAuthError("Please enter a valid email address.");
      setAuthFieldError("email");
      setAuthLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: authEmail }),
      });
      const data = await res.json();
      if (data.success) {
        setAuthSuccess(data.message);
      } else {
        setAuthError(data.error || "Unable to send reset link. Please try again.");
      }
    } catch {
      setAuthError("Could not connect to the server. Please try again.");
    } finally {
      setAuthLoading(false);
    }
  };

  /* ── Reset Password ──
     Validates the token (from URL), sets a new password. */
  const handleResetPassword = async () => {
    setAuthLoading(true);
    setAuthError("");
    setAuthFieldError("");
    setAuthSuccess("");

    if (!authResetToken) {
      setAuthError("Invalid reset link. Please request a new password reset.");
      setAuthLoading(false);
      return;
    }
    if (authPassword.length < 8) {
      setAuthError("Password must be at least 8 characters long.");
      setAuthFieldError("password");
      setAuthLoading(false);
      return;
    }
    if (!/[A-Z]/.test(authPassword) || !/[0-9]/.test(authPassword) || !/[^A-Za-z0-9]/.test(authPassword)) {
      setAuthError("Password must include an uppercase letter, a number, and a special character.");
      setAuthFieldError("password");
      setAuthLoading(false);
      return;
    }
    if (authPassword !== authConfirmPassword) {
      setAuthError("Passwords do not match.");
      setAuthFieldError("confirm");
      setAuthLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: authResetToken,
          email: authEmail,
          password: authPassword,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setAuthSuccess(data.message);
        setAuthPassword("");
        setAuthConfirmPassword("");
        setAuthResetToken("");
        // Auto-switch to login mode after a short delay
        setTimeout(() => {
          setAuthMode("login");
          setAuthSuccess("");
        }, 2500);
      } else {
        setAuthError(data.error || "Unable to reset password. Please try again.");
      }
    } catch {
      setAuthError("Could not connect to the server. Please try again.");
    } finally {
      setAuthLoading(false);
    }
  };

  // ── URL param: auto-open auth dialog for reset flow or login prompt ──
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const resetToken = params.get("reset");
    const resetEmail = params.get("email");
    const authParam = params.get("auth");
    if (resetToken) {
      setAuthResetToken(resetToken);
      if (resetEmail) setAuthEmail(resetEmail);
      setAuthMode("reset");
      setAuthDialogOpen(true);
      // clean the URL so a refresh doesn't re-trigger
      const url = new URL(window.location.href);
      url.searchParams.delete("reset");
      url.searchParams.delete("email");
      window.history.replaceState({}, "", url.toString());
    } else if (authParam === "login") {
      setAuthMode("login");
      setAuthDialogOpen(true);
      const url = new URL(window.location.href);
      url.searchParams.delete("auth");
      window.history.replaceState({}, "", url.toString());
    }
  }, []);

  const handleSignOut = async () => {
    await signOut({ redirect: false });
    setUserProfile(null);
    setUserTokens(0);
    setCurrentView("home");
    toast({ title: "Signed out" });
  };

  const fetchUserProfile = useCallback(async () => {
    if (!session?.user) return;
    try {
      const res = await fetch("/api/auth/user");
      const data = await res.json();
      if (data.success) {
        setUserProfile(data.user);
        setUserTokens(data.user.tokens);
      }
    } catch { /* ignore */ }
  }, [session?.user]);

  const handleBuyTokens = async (pkgId: string, amount: number, tokens: number, currency: string) => {
    try {
      const res = await fetch("/api/payments/initialize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount, tokensPurchased: tokens, currency, packageId: pkgId }),
      });
      const data = await res.json().catch(() => ({ success: false, error: "Invalid server response" }));
      if (data.success && data.authorizationUrl) {
        window.open(data.authorizationUrl, "_blank");
        toast({ title: "Redirecting to payment...", description: "Complete your payment in the new tab." });
      } else {
        toast({
          title: "Payment initialization failed",
          description: data.error || "Please try again or contact support.",
          variant: "destructive",
        });
      }
    } catch {
      toast({ title: "Payment failed", description: "Network error. Please check your connection.", variant: "destructive" });
    }
  };

  const handleAdminLoadData = useCallback(async () => {
    setAdminLoading(true);
    try {
      const [usersRes, paymentsRes, analyticsRes, configRes, packagesRes] = await Promise.all([
        fetch("/api/admin/users"),
        fetch("/api/admin/payments"),
        fetch("/api/admin/analytics"),
        fetch("/api/admin/config"),
        fetch("/api/admin/packages"),
      ]);
      const [usersData, paymentsData, analyticsData, configData, packagesData] = await Promise.all([
        usersRes.json(), paymentsRes.json(), analyticsRes.json(), configRes.json(), packagesRes.json(),
      ]);
      if (usersData.success) setAdminUsers(usersData.users);
      if (paymentsData.success) setAdminPayments(paymentsData.payments);
      if (analyticsData.success) setAdminAnalytics(analyticsData.analytics);
      if (configData.success) {
        setAdminConfigs(configData.configs);
        // Sync the editable form with loaded values (only keys that exist in the form)
        const formUpdate: Record<string, string> = {};
        Object.entries(configData.configs as Record<string, { value: string; description: string }>).forEach(([k, v]) => {
          formUpdate[k] = v.value || "";
        });
        setConfigForm(formUpdate);
      }
      if (packagesData.success) setAdminPackages(packagesData.packages);
    } catch { /* ignore */ }
    finally { setAdminLoading(false); }
  }, []);

  // ── Token Package CRUD ──
  const refreshAdminPackages = async () => {
    try {
      const res = await fetch("/api/admin/packages");
      const data = await res.json();
      if (data.success) setAdminPackages(data.packages);
    } catch { /* ignore */ }
  };

  const handleSavePackage = async (pkg: Partial<AdminTokenPackage> & { id?: string }) => {
    setSavingPackage(true);
    try {
      const isEdit = !!pkg.id;
      const body = {
        slug: pkg.slug,
        name: pkg.name,
        tokens: Number(pkg.tokens),
        priceGHS: Number(pkg.priceGHS),
        priceUSD: Number(pkg.priceUSD),
        bonusPct: Number(pkg.bonusPct),
        popular: Boolean(pkg.popular),
        isActive: pkg.isActive !== false,
        sortOrder: Number(pkg.sortOrder ?? 0),
        features: pkg.features || [],
      };
      const url = isEdit ? `/api/admin/packages/${pkg.id}` : "/api/admin/packages";
      const method = isEdit ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        toast({ title: isEdit ? "Package updated" : "Package created", description: "Changes are live on the storefront." });
        setPackageDialogOpen(false);
        setEditingPackage(null);
        await refreshAdminPackages();
      } else {
        toast({ title: "Failed to save package", description: data.error || "Please try again.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Failed to save package", variant: "destructive" });
    } finally {
      setSavingPackage(false);
    }
  };

  const handleDeletePackage = async (id: string) => {
    if (!confirm("Delete this package? This cannot be undone. Existing payment records are preserved, but the package will no longer be offered.")) return;
    try {
      const res = await fetch(`/api/admin/packages/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        toast({ title: "Package deleted" });
        await refreshAdminPackages();
      } else {
        toast({ title: "Failed to delete", description: data.error || "It may be referenced by existing payments.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Failed to delete package", variant: "destructive" });
    }
  };

  const handleTogglePackageActive = async (pkg: AdminTokenPackage) => {
    // Optimistic update for instant feedback
    setAdminPackages((prev) => prev.map((p) => p.id === pkg.id ? { ...p, isActive: !p.isActive } : p));
    try {
      const res = await fetch(`/api/admin/packages/${pkg.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !pkg.isActive }),
      });
      const data = await res.json();
      if (data.success) {
        toast({ title: pkg.isActive ? "Package hidden from storefront" : "Package is now live", description: pkg.name });
      } else {
        // Revert on failure
        setAdminPackages((prev) => prev.map((p) => p.id === pkg.id ? { ...p, isActive: pkg.isActive } : p));
        toast({ title: "Failed to toggle", variant: "destructive" });
      }
    } catch {
      setAdminPackages((prev) => prev.map((p) => p.id === pkg.id ? { ...p, isActive: pkg.isActive } : p));
      toast({ title: "Failed to toggle", variant: "destructive" });
    }
  };

  const handleTogglePackagePopular = async (pkg: AdminTokenPackage) => {
    setAdminPackages((prev) => prev.map((p) => p.id === pkg.id ? { ...p, popular: !p.popular } : p));
    try {
      const res = await fetch(`/api/admin/packages/${pkg.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ popular: !pkg.popular }),
      });
      const data = await res.json();
      if (!data.success) {
        setAdminPackages((prev) => prev.map((p) => p.id === pkg.id ? { ...p, popular: pkg.popular } : p));
        toast({ title: "Failed to toggle popular", variant: "destructive" });
      }
    } catch {
      setAdminPackages((prev) => prev.map((p) => p.id === pkg.id ? { ...p, popular: pkg.popular } : p));
      toast({ title: "Failed to toggle popular", variant: "destructive" });
    }
  };

  const handleReorderPackage = async (pkg: AdminTokenPackage, direction: "up" | "down") => {
    const sorted = [...adminPackages].sort((a, b) => a.sortOrder - b.sortOrder);
    const idx = sorted.findIndex((p) => p.id === pkg.id);
    if (idx < 0) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;
    const swapPkg = sorted[swapIdx];
    // Optimistic swap
    setAdminPackages((prev) => prev.map((p) => {
      if (p.id === pkg.id) return { ...p, sortOrder: swapPkg.sortOrder };
      if (p.id === swapPkg.id) return { ...p, sortOrder: pkg.sortOrder };
      return p;
    }).sort((a, b) => a.sortOrder - b.sortOrder));
    try {
      await Promise.all([
        fetch(`/api/admin/packages/${pkg.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sortOrder: swapPkg.sortOrder }) }),
        fetch(`/api/admin/packages/${swapPkg.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sortOrder: pkg.sortOrder }) }),
      ]);
    } catch {
      toast({ title: "Failed to reorder", variant: "destructive" });
      await refreshAdminPackages();
    }
  };

  const handleResetPackages = async () => {
    if (!confirm("Reset ALL packages to the default values? This will discard your custom prices and quantities.")) return;
    setResettingPackages(true);
    try {
      const res = await fetch("/api/admin/packages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset" }),
      });
      const data = await res.json();
      if (data.success) {
        setAdminPackages(data.packages);
        toast({ title: "Packages reset to defaults" });
      } else {
        toast({ title: "Failed to reset", variant: "destructive" });
      }
    } catch {
      toast({ title: "Failed to reset", variant: "destructive" });
    } finally {
      setResettingPackages(false);
    }
  };

  // Save only the fields belonging to the specified gateway — no global reload mid-edit.
  const handleSaveGatewayConfig = async (gateway: string, fields: string[]) => {
    setSavingConfigKey(gateway);
    try {
      const updates: Record<string, string> = {};
      fields.forEach((f) => { updates[f] = configForm[f] || ""; });
      const res = await fetch("/api/admin/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ configs: updates }),
      });
      const data = await res.json();
      if (data.success) {
        toast({ title: `${gateway.charAt(0).toUpperCase() + gateway.slice(1)} configuration saved` });
        // Reload to confirm persisted state, but DON'T wipe the form — merge loaded values
        const cfgRes = await fetch("/api/admin/config");
        const cfgData = await cfgRes.json();
        if (cfgData.success) {
          setAdminConfigs(cfgData.configs);
          const merged: Record<string, string> = { ...configForm };
          Object.entries(cfgData.configs as Record<string, { value: string; description: string }>).forEach(([k, v]) => {
            merged[k] = v.value || "";
          });
          setConfigForm(merged);
        }
      } else {
        toast({ title: "Failed to save config", description: data.error || "Please try again.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Failed to save config", variant: "destructive" });
    } finally {
      setSavingConfigKey(null);
    }
  };

  // Set the active payment gateway (separate from field edits)
  const handleSetActiveGateway = async (gateway: string) => {
    setSavingConfigKey("payment_gateway");
    try {
      const res = await fetch("/api/admin/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ configs: { payment_gateway: gateway } }),
      });
      const data = await res.json();
      if (data.success) {
        toast({ title: `${gateway.charAt(0).toUpperCase() + gateway.slice(1)} is now the active gateway` });
        // Update both adminConfigs and configForm without a full reload
        setAdminConfigs((prev) => ({ ...prev, payment_gateway: { value: gateway, description: prev.payment_gateway?.description || "" } }));
        setConfigForm((prev) => ({ ...prev, payment_gateway: gateway }));
      }
    } catch {
      toast({ title: "Failed to set active gateway", variant: "destructive" });
    } finally {
      setSavingConfigKey(null);
    }
  };

  // Save AI provider config
  const handleSaveAIConfig = async (provider: string, fields: string[]) => {
    setSavingConfigKey(provider);
    try {
      const updates: Record<string, string> = {};
      fields.forEach((f) => { updates[f] = configForm[f] || ""; });
      const res = await fetch("/api/admin/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ configs: updates }),
      });
      const data = await res.json();
      if (data.success) {
        toast({ title: `${provider} configuration saved` });
        const cfgRes = await fetch("/api/admin/config");
        const cfgData = await cfgRes.json();
        if (cfgData.success) {
          setAdminConfigs(cfgData.configs);
          const merged: Record<string, string> = { ...configForm };
          Object.entries(cfgData.configs as Record<string, { value: string; description: string }>).forEach(([k, v]) => {
            merged[k] = v.value || "";
          });
          setConfigForm(merged);
        }
      }
    } catch {
      toast({ title: "Failed to save config", variant: "destructive" });
    } finally {
      setSavingConfigKey(null);
    }
  };

  // Backward-compatible generic save (used by AI provider radio buttons)
  const handleAdminSaveConfig = async (configs: Record<string, string>) => {
    try {
      const res = await fetch("/api/admin/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ configs }),
      });
      const data = await res.json();
      if (data.success) {
        toast({ title: "Configuration saved" });
        // Merge into local state — no full reload
        setAdminConfigs((prev) => {
          const next = { ...prev };
          Object.entries(configs).forEach(([k, v]) => {
            next[k] = { value: v, description: next[k]?.description || "" };
          });
          return next;
        });
        setConfigForm((prev) => ({ ...prev, ...configs }));
      }
    } catch {
      toast({ title: "Failed to save config", variant: "destructive" });
    }
  };

  // Update a single configForm field
  const updateConfigField = (key: string, value: string) => {
    setConfigForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleAdminUpdateUser = async (userId: string, updates: Record<string, unknown>) => {
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      const data = await res.json();
      if (data.success) {
        toast({ title: "User updated" });
        handleAdminLoadData();
      }
    } catch {
      toast({ title: "Failed to update user", variant: "destructive" });
    }
  };

  // Fetch user data and token packages when session changes
  useEffect(() => {
    if (session?.user) {
      fetchUserProfile();
    }
  }, [session, fetchUserProfile]);

  useEffect(() => {
    fetch("/api/payments/packages")
      .then((r) => r.json())
      .then((d) => d.success && setTokenPackages(d.packages))
      .catch(() => {});
  }, []);

  // Re-fetch packages when the user navigates to the buy-tokens view so
  // admin edits are reflected immediately (the storefront cache has a 60s
  // TTL, but navigating away and back should always show fresh prices).
  useEffect(() => {
    if (currentView === "buy-tokens") {
      fetch("/api/payments/packages")
        .then((r) => r.json())
        .then((d) => d.success && setTokenPackages(d.packages))
        .catch(() => {});
    }
  }, [currentView]);

  // Handle payment redirect callbacks (?payment=success|cancelled|error)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const paymentStatus = params.get("payment");
    if (!paymentStatus) return;

    if (paymentStatus === "success") {
      toast({ title: "Payment successful!", description: "Your tokens have been credited to your account." });
      // Refresh token balance
      if (session?.user) fetchUserProfile();
    } else if (paymentStatus === "cancelled") {
      toast({ title: "Payment cancelled", description: "You cancelled the payment. No tokens were charged.", variant: "destructive" });
    } else if (paymentStatus === "error") {
      toast({ title: "Payment failed", description: "The payment could not be verified. Please try again or contact support.", variant: "destructive" });
    }

    // Clean the URL so the toast doesn't re-trigger on refresh
    const url = new URL(window.location.href);
    url.searchParams.delete("payment");
    window.history.replaceState({}, "", url.toString());
  }, [session?.user, fetchUserProfile, toast]);

  useEffect(() => {
    if (currentView === "admin" && session) handleAdminLoadData();
  }, [currentView, session, handleAdminLoadData]);

  // Load dashboard data
  useEffect(() => {
    if (currentView === "dashboard" && session) {
      fetch("/api/tokens/history")
        .then((r) => r.json())
        .then((d) => d.success && setTokenHistory(d.transactions || []))
        .catch(() => {});
    }
  }, [currentView, session]);

  // Load profile data
  useEffect(() => {
    if (currentView === "profile" && session) {
      fetchUserProfile();
      fetch("/api/tokens/history")
        .then((r) => r.json())
        .then((d) => {
          if (d.success) {
            setTokenHistory(d.transactions || []);
            if (d.user) {
              setProfileData(d.user);
              setProfileName(d.user.name || "");
            }
          }
        })
        .catch(() => {});
    }
  }, [currentView, session, fetchUserProfile]);

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

  const openDownloadGate = async (projectId: string, quality: string) => {
    setDownloadProjectId(projectId);
    setDownloadQuality(quality);
    try {
      const res = await fetch("/api/download/calculate-cost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, quality }),
      });
      const data = await res.json();
      if (data.success) {
        setDownloadCost(data.tokenCost);
        setDownloadBreakdown(data.breakdown);
        setDownloadInsufficient(data.tokenCost > userTokens);
        setDownloadGateOpen(true);
      } else {
        toast({ title: "Error calculating cost", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to calculate download cost", variant: "destructive" });
    }
  };

  const confirmDownload = async () => {
    if (!currentProject || !downloadProjectId) return;
    setIsRequestingDownload(true);
    try {
      const res = await fetch("/api/download/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: downloadProjectId, quality: downloadQuality }),
      });
      const data = await res.json();
      if (data.success) {
        toast({ title: "Download ready!", description: "Your video is being prepared." });
        if (data.downloadUrl) {
          window.open(data.downloadUrl, "_blank");
        }
        setUserTokens((prev) => prev - downloadCost);
        setDownloadGateOpen(false);
      } else {
        toast({ title: "Download failed", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to request download", variant: "destructive" });
    } finally {
      setIsRequestingDownload(false);
    }
  };

  const handleUpdateProfile = async () => {
    setIsUpdatingProfile(true);
    try {
      const body: Record<string, string> = {};
      if (profileName.trim()) body.name = profileName.trim();
      if (profileOldPassword && profileNewPassword) {
        body.oldPassword = profileOldPassword;
        body.newPassword = profileNewPassword;
      }
      const res = await fetch("/api/auth/user", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        toast({ title: "Profile updated" });
        fetchUserProfile();
        setProfileOldPassword("");
        setProfileNewPassword("");
      } else {
        toast({ title: "Update failed", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Error updating profile", variant: "destructive" });
    } finally {
      setIsUpdatingProfile(false);
    }
  };

  /* ════════════════════════════════════════════════════════════════
     RENDER
     ════════════════════════════════════════════════════════════════ */

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* ── Header ── */}
      <header className={`fixed top-0 inset-x-0 z-50 border-b backdrop-blur-xl transition-all duration-300 ${
        headerScrolled
          ? "bg-background/95 shadow-md shadow-black/5 border-slate-200/80"
          : "bg-background/70 border-transparent"
      }`}>
        <div className="max-w-7xl mx-auto px-3 sm:px-6 h-14 flex items-center justify-between gap-1.5 sm:gap-2 min-w-0 overflow-hidden">
          <button
            onClick={() => currentView !== "home" ? setCurrentView("home") : undefined}
            className="flex items-center gap-2 font-bold text-base sm:text-lg hover:opacity-80 transition-opacity shrink-0"
          >
            <div className="h-7 w-7 sm:h-8 sm:w-8 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-violet-500/20">
              <Clapperboard className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-white" />
            </div>
            <span className="bg-gradient-to-r from-violet-600 to-fuchsia-600 bg-clip-text text-transparent font-extrabold tracking-tight">
              Vidora
            </span>
            <Badge variant="outline" className="text-xs font-semibold text-violet-500 border-violet-200 ml-0.5 hidden sm:inline">
              PRO
            </Badge>
          </button>
          <div className="flex items-center gap-1 min-w-0 overflow-hidden">
            {/* AI Service Status — proactive health indicator */}
            <AIStatusBadge compact />
            {/* Desktop (lg+): inline buttons — icon always, label on xl+ */}
            {session?.user && (
              <div className="hidden lg:flex items-center gap-0.5">
                <Button variant="ghost" size="sm" onClick={() => setCurrentView("dashboard")} className="hover:bg-violet-50 text-violet-600 px-2 sm:px-2.5" title="Dashboard">
                  <BarChart3 className="h-4 w-4" /><span className="ml-1 header-label">Dashboard</span>
                </Button>
                {userProfile?.role === "admin" && (
                  <Button variant="ghost" size="sm" onClick={() => setCurrentView("admin")} className="hover:bg-violet-50 text-violet-600 px-2 sm:px-2.5" title="Admin">
                    <ShieldCheck className="h-4 w-4" /><span className="ml-1 header-label">Admin</span>
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={() => setCurrentView("buy-tokens")} className="border-amber-200 text-amber-600 hover:bg-amber-50 shrink-0 px-2 sm:px-2.5" title={`${userTokens} tokens`}>
                  <Coins className="h-4 w-4" /><span className="ml-1 font-bold text-xs sm:text-sm">{userTokens}</span>
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setCurrentView("profile")} className="hover:bg-slate-50 text-slate-600 px-2 sm:px-2.5" title="Profile">
                  <User className="h-4 w-4" /><span className="ml-1 header-label">Profile</span>
                </Button>
                <Button variant="ghost" size="sm" onClick={handleSignOut} className="hover:bg-red-50 text-red-500 px-2 sm:px-2.5" title="Sign Out">
                  <LogOut className="h-4 w-4" /><span className="ml-1 header-label">Sign Out</span>
                </Button>
              </div>
            )}
            {/* Tablet/mobile (below lg): token badge + hamburger drawer */}
            <div className="flex lg:hidden items-center gap-1.5">
              {session?.user ? (
                <Button variant="outline" size="sm" onClick={() => setCurrentView("buy-tokens")} className="border-amber-200 text-amber-600 hover:bg-amber-50 shrink-0 px-2">
                  <Coins className="h-4 w-4" /><span className="ml-1 text-xs font-bold">{userTokens}</span>
                </Button>
              ) : (
                <Button size="sm" onClick={() => { setAuthMode("login"); setAuthDialogOpen(true); }} className="btn-gradient shrink-0 px-3">
                  <LogIn className="h-4 w-4" /><span className="ml-1">Sign In</span>
                </Button>
              )}
              <Button variant="ghost" size="icon" onClick={() => setMobileNavOpen(true)} className="h-9 w-9 rounded-lg hover:bg-slate-100 shrink-0 border border-slate-200" aria-label="Open navigation menu">
                <Menu className="h-5 w-5" />
              </Button>
            </div>
            {/* Desktop (lg+): Sign In button for logged-out users */}
            {!session?.user && (
              <Button variant="outline" size="sm" onClick={() => { setAuthMode("login"); setAuthDialogOpen(true); }} className="hidden lg:inline-flex hover:bg-violet-50 shrink-0 px-3">
                <LogIn className="h-4 w-4" /><span className="ml-1.5">Sign In</span>
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* ── Main Content ── */}
      <main className="flex-1 pt-14 pb-20 md:pb-0">
        <AnimatePresence mode="wait">

          {/* ═══════════════════════════════════════════════════════
              HOME VIEW
              ═══════════════════════════════════════════════════════ */}
          {currentView === "home" && (
            <motion.div key="home" {...fadeUp}>
              {/* Hero */}
              <section className="relative overflow-hidden min-h-[520px] sm:min-h-[600px]">
                {/* ── Hero Slider ── */}
                <HeroSlider onNavigateCreate={() => setCurrentView("create")} onNavigateDemo={handleTryDemo} onNavigateGallery={() => setCurrentView("gallery")} isCreatingDemo={isCreatingDemo} />
              </section>

              {/* Quick Create Cards */}
              <section className="max-w-5xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
                <div className="text-center mb-8">
                  <h2 className="text-xl sm:text-2xl font-bold tracking-tight">Quick Create</h2>
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

              {/* ── Demo Showcase ── */}
              {demoTemplates.length > 0 && (
                <section className="max-w-6xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
                  <div className="text-center mb-8">
                    <Badge className="px-3 py-1 text-xs font-semibold bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100 mb-3">
                      <Play className="h-3 w-3 mr-1.5" />Instant Demo · No Signup
                    </Badge>
                    <h2 className="text-xl sm:text-2xl font-bold tracking-tight">
                      See It In Action — Pick a Demo
                    </h2>
                    <p className="text-muted-foreground mt-1 max-w-2xl mx-auto">
                      Explore a fully-generated video project with scenes, AI imagery, and playable clips — no tokens or account required.
                    </p>
                  </div>
                  <motion.div {...stagger} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                    {demoTemplates.map((tpl) => (
                      <motion.div key={tpl.id} {...fadeItem}>
                        <Card
                          className="card-glow cursor-pointer border-0 shadow-lg shadow-black/5 bg-white overflow-hidden group h-full flex flex-col"
                          onClick={() => handleTryDemo(tpl.id)}
                        >
                          <div className="relative aspect-video overflow-hidden">
                            <img
                              src={tpl.coverImage}
                              alt={tpl.title}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                            />
                            <div className={`absolute inset-0 bg-gradient-to-t ${tpl.accentColor} opacity-30 mix-blend-multiply`} />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
                            <div className="absolute top-3 left-3">
                              <Badge className="text-xs font-semibold bg-black/60 text-amber-200 border-amber-400/40 backdrop-blur-sm">
                                <Play className="h-3 w-3 mr-1" />Demo
                              </Badge>
                            </div>
                            <div className="absolute bottom-3 left-3 right-3">
                              <p className="text-white text-xs font-medium drop-shadow">{tpl.tagline}</p>
                            </div>
                            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                              <div className="h-14 w-14 rounded-full bg-white/95 flex items-center justify-center shadow-2xl">
                                <Play className="h-6 w-6 text-violet-700 ml-0.5" fill="currentColor" />
                              </div>
                            </div>
                          </div>
                          <CardHeader className="pb-2 pt-4 flex-1">
                            <CardTitle className="text-base font-bold leading-tight">{tpl.title.replace(/\s*—.*$/, "")}</CardTitle>
                            <CardDescription className="text-sm leading-relaxed line-clamp-2 mt-1">
                              {tpl.description}
                            </CardDescription>
                          </CardHeader>
                          <CardContent className="pt-0 pb-4">
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                              <span className="flex items-center gap-1.5">
                                <Film className="h-3.5 w-3.5" />
                                {tpl.sceneCount} scenes
                              </span>
                              <span className="flex items-center gap-1.5">
                                <Clock className="h-3.5 w-3.5" />
                                {tpl.targetDuration}s
                              </span>
                              <span className="flex items-center gap-1.5 capitalize">
                                <Palette className="h-3.5 w-3.5" />
                                {tpl.style}
                              </span>
                            </div>
                            <Button
                              size="sm"
                              className="w-full mt-3 btn-gradient"
                              disabled={isCreatingDemo}
                              onClick={(e) => { e.stopPropagation(); handleTryDemo(tpl.id); }}
                            >
                              {isCreatingDemo ? (
                                <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Loading…</>
                              ) : (
                                <><Play className="h-4 w-4 mr-1.5" />Open Demo</>
                              )}
                            </Button>
                          </CardContent>
                        </Card>
                      </motion.div>
                    ))}
                  </motion.div>
                </section>
              )}

              {/* Features Showcase */}
              <section className="max-w-6xl mx-auto px-4 sm:px-6 py-12">
                <div className="section-divider mb-12" />
                <div className="text-center mb-10">
                  <h2 className="text-xl sm:text-2xl font-bold tracking-tight">Everything You Need for Professional Videos</h2>
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
                  <h2 className="text-xl sm:text-2xl font-bold tracking-tight">How It Works</h2>
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
                  <h2 className="text-xl sm:text-2xl font-bold tracking-tight">Loved by Creators</h2>
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
                            <Badge className={`text-xs font-semibold px-2 shrink-0 ${
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
                            <Badge variant="outline" className="text-xs">{p.aspectRatio}</Badge>
                            <Badge variant="outline" className="text-xs">{p.style}</Badge>
                            <span className="flex items-center gap-0.5"><Clock className="h-3 w-3" />{formatDuration(p.targetDuration)}</span>
                            {p.projectType && p.projectType !== "custom" && (
                              <Badge className="text-xs bg-violet-50 text-violet-600 border-violet-200">{p.projectType}</Badge>
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
                              <Badge className="text-xs bg-emerald-50 text-emerald-700 border-emerald-200">
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

            </motion.div>
          )}

          {/* ═══════════════════════════════════════════════════════
              CREATE VIEW
              ═══════════════════════════════════════════════════════ */}
          {currentView === "create" && (
            <motion.div key="create" {...fadeUp} className="max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-6">
              <div>
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Create New Video</h1>
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
                          <p className="text-sm font-bold">{t.label}</p>
                          <p className="text-sm text-muted-foreground mt-0.5 leading-tight">{t.desc}</p>
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
                            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
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
                        className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                          isCustomDuration
                            ? "bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-md"
                            : "bg-amber-50 text-amber-600 hover:bg-amber-100 border border-amber-200"
                        }`}
                      >
                        Custom
                      </button>
                      {isCustomDuration && (
                        <div className="flex items-center gap-1.5">
                          <Input type="number" min={10} max={300} placeholder="seconds" value={customDuration} onChange={(e) => setCustomDuration(e.target.value)} className="w-28 h-10 text-sm" />
                          <span className="text-xs text-muted-foreground">sec (10–300)</span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="outline" className="text-xs">
                        <Film className="h-2.5 w-2.5 mr-1" />~{effectiveSceneCount} scene{effectiveSceneCount > 1 ? "s" : ""}
                      </Badge>
                      <Badge variant="outline" className="text-xs">
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
                            <p className="text-xs mt-0.5 font-bold">{a.label}</p>
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
                      <Badge className="ml-auto text-xs bg-emerald-50 text-emerald-700 border-emerald-200">
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
                              <Badge className="text-xs bg-violet-100 text-violet-700 border-violet-200">Scene {i + 1}</Badge>
                              {s.title && <span className="text-xs font-bold">{s.title}</span>}
                            </div>
                            <p className="text-sm text-muted-foreground line-clamp-2">{s.prompt}</p>
                            {s.dialogue && (
                              <p className="text-xs text-violet-500 mt-1 italic">{s.dialogue}</p>
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
                            <Badge key={i} variant="outline" className="text-xs">
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

              {/* ── FREE PREVIEW (try before you buy) ── */}
              {/* Lets users see a storyboard + watermarked style image before
                  spending tokens. Costs the owner ~$0.03 per user/day max
                  (rate-limited), accepted as customer-acquisition cost. */}
              <Card className="border-2 border-dashed border-emerald-300 bg-emerald-50/40 shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-bold flex items-center gap-2">
                    <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center text-white">
                      <Eye className="h-3.5 w-3.5" />
                    </div>
                    Free Preview — try before you buy
                    <Badge variant="outline" className="text-xs ml-1 text-emerald-600 border-emerald-300">0 tokens</Badge>
                  </CardTitle>
                  <CardDescription className="text-xs">
                    See exactly what your video will look like — for free. Get an AI storyboard and a watermarked style preview, then unlock the full HD video with tokens.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={handleGenerateStoryboardPreview}
                      disabled={isGeneratingStoryboard}
                      variant="outline"
                      className="border-emerald-300 text-emerald-700 hover:bg-emerald-100"
                    >
                      {isGeneratingStoryboard ? (
                        <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Building storyboard...</>
                      ) : (
                        <><FileText className="h-4 w-4 mr-1.5" />Free Storyboard</>
                      )}
                    </Button>
                    <Button
                      onClick={handleGeneratePreviewImage}
                      disabled={isGeneratingPreviewImage || !previewStoryboard}
                      variant="outline"
                      className="border-violet-300 text-violet-700 hover:bg-violet-100"
                    >
                      {isGeneratingPreviewImage ? (
                        <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Generating preview...</>
                      ) : (
                        <><ImageIcon className="h-4 w-4 mr-1.5" />Preview Visual Style</>
                      )}
                    </Button>
                  </div>
                  {/* Daily quota indicators */}
                  {previewQuota && (
                    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <FileText className="h-3 w-3" />
                        Storyboards: <strong className="text-slate-700">{previewQuota.storyboard.used}/{previewQuota.storyboard.limit}</strong> used today
                      </span>
                      <span className="flex items-center gap-1">
                        <ImageIcon className="h-3 w-3" />
                        Image previews: <strong className="text-slate-700">{previewQuota.image.used}/{previewQuota.image.limit}</strong> used today
                      </span>
                    </div>
                  )}
                  {previewStoryboard && (
                    <div className="rounded-lg bg-white border border-emerald-200 p-3 text-xs">
                      <p className="font-bold text-emerald-700 mb-1">Storyboard ready! ✓</p>
                      <p className="text-muted-foreground">
                        {Array.isArray(previewStoryboard.scenes) ? (previewStoryboard.scenes as unknown[]).length : 0} scenes planned.
                        {previewImageUrl ? " Style preview generated — view both in the preview panel." : " Now click \"Preview Visual Style\" to see how it will look."}
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>

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

              {/* ── Project Settings — Always at the top ── */}
              <Card className="border-0 shadow-lg shadow-black/5 bg-white card-glow">
                <CardHeader className="pb-3">
                  <div
                    className="flex items-center justify-between cursor-pointer select-none"
                    onClick={() => setShowProjectSettings(!showProjectSettings)}
                  >
                    <CardTitle className="text-base font-bold flex items-center gap-2">
                      <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center text-white">
                        <Settings className="h-3.5 w-3.5" />
                      </div>
                      Project Settings
                      <Badge variant="outline" className="text-xs ml-1">
                        {currentProject.style} · {currentProject.aspectRatio} · {formatDuration(currentProject.targetDuration)}
                      </Badge>
                    </CardTitle>
                    <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${showProjectSettings ? "rotate-90" : ""}`} />
                  </div>
                </CardHeader>
                <AnimatePresence>
                  {showProjectSettings && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <CardContent className="space-y-5">
                        {/* Style */}
                        <div className="space-y-2">
                          <Label className="text-sm font-medium flex items-center gap-1.5">
                            <Palette className="h-3.5 w-3.5 text-muted-foreground" />Visual Style
                          </Label>
                          <div className="flex flex-wrap gap-2">
                            {STYLES.map((s) => (
                              <button
                                key={s.value}
                                onClick={() => handleUpdateProjectSetting("style", s.value)}
                                disabled={updatingSettings}
                                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                                  currentProject.style === s.value
                                    ? "bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow-md shadow-violet-500/25"
                                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                                }`}
                              >
                                {s.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Aspect Ratio */}
                        <div className="space-y-2">
                          <Label className="text-sm font-medium flex items-center gap-1.5">
                            <LayoutGrid className="h-3.5 w-3.5 text-muted-foreground" />Aspect Ratio
                          </Label>
                          <div className="flex flex-wrap gap-2">
                            {ASPECTS.map((a) => (
                              <button
                                key={a.value}
                                onClick={() => handleUpdateProjectSetting("aspectRatio", a.value)}
                                disabled={updatingSettings}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                                  currentProject.aspectRatio === a.value
                                    ? "bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow-md shadow-violet-500/25"
                                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                                }`}
                              >
                                <a.icon className="h-3 w-3" />
                                {a.label}
                                <span className="opacity-70">{a.desc}</span>
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Duration */}
                        <div className="space-y-2">
                          <Label className="text-sm font-medium flex items-center gap-1.5">
                            <Timer className="h-3.5 w-3.5 text-muted-foreground" />Target Duration
                          </Label>
                          <div className="flex flex-wrap gap-2">
                            {DURATION_PRESETS.map((d) => (
                              <button
                                key={d.value}
                                onClick={() => handleUpdateProjectSetting("targetDuration", d.value)}
                                disabled={updatingSettings}
                                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                                  currentProject.targetDuration === d.value
                                    ? "bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow-md shadow-violet-500/25"
                                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                                }`}
                              >
                                {d.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      </CardContent>
                    </motion.div>
                  )}
                </AnimatePresence>
              </Card>

              {/* Project Info Bar */}
              <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
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
                {/* ── Advanced Feature Buttons ── */}
                <Button
                  onClick={() => setShareDialogOpen(true)}
                  variant="outline"
                  className="text-violet-600 border-violet-200 hover:bg-violet-50"
                >
                  <Share2 className="h-4 w-4 mr-1.5" />Share
                </Button>
                <Button
                  onClick={() => setBrandKitDialogOpen(true)}
                  variant="outline"
                  className="text-fuchsia-600 border-fuchsia-200 hover:bg-fuchsia-50"
                >
                  <Palette className="h-4 w-4 mr-1.5" />Brand Kit
                </Button>
                <Button
                  onClick={handleOpenAnalytics}
                  variant="outline"
                  disabled={!currentProject}
                >
                  <BarChart2 className="h-4 w-4 mr-1.5" />Analytics
                </Button>
                <Button
                  onClick={() => setSocialDialogOpen(true)}
                  variant="outline"
                  className="text-rose-600 border-rose-200 hover:bg-rose-50"
                  disabled={!currentProject?.finalVideoUrl}
                >
                  <Send className="h-4 w-4 mr-1.5" />Publish
                </Button>
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
                      <Badge variant="outline" className="text-xs ml-1">{safeCharacters.length}</Badge>
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
                              <Badge variant="outline" className="text-xs px-1 py-0">{char.role}</Badge>
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
                              <SelectTrigger className="h-6 w-16 text-xs px-0.5">
                                <Volume2 className="h-2.5 w-2.5" />
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {TTS_VOICES.map((v) => (
                                  <SelectItem key={v.id} value={v.id}>
                                    <span className="text-xs">{v.label}</span>
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
                    <CardTitle className="text-lg font-bold flex items-center gap-2">
                      <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-violet-500 to-purple-500 flex items-center justify-center text-white">
                        <Layers className="h-4 w-4" />
                      </div>
                      Scene Timeline
                      <Badge variant="outline" className="text-xs ml-1">{safeScenes.length}</Badge>
                    </CardTitle>
                    <div className="flex items-center gap-2">
                      <Select value={sceneFilter} onValueChange={setSceneFilter}>
                        <SelectTrigger className="h-8 w-32 text-xs px-2">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all"><span className="text-xs">All</span></SelectItem>
                          <SelectItem value="pending"><span className="text-xs">Pending</span></SelectItem>
                          <SelectItem value="generating"><span className="text-xs">Generating</span></SelectItem>
                          <SelectItem value="completed"><span className="text-xs">Completed</span></SelectItem>
                          <SelectItem value="failed"><span className="text-xs">Failed</span></SelectItem>
                        </SelectContent>
                      </Select>
                      <Button size="sm" variant="outline" onClick={() => setCreateDialogOpen(true)}>
                        <Plus className="h-3.5 w-3.5 mr-1" />Add Scene
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
                              onSetMusic={handleSetSceneMusic}
                              onGenerateSubtitles={handleGenerateSubtitles}
                              onToggleBurnSubtitles={handleToggleBurnSubtitles}
                              onGenerateDubbing={handleGenerateDubbing}
                              onDeleteDubbing={handleDeleteDubbing}
                              musicTracks={musicTracks}
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
                      <Button className="btn-amber" onClick={() => openDownloadGate(currentProject.id, "high")}>
                        <Download className="h-4 w-4 mr-1.5" />Download Video
                      </Button>
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
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Scene Templates</h1>
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
                          <Badge variant="outline" className="mt-2 text-xs capitalize">{scene.category}</Badge>
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

              {/* ── Template Marketplace ── */}
              <div className="pt-8 border-t border-slate-200">
                <div className="text-center mb-6">
                  <Badge className="mb-2 bg-violet-50 text-violet-700 border-violet-200">
                    <Building className="h-3 w-3 mr-1" />Industry Templates
                  </Badge>
                  <h2 className="text-xl sm:text-2xl font-bold tracking-tight">Start from a Professional Template</h2>
                  <p className="text-muted-foreground mt-1">Pre-built storyboards for real estate, restaurants, products, and more.</p>
                </div>

                {/* Category filter */}
                <div className="flex items-center gap-2 flex-wrap mb-4 justify-center">
                  <Button
                    variant={marketplaceCategory === "all" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setMarketplaceCategory("all")}
                    className={marketplaceCategory === "all" ? "btn-gradient" : ""}
                  >
                    All
                  </Button>
                  {marketplaceCategories.map((cat) => (
                    <Button
                      key={cat}
                      variant={marketplaceCategory === cat ? "default" : "outline"}
                      size="sm"
                      onClick={() => setMarketplaceCategory(cat)}
                      className={marketplaceCategory === cat ? "btn-gradient" : ""}
                    >
                      {cat.replace("-", " ")}
                    </Button>
                  ))}
                </div>

                {/* Template grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                  {marketplaceTemplates.map((tpl) => (
                    <motion.div key={tpl.slug} {...fadeItem}>
                      <Card
                        className="card-glow cursor-pointer border-0 shadow-lg shadow-black/5 bg-white overflow-hidden group h-full flex flex-col"
                        onClick={() => handleUseTemplate(tpl.slug)}
                      >
                        <div className="relative aspect-video overflow-hidden">
                          <img
                            src={tpl.coverImage}
                            alt={tpl.title}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                          />
                          <div className={`absolute inset-0 bg-gradient-to-t ${tpl.accentColor} opacity-20 mix-blend-multiply`} />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
                          {tpl.isFeatured && (
                            <div className="absolute top-2 right-2">
                              <Badge className="text-xs bg-amber-500 text-white border-0">
                                <Star className="h-3 w-3 mr-1" />Featured
                              </Badge>
                            </div>
                          )}
                          <div className="absolute bottom-2 left-3 right-3">
                            <Badge variant="outline" className="text-xs bg-black/40 text-white border-white/20 capitalize mb-1">
                              {tpl.category.replace("-", " ")}
                            </Badge>
                            <p className="text-white text-xs">{tpl.sceneCount} scenes · {tpl.targetDuration}s</p>
                          </div>
                        </div>
                        <CardHeader className="pb-2 pt-3 flex-1">
                          <CardTitle className="text-sm font-bold leading-tight">{tpl.title}</CardTitle>
                          <CardDescription className="text-xs leading-relaxed line-clamp-2 mt-1">
                            {tpl.description}
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="pt-0 pb-3">
                          <Button
                            size="sm"
                            className="w-full btn-gradient"
                            disabled={usingTemplate === tpl.slug}
                            onClick={(e) => { e.stopPropagation(); handleUseTemplate(tpl.slug); }}
                          >
                            {usingTemplate === tpl.slug ? (
                              <><Loader2 className="h-4 w-4 mr-1 animate-spin" />Creating...</>
                            ) : (
                              <><FolderPlus className="h-4 w-4 mr-1" />Use Template</>
                            )}
                          </Button>
                        </CardContent>
                      </Card>
                    </motion.div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}

          {/* ═══════════════════════════════════════════════════════
              BUY TOKENS VIEW
              ═══════════════════════════════════════════════════════ */}
          {currentView === "buy-tokens" && (
            <motion.div key="buy-tokens" {...fadeUp} className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-6">
              <div className="text-center space-y-2">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white shadow-lg shadow-amber-500/20">
                    <Coins className="h-5 w-5" />
                  </div>
                </div>
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Buy Tokens</h1>
                <p className="text-muted-foreground max-w-lg mx-auto">
                  Purchase tokens to download your AI-generated videos. Each download costs 1 token.
                </p>
                <div className="flex items-center justify-center gap-2 mt-2">
                  <Badge variant="outline" className="text-sm px-3 py-1 bg-amber-50 border-amber-200 text-amber-700">
                    <Wallet className="h-3.5 w-3.5 mr-1" />Current Balance: <strong>{userTokens} tokens</strong>
                  </Badge>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
                {tokenPackages.map((pkg: Record<string, unknown>) => (
                  <Card
                    key={pkg.id as string}
                    className={`relative border-2 transition-all hover:shadow-lg ${
                      pkg.popular
                        ? "border-violet-300 shadow-lg shadow-violet-500/10"
                        : "border-slate-100 hover:border-violet-200"
                    }`}
                  >
                    {pkg.popular && (
                      <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
                        <Badge className="bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white text-xs px-2.5 shadow-md">
                          <Star className="h-3 w-3 mr-1" />Popular
                        </Badge>
                      </div>
                    )}
                    <CardHeader className="text-center pb-2 pt-5">
                      <CardTitle className="text-lg font-bold">{pkg.name as string}</CardTitle>
                      <CardDescription className="text-xs">{pkg.tokens} tokens</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="text-center">
                        <div className="flex items-baseline justify-center gap-1">
                          <span className="text-3xl font-extrabold text-slate-900">
                            {typeof pkg.priceGHS === "number" && pkg.priceGHS < 100 ? `GH₵${pkg.priceGHS}` : `$${pkg.priceUSD}`}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground mt-0.5">
                          or ${pkg.priceUSD} USD
                        </p>
                      </div>
                      <Button
                        className="w-full btn-gradient"
                        onClick={() => handleBuyTokens(pkg.id as string, pkg.priceGHS as number, pkg.tokens as number, "GHS")}
                      >
                        <ShoppingBag className="h-4 w-4 mr-1.5" />Buy Now
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <div className="text-center">
                <p className="text-xs text-muted-foreground">
                  <CreditCard className="h-3 w-3 inline mr-1" />
                  Pay with MTN MoMo, Vodafone Cash, Visa, Mastercard via Paystack
                </p>
              </div>

              <div className="text-center pt-4">
                <Button variant="outline" onClick={() => setCurrentView("home")}>
                  <ArrowLeft className="h-4 w-4 mr-1.5" />Back to Home
                </Button>
              </div>
            </motion.div>
          )}

          {/* ═══════════════════════════════════════════════════════
              USER DASHBOARD VIEW
              ═══════════════════════════════════════════════════════ */}
          {currentView === "dashboard" && (
            <motion.div key="dashboard" {...fadeUp} className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-6">
              {/* Header */}
              <div className="flex items-center gap-3 flex-wrap">
                <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center text-white shadow-lg shadow-violet-500/20">
                  <BarChart3 className="h-5 w-5" />
                </div>
                <div>
                  <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Dashboard</h1>
                  <p className="text-muted-foreground text-sm">Welcome back, {userProfile?.name || "User"}</p>
                </div>
              </div>

              {/* Stats Row */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  { icon: Film, label: "Total Projects", value: safeProjects.length, color: "from-violet-500 to-purple-500" },
                  { icon: CheckCircle, label: "Completed Videos", value: safeProjects.filter((p: VideoProject) => p.status === "completed").length, color: "from-emerald-500 to-teal-500" },
                  { icon: TrendingDown, label: "Tokens Spent", value: tokenHistory.filter((t: Record<string, unknown>) => t.type === "spend").reduce((sum: number, t: Record<string, unknown>) => sum + (Number(t.amount) || 0), 0), color: "from-rose-500 to-red-500" },
                  { icon: Wallet, label: "Current Balance", value: userTokens, color: "from-amber-400 to-orange-500" },
                ].map((stat) => (
                  <Card key={stat.label} className="card-glow border-0 shadow-lg shadow-black/5 bg-white">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3">
                        <div className={`h-9 w-9 rounded-lg bg-gradient-to-br ${stat.color} flex items-center justify-center text-white shadow-md`}>
                          <stat.icon className="h-4 w-4" />
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground font-medium">{stat.label}</p>
                          <p className="text-xl font-extrabold">{stat.value}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* My Projects */}
              <Card className="card-glow border-0 shadow-lg shadow-black/5 bg-white">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-bold flex items-center gap-2">
                    <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-500 flex items-center justify-center text-white">
                      <Layers className="h-3.5 w-3.5" />
                    </div>
                    My Projects
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {safeProjects.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <Film className="h-8 w-8 mx-auto mb-2 opacity-30" />
                      <p className="text-sm">No projects yet</p>
                      <Button size="sm" className="mt-3 btn-gradient" onClick={() => setCurrentView("create")}>
                        <Plus className="h-4 w-4 mr-1" />Create Your First Video
                      </Button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-96 overflow-y-auto">
                      {safeProjects.map((project: VideoProject) => {
                        const statusColors: Record<string, string> = {
                          completed: "bg-emerald-50 text-emerald-700 border-emerald-200",
                          generating: "bg-violet-50 text-violet-700 border-violet-200",
                          failed: "bg-red-50 text-red-700 border-red-200",
                          pending: "bg-amber-50 text-amber-700 border-amber-200",
                        };
                        return (
                          <Card
                            key={project.id}
                            className="border border-slate-100 hover:border-violet-200 hover:shadow-md transition-all cursor-pointer group"
                            onClick={() => openProject(project)}
                          >
                            <CardContent className="p-4">
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-sm font-bold truncate">{project.title || "Untitled"}</span>
                                <Badge className={`text-xs px-2 ${statusColors[project.status] || "bg-slate-50 text-slate-600 border-slate-200"}`}>
                                  {project.status}
                                </Badge>
                              </div>
                              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{formatDuration(project.targetDuration || 0)}</span>
                                <span className="flex items-center gap-1"><Layers className="h-3 w-3" />{project.scenes?.length || 0} scenes</span>
                              </div>
                              <div className="flex items-center justify-end mt-2">
                                <span className="text-xs text-violet-500 group-hover:text-violet-700 flex items-center gap-0.5">
                                  Open <ArrowRight className="h-3 w-3" />
                                </span>
                              </div>
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Recent Activity */}
              <Card className="card-glow border-0 shadow-lg shadow-black/5 bg-white">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-bold flex items-center gap-2">
                    <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white">
                      <History className="h-3.5 w-3.5" />
                    </div>
                    Recent Activity
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {tokenHistory.length === 0 ? (
                    <div className="text-center py-6 text-muted-foreground">
                      <History className="h-8 w-8 mx-auto mb-2 opacity-30" />
                      <p className="text-sm">No recent transactions</p>
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {tokenHistory.slice(0, 5).map((tx: Record<string, unknown>, i: number) => {
                        const typeColors: Record<string, string> = {
                          purchase: "bg-emerald-50 text-emerald-700 border-emerald-200",
                          spend: "bg-red-50 text-red-700 border-red-200",
                          refund: "bg-blue-50 text-blue-700 border-blue-200",
                          bonus: "bg-purple-50 text-purple-700 border-purple-200",
                        };
                        return (
                          <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-slate-50/50 hover:bg-slate-50 transition-colors">
                            <div className="flex items-center gap-3">
                              <Badge className={`text-xs px-2 ${typeColors[String(tx.type)] || "bg-slate-100 text-slate-600"}`}>
                                {String(tx.type)}
                              </Badge>
                              <div>
                                <p className="text-sm font-medium">{String(tx.description || tx.type)}</p>
                                <p className="text-xs text-muted-foreground">{tx.createdAt ? new Date(String(tx.createdAt)).toLocaleDateString() : ""}</p>
                              </div>
                            </div>
                            <span className={`text-sm font-bold ${(tx.type as string) === "spend" ? "text-red-600" : "text-emerald-600"}`}>
                              {(tx.type as string) === "spend" ? "-" : "+"}{Number(tx.amount) || 0} tokens
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Quick Actions */}
              <Card className="card-glow border-0 shadow-lg shadow-black/5 bg-white">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-bold flex items-center gap-2">
                    <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-fuchsia-500 to-pink-500 flex items-center justify-center text-white">
                      <Zap className="h-3.5 w-3.5" />
                    </div>
                    Quick Actions
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <Button className="btn-gradient h-12" onClick={() => setCurrentView("create")}>
                      <Sparkles className="h-4 w-4 mr-2" />Create Video
                    </Button>
                    <Button className="btn-amber h-12" onClick={() => setCurrentView("buy-tokens")}>
                      <Coins className="h-4 w-4 mr-2" />Buy Tokens
                    </Button>
                    <Button variant="outline" className="h-12 border-slate-200" onClick={() => setCurrentView("profile")}>
                      <Settings className="h-4 w-4 mr-2" />Profile
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <div className="text-center pt-2">
                <Button variant="outline" onClick={() => setCurrentView("home")}>
                  <ArrowLeft className="h-4 w-4 mr-1.5" />Back to Home
                </Button>
              </div>
            </motion.div>
          )}

          {/* ═══════════════════════════════════════════════════════
              PROFILE VIEW
              ═══════════════════════════════════════════════════════ */}
          {currentView === "profile" && (
            <motion.div key="profile" {...fadeUp} className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-6">
              {/* Header */}
              <div className="flex items-center gap-3 flex-wrap">
                <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-slate-500 to-slate-700 flex items-center justify-center text-white shadow-lg shadow-slate-500/20">
                  <User className="h-5 w-5" />
                </div>
                <div>
                  <h1 className="text-xl sm:text-2xl font-bold tracking-tight">My Profile</h1>
                  <p className="text-muted-foreground text-sm">Manage your account and view activity</p>
                </div>
              </div>

              {/* Profile Card */}
              <Card className="card-glow border-0 shadow-lg shadow-black/5 bg-white">
                <CardContent className="p-6">
                  <div className="flex items-center gap-4">
                    <div className="h-16 w-16 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center text-white text-2xl font-bold shadow-lg">
                      {userProfile?.name?.charAt(0)?.toUpperCase() || "U"}
                    </div>
                    <div className="flex-1">
                      <h2 className="text-lg font-bold">{userProfile?.name || "User"}</h2>
                      <p className="text-sm text-muted-foreground">{userProfile?.email || ""}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge className="text-xs px-2 bg-violet-50 text-violet-700 border-violet-200">
                          {userProfile?.role === "admin" ? "🛡️ Admin" : "✨ Member"}
                        </Badge>
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {profileData?.createdAt ? `Member since ${new Date(profileData.createdAt).toLocaleDateString("en-US", { month: "long", year: "numeric" })}` : "Member"}
                        </span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Edit Profile Form */}
              <Card className="card-glow border-0 shadow-lg shadow-black/5 bg-white">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-bold flex items-center gap-2">
                    <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-teal-500 to-emerald-500 flex items-center justify-center text-white">
                      <Settings className="h-3.5 w-3.5" />
                    </div>
                    Edit Profile
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-1.5">
                    <Label className="text-sm font-medium">Display Name</Label>
                    <Input
                      placeholder="Your name"
                      value={profileName}
                      onChange={(e) => setProfileName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-sm font-medium">Email</Label>
                    <Input
                      placeholder="Email"
                      value={userProfile?.email || ""}
                      disabled
                      className="bg-slate-50 text-muted-foreground"
                    />
                    <p className="text-xs text-muted-foreground">Email cannot be changed</p>
                  </div>
                  <Separator className="my-4" />
                  <div className="space-y-1.5">
                    <Label className="text-sm font-medium">Change Password</Label>
                    <Input
                      type="password"
                      placeholder="Current password"
                      value={profileOldPassword}
                      onChange={(e) => setProfileOldPassword(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Input
                      type="password"
                      placeholder="New password"
                      value={profileNewPassword}
                      onChange={(e) => setProfileNewPassword(e.target.value)}
                    />
                  </div>
                  <Button
                    className="btn-gradient"
                    onClick={handleUpdateProfile}
                    disabled={isUpdatingProfile || (!profileName.trim() && !profileOldPassword)}
                  >
                    {isUpdatingProfile ? (
                      <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Saving...</>
                    ) : (
                      <><CheckCircle className="h-4 w-4 mr-1.5" />Save Changes</>
                    )}
                  </Button>
                </CardContent>
              </Card>

              {/* Token History */}
              <Card className="card-glow border-0 shadow-lg shadow-black/5 bg-white">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-bold flex items-center gap-2">
                    <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white">
                      <History className="h-3.5 w-3.5" />
                    </div>
                    Token History
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {tokenHistory.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <History className="h-8 w-8 mx-auto mb-2 opacity-30" />
                      <p className="text-sm">No transactions yet</p>
                    </div>
                  ) : (
                    <>
                      <div className="space-y-2 max-h-96 overflow-y-auto">
                        {tokenHistory.slice((profileHistoryPage - 1) * 10, profileHistoryPage * 10).map((tx: Record<string, unknown>, i: number) => {
                          const typeColors: Record<string, string> = {
                            purchase: "bg-emerald-50 text-emerald-700 border-emerald-200",
                            spend: "bg-red-50 text-red-700 border-red-200",
                            refund: "bg-blue-50 text-blue-700 border-blue-200",
                            bonus: "bg-purple-50 text-purple-700 border-purple-200",
                          };
                          return (
                            <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-slate-50/50 hover:bg-slate-50 transition-colors">
                              <div className="flex items-center gap-3">
                                <Badge className={`text-xs px-2 ${typeColors[String(tx.type)] || "bg-slate-100 text-slate-600"}`}>
                                  {String(tx.type)}
                                </Badge>
                                <div>
                                  <p className="text-sm font-medium">{String(tx.description || tx.type)}</p>
                                  <p className="text-xs text-muted-foreground">{tx.createdAt ? new Date(String(tx.createdAt)).toLocaleString() : ""}</p>
                                </div>
                              </div>
                              <span className={`text-sm font-bold ${(tx.type as string) === "spend" ? "text-red-600" : "text-emerald-600"}`}>
                                {(tx.type as string) === "spend" ? "-" : "+"}{Number(tx.amount) || 0} tokens
                              </span>
                            </div>
                          );
                        })}
                      </div>
                      {tokenHistory.length > 10 && (
                        <div className="flex items-center justify-center gap-2 mt-4">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={profileHistoryPage <= 1}
                            onClick={() => setProfileHistoryPage((p) => p - 1)}
                          >
                            <ArrowLeft className="h-3 w-3 mr-1" />Prev
                          </Button>
                          <span className="text-xs text-muted-foreground">Page {profileHistoryPage} of {Math.ceil(tokenHistory.length / 10)}</span>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={profileHistoryPage >= Math.ceil(tokenHistory.length / 10)}
                            onClick={() => setProfileHistoryPage((p) => p + 1)}
                          >
                            Next<ArrowRight className="h-3 w-3 ml-1" />
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>

              {/* Archived Projects */}
              <Card className="card-glow border-0 shadow-lg shadow-black/5 bg-white">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-bold flex items-center gap-2">
                    <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-slate-400 to-slate-600 flex items-center justify-center text-white">
                      <FileText className="h-3.5 w-3.5" />
                    </div>
                    Archived Projects
                  </CardTitle>
                  <CardDescription className="text-xs">Completed and failed projects</CardDescription>
                </CardHeader>
                <CardContent>
                  {safeProjects.filter((p: VideoProject) => p.status === "completed" || p.status === "failed").length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <FileText className="h-8 w-8 mx-auto mb-2 opacity-30" />
                      <p className="text-sm">No archived projects</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-64 overflow-y-auto">
                      {safeProjects
                        .filter((p: VideoProject) => p.status === "completed" || p.status === "failed")
                        .map((project: VideoProject) => (
                          <Card
                            key={project.id}
                            className="border border-slate-100 hover:border-violet-200 hover:shadow-md transition-all cursor-pointer"
                            onClick={() => openProject(project)}
                          >
                            <CardContent className="p-4">
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-sm font-bold truncate">{project.title || "Untitled"}</span>
                                <Badge className={`text-xs px-2 ${
                                  project.status === "completed"
                                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                    : "bg-red-50 text-red-700 border-red-200"
                                }`}>
                                  {project.status}
                                </Badge>
                              </div>
                              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{formatDuration(project.targetDuration || 0)}</span>
                                <span className="flex items-center gap-1"><Layers className="h-3 w-3" />{project.scenes?.length || 0} scenes</span>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <div className="text-center pt-2">
                <Button variant="outline" onClick={() => setCurrentView("home")}>
                  <ArrowLeft className="h-4 w-4 mr-1.5" />Back to Home
                </Button>
              </div>
            </motion.div>
          )}

          {/* ═══════════════════════════════════════════════════════
              ADMIN DASHBOARD VIEW
              ═══════════════════════════════════════════════════════ */}
          {currentView === "admin" && userProfile?.role === "admin" && (
            <motion.div key="admin" {...fadeUp} className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-6">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white shadow-lg shadow-violet-500/20">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div>
                  <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Admin Dashboard</h1>
                  <p className="text-muted-foreground text-sm">Manage users, payments, and system configuration</p>
                </div>
              </div>

              {adminLoading && !adminAnalytics && (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-violet-500" />
                </div>
              )}

              {adminAnalytics && (
                <>
                  {/* Analytics Cards */}
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    {[
                      { label: "Total Users", value: ((adminAnalytics.users as Record<string, unknown>)?.total as number) || 0, icon: Users, color: "from-violet-500 to-purple-500" },
                      { label: "Active Users", value: ((adminAnalytics.users as Record<string, unknown>)?.active as number) || 0, icon: User, color: "from-emerald-500 to-teal-500" },
                      { label: "Total Revenue", value: `GH₵${((adminAnalytics.revenue as Record<string, unknown>)?.totalRevenue as number) || 0}`, icon: DollarSign, color: "from-amber-500 to-orange-500" },
                      { label: "Tokens Sold", value: ((adminAnalytics.revenue as Record<string, unknown>)?.totalTokensSold as number) || 0, icon: Coins, color: "from-rose-500 to-pink-500" },
                    ].map((stat) => (
                      <Card key={stat.label} className="border-0 shadow-lg shadow-black/5">
                        <CardContent className="p-4">
                          <div className="flex items-center gap-3">
                            <div className={`h-10 w-10 rounded-lg bg-gradient-to-br ${stat.color} flex items-center justify-center text-white`}>
                              <stat.icon className="h-5 w-5" />
                            </div>
                            <div>
                              <p className="text-sm text-muted-foreground">{stat.label}</p>
                              <p className="text-xl font-bold">{stat.value}</p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>

                  {/* ── Token Package Management ──
                      Admin can adjust prices, token quantities, bonuses,
                      ordering, active/popular flags — all live, no redeploy. */}
                  <Card className="border-0 shadow-lg shadow-black/5">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base font-bold flex items-center gap-2 flex-wrap">
                        <Package className="h-4 w-4 text-amber-500" />
                        Token Packages
                        <Badge variant="outline" className="text-xs ml-1 bg-amber-50 text-amber-600 border-amber-200">
                          {adminPackages.filter((p) => p.isActive).length} live · {adminPackages.length} total
                        </Badge>
                        <div className="ml-auto flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={handleResetPackages}
                            disabled={resettingPackages}
                            className="h-8 text-xs"
                          >
                            {resettingPackages ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5 mr-1.5" />}
                            Reset to Defaults
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => { setEditingPackage(null); setPackageDialogOpen(true); }}
                            className="btn-gradient h-8 text-xs"
                          >
                            <Plus className="h-3.5 w-3.5 mr-1.5" />Add Package
                          </Button>
                        </div>
                      </CardTitle>
                      <CardDescription className="text-xs">
                        Adjust prices, token quantities, and bonuses. Changes go live instantly on the Buy Tokens page — no redeploy needed. Inactive packages are hidden from customers but preserved for analytics.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="max-h-[28rem] overflow-y-auto custom-scrollbar -mx-2 px-2">
                        <table className="w-full text-sm">
                          <thead className="sticky top-0 bg-white z-10">
                            <tr className="border-b text-left text-xs text-muted-foreground">
                              <th className="pb-2 pr-2 pl-1 w-8"></th>
                              <th className="pb-2 pr-2">Package</th>
                              <th className="pb-2 pr-2 text-right">Tokens</th>
                              <th className="pb-2 pr-2 text-right">Bonus</th>
                              <th className="pb-2 pr-2 text-right">Effective</th>
                              <th className="pb-2 pr-2 text-right">Price (GHS)</th>
                              <th className="pb-2 pr-2 text-right">Price (USD)</th>
                              <th className="pb-2 pr-2 text-right">₵/Token</th>
                              <th className="pb-2 pr-2 text-center">Popular</th>
                              <th className="pb-2 pr-2 text-center">Active</th>
                              <th className="pb-2 pr-1 text-right">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {adminPackages.map((pkg) => (
                              <tr key={pkg.id} className={`border-b last:border-0 hover:bg-slate-50 ${!pkg.isActive ? "opacity-50" : ""}`}>
                                <td className="py-2 pr-2 pl-1">
                                  <div className="flex flex-col">
                                    <button
                                      onClick={() => handleReorderPackage(pkg, "up")}
                                      disabled={pkg.sortOrder === Math.min(...adminPackages.map((p) => p.sortOrder))}
                                      className="text-slate-400 hover:text-violet-600 disabled:opacity-20 disabled:cursor-not-allowed"
                                      title="Move up"
                                    ><ChevronUp className="h-3.5 w-3.5" /></button>
                                    <button
                                      onClick={() => handleReorderPackage(pkg, "down")}
                                      disabled={pkg.sortOrder === Math.max(...adminPackages.map((p) => p.sortOrder))}
                                      className="text-slate-400 hover:text-violet-600 disabled:opacity-20 disabled:cursor-not-allowed"
                                      title="Move down"
                                    ><ChevronDown className="h-3.5 w-3.5" /></button>
                                  </div>
                                </td>
                                <td className="py-2 pr-2">
                                  <div className="font-semibold text-slate-800">{pkg.name}</div>
                                  <div className="text-xs text-muted-foreground font-mono">{pkg.slug}</div>
                                </td>
                                <td className="py-2 pr-2 text-right font-semibold">{pkg.tokens}</td>
                                <td className="py-2 pr-2 text-right text-xs">
                                  {pkg.bonusPct > 0 ? (
                                    <Badge variant="outline" className="text-xs bg-emerald-50 text-emerald-600 border-emerald-200">+{pkg.bonusPct}%</Badge>
                                  ) : (
                                    <span className="text-muted-foreground">—</span>
                                  )}
                                </td>
                                <td className="py-2 pr-2 text-right">
                                  <span className="font-bold text-violet-600">{pkg.effectiveTokens}</span>
                                </td>
                                <td className="py-2 pr-2 text-right font-semibold">₵{pkg.priceGHS.toFixed(2)}</td>
                                <td className="py-2 pr-2 text-right text-muted-foreground">${pkg.priceUSD.toFixed(2)}</td>
                                <td className="py-2 pr-2 text-right text-xs">
                                  <span className={pkg.effectiveTokenPriceGHS < 0.3 ? "text-emerald-600 font-semibold" : "text-slate-600"}>
                                    ₵{pkg.effectiveTokenPriceGHS.toFixed(3)}
                                  </span>
                                </td>
                                <td className="py-2 pr-2 text-center">
                                  <button
                                    onClick={() => handleTogglePackagePopular(pkg)}
                                    className={`transition-transform hover:scale-110 ${pkg.popular ? "text-amber-500" : "text-slate-300 hover:text-amber-400"}`}
                                    title={pkg.popular ? "Unmark as popular" : "Mark as popular (highlighted)"}
                                  >
                                    <Star className={`h-4 w-4 ${pkg.popular ? "fill-current" : ""}`} />
                                  </button>
                                </td>
                                <td className="py-2 pr-2 text-center">
                                  <Switch
                                    checked={pkg.isActive}
                                    onCheckedChange={() => handleTogglePackageActive(pkg)}
                                    title={pkg.isActive ? "Click to hide from storefront" : "Click to make live"}
                                  />
                                </td>
                                <td className="py-2 pr-1 text-right">
                                  <div className="flex justify-end gap-1">
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 w-7 p-0"
                                      onClick={() => { setEditingPackage(pkg); setPackageDialogOpen(true); }}
                                      title="Edit package"
                                    >
                                      <Pencil className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 w-7 p-0 text-red-500 hover:bg-red-50 hover:text-red-600"
                                      onClick={() => handleDeletePackage(pkg.id)}
                                      title="Delete package"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                            {adminPackages.length === 0 && (
                              <tr><td colSpan={11} className="py-8 text-center text-muted-foreground">No packages yet. Click "Add Package" or "Reset to Defaults".</td></tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                      {/* Economics summary footer */}
                      {(() => {
                        const active = adminPackages.filter((p) => p.isActive);
                        if (active.length === 0) return null;
                        const prices = active.map((p) => p.effectiveTokenPriceGHS);
                        const totalTokens = active.reduce((s, p) => s + p.effectiveTokens, 0);
                        return (
                          <div className="mt-3 pt-3 border-t flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Sparkle className="h-3 w-3 text-amber-500" />
                              Cheapest per-token: <strong className="text-slate-700">₵{Math.min(...prices).toFixed(3)}</strong>
                            </span>
                            <span className="flex items-center gap-1">
                              <TrendingDown className="h-3 w-3 text-violet-500" />
                              Most expensive: <strong className="text-slate-700">₵{Math.max(...prices).toFixed(3)}</strong>
                            </span>
                            <span className="flex items-center gap-1">
                              <Coins className="h-3 w-3 text-amber-500" />
                              Total tokens offered: <strong className="text-slate-700">{totalTokens}</strong>
                            </span>
                          </div>
                        );
                      })()}
                    </CardContent>
                  </Card>

                  {/* Users Table */}
                  <Card className="border-0 shadow-lg shadow-black/5">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base font-bold flex items-center gap-2">
                        <Users className="h-4 w-4 text-violet-500" />
                        Users ({adminUsers.length})
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="max-h-96 overflow-y-auto custom-scrollbar">
                        <table className="w-full text-sm">
                          <thead className="sticky top-0 bg-white">
                            <tr className="border-b text-left text-sm text-muted-foreground">
                              <th className="pb-2 pr-3">Name</th>
                              <th className="pb-2 pr-3">Email</th>
                              <th className="pb-2 pr-3">Role</th>
                              <th className="pb-2 pr-3">Tokens</th>
                              <th className="pb-2 pr-3">Status</th>
                              <th className="pb-2">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {adminUsers.map((u: Record<string, unknown>) => (
                              <tr key={u.id as string} className="border-b last:border-0 hover:bg-slate-50">
                                <td className="py-2 pr-3 font-medium truncate max-w-[120px]">{u.name as string}</td>
                                <td className="py-2 pr-3 truncate max-w-[180px] text-muted-foreground">{u.email as string}</td>
                                <td className="py-2 pr-3">
                                  <Badge variant="outline" className={`text-xs ${
                                    u.role === "admin" ? "bg-violet-50 text-violet-600 border-violet-200" : "bg-slate-50"
                                  }`}>{u.role as string}</Badge>
                                </td>
                                <td className="py-2 pr-3 font-semibold">{u.tokens as number}</td>
                                <td className="py-2 pr-3">
                                  <Badge variant="outline" className={`text-xs ${u.isActive ? "bg-emerald-50 text-emerald-600 border-emerald-200" : "bg-red-50 text-red-600"}`}>
                                    {u.isActive ? "Active" : "Inactive"}
                                  </Badge>
                                </td>
                                <td className="py-2">
                                  <div className="flex gap-1">
                                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs"
                                      onClick={() => handleAdminUpdateUser(u.id as string, { tokens: (u.tokens as number) + 10 })}>
                                      +10
                                    </Button>
                                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs"
                                      onClick={() => handleAdminUpdateUser(u.id as string, { role: u.role === "admin" ? "user" : "admin" })}>
                                      {u.role === "admin" ? "User" : "Admin"}
                                    </Button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Payment Gateway Config */}
                  <Card className="border-0 shadow-lg shadow-black/5">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base font-bold flex items-center gap-2 flex-wrap">
                        <Building2 className="h-4 w-4 text-violet-500" />
                        Payment Gateway Configuration
                        {adminConfigs.payment_gateway?.value && (
                          <Badge variant="outline" className={`ml-auto text-xs font-medium ${
                            adminConfigs.payment_gateway?.value === "paystack" ? "bg-violet-50 text-violet-600 border-violet-200" :
                            adminConfigs.payment_gateway?.value === "hubtel" ? "bg-amber-50 text-amber-600 border-amber-200" :
                            "bg-emerald-50 text-emerald-600 border-emerald-200"
                          }`}>
                            Active: {adminConfigs.payment_gateway.value}
                          </Badge>
                        )}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {/* Active gateway selector — NOT auto-save, requires explicit click */}
                      <div className="mb-5 p-4 rounded-lg bg-slate-50 border border-slate-200">
                        <Label className="text-sm font-semibold text-slate-700 mb-2 block">Select Active Payment Gateway</Label>
                        <div className="grid grid-cols-3 gap-2">
                          {(["paystack", "hubtel", "stripe"] as const).map((gw) => (
                            <Button
                              key={gw}
                              size="sm"
                              variant={adminConfigs.payment_gateway?.value === gw ? "default" : "outline"}
                              className={`h-auto py-2.5 flex flex-col items-center gap-1 ${
                                adminConfigs.payment_gateway?.value === gw
                                  ? "btn-gradient"
                                  : "hover:bg-slate-100"
                              }`}
                              disabled={savingConfigKey === "payment_gateway"}
                              onClick={() => handleSetActiveGateway(gw)}
                            >
                              <span className="text-sm font-semibold capitalize">{gw}</span>
                              {adminConfigs.payment_gateway?.value === gw && (
                                <Check className="h-3 w-3" />
                              )}
                            </Button>
                          ))}
                        </div>
                        <p className="text-xs text-muted-foreground mt-2">Only the active gateway is used at checkout. Switch anytime.</p>
                      </div>

                      {/* Only the ACTIVE gateway's fields are shown — selecting a gateway above
                          switches this form instantly. No tabs, no clutter. */}
                      <div className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
                        <div className="flex items-center gap-2 mb-4">
                          {(() => {
                            const gw = adminConfigs.payment_gateway?.value || "paystack";
                            const icon = gw === "paystack" ? <DollarSign className="h-4 w-4 text-violet-500" /> :
                                         gw === "hubtel" ? <Wallet className="h-4 w-4 text-amber-500" /> :
                                         <CreditCard className="h-4 w-4 text-emerald-500" />;
                            return icon;
                          })()}
                          <h4 className="text-sm font-bold capitalize text-slate-800">
                            {adminConfigs.payment_gateway?.value || "paystack"} Configuration
                          </h4>
                        </div>

                        {/* ── Paystack fields (only when active) ── */}
                        {(adminConfigs.payment_gateway?.value || "paystack") === "paystack" && (
                          <div className="space-y-4">
                            <p className="text-sm text-muted-foreground">Accept payments via Paystack (MoMo, Visa, Mastercard)</p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div className="space-y-1.5">
                                <Label className="text-sm font-medium">Secret Key</Label>
                                <Input
                                  type="password"
                                  value={configForm.paystack_secret_key || ""}
                                  onChange={(e) => updateConfigField("paystack_secret_key", e.target.value)}
                                  placeholder="sk_live_..."
                                  className="h-9 text-sm"
                                />
                              </div>
                              <div className="space-y-1.5">
                                <Label className="text-sm font-medium">Public Key</Label>
                                <Input
                                  type="password"
                                  value={configForm.paystack_public_key || ""}
                                  onChange={(e) => updateConfigField("paystack_public_key", e.target.value)}
                                  placeholder="pk_live_..."
                                  className="h-9 text-sm"
                                />
                              </div>
                              <div className="space-y-1.5">
                                <Label className="text-sm font-medium">Webhook Secret</Label>
                                <Input
                                  type="password"
                                  value={configForm.paystack_webhook_secret || ""}
                                  onChange={(e) => updateConfigField("paystack_webhook_secret", e.target.value)}
                                  placeholder="Paystack webhook verification secret"
                                  className="h-9 text-sm"
                                />
                                <p className="text-xs text-muted-foreground">Used to verify webhook events from Paystack</p>
                              </div>
                              <div className="space-y-1.5">
                                <Label className="text-sm font-medium">Currency</Label>
                                <Input
                                  type="text"
                                  value={configForm.paystack_currency || "GHS"}
                                  onChange={(e) => updateConfigField("paystack_currency", e.target.value)}
                                  placeholder="GHS"
                                  className="h-9 text-sm"
                                />
                                <p className="text-xs text-muted-foreground">Default payment currency (e.g. GHS, USD)</p>
                              </div>
                            </div>
                            <Button
                              onClick={() => handleSaveGatewayConfig("paystack", ["paystack_secret_key", "paystack_public_key", "paystack_webhook_secret", "paystack_currency"])}
                              disabled={savingConfigKey === "paystack"}
                              className="btn-gradient w-full sm:w-auto"
                            >
                              {savingConfigKey === "paystack" ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <KeyRound className="h-4 w-4 mr-1.5" />}
                              {savingConfigKey === "paystack" ? "Saving..." : "Save Paystack Configuration"}
                            </Button>
                          </div>
                        )}

                        {/* ── Hubtel fields (only when active) ── */}
                        {adminConfigs.payment_gateway?.value === "hubtel" && (
                          <div className="space-y-4">
                            <p className="text-sm text-muted-foreground">Accept payments via Hubtel (MoMo, Bank Transfer)</p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div className="space-y-1.5">
                                <Label className="text-sm font-medium">Client ID</Label>
                                <Input
                                  type="password"
                                  value={configForm.hubtel_client_id || ""}
                                  onChange={(e) => updateConfigField("hubtel_client_id", e.target.value)}
                                  placeholder="Hubtel client ID"
                                  className="h-9 text-sm"
                                />
                              </div>
                              <div className="space-y-1.5">
                                <Label className="text-sm font-medium">Client Secret</Label>
                                <Input
                                  type="password"
                                  value={configForm.hubtel_client_secret || ""}
                                  onChange={(e) => updateConfigField("hubtel_client_secret", e.target.value)}
                                  placeholder="Hubtel client secret"
                                  className="h-9 text-sm"
                                />
                              </div>
                              <div className="space-y-1.5">
                                <Label className="text-sm font-medium">Merchant Account Number</Label>
                                <Input
                                  type="text"
                                  value={configForm.hubtel_merchant_id || ""}
                                  onChange={(e) => updateConfigField("hubtel_merchant_id", e.target.value)}
                                  placeholder="HM-XXXXXX"
                                  className="h-9 text-sm"
                                />
                              </div>
                              <div className="space-y-1.5">
                                <Label className="text-sm font-medium">API Key</Label>
                                <Input
                                  type="password"
                                  value={configForm.hubtel_api_key || ""}
                                  onChange={(e) => updateConfigField("hubtel_api_key", e.target.value)}
                                  placeholder="Hubtel API key"
                                  className="h-9 text-sm"
                                />
                              </div>
                              <div className="space-y-1.5">
                                <Label className="text-sm font-medium">Currency</Label>
                                <Input
                                  type="text"
                                  value={configForm.hubtel_currency || "GHS"}
                                  onChange={(e) => updateConfigField("hubtel_currency", e.target.value)}
                                  placeholder="GHS"
                                  className="h-9 text-sm"
                                />
                                <p className="text-xs text-muted-foreground">Default payment currency (e.g. GHS, USD)</p>
                              </div>
                            </div>
                            <Button
                              onClick={() => handleSaveGatewayConfig("hubtel", ["hubtel_client_id", "hubtel_client_secret", "hubtel_merchant_id", "hubtel_api_key", "hubtel_currency"])}
                              disabled={savingConfigKey === "hubtel"}
                              className="btn-gradient w-full sm:w-auto"
                            >
                              {savingConfigKey === "hubtel" ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <KeyRound className="h-4 w-4 mr-1.5" />}
                              {savingConfigKey === "hubtel" ? "Saving..." : "Save Hubtel Configuration"}
                            </Button>
                          </div>
                        )}

                        {/* ── Stripe fields (only when active) ── */}
                        {adminConfigs.payment_gateway?.value === "stripe" && (
                          <div className="space-y-4">
                            <p className="text-sm text-muted-foreground">Accept payments via Stripe (Card, Apple Pay, Google Pay)</p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div className="space-y-1.5">
                                <Label className="text-sm font-medium">Secret Key</Label>
                                <Input
                                  type="password"
                                  value={configForm.stripe_secret_key || ""}
                                  onChange={(e) => updateConfigField("stripe_secret_key", e.target.value)}
                                  placeholder="sk_live_..."
                                  className="h-9 text-sm"
                                />
                              </div>
                              <div className="space-y-1.5">
                                <Label className="text-sm font-medium">Publishable Key</Label>
                                <Input
                                  type="password"
                                  value={configForm.stripe_publishable_key || ""}
                                  onChange={(e) => updateConfigField("stripe_publishable_key", e.target.value)}
                                  placeholder="pk_live_..."
                                  className="h-9 text-sm"
                                />
                              </div>
                            </div>
                            <Button
                              onClick={() => handleSaveGatewayConfig("stripe", ["stripe_secret_key", "stripe_publishable_key"])}
                              disabled={savingConfigKey === "stripe"}
                              className="btn-gradient w-full sm:w-auto"
                            >
                              {savingConfigKey === "stripe" ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <KeyRound className="h-4 w-4 mr-1.5" />}
                              {savingConfigKey === "stripe" ? "Saving..." : "Save Stripe Configuration"}
                            </Button>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>


                  {/* AI Provider Configuration */}
                  <Card className="border-0 shadow-lg shadow-black/5">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base font-bold flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-violet-500" />
                        AI Provider Configuration
                        <Badge variant="outline" className="text-xs ml-1 bg-amber-50 text-amber-600 border-amber-200">VPS Only</Badge>
                      </CardTitle>
                      <CardDescription className="text-xs">
                        Configure AI service providers for video, image, TTS, and LLM generation. These are used when deployed on a live VPS server.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-5">
                      {/* Video Generation */}
                      <div className="space-y-2">
                        <Label className="text-sm font-semibold flex items-center gap-1.5">
                          <Video className="h-3.5 w-3.5 text-violet-500" />Video Generation
                        </Label>
                        <div className="flex flex-wrap gap-2 mb-2">
                          {["replicate", "luma", "runway"].map((p) => (
                            <button
                              key={p}
                              onClick={() => handleAdminSaveConfig({ ai_video_provider: p })}
                              className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all capitalize ${
                                configForm.ai_video_provider === p
                                  ? "bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow-md"
                                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                              }`}
                            >{p}</button>
                          ))}
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <Label className="text-sm text-muted-foreground">API Key</Label>
                            <Input
                              type="password"
                              value={configForm.ai_video_api_key || ""}
                              onChange={(e) => updateConfigField("ai_video_api_key", e.target.value)}
                              placeholder="Enter video provider API key"
                              className="h-9 text-sm"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-sm text-muted-foreground">Model</Label>
                            <Input
                              type="text"
                              value={configForm.ai_video_model || ""}
                              onChange={(e) => updateConfigField("ai_video_model", e.target.value)}
                              placeholder="e.g. stable-video-diffusion-xt"
                              className="h-9 text-sm"
                            />
                          </div>
                        </div>
                      </div>

                      <Separator />

                      {/* Image Generation */}
                      <div className="space-y-2">
                        <Label className="text-sm font-semibold flex items-center gap-1.5">
                          <ImageIcon className="h-3.5 w-3.5 text-fuchsia-500" />Image Generation
                        </Label>
                        <div className="flex flex-wrap gap-2 mb-2">
                          {["replicate", "stability", "together"].map((p) => (
                            <button
                              key={p}
                              onClick={() => handleAdminSaveConfig({ ai_image_provider: p })}
                              className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all capitalize ${
                                configForm.ai_image_provider === p
                                  ? "bg-gradient-to-r from-fuchsia-500 to-pink-500 text-white shadow-md"
                                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                              }`}
                            >{p}</button>
                          ))}
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <Label className="text-sm text-muted-foreground">API Key</Label>
                            <Input
                              type="password"
                              value={configForm.ai_image_api_key || ""}
                              onChange={(e) => updateConfigField("ai_image_api_key", e.target.value)}
                              placeholder="Enter image provider API key"
                              className="h-9 text-sm"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-sm text-muted-foreground">Model</Label>
                            <Input
                              type="text"
                              value={configForm.ai_image_model || ""}
                              onChange={(e) => updateConfigField("ai_image_model", e.target.value)}
                              placeholder="e.g. flux-pro, sdxl-turbo"
                              className="h-9 text-sm"
                            />
                          </div>
                        </div>
                      </div>

                      <Separator />

                      {/* Text-to-Speech */}
                      <div className="space-y-2">
                        <Label className="text-sm font-semibold flex items-center gap-1.5">
                          <Volume2 className="h-3.5 w-3.5 text-emerald-500" />Text-to-Speech (TTS)
                        </Label>
                        <div className="flex flex-wrap gap-2 mb-2">
                          {["elevenlabs", "openai", "google"].map((p) => (
                            <button
                              key={p}
                              onClick={() => handleAdminSaveConfig({ ai_tts_provider: p })}
                              className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all capitalize ${
                                configForm.ai_tts_provider === p
                                  ? "bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-md"
                                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                              }`}
                            >{p}</button>
                          ))}
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <Label className="text-sm text-muted-foreground">API Key</Label>
                            <Input
                              type="password"
                              value={configForm.ai_tts_api_key || ""}
                              onChange={(e) => updateConfigField("ai_tts_api_key", e.target.value)}
                              placeholder="Enter TTS provider API key"
                              className="h-9 text-sm"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-sm text-muted-foreground">Model</Label>
                            <Input
                              type="text"
                              value={configForm.ai_tts_model || ""}
                              onChange={(e) => updateConfigField("ai_tts_model", e.target.value)}
                              placeholder="e.g. eleven_multilingual_v2, tts-1"
                              className="h-9 text-sm"
                            />
                          </div>
                        </div>
                      </div>

                      <Separator />

                      {/* LLM (AI Director & Continuity) */}
                      <div className="space-y-2">
                        <Label className="text-sm font-semibold flex items-center gap-1.5">
                          <Wand2 className="h-3.5 w-3.5 text-amber-500" />LLM (AI Director & Continuity)
                        </Label>
                        <div className="flex flex-wrap gap-2 mb-2">
                          {["openai", "anthropic", "together"].map((p) => (
                            <button
                              key={p}
                              onClick={() => handleAdminSaveConfig({ ai_llm_provider: p })}
                              className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all capitalize ${
                                configForm.ai_llm_provider === p
                                  ? "bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-md"
                                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                              }`}
                            >{p}</button>
                          ))}
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <Label className="text-sm text-muted-foreground">API Key</Label>
                            <Input
                              type="password"
                              value={configForm.ai_llm_api_key || ""}
                              onChange={(e) => updateConfigField("ai_llm_api_key", e.target.value)}
                              placeholder="Enter LLM API key"
                              className="h-9 text-sm"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-sm text-muted-foreground">Model</Label>
                            <Input
                              type="text"
                              value={configForm.ai_llm_model || ""}
                              onChange={(e) => updateConfigField("ai_llm_model", e.target.value)}
                              placeholder="e.g. gpt-4o, claude-3.5-sonnet, llama-3.1-70b"
                              className="h-9 text-sm"
                            />
                          </div>
                        </div>
                      </div>

                      <Button
                        onClick={() => handleSaveAIConfig("ai-providers", ["ai_video_api_key", "ai_video_model", "ai_image_api_key", "ai_image_model", "ai_tts_api_key", "ai_tts_model", "ai_llm_api_key", "ai_llm_model"])}
                        disabled={savingConfigKey === "ai-providers"}
                        className="btn-gradient"
                      >
                        {savingConfigKey === "ai-providers" ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <KeyRound className="h-4 w-4 mr-1.5" />}
                        {savingConfigKey === "ai-providers" ? "Saving..." : "Save AI Configuration"}
                      </Button>
                    </CardContent>
                  </Card>

                  {/* Recent Payments */}
                  <Card className="border-0 shadow-lg shadow-black/5">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base font-bold flex items-center gap-2">
                        <CreditCard className="h-4 w-4 text-violet-500" />
                        Recent Payments ({adminPayments.length})
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="max-h-72 overflow-y-auto custom-scrollbar">
                        <table className="w-full text-sm">
                          <thead className="sticky top-0 bg-white">
                            <tr className="border-b text-left text-sm text-muted-foreground">
                              <th className="pb-2 pr-3">Date</th>
                              <th className="pb-2 pr-3">User</th>
                              <th className="pb-2 pr-3">Gateway</th>
                              <th className="pb-2 pr-3">Amount</th>
                              <th className="pb-2 pr-3">Tokens</th>
                              <th className="pb-2">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {adminPayments.slice(0, 20).map((p: Record<string, unknown>) => (
                              <tr key={p.id as string} className="border-b last:border-0 hover:bg-slate-50">
                                <td className="py-2 pr-3 text-muted-foreground text-xs">
                                  {new Date(p.createdAt as string).toLocaleDateString()}
                                </td>
                                <td className="py-2 pr-3 truncate max-w-[150px]">
                                  {(p.user as Record<string, unknown>)?.name || (p.user as Record<string, unknown>)?.email || "-"}
                                </td>
                                <td className="py-2 pr-3 capitalize text-xs">{p.gateway as string}</td>
                                <td className="py-2 pr-3 font-semibold">GH₵{p.amount as number}</td>
                                <td className="py-2 pr-3">{p.tokensPurchased as number}</td>
                                <td className="py-2">
                                  <Badge variant="outline" className={`text-xs ${
                                    p.status === "completed" ? "bg-emerald-50 text-emerald-600 border-emerald-200" :
                                    p.status === "pending" ? "bg-amber-50 text-amber-600 border-amber-200" :
                                    "bg-red-50 text-red-600"
                                  }`}>{p.status as string}</Badge>
                                </td>
                              </tr>
                            ))}
                            {adminPayments.length === 0 && (
                              <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">No payments yet</td></tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                  </Card>

                  {/* ── Package Edit/Create Dialog ── */}
                  <PackageEditDialog
                    open={packageDialogOpen}
                    onOpenChange={(open) => { setPackageDialogOpen(open); if (!open) setEditingPackage(null); }}
                    pkg={editingPackage}
                    onSave={handleSavePackage}
                    saving={savingPackage}
                  />

                  <div className="text-center pt-2">
                    <Button variant="outline" onClick={() => setCurrentView("home")}>
                      <ArrowLeft className="h-4 w-4 mr-1.5" />Back to Home
                    </Button>
                  </div>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* ── Mobile Bottom Navigation (native app feel) ── */}
      {session?.user && (
        <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur-lg safe-area-pb" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
          <div className="grid grid-cols-5 h-16">
            <button
              onClick={() => setCurrentView("home")}
              className={`flex flex-col items-center justify-center gap-0.5 transition-colors ${currentView === "home" ? "text-violet-600" : "text-slate-400"}`}
            >
              <Home className="h-5 w-5" />
              <span className="text-[10px] font-medium">Home</span>
            </button>
            <button
              onClick={() => setCurrentView("dashboard")}
              className={`flex flex-col items-center justify-center gap-0.5 transition-colors ${currentView === "dashboard" ? "text-violet-600" : "text-slate-400"}`}
            >
              <BarChart3 className="h-5 w-5" />
              <span className="text-[10px] font-medium">Stats</span>
            </button>
            <button
              onClick={() => setCurrentView("create")}
              className={`flex flex-col items-center justify-center gap-0.5 transition-colors ${currentView === "create" || currentView === "studio" ? "text-violet-600" : "text-slate-400"}`}
            >
              <div className={`h-9 w-9 rounded-full flex items-center justify-center -mt-3 shadow-lg ${currentView === "create" || currentView === "studio" ? "bg-gradient-to-br from-violet-500 to-fuchsia-500" : "bg-gradient-to-br from-violet-400 to-fuchsia-400"} text-white`}>
                <Plus className="h-5 w-5" />
              </div>
              <span className="text-[10px] font-medium -mt-0.5">Create</span>
            </button>
            <button
              onClick={() => setCurrentView("buy-tokens")}
              className={`flex flex-col items-center justify-center gap-0.5 transition-colors ${currentView === "buy-tokens" ? "text-amber-600" : "text-slate-400"}`}
            >
              <Coins className="h-5 w-5" />
              <span className="text-[10px] font-medium">Tokens</span>
            </button>
            <button
              onClick={() => setCurrentView("profile")}
              className={`flex flex-col items-center justify-center gap-0.5 transition-colors ${currentView === "profile" || currentView === "admin" ? "text-violet-600" : "text-slate-400"}`}
            >
              <User className="h-5 w-5" />
              <span className="text-[10px] font-medium">Profile</span>
            </button>
          </div>
        </nav>
      )}

      {/* ── Global Footer (renders on ALL views) ── */}
      <footer className="mt-auto border-t bg-slate-50/50 pb-20 md:pb-0">
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
              <div className="flex items-center gap-3 mt-4">
                <a
                  href="https://youtube.com/@vidorapro"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="h-8 w-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-slate-500 hover:text-red-600 hover:border-red-200 transition-colors"
                  aria-label="YouTube"
                  title="@vidorapro on YouTube"
                >
                  <Youtube className="h-4 w-4" />
                </a>
                <a
                  href="https://instagram.com/vidorapro"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="h-8 w-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-slate-500 hover:text-pink-600 hover:border-pink-200 transition-colors"
                  aria-label="Instagram"
                  title="@vidorapro on Instagram"
                >
                  <Instagram className="h-4 w-4" />
                </a>
                <a
                  href="https://facebook.com/vidorapro"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="h-8 w-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-slate-500 hover:text-blue-600 hover:border-blue-200 transition-colors"
                  aria-label="Facebook"
                  title="@vidorapro on Facebook"
                >
                  <Facebook className="h-4 w-4" />
                </a>
                <a
                  href="mailto:vidora@lightworldtech.com"
                  className="h-8 w-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-slate-500 hover:text-violet-600 hover:border-violet-200 transition-colors"
                  aria-label="Email"
                  title="vidora@lightworldtech.com"
                >
                  <MailIcon className="h-4 w-4" />
                </a>
                <a
                  href="https://wa.me/233243618186"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="h-8 w-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-slate-500 hover:text-emerald-600 hover:border-emerald-200 transition-colors"
                  aria-label="WhatsApp"
                  title="Chat on WhatsApp: 0243618186"
                >
                  <MessageCircle className="h-4 w-4" />
                </a>
              </div>
            </div>
            <div>
              <h4 className="font-bold text-sm mb-3 flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5 text-violet-500" />Product
              </h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>
                  <button onClick={() => setCurrentView("create")} className="hover:text-violet-500 transition-colors text-left">
                    Create Video
                  </button>
                </li>
                <li>
                  <button onClick={() => setCurrentView("gallery")} className="hover:text-violet-500 transition-colors text-left">
                    Templates
                  </button>
                </li>
                <li>
                  <button onClick={() => handleTryDemo()} className="hover:text-violet-500 transition-colors text-left">
                    Features
                  </button>
                </li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold text-sm mb-3 flex items-center gap-1.5">
                <Shield className="h-3.5 w-3.5 text-fuchsia-500" />Support
              </h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>
                  <button
                    onClick={() => setDocsDialogOpen(true)}
                    className="hover:text-violet-500 transition-colors flex items-center gap-1 text-left"
                  >
                    <BookOpen className="h-3 w-3" />Documentation
                  </button>
                </li>
                <li>
                  <button
                    onClick={() => setApiRefDialogOpen(true)}
                    className="hover:text-violet-500 transition-colors flex items-center gap-1 text-left"
                  >
                    <Code className="h-3 w-3" />API Reference
                  </button>
                </li>
                <li>
                  <button
                    onClick={() => setContactDialogOpen(true)}
                    className="hover:text-violet-500 transition-colors flex items-center gap-1 text-left"
                  >
                    <Phone className="h-3 w-3" />Contact
                  </button>
                </li>
              </ul>
            </div>
          </div>
          <Separator className="my-6" />
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground text-center sm:text-left">
              &copy; {new Date().getFullYear()} Vidora AI · A product of LightWorld Technologies.
            </p>
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Globe className="h-3 w-3" />
              <a href="https://vidora.lightworldtech.com" className="hover:text-violet-500 transition-colors" target="_blank" rel="noopener noreferrer">
                vidora.lightworldtech.com
              </a>
            </p>
          </div>
        </div>
      </footer>

      {/* ═══════════════════════════════════════════════════════
          MOBILE NAVIGATION DRAWER (hamburger menu)
          ═══════════════════════════════════════════════════════ */}
      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="right" className="w-[300px] sm:w-[340px] p-0 flex flex-col">
          <SheetHeader className="border-b pb-4">
            <SheetTitle className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-violet-500/20">
                <Clapperboard className="h-4 w-4 text-white" />
              </div>
              <span className="bg-gradient-to-r from-violet-600 to-fuchsia-600 bg-clip-text text-transparent font-extrabold text-lg">
                Vidora
              </span>
              <Badge variant="outline" className="text-xs font-semibold text-violet-500 border-violet-200 ml-0.5">
                PRO
              </Badge>
            </SheetTitle>
            <SheetDescription className="sr-only">Navigation menu</SheetDescription>
          </SheetHeader>

          {/* Drawer body — scrollable */}
          <div className="flex-1 overflow-y-auto px-4 py-4">
            {session?.user ? (
              <div className="space-y-1">
                {/* User info card */}
                <div className="p-3 rounded-lg bg-gradient-to-br from-violet-50 to-fuchsia-50 border border-violet-100 mb-4">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center text-white font-bold shrink-0">
                      {(userProfile?.name || session.user?.email || "U").charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold truncate text-slate-800">{userProfile?.name || "User"}</p>
                      <p className="text-xs text-muted-foreground truncate">{session.user?.email}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Token balance</span>
                    <Badge variant="outline" className="text-xs font-bold border-amber-200 text-amber-600 bg-amber-50">
                      <Coins className="h-3 w-3 mr-1" />{userTokens}
                    </Badge>
                  </div>
                </div>

                {/* Navigation links */}
                {[
                  { view: "home", icon: <Home className="h-5 w-5" />, label: "Home" },
                  { view: "dashboard", icon: <BarChart3 className="h-5 w-5" />, label: "Dashboard" },
                  { view: "create", icon: <Plus className="h-5 w-5" />, label: "Create Video" },
                  { view: "gallery", icon: <LayoutGrid className="h-5 w-5" />, label: "Templates" },
                  { view: "buy-tokens", icon: <Coins className="h-5 w-5" />, label: "Buy Tokens" },
                  { view: "profile", icon: <User className="h-5 w-5" />, label: "Profile" },
                  ...(userProfile?.role === "admin" ? [{ view: "admin", icon: <ShieldCheck className="h-5 w-5" />, label: "Admin Portal" }] : []),
                ].map((item) => (
                  <button
                    key={item.view}
                    onClick={() => { setCurrentView(item.view as never); setMobileNavOpen(false); }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                      currentView === item.view
                        ? "bg-violet-50 text-violet-700"
                        : "text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <span className={currentView === item.view ? "text-violet-500" : "text-slate-400"}>{item.icon}</span>
                    {item.label}
                    {currentView === item.view && <ChevronRight className="h-4 w-4 ml-auto text-violet-400" />}
                  </button>
                ))}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="text-center py-4">
                  <div className="mx-auto mb-3 h-14 w-14 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center text-white shadow-lg shadow-violet-500/20">
                    <Sparkles className="h-6 w-6" />
                  </div>
                  <h3 className="text-base font-bold text-slate-800">Welcome to Vidora</h3>
                  <p className="text-sm text-muted-foreground mt-1">Sign in to create AI-powered videos, manage projects, and track your tokens.</p>
                </div>
                <Button
                  className="btn-gradient w-full h-11"
                  onClick={() => { setAuthMode("login"); setAuthDialogOpen(true); setMobileNavOpen(false); }}
                >
                  <LogIn className="h-4 w-4 mr-2" />Sign In
                </Button>
                <Button
                  variant="outline"
                  className="w-full h-11 border-violet-200 text-violet-600 hover:bg-violet-50"
                  onClick={() => { setCurrentView("create"); setMobileNavOpen(false); }}
                >
                  <Sparkles className="h-4 w-4 mr-2" />Try the Creator
                </Button>
                <div className="pt-3 border-t">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Quick Links</p>
                  {[
                    { view: "create", icon: <Plus className="h-4 w-4" />, label: "Start Creating" },
                    { view: "gallery", icon: <LayoutGrid className="h-4 w-4" />, label: "Browse Templates" },
                  ].map((item) => (
                    <button
                      key={item.view}
                      onClick={() => { setCurrentView(item.view as never); setMobileNavOpen(false); }}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                    >
                      <span className="text-slate-400">{item.icon}</span>
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Footer — Sign Out (logged in only) */}
          {session?.user && (
            <SheetFooter className="border-t pt-4">
              <Button
                variant="outline"
                className="w-full h-11 text-red-500 border-red-200 hover:bg-red-50 hover:text-red-600"
                onClick={() => { handleSignOut(); setMobileNavOpen(false); }}
              >
                <LogOut className="h-4 w-4 mr-2" />Sign Out
              </Button>
            </SheetFooter>
          )}
        </SheetContent>
      </Sheet>

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
          <DialogTitle className="sr-only">Video Preview</DialogTitle>
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
            <Button onClick={() => { setExportDialogOpen(false); openDownloadGate(currentProject.id, exportQuality); }} disabled={isExporting} className="btn-gradient">
              {isExporting ? (
                <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Exporting...</>
              ) : (
                <><Download className="h-4 w-4 mr-1.5" />Export Full Video</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Download Gate Dialog */}
      <Dialog open={downloadGateOpen} onOpenChange={setDownloadGateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white">
                <Coins className="h-4 w-4" />
              </div>
              Download Requires Tokens
            </DialogTitle>
            <DialogDescription>
              This download costs <strong className="text-amber-600">{downloadCost} tokens</strong>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Cost Breakdown */}
            {downloadBreakdown && (
              <div className="rounded-lg bg-slate-50 p-4 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Cost Breakdown</p>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Quality base</span>
                  <span className="font-semibold">{downloadBreakdown.quality} tokens</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Duration bonus</span>
                  <span className="font-semibold">{downloadBreakdown.duration} tokens</span>
                </div>
                <Separator className="my-2" />
                <div className="flex items-center justify-between text-sm font-bold">
                  <span>Total</span>
                  <span className="text-amber-600">{downloadCost} tokens</span>
                </div>
              </div>
            )}

            {/* Token Balance Info */}
            <div className="flex items-center gap-2 p-3 rounded-lg bg-violet-50 border border-violet-100">
              <Wallet className="h-4 w-4 text-violet-600 shrink-0" />
              <span className="text-sm text-violet-700">
                Your balance: <strong>{userTokens} tokens</strong>
              </span>
            </div>

            {/* Insufficient Warning */}
            {downloadInsufficient && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-100">
                <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" />
                <span className="text-sm text-red-700">
                  You need <strong>{downloadCost - userTokens} more tokens</strong> to download this video.
                </span>
              </div>
            )}
          </div>
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            {!downloadInsufficient ? (
              <Button
                onClick={confirmDownload}
                disabled={isRequestingDownload}
                className="btn-gradient flex-1"
              >
                {isRequestingDownload ? (
                  <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Processing...</>
                ) : (
                  <><Coins className="h-4 w-4 mr-1.5" />Use My Tokens ({userTokens} remaining)</>
                )}
              </Button>
            ) : (
              <Button
                onClick={() => { setDownloadGateOpen(false); setCurrentView("buy-tokens"); }}
                className="btn-amber flex-1"
              >
                <Coins className="h-4 w-4 mr-1.5" />Buy Tokens
              </Button>
            )}
            <Button variant="outline" onClick={() => setDownloadGateOpen(false)}>
              Cancel
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
                              <Badge className={`text-xs px-1.5 ${
                                issue.type === "inconsistency"
                                  ? "bg-red-100 text-red-700"
                                  : issue.type === "warning"
                                  ? "bg-amber-100 text-amber-700"
                                  : "bg-sky-100 text-sky-700"
                              }`}>
                                {issue.type}
                              </Badge>
                              <Badge variant="outline" className="text-xs">
                                Scene {issue.sceneIndex + 1}
                              </Badge>
                              <Badge variant="outline" className={`text-xs ${
                                issue.severity === "high" ? "border-red-200 text-red-600"
                                : issue.severity === "medium" ? "border-amber-200 text-amber-600"
                                : "border-slate-200 text-slate-600"
                              }`}>
                                {issue.severity}
                              </Badge>
                            </div>
                            <p className="text-xs text-foreground">{issue.description}</p>
                            <p className="text-xs text-muted-foreground mt-1 italic">Fix: {issue.fix}</p>
                          </div>
                          <Button
                            size="sm" variant="outline" className="h-6 text-xs px-2 shrink-0"
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

      {/* ═══════════════════════════════════════════════════════
          AUTH DIALOG (Login / Register / Forgot / Reset)
          Split layout: left branding panel + right form.
          4 modes with password strength meter, show/hide toggles,
          remember-me, forgot-password, and token-based reset flow.
          ═══════════════════════════════════════════════════════ */}
      <Dialog open={authDialogOpen} onOpenChange={(open) => {
        setAuthDialogOpen(open);
        if (!open) {
          // reset transient state when closing
          setAuthError("");
          setAuthFieldError("");
          setAuthSuccess("");
          setAuthShowPassword(false);
          setAuthShowConfirm(false);
          if (authMode === "forgot" || authMode === "reset") setAuthMode("login");
        }
      }}>
        <DialogContent className="sm:max-w-4xl p-0 overflow-hidden gap-0">
          <div className="grid grid-cols-1 sm:grid-cols-2">
            {/* ── Left: Branding panel (hidden on small phones only; shows on tablets & desktops) ── */}
            <div className="hidden sm:flex relative flex-col justify-between p-8 bg-gradient-to-br from-violet-600 via-purple-600 to-fuchsia-600 text-white overflow-hidden">
              <div className="absolute inset-0 opacity-20 pointer-events-none"
                style={{ backgroundImage: "radial-gradient(circle at 20% 30%, rgba(255,255,255,0.4) 0%, transparent 40%), radial-gradient(circle at 80% 70%, rgba(255,255,255,0.3) 0%, transparent 40%)" }} />
              <div className="relative">
                <div className="flex items-center gap-3 mb-8">
                  <div className="h-11 w-11 rounded-xl bg-white/15 backdrop-blur flex items-center justify-center ring-1 ring-white/30">
                    <Clapperboard className="h-6 w-6 text-white" />
                  </div>
                  <span className="text-2xl font-bold tracking-tight">Vidora</span>
                </div>
                <h2 className="text-3xl font-bold leading-tight mb-3">
                  {authMode === "login" && "Welcome back to the studio."}
                  {authMode === "register" && "Start creating cinematic videos."}
                  {authMode === "forgot" && "Let's get you back in."}
                  {authMode === "reset" && "Secure your account."}
                </h2>
                <p className="text-white/80 text-sm leading-relaxed">
                  {authMode === "login" && "Sign in to continue building your AI-powered video projects, manage scenes, and publish to the world."}
                  {authMode === "register" && "Join Vidora to turn text prompts into stunning cinematic scenes — complete with AI imagery, narration, music, and subtitles."}
                  {authMode === "forgot" && "Enter your email and we'll send you a secure link to reset your password."}
                  {authMode === "reset" && "Choose a strong new password to protect your Vidora account."}
                </p>
              </div>
              <div className="relative space-y-2.5 mt-8">
                {[
                  { icon: Sparkles, text: "AI-generated cinematic scenes" },
                  { icon: Film, text: "Multi-language dubbing & subtitles" },
                  { icon: Share2, text: "One-click social publishing" },
                ].map((f, i) => (
                  <div key={i} className="flex items-center gap-2.5 text-sm text-white/90">
                    <f.icon className="h-4 w-4 shrink-0" />
                    <span>{f.text}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Right: Form panel ── */}
            <div className="flex flex-col p-6 sm:p-8 max-h-[90vh] overflow-y-auto">
              {/* Mobile-only header (branding panel is hidden on mobile) */}
              <div className="sm:hidden flex items-center gap-2.5 mb-5">
                <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center text-white">
                  <Clapperboard className="h-5 w-5" />
                </div>
                <span className="text-lg font-bold">Vidora</span>
              </div>

              <DialogHeader className="mb-1">
                <DialogTitle className="text-xl font-bold flex items-center gap-2">
                  {authMode === "login" && <><LogIn className="h-5 w-5 text-violet-600" />Welcome Back</>}
                  {authMode === "register" && <><UserPlus className="h-5 w-5 text-violet-600" />Create Account</>}
                  {authMode === "forgot" && <><KeyRound className="h-5 w-5 text-violet-600" />Forgot Password</>}
                  {authMode === "reset" && <><ShieldCheck className="h-5 w-5 text-violet-600" />Reset Password</>}
                </DialogTitle>
                <DialogDescription>
                  {authMode === "login" && "Sign in to your Vidora account"}
                  {authMode === "register" && "Join Vidora and start creating AI videos"}
                  {authMode === "forgot" && "We'll send you a reset link"}
                  {authMode === "reset" && "Set a new password for your account"}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 pt-3">
                {/* Success banner */}
                {authSuccess && (
                  <div className="flex items-start gap-2 p-3 rounded-lg bg-emerald-50 text-emerald-700 text-sm border border-emerald-200">
                    <CheckCircle className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>{authSuccess}</span>
                  </div>
                )}
                {/* Error banner */}
                {authError && (
                  <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 text-red-700 text-sm border border-red-200">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>{authError}</span>
                  </div>
                )}

                {/* ── LOGIN / REGISTER mode ── */}
                {(authMode === "login" || authMode === "register") && (
                  <>
                    {authMode === "register" && (
                      <div className="space-y-1.5">
                        <Label className="text-sm font-medium">Full Name</Label>
                        <Input
                          placeholder="John Doe"
                          value={authName}
                          onChange={(e) => { setAuthName(e.target.value); if (authFieldError === "name") { setAuthFieldError(""); setAuthError(""); } }}
                          className={authFieldError === "name" ? "border-red-400 focus-visible:ring-red-400" : ""}
                        />
                      </div>
                    )}
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium">Email</Label>
                      <Input
                        type="email"
                        placeholder="you@example.com"
                        value={authEmail}
                        onChange={(e) => { setAuthEmail(e.target.value); if (authFieldError === "email") { setAuthFieldError(""); setAuthError(""); } }}
                        className={authFieldError === "email" ? "border-red-400 focus-visible:ring-red-400" : ""}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium">Password</Label>
                      <div className="relative">
                        <Input
                          type={authShowPassword ? "text" : "password"}
                          placeholder="••••••••"
                          value={authPassword}
                          onChange={(e) => { setAuthPassword(e.target.value); if (authFieldError === "password") { setAuthFieldError(""); setAuthError(""); } }}
                          className={`pr-10 ${authFieldError === "password" ? "border-red-400 focus-visible:ring-red-400" : ""}`}
                        />
                        <button
                          type="button"
                          onClick={() => setAuthShowPassword((v) => !v)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                          tabIndex={-1}
                          aria-label={authShowPassword ? "Hide password" : "Show password"}
                        >
                          {authShowPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                      {/* Password strength meter (register only) */}
                      {authMode === "register" && authPassword && (
                        <div className="mt-2 space-y-1.5">
                          <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-300 ${passwordStrength.color}`}
                              style={{ width: `${passwordStrength.pct}%` }}
                            />
                          </div>
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">
                              Strength: <span className="font-medium">{passwordStrength.label}</span>
                            </span>
                            <span className="text-muted-foreground">{authPassword.length} chars</span>
                          </div>
                          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                            <span className={authPassword.length >= 8 ? "text-emerald-600" : "text-muted-foreground"}>8+ chars</span>
                            <span className={/[A-Z]/.test(authPassword) ? "text-emerald-600" : "text-muted-foreground"}>Uppercase</span>
                            <span className={/[0-9]/.test(authPassword) ? "text-emerald-600" : "text-muted-foreground"}>Number</span>
                            <span className={/[^A-Za-z0-9]/.test(authPassword) ? "text-emerald-600" : "text-muted-foreground"}>Special</span>
                          </div>
                        </div>
                      )}
                      {authMode === "register" && !authPassword && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Must be 8+ characters with uppercase, lowercase, number & special character
                        </p>
                      )}
                    </div>

                    {/* Remember me + Forgot password (login only) */}
                    {authMode === "login" && (
                      <div className="flex items-center justify-between text-sm">
                        <label className="flex items-center gap-2 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={authRemember}
                            onChange={(e) => setAuthRemember(e.target.checked)}
                            className="h-4 w-4 rounded border-border accent-violet-600"
                          />
                          <span className="text-muted-foreground">Remember me</span>
                        </label>
                        <button
                          type="button"
                          onClick={() => { setAuthMode("forgot"); setAuthError(""); setAuthFieldError(""); setAuthSuccess(""); }}
                          className="text-violet-600 font-medium hover:underline"
                        >
                          Forgot password?
                        </button>
                      </div>
                    )}

                    <Button
                      className="w-full btn-gradient"
                      disabled={authLoading || !authEmail || !authPassword || (authMode === "register" && !authName.trim())}
                      onClick={authMode === "login" ? handleLogin : handleRegister}
                    >
                      {authLoading
                        ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />{authMode === "login" ? "Signing in..." : "Creating account..."}</>
                        : authMode === "login" ? "Sign In" : "Create Account"}
                    </Button>
                    <div className="text-center text-sm text-muted-foreground">
                      {authMode === "login" ? "Don't have an account?" : "Already have an account?"}{" "}
                      <button
                        type="button"
                        onClick={() => { setAuthMode(authMode === "login" ? "register" : "login"); setAuthError(""); setAuthFieldError(""); setAuthSuccess(""); }}
                        className="text-violet-600 font-semibold hover:underline"
                      >
                        {authMode === "login" ? "Sign Up" : "Sign In"}
                      </button>
                    </div>
                  </>
                )}

                {/* ── FORGOT mode ── */}
                {authMode === "forgot" && (
                  <>
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium">Email</Label>
                      <Input
                        type="email"
                        placeholder="you@example.com"
                        value={authEmail}
                        onChange={(e) => { setAuthEmail(e.target.value); if (authFieldError === "email") { setAuthFieldError(""); setAuthError(""); } }}
                        className={authFieldError === "email" ? "border-red-400 focus-visible:ring-red-400" : ""}
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Enter the email associated with your account. If it exists, you'll receive a reset link.
                      </p>
                    </div>
                    <Button
                      className="w-full btn-gradient"
                      disabled={authLoading || !authEmail}
                      onClick={handleForgotPassword}
                    >
                      {authLoading
                        ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Sending link...</>
                        : <><Mail className="h-4 w-4 mr-2" />Send Reset Link</>}
                    </Button>
                    <div className="text-center text-sm text-muted-foreground">
                      <button
                        type="button"
                        onClick={() => { setAuthMode("login"); setAuthError(""); setAuthFieldError(""); setAuthSuccess(""); }}
                        className="text-violet-600 font-semibold hover:inline-flex hover:items-center hover:gap-1"
                      >
                        <ArrowLeft className="inline h-3.5 w-3.5 mr-1" />Back to Sign In
                      </button>
                    </div>
                  </>
                )}

                {/* ── RESET mode ── */}
                {authMode === "reset" && (
                  <>
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium">Email</Label>
                      <Input
                        type="email"
                        placeholder="you@example.com"
                        value={authEmail}
                        onChange={(e) => { setAuthEmail(e.target.value); if (authFieldError === "email") { setAuthFieldError(""); setAuthError(""); } }}
                        disabled={!!authResetToken}
                        className={`opacity-70 ${authFieldError === "email" ? "border-red-400 focus-visible:ring-red-400" : ""}`}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium">New Password</Label>
                      <div className="relative">
                        <Input
                          type={authShowPassword ? "text" : "password"}
                          placeholder="••••••••"
                          value={authPassword}
                          onChange={(e) => { setAuthPassword(e.target.value); if (authFieldError === "password") { setAuthFieldError(""); setAuthError(""); } }}
                          className={`pr-10 ${authFieldError === "password" ? "border-red-400 focus-visible:ring-red-400" : ""}`}
                        />
                        <button
                          type="button"
                          onClick={() => setAuthShowPassword((v) => !v)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                          tabIndex={-1}
                          aria-label={authShowPassword ? "Hide password" : "Show password"}
                        >
                          {authShowPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                      {authPassword && (
                        <div className="mt-2 space-y-1.5">
                          <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-300 ${passwordStrength.color}`}
                              style={{ width: `${passwordStrength.pct}%` }}
                            />
                          </div>
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">
                              Strength: <span className="font-medium">{passwordStrength.label}</span>
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                            <span className={authPassword.length >= 8 ? "text-emerald-600" : "text-muted-foreground"}>8+ chars</span>
                            <span className={/[A-Z]/.test(authPassword) ? "text-emerald-600" : "text-muted-foreground"}>Uppercase</span>
                            <span className={/[0-9]/.test(authPassword) ? "text-emerald-600" : "text-muted-foreground"}>Number</span>
                            <span className={/[^A-Za-z0-9]/.test(authPassword) ? "text-emerald-600" : "text-muted-foreground"}>Special</span>
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium">Confirm New Password</Label>
                      <div className="relative">
                        <Input
                          type={authShowConfirm ? "text" : "password"}
                          placeholder="••••••••"
                          value={authConfirmPassword}
                          onChange={(e) => { setAuthConfirmPassword(e.target.value); if (authFieldError === "confirm") { setAuthFieldError(""); setAuthError(""); } }}
                          className={`pr-10 ${authFieldError === "confirm" ? "border-red-400 focus-visible:ring-red-400" : ""}`}
                        />
                        <button
                          type="button"
                          onClick={() => setAuthShowConfirm((v) => !v)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                          tabIndex={-1}
                          aria-label={authShowConfirm ? "Hide password" : "Show password"}
                        >
                          {authShowConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                      {authConfirmPassword && authPassword !== authConfirmPassword && (
                        <p className="text-xs text-red-500 mt-1">Passwords do not match</p>
                      )}
                    </div>
                    <Button
                      className="w-full btn-gradient"
                      disabled={authLoading || !authPassword || !authConfirmPassword || authPassword !== authConfirmPassword}
                      onClick={handleResetPassword}
                    >
                      {authLoading
                        ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Resetting...</>
                        : <><ShieldCheck className="h-4 w-4 mr-2" />Reset Password</>}
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ═══════════════════════════════════════════════════════
          FREE PREVIEW MODAL
          Shows the AI storyboard + watermarked style image with a
          strong CTA to buy tokens for the full HD video.
          ═══════════════════════════════════════════════════════ */}
      <Dialog open={previewModalOpen} onOpenChange={(open) => {
        // Prevent closing while a generation is in flight (avoid orphaned requests)
        if (!open && (isGeneratingStoryboard || isGeneratingPreviewImage)) return;
        setPreviewModalOpen(open);
      }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center text-white">
                <Eye className="h-4 w-4" />
              </div>
              Free Preview
              {previewQuota && (
                <Badge variant="outline" className="text-xs ml-1">
                  {previewQuota.storyboard.used}/{previewQuota.storyboard.limit} stories · {previewQuota.image.used}/{previewQuota.image.limit} images today
                </Badge>
              )}
            </DialogTitle>
            <DialogDescription>
              Your video at a glance — storyboard plan and a watermarked style preview. Buy tokens to generate the full HD, multi-scene video.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Loading: Storyboard */}
            {isGeneratingStoryboard && !previewStoryboard && (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Loader2 className="h-10 w-10 animate-spin text-emerald-500 mb-3" />
                <p className="font-semibold text-slate-700">Building your storyboard...</p>
                <p className="text-sm text-muted-foreground mt-1">The AI is breaking your idea into scenes, shots, and narration.</p>
              </div>
            )}

            {/* Storyboard content */}
            {previewStoryboard && (
              <div className="space-y-3">
                {/* Title + logline */}
                <div className="rounded-xl bg-gradient-to-br from-violet-50 to-fuchsia-50 border border-violet-200 p-4">
                  {typeof previewStoryboard.title === "string" && (
                    <h3 className="text-lg font-bold text-slate-800">{previewStoryboard.title}</h3>
                  )}
                  {typeof previewStoryboard.logline === "string" && (
                    <p className="text-sm text-slate-600 mt-1 italic">"{previewStoryboard.logline}"</p>
                  )}
                  <div className="flex flex-wrap gap-3 mt-2 text-xs text-muted-foreground">
                    {typeof previewStoryboard.estimatedDurationSec === "number" && (
                      <span className="flex items-center gap-1"><Clock className="h-3 w-3" />~{previewStoryboard.estimatedDurationSec}s total</span>
                    )}
                    {Array.isArray(previewStoryboard.scenes) && (
                      <span className="flex items-center gap-1"><Film className="h-3 w-3" />{(previewStoryboard.scenes as unknown[]).length} scenes</span>
                    )}
                    {typeof previewStoryboard.styleNotes === "string" && (
                      <span className="flex items-center gap-1"><Palette className="h-3 w-3" />{previewStoryboard.styleNotes.slice(0, 80)}{previewStoryboard.styleNotes.length > 80 ? "…" : ""}</span>
                    )}
                  </div>
                </div>

                {/* Scene list */}
                {Array.isArray(previewStoryboard.scenes) && (
                  <ScrollArea className="max-h-72 rounded-lg border border-slate-200">
                    <div className="p-3 space-y-2">
                      {(previewStoryboard.scenes as Array<Record<string, unknown>>).map((scene, i) => (
                        <div key={i} className="rounded-lg bg-white border border-slate-100 p-3">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-bold text-violet-600">Scene {scene.sceneNumber ?? i + 1}</span>
                            <div className="flex gap-2 text-[10px] text-muted-foreground">
                              {typeof scene.shotType === "string" && <Badge variant="outline" className="text-[10px] py-0"><Camera className="h-2.5 w-2.5 mr-0.5" />{scene.shotType}</Badge>}
                              {typeof scene.durationSec === "number" && <Badge variant="outline" className="text-[10px] py-0"><Timer className="h-2.5 w-2.5 mr-0.5" />{scene.durationSec}s</Badge>}
                              {typeof scene.mood === "string" && <Badge variant="outline" className="text-[10px] py-0">{scene.mood}</Badge>}
                            </div>
                          </div>
                          {typeof scene.title === "string" && scene.title && (
                            <p className="text-sm font-semibold text-slate-800">{scene.title}</p>
                          )}
                          {typeof scene.visualPrompt === "string" && (
                            <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">{scene.visualPrompt}</p>
                          )}
                          {typeof scene.narration === "string" && scene.narration && (
                            <p className="text-xs text-violet-500 mt-1 italic flex items-start gap-1">
                              <Quote className="h-3 w-3 mt-0.5 shrink-0" />{scene.narration}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </div>
            )}

            {/* Style preview image */}
            {isGeneratingPreviewImage && !previewImageUrl && (
              <div className="flex flex-col items-center justify-center py-10 text-center rounded-xl bg-slate-50 border border-dashed border-slate-200">
                <Loader2 className="h-8 w-8 animate-spin text-violet-500 mb-2" />
                <p className="text-sm font-semibold text-slate-700">Generating your style preview...</p>
                <p className="text-xs text-muted-foreground mt-1">Creating a watermarked image of Scene 1. This takes ~15-30 seconds.</p>
              </div>
            )}
            {previewImageUrl && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <ImageIcon className="h-4 w-4 text-violet-500" />
                  <p className="text-sm font-semibold text-slate-700">Style Preview (watermarked)</p>
                  <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300">Low-res · watermarked</Badge>
                </div>
                <div className="rounded-xl overflow-hidden border border-slate-200 bg-slate-50">
                  <img src={previewImageUrl} alt="Watermarked style preview" className="w-full h-auto" />
                </div>
                <p className="text-xs text-muted-foreground">
                  This watermarked image shows the art style, lighting, and composition. Buy tokens to generate the clean, full-HD, multi-scene video — no watermark, downloadable.
                </p>
              </div>
            )}

            {/* CTA: buy tokens to unlock full video */}
            <div className="rounded-xl bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 p-4 flex flex-col sm:flex-row items-center gap-3">
              <div className="flex-1 text-center sm:text-left">
                <p className="font-bold text-amber-800 flex items-center gap-1.5"><Coins className="h-4 w-4" />Ready to create the real thing?</p>
                <p className="text-xs text-amber-700 mt-0.5">Buy tokens to generate all scenes in full HD — no watermark, fully downloadable.</p>
              </div>
              <Button
                className="btn-amber shrink-0"
                onClick={() => { setPreviewModalOpen(false); setCurrentView("buy-tokens"); }}
              >
                <Coins className="h-4 w-4 mr-1.5" />Buy Tokens
              </Button>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPreviewModalOpen(false)}>Close</Button>
            <Button
              variant="outline"
              className="border-emerald-300 text-emerald-700 hover:bg-emerald-100"
              onClick={() => { setPreviewModalOpen(false); }}
            >
              <Sparkles className="h-4 w-4 mr-1.5" />Create Full Video
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══════════════════════════════════════════════════════
          ADVANCED FEATURE DIALOGS
          ═══════════════════════════════════════════════════════ */}

      {/* ── Share Dialog ── */}
      {currentProject && (
        <ShareDialog
          projectId={currentProject.id}
          open={shareDialogOpen}
          onOpenChange={setShareDialogOpen}
        />
      )}

      {/* ── Brand Kit Dialog ── */}
      <BrandKitDialog
        open={brandKitDialogOpen}
        onOpenChange={setBrandKitDialogOpen}
      />

      {/* ── Analytics Dialog ── */}
      <Dialog open={analyticsDialogOpen} onOpenChange={setAnalyticsDialogOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BarChart2 className="h-5 w-5 text-violet-500" />
              Video Analytics
            </DialogTitle>
            <DialogDescription>View tracking and engagement metrics for your shared video.</DialogDescription>
          </DialogHeader>
          {analyticsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-violet-500" />
            </div>
          ) : analyticsData ? (
            <div className="space-y-4">
              {/* Stats grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Card className="bg-violet-50 border-violet-100">
                  <CardContent className="p-3 text-center">
                    <Eye className="h-5 w-5 mx-auto text-violet-600 mb-1" />
                    <p className="text-2xl font-bold">{(analyticsData as Record<string, unknown>).totalViews as number}</p>
                    <p className="text-xs text-muted-foreground">Total Views</p>
                  </CardContent>
                </Card>
                <Card className="bg-emerald-50 border-emerald-100">
                  <CardContent className="p-3 text-center">
                    <Users className="h-5 w-5 mx-auto text-emerald-600 mb-1" />
                    <p className="text-2xl font-bold">{(analyticsData as Record<string, unknown>).uniqueViewers as number}</p>
                    <p className="text-xs text-muted-foreground">Unique Viewers</p>
                  </CardContent>
                </Card>
                <Card className="bg-amber-50 border-amber-100">
                  <CardContent className="p-3 text-center">
                    <Clock className="h-5 w-5 mx-auto text-amber-600 mb-1" />
                    <p className="text-2xl font-bold">{(analyticsData as Record<string, unknown>).avgWatchTime as number}s</p>
                    <p className="text-xs text-muted-foreground">Avg Watch</p>
                  </CardContent>
                </Card>
                <Card className="bg-rose-50 border-rose-100">
                  <CardContent className="p-3 text-center">
                    <CheckCircle className="h-5 w-5 mx-auto text-rose-600 mb-1" />
                    <p className="text-2xl font-bold">{(analyticsData as Record<string, unknown>).completionRate as number}%</p>
                    <p className="text-xs text-muted-foreground">Completion</p>
                  </CardContent>
                </Card>
              </div>
              {/* 7-day trend */}
              <div>
                <h4 className="text-sm font-semibold mb-2">Last 7 Days</h4>
                <div className="flex items-end gap-1 h-24">
                  {((analyticsData as Record<string, unknown>).trend as Array<{ date: string; views: number }>).map((day) => (
                    <div key={day.date} className="flex-1 flex flex-col items-center gap-1">
                      <div
                        className="w-full bg-gradient-to-t from-violet-500 to-fuchsia-500 rounded-t-sm min-h-[2px]"
                        style={{ height: `${Math.max(2, day.views * 20)}px` }}
                        title={`${day.views} views`}
                      />
                      <span className="text-[10px] text-muted-foreground">{day.date.slice(5)}</span>
                    </div>
                  ))}
                </div>
              </div>
              {/* Top referers */}
              {((analyticsData as Record<string, unknown>).topReferers as Array<{ source: string; count: number }>).length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold mb-2">Top Traffic Sources</h4>
                  <div className="space-y-1">
                    {((analyticsData as Record<string, unknown>).topReferers as Array<{ source: string; count: number }>).map((ref) => (
                      <div key={ref.source} className="flex items-center justify-between text-sm py-1 border-b border-slate-100">
                        <span className="truncate max-w-[200px]">{ref.source}</span>
                        <Badge variant="outline">{ref.count} views</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <p className="text-xs text-muted-foreground text-center pt-2">
                Analytics are tracked when someone views your shared video link.
              </p>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <BarChart2 className="h-10 w-10 mx-auto mb-2 opacity-30" />
              <p>No analytics data yet.</p>
              <p className="text-xs">Share your video to start collecting views.</p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Social Publishing Dialog ── */}
      <Dialog open={socialDialogOpen} onOpenChange={setSocialDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-5 w-5 text-rose-500" />
              Publish to Social Media
            </DialogTitle>
            <DialogDescription>One-click publish your video to social platforms.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {/* Connections */}
            <div className="space-y-2">
              <h4 className="text-sm font-semibold">Connected Accounts</h4>
              {[
                { platform: "youtube", icon: Youtube, label: "YouTube", color: "text-red-600" },
                { platform: "instagram", icon: Instagram, label: "Instagram", color: "text-pink-600" },
                { platform: "facebook", icon: Facebook, label: "Facebook", color: "text-blue-600" },
                { platform: "tiktok", icon: Send, label: "TikTok", color: "text-slate-800" },
                { platform: "twitter", icon: Send, label: "X (Twitter)", color: "text-slate-800" },
              ].map(({ platform, icon: Icon, label, color }) => {
                const conn = socialConnections.find((c) => c.platform === platform);
                const isConnected = conn?.isConnected;
                return (
                  <div key={platform} className="flex items-center justify-between p-3 rounded-lg border border-slate-200">
                    <div className="flex items-center gap-3">
                      <Icon className={`h-5 w-5 ${color}`} />
                      <div>
                        <p className="text-sm font-medium">{label}</p>
                        <p className="text-xs text-muted-foreground">{isConnected ? conn?.accountName : "Not connected"}</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant={isConnected ? "outline" : "default"}
                        onClick={() => handleToggleConnection(platform)}
                      >
                        {isConnected ? "Disconnect" : "Connect"}
                      </Button>
                      {isConnected && (
                        <Button
                          size="sm"
                          className="btn-gradient"
                          disabled={publishingPlatform === platform}
                          onClick={() => handlePublish(platform)}
                        >
                          {publishingPlatform === platform ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <>Publish</>
                          )}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Publish history */}
            {publishHistory.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold mb-2">Publish History</h4>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {publishHistory.map((pub, i) => (
                    <div key={i} className="flex items-center justify-between text-xs py-1.5 border-b border-slate-100">
                      <span className="capitalize font-medium">{pub.platform}</span>
                      <Badge variant={pub.status === "published" ? "default" : "secondary"} className="text-xs">
                        {pub.status}
                      </Badge>
                      {pub.externalUrl && (
                        <a href={pub.externalUrl} target="_blank" rel="noopener noreferrer" className="text-violet-600 hover:underline">
                          View →
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg p-2">
              <AlertCircle className="h-3.5 w-3.5 inline mr-1" />
              OAuth integration requires real platform API credentials. Currently running in demo mode — publish creates a mock record to test the UI flow.
            </p>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Contact Dialog (opened from footer) ── */}
      <Dialog open={contactDialogOpen} onOpenChange={setContactDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center">
                <Phone className="h-4 w-4 text-white" />
              </div>
              Get in Touch
            </DialogTitle>
            <DialogDescription>
              We'd love to hear from you. Reach out with any questions, feedback, or partnership ideas.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <a
              href="mailto:vidora@lightworldtech.com"
              className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 hover:border-violet-300 hover:bg-violet-50 transition-colors group"
            >
              <div className="h-10 w-10 rounded-lg bg-violet-100 flex items-center justify-center text-violet-600 group-hover:bg-violet-200 transition-colors shrink-0">
                <MailIcon className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold">Email Us</p>
                <p className="text-xs text-muted-foreground truncate">vidora@lightworldtech.com</p>
              </div>
            </a>
            <a
              href="https://wa.me/233243618186"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 hover:border-emerald-300 hover:bg-emerald-50 transition-colors group"
            >
              <div className="h-10 w-10 rounded-lg bg-emerald-100 flex items-center justify-center text-emerald-600 group-hover:bg-emerald-200 transition-colors shrink-0">
                <MessageCircle className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold">WhatsApp</p>
                <p className="text-xs text-muted-foreground truncate">0243618186</p>
              </div>
            </a>
            <div className="flex items-center gap-3 p-3 rounded-xl border border-slate-200">
              <div className="h-10 w-10 rounded-lg bg-fuchsia-100 flex items-center justify-center text-fuchsia-600 shrink-0">
                <Globe className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold">Website</p>
                <p className="text-xs text-muted-foreground truncate">vidora.lightworldtech.com</p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200">
              <Bot className="h-5 w-5 text-violet-500 shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground">
                Need a quick answer? Try our <strong className="text-violet-600">AI Assistant</strong> —
                click the chat bubble in the bottom-right corner. It's available 24/7 and can help with
                most questions instantly.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setContactDialogOpen(false)}>
              Close
            </Button>
            <Button
              className="btn-gradient"
              onClick={() => {
                setContactDialogOpen(false);
                window.location.href = "mailto:vidora@lightworldtech.com";
              }}
            >
              <MailIcon className="h-4 w-4 mr-1.5" /> Send Email
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Documentation Dialog (opened from footer) ── */}
      <Dialog open={docsDialogOpen} onOpenChange={setDocsDialogOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center">
                <BookOpen className="h-4 w-4 text-white" />
              </div>
              Vidora Documentation
            </DialogTitle>
            <DialogDescription>
              Everything you need to create AI-powered videos with Vidora.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="flex-1 pr-4 -mr-4">
            <div className="space-y-5 text-sm">
              <section>
                <h3 className="font-bold text-base flex items-center gap-1.5 mb-2"><Sparkles className="h-4 w-4 text-violet-500" />Quick Start</h3>
                <ol className="space-y-2 text-muted-foreground list-decimal list-inside pl-1">
                  <li>Click <strong className="text-foreground">Start Creating</strong> from the home page.</li>
                  <li>Choose an input mode: <strong className="text-foreground">Text</strong>, <strong className="text-foreground">Voice</strong>, or <strong className="text-foreground">Image</strong>.</li>
                  <li>Write or paste your script, then click <strong className="text-foreground">Enhance Prompt</strong> to let AI refine it.</li>
                  <li>Pick a visual style (Cinematic, Anime, Photorealistic, etc.) and aspect ratio.</li>
                  <li>Generate scenes — each scene gets an AI image + 10s video clip.</li>
                  <li>Open the Studio to arrange, dub, subtitle, and add music.</li>
                  <li>Export the final video or share a public link.</li>
                </ol>
              </section>
              <Separator />
              <section>
                <h3 className="font-bold text-base flex items-center gap-1.5 mb-2"><Wand2 className="h-4 w-4 text-fuchsia-500" />AI Director Controls</h3>
                <p className="text-muted-foreground mb-2">Per-scene cinematic controls:</p>
                <ul className="space-y-1.5 text-muted-foreground list-disc list-inside pl-1">
                  <li><strong className="text-foreground">Camera:</strong> Aerial Drone, Dolly Zoom, Crane Shot, Handheld, Static Wide.</li>
                  <li><strong className="text-foreground">Lighting:</strong> Golden Hour, Neon, Soft Box, Backlit, Natural.</li>
                  <li><strong className="text-foreground">Mood:</strong> Epic, Intimate, Tense, Dreamy, Melancholic.</li>
                  <li><strong className="text-foreground">Music:</strong> Orchestral, Lo-fi, Electronic, Ambient, Cinematic.</li>
                  <li><strong className="text-foreground">Transition:</strong> Cut, Fade, Dissolve, Wipe, Zoom.</li>
                </ul>
              </section>
              <Separator />
              <section>
                <h3 className="font-bold text-base flex items-center gap-1.5 mb-2"><Languages className="h-4 w-4 text-violet-500" />Dubbing & Subtitles</h3>
                <ul className="space-y-1.5 text-muted-foreground list-disc list-inside pl-1">
                  <li>Generate dubbed audio in <strong className="text-foreground">30+ languages</strong> including English, French, Twi, Yoruba, Hausa, Swahili.</li>
                  <li>Each dubbed track appears as a playable audio row inside the scene card.</li>
                  <li>Auto-generated SRT subtitles can be toggled on/off per scene.</li>
                  <li>Delete a dubbed track anytime — the source audio file is cleaned up.</li>
                </ul>
              </section>
              <Separator />
              <section>
                <h3 className="font-bold text-base flex items-center gap-1.5 mb-2"><Share2 className="h-4 w-4 text-fuchsia-500" />Sharing & Brand Kit</h3>
                <ul className="space-y-1.5 text-muted-foreground list-disc list-inside pl-1">
                  <li><strong className="text-foreground">Share Pages:</strong> generate a public link with optional password protection.</li>
                  <li><strong className="text-foreground">Brand Kit:</strong> upload logo, brand colors, fonts — auto-applied to intros/outros.</li>
                  <li><strong className="text-foreground">Embed:</strong> copy an iframe snippet for any external site.</li>
                  <li><strong className="text-foreground">Analytics:</strong> view counts tracked per share page.</li>
                </ul>
              </section>
              <Separator />
              <section>
                <h3 className="font-bold text-base flex items-center gap-1.5 mb-2"><Coins className="h-4 w-4 text-amber-500" />Tokens & Billing</h3>
                <ul className="space-y-1.5 text-muted-foreground list-disc list-inside pl-1">
                  <li>Each image generation costs <strong className="text-foreground">1 token</strong>, each video clip <strong className="text-foreground">3 tokens</strong>.</li>
                  <li>Buy tokens via Paystack (Ghana), Hubtel, or Stripe (international).</li>
                  <li>Free guests get a no-signup demo. Sign in to save projects and earn bonus tokens.</li>
                </ul>
              </section>
              <Separator />
              <section>
                <h3 className="font-bold text-base flex items-center gap-1.5 mb-2"><MailIcon className="h-4 w-4 text-violet-500" />Need More Help?</h3>
                <p className="text-muted-foreground">
                  Reach us at <a href="mailto:vidora@lightworldtech.com" className="text-violet-600 hover:underline font-medium">vidora@lightworldtech.com</a> or WhatsApp <a href="https://wa.me/233243618186" target="_blank" rel="noopener noreferrer" className="text-emerald-600 hover:underline font-medium">0243618186</a>. You can also use the AI Assistant chat bubble (bottom-right) for instant answers.
                </p>
              </section>
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDocsDialogOpen(false)}>Close</Button>
            <Button className="btn-gradient" onClick={() => { setDocsDialogOpen(false); setCurrentView("create"); }}>
              <Sparkles className="h-4 w-4 mr-1.5" /> Start Creating
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── API Reference Dialog (opened from footer) ── */}
      <Dialog open={apiRefDialogOpen} onOpenChange={setApiRefDialogOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center">
                <Code className="h-4 w-4 text-white" />
              </div>
              Vidora API Reference
            </DialogTitle>
            <DialogDescription>
              REST endpoints for projects, scenes, and AI generation. All routes are relative to your deployment origin.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="flex-1 pr-4 -mr-4">
            <div className="space-y-4 text-sm font-mono">
              {[
                { method: "GET", path: "/api/projects", desc: "List all video projects for the signed-in user." },
                { method: "POST", path: "/api/projects", desc: "Create a new video project. Body: { title, description, style, aspectRatio }." },
                { method: "GET", path: "/api/projects/:id", desc: "Fetch a single project with all scenes, characters, and translations." },
                { method: "PUT", path: "/api/projects/:id", desc: "Update project metadata or reorder scenes." },
                { method: "DELETE", path: "/api/projects/:id", desc: "Delete a project and its scenes." },
                { method: "POST", path: "/api/projects/:id/scenes", desc: "Add a new scene to a project." },
                { method: "PUT", path: "/api/projects/:id/scenes/:sceneId", desc: "Update scene prompt, AI Director controls, status." },
                { method: "DELETE", path: "/api/projects/:id/scenes/:sceneId", desc: "Delete a scene." },
                { method: "POST", path: "/api/enhance-prompt", desc: "LLM-powered prompt enhancement. Body: { prompt }." },
                { method: "POST", path: "/api/generate-scene", desc: "Generate an AI image for a scene. Body: { sceneId, prompt, style }." },
                { method: "POST", path: "/api/generate-video", desc: "Batch-generate video clips for all ready scenes in a project." },
                { method: "POST", path: "/api/transcribe", desc: "ASR — transcribe an uploaded audio file to text." },
                { method: "POST", path: "/api/analyze-video", desc: "VLM — analyze an uploaded video and return scene descriptions." },
                { method: "GET", path: "/api/scenes/:id/dubbing", desc: "List dubbed audio translations for a scene + language catalog." },
                { method: "POST", path: "/api/scenes/:id/dubbing", desc: "Generate a dubbed audio track. Body: { lang }." },
                { method: "DELETE", path: "/api/scenes/:id/dubbing?lang=xx", desc: "Delete a single dubbed translation by language code." },
                { method: "GET", path: "/api/history", desc: "List generation history for the signed-in user." },
                { method: "GET", path: "/api/payments/packages", desc: "List available token packages." },
                { method: "POST", path: "/api/assistant/chat", desc: "AI assistant chat. Body: { messages: [{role, content}] }." },
              ].map((endpoint) => (
                <div key={endpoint.path + endpoint.method} className="border border-slate-200 rounded-lg p-3 bg-slate-50/50">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${endpoint.method === "GET" ? "bg-emerald-100 text-emerald-700" : endpoint.method === "POST" ? "bg-violet-100 text-violet-700" : endpoint.method === "PUT" ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700"}`}>{endpoint.method}</span>
                    <code className="text-xs text-foreground break-all">{endpoint.path}</code>
                  </div>
                  <p className="text-xs text-muted-foreground font-sans pl-1">{endpoint.desc}</p>
                </div>
              ))}
              <div className="border border-violet-200 bg-violet-50/50 rounded-lg p-3 mt-4 font-sans">
                <p className="text-xs text-muted-foreground">
                  <strong className="text-violet-700">Auth:</strong> All endpoints except <code className="text-violet-700">/api/assistant/chat</code> and the public share page require a NextAuth session cookie. Guest demo projects (no userId) are accessible without auth.
                </p>
              </div>
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApiRefDialogOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Global floating widgets: AI chat + scroll-to-top ── */}
      <AIAssistant />
      <ScrollToTop />

    </div>
  );
}
