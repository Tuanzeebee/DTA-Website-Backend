import { RoleName } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const ROLES: Array<{ name: RoleName; description: string }> = [
  { name: RoleName.SUPER_ADMIN, description: 'Quản trị hệ thống' },
  { name: RoleName.ADMIN, description: 'Quản trị nội dung và tổ chức' },
  { name: RoleName.EDITOR, description: 'Biên tập viên' },
  { name: RoleName.AUTHOR, description: 'Cộng tác viên viết bài' },
  { name: RoleName.MEMBER, description: 'Hội viên' },
  { name: RoleName.USER, description: 'Người dùng thường' },
];

async function main(): Promise<void> {
  for (const role of ROLES) {
    await prisma.role.upsert({
      where: { name: role.name },
      update: { description: role.description },
      create: role,
    });
    console.log(`role ok: ${role.name}`);
  }

  const email = (
    process.env.SEED_ADMIN_EMAIL || 'admin@dta.vn'
  ).toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD || 'Admin@123456';
  const passwordHash = await bcrypt.hash(password, 10);
  const superAdmin = await prisma.role.findUnique({
    where: { name: RoleName.SUPER_ADMIN },
  });
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`super admin đã tồn tại: ${email}`);
    return;
  }
  await prisma.user.create({
    data: {
      email,
      passwordHash,
      fullName: 'Super Admin',
      roles: superAdmin ? { create: [{ roleId: superAdmin.id }] } : undefined,
    },
  });
  console.log(`tạo super admin: ${email} / ${password}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
