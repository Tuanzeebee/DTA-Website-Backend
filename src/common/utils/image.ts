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
