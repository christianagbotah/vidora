"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Project = {
  id: string;
  title: string;
  projectType?: string;
  scenes?: unknown[];
  characters?: unknown[];
  updatedAt?: string;
};

export default function VoiceStudioIndexPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [message, setMessage] = useState("Loading projects…");

  useEffect(() => {
    fetch("/api/projects", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok || !body.success) throw new Error(body.error || "Unable to load projects");
        setProjects(Array.isArray(body.projects) ? body.projects : []);
        setMessage("");
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : "Unable to load projects"));
  }, []);

  return (
    <main className="min-h-screen bg-[#08080c] text-white">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <Link href="/" className="text-sm text-violet-300 hover:text-violet-200">← Back to Vidora</Link>
        <p className="mt-8 text-xs font-semibold uppercase tracking-[0.22em] text-violet-300">Vidora Voice Studio</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight">Choose a project</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">Configure multilingual narration, regional accents, character voices and speaking styles without changing your scene content.</p>

        {message && <p className="mt-8 text-sm text-zinc-400">{message}</p>}
        {!message && projects.length === 0 && <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-sm text-zinc-400">No signed-in projects are available yet.</div>}

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <Link key={project.id} href={`/voice-studio/${encodeURIComponent(project.id)}`} className="group rounded-2xl border border-white/10 bg-white/[0.035] p-5 transition hover:border-violet-400/40 hover:bg-violet-400/[0.06]">
              <h2 className="font-semibold group-hover:text-violet-100">{project.title}</h2>
              <p className="mt-2 text-xs text-zinc-500">{project.projectType || "custom"} · {project.scenes?.length || 0} scenes · {project.characters?.length || 0} characters</p>
              <p className="mt-5 text-sm font-medium text-violet-300">Open Voice Studio →</p>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
