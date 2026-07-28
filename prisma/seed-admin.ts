import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

/**
 * Seed / update the admin user.
 *
 * Usage:
 *   bun run prisma:seed-admin <email> <password>
 *
 * For security, there is NO default password. If arguments are missing
 * the script will:
 *   - fall back to ADMIN_EMAIL / ADMIN_PASSWORD env vars, OR
 *   - exit with an error explaining how to use it.
 *
 * Existing admins are updated in place (preserves user id, payments,
 * projects, token transactions).
 */
async function main() {
  const email = process.argv[2] || process.env.ADMIN_EMAIL;
  const password = process.argv[3] || process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    console.error("❌ Admin email and password are required.");
    console.error("");
    console.error("Usage:");
    console.error("  bun run prisma:seed-admin <email> <password>");
    console.error("");
    console.error("Or set ADMIN_EMAIL and ADMIN_PASSWORD env vars.");
    console.error("");
    console.error("Password requirements: min 10 chars, mix of letters, numbers, symbols.");
    process.exit(1);
  }

  if (password.length < 10) {
    console.error("❌ Password must be at least 10 characters long.");
    process.exit(1);
  }

  // Check if admin exists by the NEW email
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`✅ Admin already exists: ${existing.email}`);
    console.log(`   Name: ${existing.name}`);
    console.log(`   Role: ${existing.role}`);
    console.log(`   Tokens: ${existing.tokens}`);
    // Update role to admin if needed
    if (existing.role !== "admin") {
      await prisma.user.update({ where: { id: existing.id }, data: { role: "admin" } });
      console.log(`   🔄 Updated role to admin`);
    }
    return;
  }

  // Check if an admin exists under an OLD email — if so, update it in place
  // (preserves user id, payments, projects, token transactions)
  const oldAdmins = await prisma.user.findMany({ where: { role: "admin" } });
  const hashedPassword = await bcrypt.hash(password, 12);

  if (oldAdmins.length > 0) {
    // Update the first admin found to the new email + password
    const oldAdmin = oldAdmins[0];
    const updated = await prisma.user.update({
      where: { id: oldAdmin.id },
      data: {
        email,
        password: hashedPassword,
        name: "Vidora Admin",
        role: "admin",
        isActive: true,
      },
    });
    console.log(`✅ Admin updated (migrated from ${oldAdmin.email})`);
    console.log(`   New Email: ${updated.email}`);
    console.log(`   Role: ${updated.role}`);
    console.log(`   Tokens: ${updated.tokens}`);
    console.log("");
    console.log("⚠️  Keep these credentials secure. Do not share them.");
    return;
  }

  // No existing admin — create a new one
  const admin = await prisma.user.create({
    data: {
      email,
      name: "Vidora Admin",
      password: hashedPassword,
      role: "admin",
      tokens: 9999,
      isActive: true,
    },
  });

  console.log("✅ Admin user created!");
  console.log(`   Email: ${admin.email}`);
  console.log(`   Role: ${admin.role}`);
  console.log(`   Tokens: ${admin.tokens}`);
  console.log("");
  console.log("⚠️  Keep these credentials secure. Do not share them.");
}

main()
  .catch((e) => {
    console.error("Error:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
