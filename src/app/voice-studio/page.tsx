"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AudioLines, CheckCircle2, ChevronRight, Film, Users } from "lucide-react";
import { voiceStudioProjectHasPersistedDefault } from "@/lib/voice-studio-project-status";

type Project = {
  id: string;
  title: string;
  projectType?: string;
  scenes?: unknown[];
  characters?: unknown[];
  status?: string;
  narrationLang?: string | null;
  narrationAccent?: string | null;
  narrationStyle?: string | null;
  narrationVoice?: string | null;
};

export default function VoiceStudioIndexPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/projects", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok || !body.success) throw new Error(body.error || "Unable to load projects");
        if (!cancelled) setProjects(Array.isArray(body.projects) ? body.projects : []);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Unable to load projects");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-slate-50">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/" className="text-sm font-medium text-violet-700 hover:text-violet-600 dark:text-violet-300 dark:hover:text-violet-200">
            ← Back to Vidora
          </Link>
          <span className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700 dark:border-violet-900 dark:bg-violet-950/50 dark:text-violet-300">
            Uses the same profiles as Preview &amp; Export
          </span>
        </div>

        <div className="mt-10 max-w-3xl">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-600 text-white shadow-sm">
            <AudioLines className="h-6 w-6" />
          </div>
          <p className="mt-5 text-xs font-semibold uppercase tracking-[0.22em] text-violet-700 dark:text-violet-300">Vidora Voice Studio</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Direct the voices for an entire video.</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-400">
            Save a whole-video narration language, accent, voice and speaking style so new scenes inherit it automatically, then fine-tune individual scenes and character voices. Changes to current scenes invalidate stale narration and require a fresh full-video review; saving a future-scene default by itself does not alter the reviewed cut.
          </p>
        </div>

        {loading ? (
          <div className="mt-10 rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">Loading projects…</div>
        ) : error ? (
          <div className="mt-10 rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{error}</div>
        ) : projects.length === 0 ? (
          <div className="mt-10 rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
            <p className="font-medium">No projects yet.</p>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Create a Vidora project first, then return here to direct its voice performance.</p>
          </div>
        ) : (
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => {
              const hasVoiceDefault = voiceStudioProjectHasPersistedDefault(project);
              return (
                <Link
                  key={project.id}
                  href={`/voice-studio/${encodeURIComponent(project.id)}`}
                  className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-violet-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-900 dark:hover:border-violet-700"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="truncate font-semibold">{project.title}</h2>
                      <p className="mt-1 text-xs capitalize text-slate-500 dark:text-slate-400">{project.projectType || "custom"} · {project.status || "draft"}</p>
                    </div>
                    <ChevronRight className="mt-0.5 h-5 w-5 shrink-0 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-violet-600" />
                  </div>

                  <div className="mt-4">
                    {hasVoiceDefault ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
                        <CheckCircle2 className="h-3.5 w-3.5" />Voice default saved
                      </span>
                    ) : (
                      <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                        Voice default not saved
                      </span>
                    )}
                  </div>

                  <div className="mt-5 flex gap-4 text-xs text-slate-500 dark:text-slate-400">
                    <span className="inline-flex items-center gap-1.5"><Film className="h-3.5 w-3.5" />{project.scenes?.length || 0} scenes</span>
                    <span className="inline-flex items-center gap-1.5"><Users className="h-3.5 w-3.5" />{project.characters?.length || 0} characters</span>
                  </div>
                  <p className="mt-5 text-sm font-semibold text-violet-700 dark:text-violet-300">Open Voice Studio</p>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
