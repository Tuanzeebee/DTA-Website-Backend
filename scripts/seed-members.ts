import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const MEMBERS = [
  {
    name: 'FPT Corporation',
    role: 'Tổ chức',
    type: 'organization',
    domain: 'Công nghệ thông tin',
    logoUrl: null,
    website: 'https://fpt.com.vn',
    sortOrder: 1,
  },
  {
    name: 'FPT Software',
    role: 'Tổ chức',
    type: 'organization',
    domain: 'Phần mềm & Dịch vụ CNTT',
    logoUrl: null,
    website: 'https://fpt-software.com',
    sortOrder: 2,
  },
  {
    name: 'RMIT University Vietnam',
    role: 'Tổ chức',
    type: 'organization',
    domain: 'Giáo dục',
    logoUrl: null,
    website: 'https://rmit.edu.vn',
    sortOrder: 3,
  },
  {
    name: 'Đại học Bách Khoa Hà Nội',
    role: 'Tổ chức',
    type: 'organization',
    domain: 'Giáo dục',
    logoUrl: null,
    website: 'https://hust.edu.vn',
    sortOrder: 4,
  },
  {
    name: 'Viettel Group',
    role: 'Tổ chức',
    type: 'organization',
    domain: 'Viễn thông & CNTT',
    logoUrl: null,
    website: 'https://viettel.com.vn',
    sortOrder: 5,
  },
  {
    name: 'VNPT',
    role: 'Tổ chức',
    type: 'organization',
    domain: 'Viễn thông',
    logoUrl: null,
    website: 'https://vnpt.com.vn',
    sortOrder: 6,
  },
  {
    name: 'TMA Solutions',
    role: 'Tổ chức',
    type: 'organization',
    domain: 'Phần mềm outsourcing',
    logoUrl: null,
    website: 'https://tmasolutions.com',
    sortOrder: 7,
  },
  {
    name: 'NTQ Solution',
    role: 'Tổ chức',
    type: 'organization',
    domain: 'Phát triển phần mềm',
    logoUrl: null,
    website: 'https://ntq.com.vn',
    sortOrder: 8,
  },
  {
    name: 'Lak Jinbourg',
    role: 'Tổ chức',
    type: 'advisory',
    domain: 'Tư vấn chiến lược CNTT',
    logoUrl: null,
    website: null,
    sortOrder: 9,
  },
  {
    name: 'Nguyễn Văn A',
    role: 'Cá nhân',
    type: 'individual',
    domain: 'Trí tuệ nhân tạo',
    logoUrl: null,
    website: null,
    sortOrder: 10,
  },
];

async function main(): Promise<void> {
  console.log('Seeding members...');
  let created = 0;
  let skipped = 0;

  for (const member of MEMBERS) {
    const existing = await prisma.member.findFirst({
      where: { name: member.name },
    });
    if (existing) {
      skipped++;
      continue;
    }
    await prisma.member.create({ data: member });
    created++;
    console.log(`  + ${member.name}`);
  }

  console.log(`Done: ${created} created, ${skipped} skipped (already exist).`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
