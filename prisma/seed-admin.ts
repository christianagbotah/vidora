import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const email = process.argv[2] || "vidora@lightworldtech.com";
  const password = process.argv[3] || "@@Myjesus4me2016$$";

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
    console.log(`   New Password: ${password}`);
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
  console.log(`   Password: ${password}`);
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
