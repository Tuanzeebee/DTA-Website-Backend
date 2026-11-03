/**
 * compress-images.ts
 *
 * Nén ảnh đã có (ảnh crawl + ảnh upload cũ) TẠI CHỖ: resize ≤1920px, giữ nguyên
 * tên & định dạng nên URL trong DB không đổi. Chỉ ghi khi file mới nhỏ hơn.
 * Ảnh upload mới đã tự đổi sang WebP (src/common/utils/image.ts).
 *
 * Mặc định chỉ thống kê. Sao lưu thư mục ảnh trước khi chạy --write.
 *
 * Usage: npx ts-node scripts/compress-images.ts [--write] [dir ...]
 *   (mặc định: $EXPORT_DIR/images và ./uploads)
 */

import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import { fitInside } from '../src/common/utils/image';

if (fs.existsSync('.env')) process.loadEnvFile('.env');

const MIN_BYTES = 300 * 1024;
const write = process.argv.includes('--write');
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const dirs = args.length
  ? args
  : [
      path.join(process.env.EXPORT_DIR ?? './craw-data/export', 'images'),
      path.join(process.cwd(), 'uploads'),
    ];

function* walk(dir: string): Generator<string> {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (/\.(jpe?g|png|webp)$/i.test(e.name)) yield full;
  }
}

async function compress(file: string): Promise<Buffer> {
  const img = sharp(fs.readFileSync(file)).rotate().resize(fitInside);
  const ext = path.extname(file).toLowerCase();
  if (ext === '.png') return img.png({ palette: true, quality: 90, compressionLevel: 9 }).toBuffer();
  if (ext === '.webp') return img.webp({ quality: 80 }).toBuffer();
  return img.jpeg({ quality: 80, mozjpeg: true }).toBuffer();
}

async function main() {
  let before = 0;
  let after = 0;
  let changed = 0;
  let failed = 0;
  for (const dir of dirs) {
    for (const file of walk(dir)) {
      const size = fs.statSync(file).size;
      if (size < MIN_BYTES) continue;
      try {
        const out = await compress(file);
        if (out.length >= size) continue;
        before += size;
        after += out.length;
        changed += 1;
        if (write) fs.writeFileSync(file, out);
      } catch (error) {
        failed += 1;
        console.warn(`! lỗi ${file}: ${(error as Error).message}`);
      }
    }
  }
  const mb = (n: number) => (n / 1024 / 1024).toFixed(1);
  console.log(`${write ? 'Đã nén' : 'Sẽ nén (chạy lại với --write để ghi)'}: ${changed} ảnh`);
  console.log(`  ${mb(before)} MB -> ${mb(after)} MB, lỗi: ${failed}`);
}

void main();
