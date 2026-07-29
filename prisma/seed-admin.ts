/**
 * Vidora — Admin User Seed Script
 *
 * Usage:
 *   bun run seed-admin          (interactive — prompts for email/password)
 *   bun run seed-admin <email> <password>   (non-interactive)
 *
 * Creates (or updates) a user with admin role and initial token balance.
 * Uses bcrypt (12 rounds) for password hashing.
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import readline from "readline";

const db = new PrismaClient();

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  const email = process.argv[2];
  const password = process.argv[3];

  const finalEmail =
    email && email.includes("@")
      ? email
      : await ask("Enter admin email: ");

  if (!finalEmail.includes("@")) {
    console.error("❌ Invalid email address");
    process.exit(1);
  }

  const finalPassword =
    password && password.length >= 6
      ? password
      : await ask("Enter admin password (min 6 chars): ");

  if (finalPassword.length < 6) {
    console.error("❌ Password must be at least 6 characters");
    process.exit(1);
  }

  const name = process.argv[4] || await ask("Enter admin name (optional): ") || "Admin";
  const tokensArg = process.argv[5];
  const tokens = tokensArg ? parseInt(tokensArg) : 1000;

  // Hash password
  const hashedPassword = await bcrypt.hash(finalPassword, 12);

  // Upsert the user
  const user = await db.user.upsert({
    where: { email: finalEmail },
    create: {
      email: finalEmail,
      name,
      password: hashedPassword,
      role: "admin",
      tokens,
      isActive: true,
    },
    update: {
      password: hashedPassword,
      role: "admin",
      tokens,
      isActive: true,
    },
  });

  console.log(`\n✅ Admin user created/updated:`);
  console.log(`   Email:  ${user.email}`);
  console.log(`   Name:   ${user.name}`);
  console.log(`   Role:   ${user.role}`);
  console.log(`   Tokens: ${user.tokens}`);
  console.log(`\n🔑 Sign in at your Vidora login page with:`);
  console.log(`   Email:    ${finalEmail}`);
  console.log(`   Password: ${finalPassword}`);
  console.log();

  await db.$disconnect();
}

main().catch((err) => {
  console.error("Failed to seed admin:", err);
  process.exit(1);
});
