import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  try {
    const projects = await db.videoProject.findMany({
      include: {
        scenes: { orderBy: { sceneNumber: "asc" } },
        characters: { orderBy: { createdAt: "asc" } },
      },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ success: true, projects });
  } catch (error) {
    console.error("Failed to fetch projects:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch projects" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { title, description, style, aspectRatio, projectType, characters } = body;

    if (!title) {
      return NextResponse.json(
        { success: false, error: "Title is required" },
        { status: 400 }
      );
    }

    const project = await db.videoProject.create({
      data: {
        title,
        description: description || null,
        style: style || "cinematic",
        aspectRatio: aspectRatio || "16:9",
        targetDuration: body.targetDuration || 60,
        projectType: projectType || "custom",
        characters: characters?.length
          ? { create: characters.map((c: Record<string, string>) => ({
              name: c.name,
              role: c.role || "supporting",
              description: c.description || null,
              stylePrompt: c.stylePrompt || null,
              imageUrl: c.imageUrl || null,
            })) }
          : undefined,
      },
      include: { scenes: true, characters: true },
    });

    return NextResponse.json({ success: true, project }, { status: 201 });
  } catch (error) {
    console.error("Failed to create project:", error);
    return NextResponse.json(
      { success: false, error: "Failed to create project" },
      { status: 500 }
    );
  }
}
