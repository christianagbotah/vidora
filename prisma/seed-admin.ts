import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const email = process.argv[2] || "admin@vidora.lightworldtech.com";
  const password = process.argv[3] || "Admin@2024";

  // Check if admin exists
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

  const hashedPassword = await bcrypt.hash(password, 12);

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
  console.log("⚠️  Change the password after first login!");
}

main()
  .catch((e) => {
    console.error("Error:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
