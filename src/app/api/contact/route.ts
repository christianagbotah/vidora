import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * POST /api/contact
 *
 * Stores a contact message submitted from the contact form.
 * Public endpoint — no auth required (guests can send messages).
 *
 * Body: { name, email, subject?, message }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, email, subject, message } = body;

    // Validate required fields
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

    // Basic length limits to prevent abuse
    const safeName = name.trim().slice(0, 100);
    const safeEmail = email.trim().slice(0, 200);
    const safeSubject = (subject || "General Inquiry").trim().slice(0, 200);
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
    console.error("Failed to save contact message:", error);
    return NextResponse.json(
      { success: false, error: "Failed to send message. Please try again." },
      { status: 500 }
    );
  }
}

/**
 * GET /api/contact
 *
 * Returns all contact messages. Admin-only.
 */
export async function GET() {
  try {
    const { getServerSession } = await import("next-auth");
    const { authOptions } = await import("@/lib/auth");
    const session = await getServerSession(authOptions);

    if (!session || session.user.role !== "admin") {
      return NextResponse.json(
        { success: false, error: "Admin access required" },
        { status: 403 }
      );
    }

    const messages = await db.contactMessage.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    return NextResponse.json({ success: true, messages });
  } catch (error) {
    console.error("Failed to fetch contact messages:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch messages" },
      { status: 500 }
    );
  }
}
