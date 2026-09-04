import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireProjectAccess } from "@/lib/project-auth";
import bcrypt from "bcryptjs";

const SHARE_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{2,62}[a-z0-9])?$/;
const MIN_SHARE_PASSWORD_BYTES = 6;
const MAX_BCRYPT_PASSWORD_BYTES = 72;

function generateShareSlug(): string {
  return crypto.randomBytes(9).toString("base64url").toLowerCase();
}

/** Return the project's current sharing settings to authorized readers. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const authResult = await requireProjectAccess(id, false);
    if (!authResult.ok) return authResult.response;

    const project = await db.videoProject.findUnique({
      where: { id },
      select: {
        isPublic: true,
        shareSlug: true,
        sharePassword: true,
        allowEmbed: true,
      },
    });
    if (!project) {
      return NextResponse.json(
        { success: false, error: "Project not found" },
        { status: 404 }
      );
    }

    const baseUrl =
      process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXTAUTH_URL || "http://localhost:3000";
    const shareUrl = project.shareSlug
      ? `${baseUrl.replace(/\/$/, "")}/share/${project.shareSlug}`
      : null;

    return NextResponse.json({
      success: true,
      settings: {
        isPublic: project.isPublic,
        shareSlug: project.shareSlug,
        hasPassword: Boolean(project.sharePassword),
        allowEmbed: project.allowEmbed,
        shareUrl,
      },
    });
  } catch (error) {
    console.error(
      "[share GET]",
      error instanceof Error ? error.message : "unknown error"
    );
    return NextResponse.json(
      { success: false, error: "Failed to load share settings" },
      { status: 500 }
    );
  }
}

/** Update sharing settings. Write access always requires an owned user project. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const authResult = await requireProjectAccess(id, true);
    if (!authResult.ok) return authResult.response;

    const project = await db.videoProject.findUnique({
      where: { id },
      select: {
        id: true,
        isPublic: true,
        shareSlug: true,
        sharePassword: true,
        allowEmbed: true,
      },
    });
    if (!project) {
      return NextResponse.json(
        { success: false, error: "Project not found" },
        { status: 404 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const { isPublic, shareSlug, password, allowEmbed } = body;
    const update: Record<string, unknown> = {};

    if (isPublic !== undefined && typeof isPublic !== "boolean") {
      return NextResponse.json(
        { success: false, error: "isPublic must be a boolean" },
        { status: 400 }
      );
    }
    if (allowEmbed !== undefined && typeof allowEmbed !== "boolean") {
      return NextResponse.json(
        { success: false, error: "allowEmbed must be a boolean" },
        { status: 400 }
      );
    }
    if (typeof isPublic === "boolean") update.isPublic = isPublic;
    if (typeof allowEmbed === "boolean") update.allowEmbed = allowEmbed;

    const willBePublic = typeof isPublic === "boolean" ? isPublic : project.isPublic;
    if (willBePublic && (isPublic === true || shareSlug !== undefined || !project.shareSlug)) {
      let slug =
        typeof shareSlug === "string" && shareSlug.trim()
          ? shareSlug.trim().toLowerCase()
          : project.shareSlug || generateShareSlug();

      if (!SHARE_SLUG_RE.test(slug)) {
        return NextResponse.json(
          {
            success: false,
            error: "Share URL must be 4-64 characters using lowercase letters, numbers, and hyphens.",
          },
          { status: 400 }
        );
      }

      const existing = await db.videoProject.findFirst({
        where: { shareSlug: slug, NOT: { id } },
        select: { id: true },
      });
      if (existing) {
        // Do not reveal which project owns the slug.
        return NextResponse.json(
          { success: false, error: "This share URL is already taken. Try another." },
          { status: 409 }
        );
      }
      update.shareSlug = slug;
    }

    if (password !== undefined) {
      if (password === null || password === "") {
        update.sharePassword = null;
      } else if (typeof password !== "string") {
        return NextResponse.json(
          { success: false, error: "password must be a string or null" },
          { status: 400 }
        );
      } else {
        const normalized = password.trim();
        const byteLength = Buffer.byteLength(normalized, "utf8");
        if (
          byteLength < MIN_SHARE_PASSWORD_BYTES ||
          byteLength > MAX_BCRYPT_PASSWORD_BYTES
        ) {
          return NextResponse.json(
            {
              success: false,
              error: "Share password must be between 6 and 72 UTF-8 bytes.",
            },
            { status: 400 }
          );
        }
        update.sharePassword = await bcrypt.hash(normalized, 12);
      }
    }

    const updated = await db.videoProject.update({ where: { id }, data: update });
    const baseUrl =
      process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXTAUTH_URL || "http://localhost:3000";
    return NextResponse.json({
      success: true,
      settings: {
        isPublic: updated.isPublic,
        shareSlug: updated.shareSlug,
        hasPassword: Boolean(updated.sharePassword),
        allowEmbed: updated.allowEmbed,
        shareUrl: updated.shareSlug
          ? `${baseUrl.replace(/\/$/, "")}/share/${updated.shareSlug}`
          : null,
      },
    });
  } catch (error) {
    console.error(
      "[share POST]",
      error instanceof Error ? error.message : "unknown error"
    );
    return NextResponse.json(
      { success: false, error: "Failed to update share settings" },
      { status: 500 }
    );
  }
}
