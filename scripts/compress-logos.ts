/**
 * compress-logos.ts — chỉ nén LOGO HỘI VIÊN (Member.logoUrl), không đụng ảnh khác.
 *
 * Logo chỉ hiển thị ~64–75px nên mỗi logo được thu về ≤480px, đổi sang WebP
 * (giữ nền trong suốt), lưu vào uploads/logos/ rồi cập nhật Member.logoUrl:
 *  - logo đã upload (/uploads/…): nén lại, file gốc vẫn giữ để khôi phục.
 *  - logo là link ngoài (website đơn vị): tải về, nén và tự lưu trữ — trang
 *    không còn phụ thuộc/tải ảnh gốc từ site khác mỗi lượt xem.
 * SVG giữ nguyên (ảnh vector, vốn nhẹ). Chỉ cập nhật khi bản mới nhẹ hơn
 * (logo ngoài thì luôn tự lưu trữ).
 *
 * Usage:
 *   npm run logos:compress              # chạy thử: chỉ in kế hoạch
 *   npm run logos:compress -- --write   # ghi file + cập nhật DB
 */

import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import { PrismaClient } from '@prisma/client';

const LOGO_EDGE = 480;
const UPLOADS = path.join(process.cwd(), 'uploads');
const OUT_DIR = path.join(UPLOADS, 'logos');
const write = process.argv.includes('--write');

/** Đọc bytes logo: file trong uploads/ hoặc tải từ link ngoài. */
async function readLogo(url: string): Promise<{ data: Buffer; external: boolean }> {
  if (url.startsWith('/uploads/')) {
    const file = path.join(UPLOADS, url.replace(/^\/uploads\//, ''));
    return { data: fs.readFileSync(file), external: false };
  }
  if (/^https?:\/\//i.test(url)) {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { data: Buffer.from(await res.arrayBuffer()), external: true };
  }
  throw new Error('đường dẫn không hỗ trợ');
}

async function main() {
  const prisma = new PrismaClient();
  const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;
  let before = 0;
  let after = 0;
  let changed = 0;
  try {
    const members = await prisma.member.findMany({
      where: { logoUrl: { not: null } },
      select: { id: true, name: true, logoUrl: true },
    });
    console.log(`${write ? '== NÉN LOGO ==' : '== CHẠY THỬ (thêm --write để ghi) =='} ${members.length} hội viên có logo`);
    if (write) fs.mkdirSync(OUT_DIR, { recursive: true });

    for (const m of members) {
      const url = m.logoUrl!.trim();
      const tag = `  ${m.name}`;
      if (!url || url.startsWith('/uploads/logos/') || /\.svg(\?|$)/i.test(url)) {
        console.log(`${tag}: bỏ qua (${url.startsWith('/uploads/logos/') ? 'đã nén' : 'SVG/trống'})`);
        continue;
      }
      try {
        const { data, external } = await readLogo(url);
        const out = await sharp(data)
          .resize({ width: LOGO_EDGE, height: LOGO_EDGE, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 85, alphaQuality: 100 })
          .toBuffer();
        if (!external && out.length >= data.length) {
          console.log(`${tag}: bỏ qua (đã nhẹ: ${kb(data.length)})`);
          continue;
        }
        // Tên đổi mỗi lần nén: /uploads phục vụ kèm Cache-Control immutable 30 ngày,
        // trùng tên thì trình duyệt/Cloudflare giữ logo CŨ khi đơn vị đổi logo.
        const fileName = `${m.id}-${Date.now()}.webp`;
        const newUrl = `/uploads/logos/${fileName}`;
        console.log(`${tag}: ${kb(data.length)} -> ${kb(out.length)}${external ? ' (tự lưu trữ logo ngoài)' : ''}`);
        before += data.length;
        after += out.length;
        changed += 1;
        if (!write) continue;
        fs.writeFileSync(path.join(OUT_DIR, fileName), out);
        await prisma.member.update({ where: { id: m.id }, data: { logoUrl: newUrl } });
      } catch (error) {
        console.warn(`${tag}: LỖI ${url} — ${(error as Error).message}`);
      }
    }
    console.log(`\n${write ? 'Đã nén' : 'Sẽ nén'} ${changed} logo: ${kb(before)} -> ${kb(after)}`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
