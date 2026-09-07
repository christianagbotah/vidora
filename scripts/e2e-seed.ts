import bcrypt from "bcryptjs";
import { db } from "../src/lib/db";

const E2E_USER_ID = "vidora-e2e-user";
const E2E_PROJECT_ID = "vidora-e2e-project";
const E2E_SCENE_ID = "vidora-e2e-scene";
const E2E_CHARACTER_ID = "vidora-e2e-character";

const E2E_EMAIL = process.env.VIDORA_E2E_EMAIL || "e2e@vidora.local";
const E2E_PASSWORD = process.env.VIDORA_E2E_PASSWORD || "VidoraE2E!2026";
const E2E_PROJECT_TITLE = process.env.VIDORA_E2E_PROJECT_TITLE || "Vidora E2E Golden Project";

async function cleanup(): Promise<void> {
  await db.videoProject.deleteMany({ where: { id: E2E_PROJECT_ID } });
  await db.user.deleteMany({ where: { id: E2E_USER_ID } });
}

async function seed(): Promise<void> {
  await cleanup();
  const password = await bcrypt.hash(E2E_PASSWORD, 10);

  await db.user.create({
    data: {
      id: E2E_USER_ID,
      email: E2E_EMAIL,
      name: "Vidora E2E User",
      password,
      role: "user",
      tokens: 0,
      isActive: true,
      projects: {
        create: {
          id: E2E_PROJECT_ID,
          title: E2E_PROJECT_TITLE,
          description: "Deterministic zero-cost browser release fixture.",
          style: "cinematic",
          aspectRatio: "16:9",
          status: "completed",
          targetDuration: 10,
          projectType: "custom",
          finalVideoUrl: "/demo/final-mountain-journey.mp4",
          scenes: {
            create: {
              id: E2E_SCENE_ID,
              sceneNumber: 1,
              title: "Golden path scene",
              prompt: "A calm mountain journey at sunrise.",
              dialogue: "Amina: Every journey begins with one clear step.",
              characterIds: JSON.stringify([E2E_CHARACTER_ID]),
              narrationLang: "en",
              narrationAccent: "auto",
              narrationStyle: "natural",
              narrationVoice: "tongtong",
              videoUrl: "/demo/final-mountain-journey.mp4",
              duration: 10,
              transition: "fade",
              status: "completed",
            },
          },
          characters: {
            create: {
              id: E2E_CHARACTER_ID,
              name: "Amina",
              role: "protagonist",
              description: "A calm guide used by the browser release fixture.",
              voiceId: null,
            },
          },
        },
      },
    },
  });

  console.log(JSON.stringify({
    seeded: true,
    email: E2E_EMAIL,
    projectId: E2E_PROJECT_ID,
    projectTitle: E2E_PROJECT_TITLE,
  }));
}

async function main(): Promise<void> {
  const command = process.argv[2] || "seed";
  if (command === "seed") {
    await seed();
    return;
  }
  if (command === "cleanup") {
    await cleanup();
    console.log(JSON.stringify({ cleaned: true }));
    return;
  }
  throw new Error(`Unknown E2E seed command: ${command}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect().catch(() => undefined);
  });
