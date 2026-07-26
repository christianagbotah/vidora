import { db } from "@/lib/db";

/**
 * Seeds the ProjectTemplate table with industry-specific templates.
 * Called lazily by getActiveTemplates() if the table is empty.
 * Safe to call multiple times (checks for existing slug first).
 */

interface SceneTemplate {
  title: string;
  prompt: string;
  mood: string;
  cameraMove: string;
  musicMood: string;
  duration: number;
  transition: string;
  dialogue?: string;
}

interface TemplateSeed {
  slug: string;
  title: string;
  description: string;
  category: string;
  style: string;
  aspectRatio: string;
  targetDuration: number;
  coverImage: string;
  accentColor: string;
  isFeatured: boolean;
  sortOrder: number;
  scenes: SceneTemplate[];
}

const TEMPLATES: TemplateSeed[] = [
  {
    slug: "real-estate-walkthrough",
    title: "Real Estate Property Walkthrough",
    description: "Showcase a property with cinematic interior and exterior shots. Perfect for agents and listings.",
    category: "real-estate",
    style: "photorealistic",
    aspectRatio: "16:9",
    targetDuration: 30,
    coverImage: "/images/scene-mountain.png",
    accentColor: "from-blue-500 to-cyan-500",
    isFeatured: true,
    sortOrder: 1,
    scenes: [
      { title: "Grand Entrance", prompt: "Cinematic exterior shot of a modern luxury home at golden hour, warm light, landscaped garden, wide angle", mood: "inviting", cameraMove: "slow zoom in", musicMood: "calm", duration: 6, transition: "fade", dialogue: "Welcome to your dream home." },
      { title: "Spacious Living Room", prompt: "Bright, airy living room with floor-to-ceiling windows, modern furniture, natural light streaming in", mood: "bright", cameraMove: "pan right", musicMood: "calm", duration: 6, transition: "dissolve", dialogue: "An open-concept living space bathed in natural light." },
      { title: "Gourmet Kitchen", prompt: "Modern gourmet kitchen with marble countertops, stainless steel appliances, pendant lighting", mood: "elegant", cameraMove: "tracking shot", musicMood: "joyful", duration: 6, transition: "dissolve", dialogue: "A chef's kitchen with premium finishes." },
      { title: "Master Suite", prompt: "Serene master bedroom with large windows, plush bedding, sitting area, en-suite bathroom visible", mood: "peaceful", cameraMove: "slow push in", musicMood: "calm", duration: 6, transition: "dissolve", dialogue: "Your private retreat awaits." },
      { title: "Outdoor Oasis", prompt: "Beautiful backyard with swimming pool, patio, outdoor kitchen, sunset lighting", mood: "luxurious", cameraMove: "aerial drone shot", musicMood: "joyful", duration: 6, transition: "fade", dialogue: "Entertain in style with this outdoor oasis." },
    ],
  },
  {
    slug: "restaurant-promo",
    title: "Restaurant Promo Video",
    description: "Showcase your restaurant's ambiance, signature dishes, and chef in action. Mouth-watering content.",
    category: "restaurant",
    style: "photorealistic",
    aspectRatio: "16:9",
    targetDuration: 24,
    coverImage: "/images/scene-sunset.png",
    accentColor: "from-amber-500 to-orange-500",
    isFeatured: true,
    sortOrder: 2,
    scenes: [
      { title: "Welcome Atmosphere", prompt: "Warm, inviting restaurant interior with ambient lighting, beautifully set tables, candles, elegant decor", mood: "inviting", cameraMove: "slow pan", musicMood: "joyful", duration: 6, transition: "fade", dialogue: "Where every meal is a celebration." },
      { title: "Chef at Work", prompt: "Professional chef plating a gourmet dish in a pristine kitchen, steam rising, focused expression, close-up", mood: "focused", cameraMove: "close-up", musicMood: "tense", duration: 6, transition: "cut", dialogue: "Crafted by our award-winning chef." },
      { title: "Signature Dish", prompt: "Stunning signature dish on elegant plate, garnished perfectly, dramatic lighting, food photography style", mood: "elegant", cameraMove: "slow zoom in", musicMood: "calm", duration: 6, transition: "dissolve", dialogue: "Taste perfection in every bite." },
      { title: "Happy Guests", prompt: "Happy couple dining at candlelit table, laughing, sharing a meal, warm golden lighting", mood: "joyful", cameraMove: "medium shot", musicMood: "joyful", duration: 6, transition: "fade", dialogue: "Join us for an unforgettable evening." },
    ],
  },
  {
    slug: "birthday-tribute",
    title: "Birthday Tribute Video",
    description: "A heartfelt birthday celebration video with memories, messages, and joy. Perfect for loved ones.",
    category: "birthday",
    style: "cinematic",
    aspectRatio: "16:9",
    targetDuration: 30,
    coverImage: "/images/scene-fantasy.png",
    accentColor: "from-pink-500 to-rose-500",
    isFeatured: true,
    sortOrder: 3,
    scenes: [
      { title: "Opening Celebration", prompt: "Golden birthday cake with lit candles on a beautifully decorated table, warm bokeh background, celebratory mood", mood: "joyful", cameraMove: "slow zoom in", musicMood: "joyful", duration: 6, transition: "fade", dialogue: "Today, we celebrate you." },
      { title: "Cherished Memories", prompt: "Warm, nostalgic scene with floating photographs and golden light particles, dreamy atmosphere, memory lane", mood: "nostalgic", cameraMove: "floating motion", musicMood: "calm", duration: 6, transition: "dissolve", dialogue: "Every memory a treasure." },
      { title: "Words from the Heart", prompt: "Warm golden hour scene with silhouettes of family gathering, love and togetherness, emotional", mood: "emotional", cameraMove: "slow tracking", musicMood: "calm", duration: 6, transition: "dissolve", dialogue: "You mean the world to us." },
      { title: "Make a Wish", prompt: "Birthday candles being blown out, sparks of light, joyful celebration, confetti in warm light", mood: "celebratory", cameraMove: "close-up", musicMood: "joyful", duration: 6, transition: "fade", dialogue: "Make a wish — the best is yet to come." },
    ],
  },
  {
    slug: "product-demo",
    title: "Product Demo Showcase",
    description: "Highlight your product's features with dramatic close-ups and lifestyle shots. E-commerce ready.",
    category: "product",
    style: "cinematic",
    aspectRatio: "1:1",
    targetDuration: 18,
    coverImage: "/images/scene-cyberpunk.png",
    accentColor: "from-violet-500 to-purple-500",
    isFeatured: false,
    sortOrder: 4,
    scenes: [
      { title: "Product Reveal", prompt: "Dramatic product reveal on dark background, studio lighting, product rotating slowly, premium feel", mood: "dramatic", cameraMove: "rotating", musicMood: "epic", duration: 6, transition: "fade", dialogue: "Meet the future of [your product]." },
      { title: "Feature Close-up", prompt: "Extreme close-up of product detail, macro shot, premium materials, studio lighting highlighting texture", mood: "elegant", cameraMove: "macro pan", musicMood: "calm", duration: 6, transition: "dissolve", dialogue: "Crafted with precision." },
      { title: "In Action", prompt: "Product being used in a lifestyle setting, happy person, natural light, aspirational", mood: "aspirational", cameraMove: "tracking shot", musicMood: "joyful", duration: 6, transition: "fade", dialogue: "Experience the difference." },
    ],
  },
  {
    slug: "fitness-reel",
    title: "Fitness Motivation Reel",
    description: "High-energy fitness content for social media. Perfect for trainers and fitness brands.",
    category: "fitness",
    style: "cinematic",
    aspectRatio: "9:16",
    targetDuration: 15,
    coverImage: "/images/scene-mountain.png",
    accentColor: "from-emerald-500 to-teal-500",
    isFeatured: false,
    sortOrder: 5,
    scenes: [
      { title: "The Grind", prompt: "Athlete training hard in gym, dramatic lighting, sweat, intensity, slow motion, powerful", mood: "intense", cameraMove: "dynamic", musicMood: "epic", duration: 5, transition: "cut", dialogue: "While you rest, I grind." },
      { title: "The Push", prompt: "Close-up of determination, athlete pushing through final rep, muscles straining, focused eyes", mood: "determined", cameraMove: "close-up", musicMood: "tense", duration: 5, transition: "cut", dialogue: "Pain is temporary." },
      { title: "The Victory", prompt: "Athlete at peak performance, summit pose, sunrise behind, victory and achievement, epic", mood: "victorious", cameraMove: "wide reveal", musicMood: "joyful", duration: 5, transition: "fade", dialogue: "Greatness is earned." },
    ],
  },
  {
    slug: "travel-vlog",
    title: "Travel Destination Vlog",
    description: "Cinematic travel content showcasing destinations, culture, and adventure. For tourism and travel brands.",
    category: "travel",
    style: "cinematic",
    aspectRatio: "16:9",
    targetDuration: 30,
    coverImage: "/images/scene-sunset.png",
    accentColor: "from-cyan-500 to-blue-500",
    isFeatured: false,
    sortOrder: 6,
    scenes: [
      { title: "Arrival", prompt: "Stunning aerial shot of tropical destination, turquoise water, palm trees, golden sand, paradise", mood: "awe-inspiring", cameraMove: "aerial drone shot", musicMood: "joyful", duration: 6, transition: "fade", dialogue: "Welcome to paradise." },
      { title: "Local Culture", prompt: "Vibrant local market scene with colorful textiles, spices, friendly vendors, authentic atmosphere", mood: "vibrant", cameraMove: "walking shot", musicMood: "joyful", duration: 6, transition: "dissolve", dialogue: "Immerse yourself in the culture." },
      { title: "Adventure", prompt: "Hiking through lush jungle to hidden waterfall, adventure, exploration, cinematic", mood: "adventurous", cameraMove: "tracking shot", musicMood: "epic", duration: 6, transition: "dissolve", dialogue: "Discover the unknown." },
      { title: "Sunset Magic", prompt: "Spectacular sunset over the ocean from a cliff, golden hour, romantic, peaceful", mood: "peaceful", cameraMove: "static wide", musicMood: "calm", duration: 6, transition: "fade", dialogue: "Moments that take your breath away." },
    ],
  },
];

export async function seedTemplates(): Promise<void> {
  for (const tpl of TEMPLATES) {
    const existing = await db.projectTemplate.findUnique({ where: { slug: tpl.slug } });
    if (existing) continue;

    await db.projectTemplate.create({
      data: {
        slug: tpl.slug,
        title: tpl.title,
        description: tpl.description,
        category: tpl.category,
        style: tpl.style,
        aspectRatio: tpl.aspectRatio,
        targetDuration: tpl.targetDuration,
        coverImage: tpl.coverImage,
        accentColor: tpl.accentColor,
        sceneCount: tpl.scenes.length,
        sceneTemplates: JSON.stringify(tpl.scenes),
        isFeatured: tpl.isFeatured,
        isActive: true,
        sortOrder: tpl.sortOrder,
      },
    });
  }
}

export { TEMPLATES };
