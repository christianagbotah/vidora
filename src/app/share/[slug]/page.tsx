import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import ShareClient from "./ShareClient";

const SHARE_SCENE_SELECT = {
  id: true,
  sceneNumber: true,
  title: true,
  prompt: true,
  enhancedPrompt: true,
  dialogue: true,
  mood: true,
  cameraMove: true,
  musicMood: true,
  imageUrl: true,
  videoUrl: true,
  duration: true,
  transition: true,
  subtitleSrt: true,
  narrationUrl: true,
} as const;

/** Public share metadata must not reveal protected project details. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const project = await db.videoProject.findUnique({
    where: { shareSlug: slug },
    select: {
      title: true,
      description: true,
      isPublic: true,
      sharePassword: true,
      finalVideoUrl: true,
      scenes: {
        orderBy: { sceneNumber: "asc" },
        take: 1,
        select: { imageUrl: true },
      },
    },
  });

  if (!project?.isPublic) {
    return { title: "Video not found — Vidora Studio" };
  }

  if (project.sharePassword) {
    return {
      title: "Password Protected Video — Vidora Studio",
      description: "This shared Vidora Studio video requires a password to view.",
      robots: { index: false, follow: false },
      openGraph: {
        title: "Password Protected Video — Vidora Studio",
        description: "This shared video requires a password to view.",
        images: [{ url: "/images/og-image.png", width: 1200, height: 630 }],
      },
      twitter: {
        card: "summary_large_image",
        title: "Password Protected Video — Vidora Studio",
        description: "This shared video requires a password to view.",
        images: ["/images/og-image.png"],
      },
    };
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
  const coverImage = project.scenes[0]?.imageUrl || "/images/og-image.png";
  const description =
    project.description?.replace(/^\[DEMO\]\s*/, "") ||
    "Watch this AI-generated video on Vidora Studio";

  return {
    title: `${project.title} — Vidora Studio`,
    description,
    openGraph: {
      title: project.title,
      description,
      type: "video.other",
      url: `${baseUrl}/share/${slug}`,
      images: [
        { url: coverImage, width: 1200, height: 630, alt: project.title },
      ],
      videos: project.finalVideoUrl ? [{ url: project.finalVideoUrl }] : [],
    },
    twitter: {
      card: "summary_large_image",
      title: project.title,
      description,
      images: [coverImage],
    },
  };
}

export default async function SharePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const project = await db.videoProject.findUnique({
    where: { shareSlug: slug },
    select: {
      id: true,
      title: true,
      description: true,
      style: true,
      aspectRatio: true,
      finalVideoUrl: true,
      isPublic: true,
      sharePassword: true,
      allowEmbed: true,
    },
  });

  if (!project?.isPublic) notFound();

  const hasPassword = Boolean(project.sharePassword);
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
  const shareUrl = `${baseUrl}/share/${slug}`;

  // Do not serialize private project/scenes into the React Server Component
  // payload before the share password has been verified by the API.
  if (hasPassword) {
    return (
      <ShareClient
        slug={slug}
        shareUrl={shareUrl}
        allowEmbed={project.allowEmbed}
        hasPassword
        initialProject={null}
        coverImage="/images/og-image.png"
      />
    );
  }

  const scenes = await db.videoScene.findMany({
    where: { projectId: project.id },
    orderBy: { sceneNumber: "asc" },
    select: SHARE_SCENE_SELECT,
  });
  const coverImage = scenes[0]?.imageUrl || "/images/og-image.png";

  return (
    <ShareClient
      slug={slug}
      shareUrl={shareUrl}
      allowEmbed={project.allowEmbed}
      hasPassword={false}
      initialProject={{
        id: project.id,
        title: project.title,
        description: project.description?.replace(/^\[DEMO\]\s*/, "") || "",
        style: project.style,
        aspectRatio: project.aspectRatio,
        finalVideoUrl: project.finalVideoUrl,
        scenes,
      }}
      coverImage={coverImage}
    />
  );
}
