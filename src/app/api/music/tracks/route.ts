import { NextResponse } from "next/server";

/**
 * GET /api/music/tracks
 * Returns the curated royalty-free music library.
 * Tracks are generated ambient audio files in /public/music/ categorized by mood.
 * In production, these would be replaced with licensed royalty-free music.
 */

interface MusicTrack {
  id: string;
  title: string;
  mood: string;
  duration: number;
  url: string;
  category: "background" | "ambient" | "cinematic";
}

const TRACKS: MusicTrack[] = [
  { id: "epic", title: "Epic Cinematic Build", mood: "epic", duration: 20, url: "/music/epic.m4a", category: "cinematic" },
  { id: "calm", title: "Calm Ambient Pad", mood: "calm", duration: 20, url: "/music/calm.m4a", category: "ambient" },
  { id: "tense", title: "Tense Suspense", mood: "tense", duration: 20, url: "/music/tense.m4a", category: "background" },
  { id: "joyful", title: "Joyful Uplifting", mood: "joyful", duration: 20, url: "/music/joyful.m4a", category: "background" },
  { id: "dramatic", title: "Dramatic Pulse", mood: "dramatic", duration: 20, url: "/music/dramatic.m4a", category: "cinematic" },
  { id: "mysterious", title: "Mysterious Echoes", mood: "mysterious", duration: 20, url: "/music/mysterious.m4a", category: "ambient" },
];

export async function GET() {
  return NextResponse.json({
    success: true,
    tracks: TRACKS,
    moods: ["epic", "calm", "tense", "joyful", "dramatic", "mysterious"],
  });
}
