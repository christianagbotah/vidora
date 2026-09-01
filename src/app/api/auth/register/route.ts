import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { registerLimiter } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  try {
    // Rate limit: 3 registrations per hour
    const { limited } = registerLimiter(req);
    if (limited) {
      return NextResponse.json(
        { success: false, error: "Too many registration attempts. Please try again later." },
        { status: 429 }
      );
    }

    const { email, name, password } = await req.json();

    // ── Field presence validation ──
    if (!email || !password) {
      return NextResponse.json(
        {
          success: false,
          error: "Email and password are required.",
          field: !email ? "email" : "password",
        },
        { status: 400 }
      );
    }

    if (!name || name.trim().length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "Please enter your full name.",
          field: "name",
        },
        { status: 400 }
      );
    }

    // ── Email format validation ──
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        {
          success: false,
          error: "Please enter a valid email address (e.g. you@example.com).",
          field: "email",
        },
        { status: 400 }
      );
    }

    // ── Password strength validation ──
    if (password.length < 8) {
      return NextResponse.json(
        {
          success: false,
          error: "Password must be at least 8 characters long.",
          field: "password",
        },
        { status: 400 }
      );
    }

    if (!/[A-Z]/.test(password)) {
      return NextResponse.json(
        {
          success: false,
          error: "Password must contain at least one uppercase letter (A-Z).",
          field: "password",
        },
        { status: 400 }
      );
    }

    if (!/[a-z]/.test(password)) {
      return NextResponse.json(
        {
          success: false,
          error: "Password must contain at least one lowercase letter (a-z).",
          field: "password",
        },
        { status: 400 }
      );
    }

    if (!/[0-9]/.test(password)) {
      return NextResponse.json(
        {
          success: false,
          error: "Password must contain at least one number (0-9).",
          field: "password",
        },
        { status: 400 }
      );
    }

    if (!/[^A-Za-z0-9]/.test(password)) {
      return NextResponse.json(
        {
          success: false,
          error: "Password must contain at least one special character (e.g. !@#$%^&*).",
          field: "password",
        },
        { status: 400 }
      );
    }

    // ── Name length validation ──
    if (name.trim().length < 2) {
      return NextResponse.json(
        {
          success: false,
          error: "Name must be at least 2 characters long.",
          field: "name",
        },
        { status: 400 }
      );
    }

    if (name.trim().length > 50) {
      return NextResponse.json(
        {
          success: false,
          error: "Name must be 50 characters or less.",
          field: "name",
        },
        { status: 400 }
      );
    }

    // ── Duplicate check ──
    const existing = await db.user.findUnique({ where: { email: email.toLowerCase().trim() } });
    if (existing) {
      return NextResponse.json(
        {
          success: false,
          error: "An account with this email already exists. Try signing in instead, or use a different email.",
          field: "email",
        },
        { status: 409 }
      );
    }

    // ── Create user ──
    const hashedPassword = await bcrypt.hash(password, 12);

    const user = await db.user.create({
      data: {
        email: email.toLowerCase().trim(),
        name: name.trim(),
        password: hashedPassword,
      },
    });

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        tokens: user.tokens,
      },
    });
  } catch (error) {
    console.error("Registration error:", error);

    // ── Handle known Prisma errors with clear messages ──
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      switch (error.code) {
        case "P2002":
          return NextResponse.json(
            {
              success: false,
              error: "An account with this email already exists. Try signing in instead, or use a different email.",
              field: "email",
            },
            { status: 409 }
          );
        case "P2025":
          return NextResponse.json(
            {
              success: false,
              error: "Could not create your account. The server could not process your request. Please try again later.",
            },
            { status: 500 }
          );
        default:
          return NextResponse.json(
            {
              success: false,
              error: `A database error occurred (${error.code}). Please try again later or contact support if the problem persists.`,
            },
            { status: 500 }
          );
      }
    }

    // ── Handle Prisma validation errors ──
    if (error instanceof Prisma.PrismaClientValidationError) {
      return NextResponse.json(
        {
          success: false,
          error: "Some of the information you provided is invalid. Please check your details and try again.",
        },
        { status: 400 }
      );
    }

    // ── Generic fallback ──
    return NextResponse.json(
      {
        success: false,
        error: "Something went wrong on our end while creating your account. Please try again in a moment.",
      },
      { status: 500 }
    );
  }
}
