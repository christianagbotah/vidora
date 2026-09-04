import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import ShareClient from "./ShareClient";

/**
 * Public share page: /share/[slug]
 * Server Component — fetches the project, generates OG metadata, renders the page.
 */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const project = await db.videoProject.findUnique({
    where: { shareSlug: slug },
    include: { scenes: { orderBy: { sceneNumber: "asc" }, take: 1 } },
  });

  if (!project || !project.isPublic) {
    return { title: "Video not found — Vidora" };
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
  const coverImage = project.scenes[0]?.imageUrl || "/images/og-image.png";

  return {
    title: `${project.title} — Vidora`,
    description: project.description?.replace(/^\[DEMO\]\s*/, "") || "Watch this AI-generated video on Vidora",
    openGraph: {
      title: project.title,
      description: project.description?.replace(/^\[DEMO\]\s*/, "") || "Watch this AI-generated video",
      type: "video.other",
      url: `${baseUrl}/share/${slug}`,
      images: [{ url: coverImage, width: 1200, height: 630, alt: project.title }],
      videos: project.finalVideoUrl ? [{ url: project.finalVideoUrl }] : [],
    },
    twitter: {
      card: "summary_large_image",
      title: project.title,
      description: project.description?.replace(/^\[DEMO\]\s*/, "") || "Watch this AI-generated video",
      images: [coverImage],
    },
  };
}

export default async function SharePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const project = await db.videoProject.findUnique({
    where: { shareSlug: slug },
    include: {
      scenes: { orderBy: { sceneNumber: "asc" }, select: {
        id: true, sceneNumber: true, title: true, prompt: true,
        enhancedPrompt: true, dialogue: true, mood: true, cameraMove: true,
        musicMood: true, imageUrl: true, videoUrl: true, duration: true,
        transition: true, subtitleSrt: true, narrationUrl: true,
      } },
    },
  });

  if (!project || !project.isPublic) {
    notFound();
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
  const shareUrl = `${baseUrl}/share/${slug}`;
  const coverImage = project.scenes[0]?.imageUrl || "/images/og-image.png";

  return (
    <ShareClient
      slug={slug}
      shareUrl={shareUrl}
      allowEmbed={project.allowEmbed}
      hasPassword={!!project.sharePassword}
      initialProject={{
        id: project.id,
        title: project.title,
        description: project.description?.replace(/^\[DEMO\]\s*/, "") || "",
        style: project.style,
        aspectRatio: project.aspectRatio,
        finalVideoUrl: project.finalVideoUrl,
        scenes: project.scenes.map((s) => ({
          ...s,
          subtitleSrt: s.subtitleSrt || null,
          narrationUrl: s.narrationUrl || null,
        })),
      }}
      coverImage={coverImage}
    />
  );
}
