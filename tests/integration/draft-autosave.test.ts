import { afterAll, describe, expect, test } from "bun:test";
import { db } from "@/lib/db";

const createdUsers: string[] = [];

async function createUser() {
  const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const user = await db.user.create({
    data: {
      email: `draft-autosave-${nonce}@example.invalid`,
      name: "Draft Autosave Test",
    },
  });
  createdUsers.push(user.id);
  return user;
}

afterAll(async () => {
  for (const id of createdUsers) {
    await db.user.delete({ where: { id } }).catch(() => undefined);
  }
});

describe("durable project draft persistence", () => {
  test("round-trips draftData and lastAutosavedAt before scenes exist", async () => {
    const user = await createUser();
    const savedAt = new Date();
    const draftData = JSON.stringify({
      version: 1,
      inputMode: "script",
      scriptText: "INT. ROOM - DAY",
      parsedCharacters: [{ name: "Ada", role: "lead" }],
      previewStoryboard: { title: "Free storyboard" },
    });

    const project = await db.videoProject.create({
      data: {
        userId: user.id,
        title: "Recoverable draft",
        status: "draft",
        draftData,
        lastAutosavedAt: savedAt,
      },
    });

    const restored = await db.videoProject.findUniqueOrThrow({
      where: { id: project.id },
      include: { scenes: true },
    });

    expect(restored.status).toBe("draft");
    expect(restored.scenes).toHaveLength(0);
    expect(restored.draftData).toBe(draftData);
    expect(restored.lastAutosavedAt?.getTime()).toBe(savedAt.getTime());
  });

  test("latest autosaved draft can be selected per user", async () => {
    const user = await createUser();
    const older = new Date(Date.now() - 60_000);
    const newer = new Date();

    await db.videoProject.createMany({
      data: [
        {
          userId: user.id,
          title: "Older draft",
          status: "draft",
          draftData: JSON.stringify({ version: 1, scriptText: "old" }),
          lastAutosavedAt: older,
        },
        {
          userId: user.id,
          title: "Newest draft",
          status: "draft",
          draftData: JSON.stringify({ version: 1, scriptText: "new" }),
          lastAutosavedAt: newer,
        },
      ],
    });

    const latest = await db.videoProject.findFirstOrThrow({
      where: {
        userId: user.id,
        status: "draft",
        draftData: { not: null },
      },
      orderBy: { lastAutosavedAt: "desc" },
    });

    expect(latest.title).toBe("Newest draft");
  });
});
