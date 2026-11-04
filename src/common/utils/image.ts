import { readFile, unlink, writeFile } from 'fs/promises';
import { basename } from 'path';
import sharp from 'sharp';

/** Cạnh dài tối đa: đủ nét cho ảnh bìa full-width, nhẹ hơn nhiều so với ảnh chụp gốc. */
export const MAX_IMAGE_EDGE = 1920;

export const fitInside = {
  width: MAX_IMAGE_EDGE,
  height: MAX_IMAGE_EDGE,
  fit: 'inside',
  withoutEnlargement: true,
} as const;

/**
 * Ảnh vừa upload -> WebP ≤1920px, xoá file gốc. Trả về tên file mới.
 * GIF giữ nguyên (có thể là ảnh động).
 */
export async function toWebp(file: Express.Multer.File): Promise<string> {
  if (file.mimetype === 'image/gif') return file.filename;
  // Đọc vào buffer: input .webp trùng đường dẫn output, và tránh khoá file trên Windows.
  const out = await sharp(await readFile(file.path))
    .rotate()
    .resize(fitInside)
    .webp({ quality: 80 })
    .toBuffer();
  const outPath = file.path.replace(/\.[^.\\/]+$/, '') + '.webp';
  await writeFile(outPath, out);
  if (outPath !== file.path) await unlink(file.path);
  return basename(outPath);
}

/** Bản thu nhỏ đặt cạnh ảnh gốc: abc.webp -> abc.thumb.webp. */
export const thumbPathOf = (filePath: string) =>
  filePath.replace(/\.[^.\\/]+$/, '') + '.thumb.webp';

/**
 * Ảnh thu nhỏ ≤640px cho lưới/banner (Thư viện ảnh hiển thị 288×192): trình
 * duyệt giải mã ít điểm ảnh hơn ~5–8 lần → cuộn qua không giật. Ảnh gốc vẫn
 * dùng cho xem phóng to.
 */
export async function writeThumb(filePath: string): Promise<void> {
  const out = await sharp(await readFile(filePath))
    .rotate()
    .resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 78 })
    .toBuffer();
  await writeFile(thumbPathOf(filePath), out);
}
