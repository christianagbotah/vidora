import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin";

/**
 * POST /api/contact
 * Stores a public contact-form submission. Public by design; input is bounded
 * before persistence. Abuse-rate limiting is handled separately at the edge.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, email, subject, message } = body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json(
        { success: false, error: "Name is required" },
        { status: 400 }
      );
    }
    if (!email || typeof email !== "string" || !/^\S+@\S+\.\S+$/.test(email)) {
      return NextResponse.json(
        { success: false, error: "A valid email is required" },
        { status: 400 }
      );
    }
    if (!message || typeof message !== "string" || message.trim().length < 5) {
      return NextResponse.json(
        { success: false, error: "Message must be at least 5 characters" },
        { status: 400 }
      );
    }

    const safeName = name.trim().slice(0, 100);
    const safeEmail = email.trim().slice(0, 200);
    const safeSubject =
      typeof subject === "string" && subject.trim()
        ? subject.trim().slice(0, 200)
        : "General Inquiry";
    const safeMessage = message.trim().slice(0, 5000);

    const record = await db.contactMessage.create({
      data: {
        name: safeName,
        email: safeEmail,
        subject: safeSubject,
        message: safeMessage,
      },
    });

    return NextResponse.json(
      { success: true, id: record.id },
      { status: 201 }
    );
  } catch (error) {
    console.error(
      "Failed to save contact message:",
      error instanceof Error ? error.message : "unknown error"
    );
    return NextResponse.json(
      { success: false, error: "Failed to send message. Please try again." },
      { status: 500 }
    );
  }
}

/** GET /api/contact — current-role/current-session admin authorization. */
export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req);
  if (error) return error;

  try {
    const messages = await db.contactMessage.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return NextResponse.json({ success: true, messages });
  } catch (error) {
    console.error(
      "Failed to fetch contact messages:",
      error instanceof Error ? error.message : "unknown error"
    );
    return NextResponse.json(
      { success: false, error: "Failed to fetch messages" },
      { status: 500 }
    );
  }
}
