/**
 * gallery-thumbs.ts — tạo ảnh thu nhỏ (≤640px, .thumb.webp) cho ảnh Thư viện
 * ảnh đã upload trước khi có tính năng này. Ảnh upload mới tự có thumbnail.
 *
 * Banner trang chủ hiển thị ảnh 288×192 nhưng ảnh gốc tới 1600–2000px: giải mã
 * ảnh gốc khi cuộn tới gây giật. Ảnh gốc giữ nguyên (dùng khi xem phóng to).
 * Chạy lại an toàn: ảnh đã có thumbnail thì bỏ qua.
 *
 * Usage: npm run gallery:thumbs
 */

import * as fs from 'fs';
import * as path from 'path';
import { thumbPathOf, writeThumb } from '../src/common/utils/image';

const DIR = path.join(process.cwd(), 'uploads', 'gallery');

async function main() {
  if (!fs.existsSync(DIR)) {
    console.log(`Không có thư mục ${DIR}`);
    return;
  }
  let made = 0;
  let skipped = 0;
  for (const name of fs.readdirSync(DIR)) {
    if (!/\.(jpe?g|png|webp)$/i.test(name) || name.endsWith('.thumb.webp')) continue;
    const file = path.join(DIR, name);
    if (fs.existsSync(thumbPathOf(file))) {
      skipped += 1;
      continue;
    }
    try {
      await writeThumb(file);
      made += 1;
      console.log(`  ${name}: ${Math.round(fs.statSync(file).size / 1024)} KB -> ${Math.round(fs.statSync(thumbPathOf(file)).size / 1024)} KB`);
    } catch (error) {
      console.warn(`  ${name}: LỖI — ${(error as Error).message}`);
    }
  }
  console.log(`\nĐã tạo ${made} thumbnail, bỏ qua ${skipped} ảnh đã có.`);
}

void main();
