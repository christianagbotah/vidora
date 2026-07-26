/**
 * ───────────────────────────────────────────────────────────────────────────
 *  Vidora — Demo Mode Templates
 * ───────────────────────────────────────────────────────────────────────────
 *
 *  Curated, self-contained demo projects that showcase the FULL video
 *  generation UX (storyboard → scene images → video clips → playback)
 *  WITHOUT requiring Z.ai API calls or token balance.
 *
 *  Each demo uses pre-rendered assets in /public/demo/scenes/ (Ken Burns
 *  video clips generated from the existing scene-*.png images via ffmpeg).
 *
 *  This exists so users can experience the product end-to-end even while
 *  the Z.ai account awaits recharge. It is also useful for sales demos,
 *  onboarding, and evaluating the UX before buying tokens.
 *
 *  Demo projects are real DB records (so they show in Gallery/Studio) but:
 *    • Cost ZERO tokens
 *    • Make ZERO Z.ai API calls
 *    • Are clearly badged as "DEMO" in the description
 * ───────────────────────────────────────────────────────────────────────────
 */

export interface DemoScene {
  sceneNumber: number;
  title: string;
  prompt: string;
  enhancedPrompt: string;
  visualNote: string;
  dialogue: string;
  mood: string;
  cameraMove: string;
  musicMood: string;
  duration: number;
  transition: string;
  imageUrl: string;
  videoUrl: string;
}

export interface DemoTemplate {
  id: string;
  title: string;
  description: string;
  style: string;
  aspectRatio: string;
  targetDuration: number;
  projectType: string;
  coverImage: string;
  accentColor: string; // tailwind gradient
  tagline: string;
  scenes: DemoScene[];
}

const BASE = "/demo/scenes";

