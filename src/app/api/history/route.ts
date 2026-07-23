import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  try {
    const history = await db.generationHistory.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    return NextResponse.json({ success: true, history });
  } catch (error) {
    console.error("Failed to fetch history:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch history" },
      { status: 500 }
    );
  }
}
