/**
 * fix-thumbnail-urls.ts
 *
 * One-time migration: resolve all external thumbnailUrl values to local paths.
 * Reads manifest.json + local_images mapping, updates DB rows in bulk.
 *
 * Usage: npx ts-node scripts/fix-thumbnail-urls.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function toUnix(p: string): string {
  return p.replace(/\\/g, '/');
}

/** Build filename → [relativePath] index from export/images/ directory. */
function buildImageIndex(rootDir: string): Map<string, string[]> {
  const index = new Map<string, string[]>();
  const imagesRoot = path.join(rootDir, 'images');
  if (!fs.existsSync(imagesRoot)) return index;

  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        const rel = toUnix(path.relative(rootDir, full));
        const list = index.get(entry.name) ?? [];
        list.push(rel);
        index.set(entry.name, list);
      }
    }
  };
  walk(imagesRoot);
  return index;
}

/** Try to find local file for an external URL using manifest local_images + filename index. */
function resolveLocal(
  url: string | undefined,
  localMap: Record<string, string>,
  index: Map<string, string[]>,
  postSlug: string,
): string | null {
  if (!url) return null;

  // Exact URL match in local_images
  const exact = localMap[url];
  if (exact) return toUnix(extractImagePath(exact));

  // Extract filename and search index
  let name: string;
  try {
    name = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
  } catch {
    return null;
  }
  const candidates = index.get(name);
  if (!candidates || candidates.length === 0) return null;
  if (candidates.length === 1) return extractImagePath(candidates[0]);

  // Prefer path containing the post slug
  const prefix = postSlug.slice(0, 60);
  const preferred = candidates.find((c) => c.includes(prefix));
  return extractImagePath(preferred ?? candidates[0]);
}

/** Extract the part after 'images/' for the DB path. */
function extractImagePath(relativePath: string): string {
  // relativePath is like "images/cat/slug/file.jpg"
  // We want to store "images/cat/slug/file.jpg" (same as imageLocalPath format)
  return relativePath;
}

interface ManifestRecord {
  id: number;
  slug: string;
  featured_image?: string | null;
  local_images?: Record<string, string>;
}

async function main() {
  const rootDir = toUnix(process.env.EXPORT_DIR || path.join(__dirname, '..', 'craw-data', 'export'));
  const manifestPath = path.join(rootDir, 'manifest.json');

  if (!fs.existsSync(manifestPath)) {
    console.error(`Không tìm thấy manifest.json tại ${manifestPath}`);
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as ManifestRecord[];
  console.log(`Manifest: ${manifest.length} bài viết`);

  const imgIndex = buildImageIndex(rootDir);
  console.log(`Image index: ${imgIndex.size} tên file`);

  // Build a lookup: slug → manifest record
  const manifestBySlug = new Map<string, ManifestRecord>();
  for (const rec of manifest) {
    manifestBySlug.set(rec.slug, rec);
  }

  // Find all articles with external thumbnail URLs
  const articles = await prisma.newsArticle.findMany({
    where: { thumbnailUrl: { contains: 'http' } },
    select: { id: true, slug: true, thumbnailUrl: true, wpId: true },
  });
  console.log(`\nArticles với URL ngoài: ${articles.length}`);

  let updated = 0;
  let notFound = 0;

  for (const article of articles) {
    const rec = manifestBySlug.get(article.slug);
    if (!rec) {
      notFound++;
      continue;
    }

    const localMap = Object.fromEntries(
      Object.entries(rec.local_images ?? {}).map(([k, v]) => [k, toUnix(v)]),
    );

    const localPath = resolveLocal(
      rec.featured_image ?? undefined,
      localMap,
      imgIndex,
      rec.slug,
    );

    if (localPath) {
      await prisma.newsArticle.update({
        where: { id: article.id },
        data: { thumbnailUrl: localPath },
      });
      updated++;
      if (updated % 100 === 0) {
        console.log(`  ... ${updated}/${articles.length}`);
      }
    } else {
      notFound++;
    }
  }

  console.log(`\nKết quả:`);
  console.log(`  Đã cập nhật: ${updated}`);
  console.log(`  Không tìm thấy local: ${notFound}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