export const DEMO_TEMPLATES: DemoTemplate[] = [
  {
    id: "mountain-journey",
    title: "Mountain Journey — A Cinematic Short",
    description: "[DEMO] A breathtaking cinematic journey across misty mountain peaks at golden hour. Follow the light as it sweeps across the landscape in this AI-directed short film.",
    style: "cinematic",
    aspectRatio: "16:9",
    targetDuration: 24,
    projectType: "custom",
    coverImage: `${BASE}/mountain.png`,
    accentColor: "from-amber-500 via-orange-500 to-rose-500",
    tagline: "Cinematic · Nature · 4 scenes",
    scenes: [
      {
        sceneNumber: 1,
        title: "Dawn Breaks Over the Range",
        prompt: "Aerial drone shot of a vast mountain range at dawn, golden light breaking through misty clouds, snow-capped peaks glowing warm.",
        enhancedPrompt: "Cinematic aerial drone shot, vast mountain range at dawn, golden hour lighting, volumetric mist rolling between peaks, snow-capped summits glowing warm amber, 4K detail, anamorphic lens flare, epic scale.",
        visualNote: "Wide aerial establishing shot, slow forward push, warm amber grade.",
        dialogue: "Narrator: Before the world woke, the mountains held the light.",
        mood: "awe-inspiring",
        cameraMove: "aerial drone shot",
        musicMood: "epic",
        duration: 6,
        transition: "fade",
        imageUrl: `${BASE}/mountain.png`,
        videoUrl: `${BASE}/mountain.mp4`,
      },
      {
        sceneNumber: 2,
        title: "Sunset Paints the Valley",
        prompt: "Golden sunset over a mountain valley, long shadows stretching across alpine meadows, warm light painting the landscape.",
        enhancedPrompt: "Cinematic sunset shot over mountain valley, alpine meadow in foreground, long dramatic shadows, warm golden-orange light, lens flare, atmospheric haze, film grain, color graded for warmth.",
        visualNote: "Static wide shot, slow zoom-in, sunset color grade.",
        dialogue: "Narrator: And as the day surrendered, the valley caught fire.",
        mood: "peaceful",
        cameraMove: "slow zoom in",
        musicMood: "calm",
        duration: 6,
        transition: "cross-dissolve",
        imageUrl: `${BASE}/sunset.png`,
        videoUrl: `${BASE}/sunset.mp4`,
      },
      {
        sceneNumber: 3,
        title: "The Enchanted Forest",
        prompt: "Mystical forest with glowing trees, fantasy atmosphere, light beams filtering through the canopy.",
        enhancedPrompt: "Fantasy forest scene, bioluminescent glowing flora, ethereal light beams through dense canopy, mystical atmosphere, shallow depth of field, magical particles in air, rich saturated greens and teals.",
        visualNote: "Slow tracking shot through trees, fantasy color grade.",
        dialogue: "Narrator: Beyond the peaks lay a place where the trees remembered every dream.",
        mood: "mysterious",
        cameraMove: "tracking shot",
        musicMood: "tense",
        duration: 6,
        transition: "cross-dissolve",
        imageUrl: `${BASE}/fantasy.png`,
        videoUrl: `${BASE}/fantasy.mp4`,
      },
      {
        sceneNumber: 4,
        title: "Neon City Awakening",
        prompt: "Cyberpunk city skyline at night, neon lights reflecting on wet streets, futuristic atmosphere.",
        enhancedPrompt: "Cyberpunk megacity skyline, dense neon signage in pink and cyan, wet reflective streets, atmospheric rain haze, flying vehicles, blade-runner aesthetic, high contrast, anamorphic lens, vibrant saturated colors.",
        visualNote: "Slow tilt-up reveal of skyline, cyberpunk color grade.",
        dialogue: "Narrator: And in the city that never sleeps, the future was already awake.",
        mood: "intense",
        cameraMove: "tilt up",
        musicMood: "epic",
        duration: 6,
        transition: "fade",
        imageUrl: `${BASE}/cyberpunk.png`,
        videoUrl: `${BASE}/cyberpunk.mp4`,
      },
    ],
  },
  {
    id: "fantasy-realm",
    title: "The Enchanted Realm — Fantasy Trailer",
    description: "[DEMO] Step into a mystical fantasy world of glowing forests and ancient magic. A promotional trailer for an epic fantasy series.",
    style: "cinematic",
    aspectRatio: "16:9",
    targetDuration: 18,
    projectType: "commercial",
    coverImage: `${BASE}/fantasy.png`,
    accentColor: "from-emerald-500 via-teal-500 to-cyan-500",
    tagline: "Fantasy · Trailer · 3 scenes",
    scenes: [
      {
        sceneNumber: 1,
        title: "The Hidden Grove",
        prompt: "A secret grove deep in an ancient forest, glowing mushrooms and floating light particles, magical atmosphere.",
        enhancedPrompt: "Fantasy establishing shot, hidden forest grove, bioluminescent mushrooms glowing teal and magenta, floating spores and light particles, ancient moss-covered trees, god rays through canopy, ethereal mist, cinematic 4K.",
        visualNote: "Slow push-in toward the grove, fantasy grade.",
        dialogue: "Narrator: In the heart of the forest, the old magic still breathes.",
        mood: "mysterious",
        cameraMove: "slow push in",
        musicMood: "epic",
        duration: 6,
        transition: "fade",
        imageUrl: `${BASE}/fantasy.png`,
        videoUrl: `${BASE}/fantasy.mp4`,
      },
      {
        sceneNumber: 2,
        title: "Twilight Over the Peaks",
        prompt: "Mountain peaks at twilight, stars beginning to appear, a lone figure silhouetted against the sky.",
        enhancedPrompt: "Cinematic twilight mountain shot, purple and deep blue sky, first stars emerging, lone hooded figure silhouette on a cliff edge, atmospheric haze, wide aspect, dramatic and contemplative mood.",
        visualNote: "Static wide with figure silhouette, twilight grade.",
        dialogue: "Narrator: But every守护者 must eventually climb beyond the known world.",
        mood: "contemplative",
        cameraMove: "static wide",
        musicMood: "calm",
        duration: 6,
        transition: "cross-dissolve",
        imageUrl: `${BASE}/mountain.png`,
        videoUrl: `${BASE}/mountain.mp4`,
      },
      {
        sceneNumber: 3,
        title: "The Final Confrontation",
        prompt: "Epic sunset battle scene, dramatic clouds, intense warm light, sense of impending climax.",
        enhancedPrompt: "Epic cinematic sunset, dramatic storm clouds lit from below in fiery orange and crimson, intense backlight, silhouette-ready composition, film grain, anamorphic flare, climactic trailer energy.",
        visualNote: "Slow zoom toward horizon, dramatic grade.",
        dialogue: "Narrator: When the sky burns, the realm will choose its champion.",
        mood: "dramatic",
        cameraMove: "slow zoom in",
        musicMood: "epic",
        duration: 6,
        transition: "fade",
        imageUrl: `${BASE}/sunset.png`,
        videoUrl: `${BASE}/sunset.mp4`,
      },
    ],
  },
  {
    id: "cyberpunk-noir",
    title: "Neon Nights — Cyberpunk Promo",
    description: "[DEMO] A moody cyberpunk promotional video for a futuristic brand. Neon-soaked streets and rain-slicked reflections.",
    style: "cyberpunk",
    aspectRatio: "16:9",
    targetDuration: 12,
    projectType: "social",
    coverImage: `${BASE}/cyberpunk.png`,
    accentColor: "from-fuchsia-500 via-purple-500 to-violet-500",
    tagline: "Cyberpunk · Promo · 2 scenes",
    scenes: [
      {
        sceneNumber: 1,
        title: "City of Light",
        prompt: "Cyberpunk city at night, neon signs reflecting on wet pavement, rain falling, atmospheric and moody.",
        enhancedPrompt: "Cyberpunk cityscape, dense neon signage in hot pink and electric cyan, wet reflective asphalt, light rain, atmospheric haze, bokeh street lights, blade-runner mood, high contrast cinematic grade.",
        visualNote: "Slow dolly along the street, neon color grade.",
        dialogue: "V/O: In a city built on data, every shadow tells a story.",
        mood: "moody",
        cameraMove: "dolly shot",
        musicMood: "tense",
        duration: 6,
        transition: "fade",
        imageUrl: `${BASE}/cyberpunk.png`,
        videoUrl: `${BASE}/cyberpunk.mp4`,
      },
      {
        sceneNumber: 2,
        title: "Beyond the Grid",
        prompt: "Looking out from the city toward distant mountains, dawn breaking over a cyberpunk world.",
        enhancedPrompt: "Wide cyberpunk vista, neon city foreground transitioning to distant mountain range, first light of dawn breaking, purple-to-orange gradient sky, atmospheric layering, epic scale, cinematic.",
        visualNote: "Wide reveal, tilt-up, dawn grade.",
        dialogue: "V/O: But beyond the grid, a new day always waits to be written.",
        mood: "hopeful",
        cameraMove: "tilt up",
        musicMood: "epic",
        duration: 6,
        transition: "fade",
        imageUrl: `${BASE}/mountain.png`,
        videoUrl: `${BASE}/mountain.mp4`,
      },
    ],
  },
];

/**
 * Find a demo template by id. Falls back to the first template.
 */
export function getDemoTemplate(id: string | null | undefined): DemoTemplate {
  if (id) {
    const found = DEMO_TEMPLATES.find((t) => t.id === id);
    if (found) return found;
  }
  return DEMO_TEMPLATES[0];
}

/**
 * The combined "final video" for a demo template — concatenation of all
 * scene clips. Currently we have one combined reel for the mountain-journey.
 * For other templates, the studio plays scenes individually.
 */
export function getDemoFinalVideo(templateId: string): string | null {
  if (templateId === "mountain-journey") return "/demo/final-mountain-journey.mp4";
  return null;
}
