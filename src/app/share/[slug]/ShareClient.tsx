"use client";

import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import {
  Play, Pause, Volume2, VolumeX, Maximize2, Share2, Copy, Check,
  Twitter, Facebook, Linkedin, MessageCircle, Lock, Eye, Clock, Film,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface ShareScene {
  id: string;
  sceneNumber: number;
  title: string | null;
  prompt: string;
  enhancedPrompt: string | null;
  dialogue: string | null;
  mood: string | null;
  cameraMove: string | null;
  musicMood: string | null;
  imageUrl: string | null;
  videoUrl: string | null;
  duration: number;
  transition: string;
  subtitleSrt: string | null;
  narrationUrl: string | null;
}

interface ShareProject {
  id: string;
  title: string;
  description: string;
  style: string;
  aspectRatio: string;
  finalVideoUrl: string | null;
  scenes: ShareScene[];
}

interface Props {
  slug: string;
  shareUrl: string;
  allowEmbed: boolean;
  hasPassword: boolean;
  initialProject: ShareProject | null;
  coverImage: string;
}

export default function ShareClient({ slug, shareUrl, allowEmbed, hasPassword, initialProject, coverImage }: Props) {
  const [unlocked, setUnlocked] = useState(!hasPassword);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [project, setProject] = useState<ShareProject | null>(hasPassword ? null : initialProject);
  const [copied, setCopied] = useState(false);
  const [copiedEmbed, setCopiedEmbed] = useState(false);
  const [currentSceneIdx, setCurrentSceneIdx] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [viewCount, setViewCount] = useState<number | null>(null);
  const [watchDuration, setWatchDuration] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const viewerIdRef = useRef<string>(Math.random().toString(36).slice(2));
  const lastReportRef = useRef<number>(0);

  // Load protected project only after the server verifies the password. The
  // password travels in a header, never in the URL/history/referrer surface.
  const loadProject = async (pwd?: string) => {
    const headers: Record<string, string> = {
      "x-viewer-id": viewerIdRef.current,
    };
    if (pwd) headers["x-share-password"] = pwd;

    const res = await fetch(`/api/share/${encodeURIComponent(slug)}`, {
      headers,
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));

    if (res.status === 429) {
      setPasswordError(data.error || "Too many unlock attempts. Please try again later.");
      return false;
    }
    if (res.status === 401 && data.requiresPassword) {
      setPasswordError("Incorrect password. Please try again.");
      return false;
    }
    if (data.success && data.project) {
      setProject(data.project);
      setUnlocked(true);
      setPassword("");
      return true;
    }

    setPasswordError(data.error || "Unable to unlock this video.");
    return false;
  };

  // If no password, project is already loaded
  useEffect(() => {
    if (!hasPassword && initialProject) {
      setProject(initialProject);
      setUnlocked(true);
    }
  }, [hasPassword, initialProject]);

  // Fetch view count
  useEffect(() => {
    if (project) {
      fetch(`/api/analytics/${project.id}/summary`)
        .then(r => r.json())
        .then(data => { if (data.success) setViewCount(data.totalViews); })
        .catch(() => {});
    }
  }, [project]);

  // Watch duration tracking
  useEffect(() => {
    if (!project || !unlocked) return;
    const interval = setInterval(() => {
      if (isPlaying) {
        setWatchDuration(d => d + 3);
        const now = Date.now();
        if (now - lastReportRef.current > 10000) {
          lastReportRef.current = now;
          fetch(`/api/analytics/${project.id}/view`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              viewerId: viewerIdRef.current,
              watchDuration: 3,
            }),
          }).catch(() => {});
        }
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [project, unlocked, isPlaying]);

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setVerifying(true);
    setPasswordError("");
    await loadProject(password);
    setVerifying(false);
  };

  const copyLink = () => {
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const copyEmbed = () => {
    const embed = `<iframe src="${shareUrl}" width="560" height="315" frameborder="0" allowfullscreen style="border:none;border-radius:12px;"></iframe>`;
    navigator.clipboard.writeText(embed);
    setCopiedEmbed(true);
    setTimeout(() => setCopiedEmbed(false), 2000);
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.play(); setIsPlaying(true); }
    else { v.pause(); setIsPlaying(false); }
  };

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  };

  const goFullscreen = () => {
    const v = videoRef.current;
    if (v?.requestFullscreen) v.requestFullscreen();
  };

  // ── Password gate ──
  if (!unlocked) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-violet-950 via-slate-900 to-black flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full"
        >
          <div className="text-center mb-8">
            <div className="inline-flex h-16 w-16 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 items-center justify-center mb-4 shadow-lg shadow-violet-500/30">
              <Lock className="h-8 w-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-white">Password Protected</h1>
            <p className="text-violet-200/70 mt-2">Enter the password to watch this video</p>
          </div>
          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              maxLength={256}
              autoComplete="current-password"
              className="bg-white/10 border-white/20 text-white placeholder:text-white/40 h-12 text-lg"
              autoFocus
            />
            {passwordError && (
              <p className="text-rose-400 text-sm text-center">{passwordError}</p>
            )}
            <Button
              type="submit"
              disabled={verifying || !password}
              className="w-full h-12 bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-700 hover:to-fuchsia-700 text-white text-base font-semibold"
            >
              {verifying ? "Unlocking..." : "Unlock Video"}
            </Button>
          </form>
          <p className="text-center text-violet-300/50 text-xs mt-6">
            Powered by <span className="font-bold text-violet-300">Vidora</span> — Professional AI Video Creator
          </p>
        </motion.div>
      </div>
    );
  }

  if (!project) return null;

  const currentScene = project.scenes[currentSceneIdx];
  const mainVideo = project.finalVideoUrl || currentScene?.videoUrl;

  const aspectClass = project.aspectRatio === "9:16" ? "aspect-[9/16] max-w-md mx-auto"
    : project.aspectRatio === "1:1" ? "aspect-square max-w-2xl mx-auto"
    : "aspect-video";

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-violet-950/40 to-slate-950 text-white">
      {/* ── Header ── */}
      <header className="border-b border-white/5 backdrop-blur-sm bg-black/30 sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <a href="/" className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center">
              <Film className="h-4 w-4 text-white" />
            </div>
            <span className="font-bold text-lg">Vidora</span>
          </a>
          <div className="flex items-center gap-3">
            {viewCount !== null && (
              <span className="hidden sm:flex items-center gap-1.5 text-xs text-white/60">
                <Eye className="h-3.5 w-3.5" />
                {viewCount} views
              </span>
            )}
            <Button
              size="sm"
              asChild
              className="bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-700 hover:to-fuchsia-700"
            >
              <a href="/">Create Your Own</a>
            </Button>
          </div>
        </div>
      </header>

      {/* ── Main content ── */}
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        {/* Title */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6"
        >
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">{project.title}</h1>
          {project.description && (
            <p className="text-white/60 mt-2 text-sm sm:text-base leading-relaxed">{project.description}</p>
          )}
          <div className="flex items-center gap-4 mt-3 text-xs text-white/40">
            <span className="flex items-center gap-1"><Film className="h-3 w-3" />{project.scenes.length} scenes</span>
            <span className="flex items-center gap-1"><Clock className="h-3 w-3" />
                  {project.scenes.reduce((s, sc) => s + sc.duration, 0)}s
            </span>
            <span className="capitalize">{project.style}</span>
          </div>
        </motion.div>

        {/* Video player */}
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className={`relative ${aspectClass} rounded-2xl overflow-hidden bg-black shadow-2xl shadow-violet-900/30 mb-6 group`}
        >
          {mainVideo ? (
            <>
              <video
                ref={videoRef}
                src={mainVideo}
                poster={project.scenes[0]?.imageUrl || coverImage}
                className="w-full h-full object-contain"
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onEnded={() => setIsPlaying(false)}
                onClick={togglePlay}
                playsInline
                loop={project.scenes.length === 1}
              />
              {/* Custom controls overlay */}
              <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent p-4 opacity-0 group-hover:opacity-100 transition-opacity">
                <div className="flex items-center gap-3">
                  <button onClick={togglePlay} className="text-white hover:text-violet-300 transition-colors">
                    {isPlaying ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6" />}
                  </button>
                  <button onClick={toggleMute} className="text-white hover:text-violet-300 transition-colors">
                    {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
                  </button>
                  <button onClick={goFullscreen} className="text-white hover:text-violet-300 transition-colors ml-auto">
                    <Maximize2 className="h-5 w-5" />
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="w-full h-full flex items-center justify-center text-white/40">
              Video not available
            </div>
          )}
        </motion.div>

        {/* Scene list (if no final video) */}
        {!project.finalVideoUrl && project.scenes.length > 1 && (
          <div className="mb-8">
            <h2 className="text-lg font-bold mb-3">Scenes</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {project.scenes.map((scene, idx) => (
                <button
                  key={scene.id}
                  onClick={() => setCurrentSceneIdx(idx)}
                  className={`text-left rounded-lg overflow-hidden border-2 transition-all ${
                    idx === currentSceneIdx
                      ? "border-violet-500 ring-2 ring-violet-500/30"
                      : "border-transparent hover:border-white/20"
                  }`}
                >
                  <div className="relative aspect-video bg-black">
                    {scene.imageUrl && (
                      <img src={scene.imageUrl} alt={scene.title || `Scene ${scene.sceneNumber}`} className="w-full h-full object-cover" />
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                    <span className="absolute bottom-1 left-2 text-xs font-bold text-white">
                      {scene.sceneNumber}
                    </span>
                  </div>
                  <div className="p-2 bg-white/5">
                    <p className="text-xs font-medium truncate">{scene.title || `Scene ${scene.sceneNumber}`}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Share bar */}
        <div className="bg-white/5 backdrop-blur-sm rounded-2xl p-5 border border-white/10">
          <div className="flex items-center gap-2 mb-4">
            <Share2 className="h-5 w-5 text-violet-400" />
            <h2 className="text-lg font-bold">Share this video</h2>
          </div>

          {/* Social buttons */}
          <div className="flex flex-wrap gap-2 mb-4">
            <a
              href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(project.title)}&url=${encodeURIComponent(shareUrl)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors text-sm font-medium"
            >
              <Twitter className="h-4 w-4" />Tweet
            </a>
            <a
              href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors text-sm font-medium"
            >
              <Facebook className="h-4 w-4" />Share
            </a>
            <a
              href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors text-sm font-medium"
            >
              <Linkedin className="h-4 w-4" />Share
            </a>
            <a
              href={`https://wa.me/?text=${encodeURIComponent(project.title + " " + shareUrl)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors text-sm font-medium"
            >
              <MessageCircle className="h-4 w-4" />WhatsApp
            </a>
          </div>

          {/* Copy link */}
          <div className="flex gap-2 mb-4">
            <Input
              readOnly
              value={shareUrl}
              className="bg-white/5 border-white/10 text-white text-sm"
            />
            <Button onClick={copyLink} variant="outline" className="border-white/20 text-white hover:bg-white/10">
              {copied ? <><Check className="h-4 w-4 mr-1" />Copied</> : <><Copy className="h-4 w-4 mr-1" />Copy</>}
            </Button>
          </div>

          {/* Embed code */}
          {allowEmbed && (
            <div>
              <label className="text-sm font-medium text-white/70 mb-2 block">Embed Code</label>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={`<iframe src="${shareUrl}" width="560" height="315" frameborder="0" allowfullscreen></iframe>`}
                  className="bg-white/5 border-white/10 text-white/70 text-xs font-mono"
                />
                <Button onClick={copyEmbed} variant="outline" className="border-white/20 text-white hover:bg-white/10 shrink-0">
                  {copiedEmbed ? <><Check className="h-4 w-4 mr-1" />Copied</> : <><Copy className="h-4 w-4 mr-1" />Copy</>}
                </Button>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* ── Footer ── */}
      <footer className="border-t border-white/5 mt-8">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 text-center">
          <a href="/" className="inline-flex items-center gap-2 text-white/60 hover:text-white transition-colors">
            <div className="h-6 w-6 rounded-md bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center">
              <Film className="h-3 w-3 text-white" />
            </div>
            <span className="font-bold">Created with Vidora</span>
          </a>
          <p className="text-xs text-white/40 mt-2">Professional AI Video Creator — Create your own in minutes</p>
        </div>
      </footer>
    </div>
  );
}
