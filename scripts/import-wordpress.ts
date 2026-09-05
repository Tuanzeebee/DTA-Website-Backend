import {
  ArticleStatus,
  BlockType,
  ImageAlign,
  ImageWrap,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import * as cheerio from 'cheerio';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

const TOPICS = [
  { slug: 'su-kien', name: 'Sự kiện', shortName: 'Sự kiện', sortOrder: 1 },
  { slug: 'digi-tech', name: 'Digi-Tech', shortName: 'Digi-Tech', sortOrder: 2 },
  { slug: 'mai-nha-chung', name: 'Mái Nhà Chung', shortName: 'Mái Nhà Chung', sortOrder: 3 },
  { slug: 'da-nang-24h', name: 'Đà Nẵng 24h', shortName: 'ĐN 24h', sortOrder: 4 },
];

const CATEGORY_TO_TOPIC: Record<string, string> = {
  'Sự kiện': 'su-kien',
  'Tin trong ngành': 'digi-tech',
  'Tin doanh nghiệp': 'digi-tech',
  'Hội Viên': 'mai-nha-chung',
  'Hỗ trợ doanh nghiệp': 'mai-nha-chung',
  'Xã hội': 'da-nang-24h',
  'Đào tạo': 'da-nang-24h',
  Uncategorized: 'da-nang-24h',
};

const BLOCK_TAGS = new Set([
  'p', 'div', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'td', 'tr', 'section', 'article', 'figure',
]);

interface DomNode {
  type: string;
  data?: string;
  tagName?: string;
  attribs?: Record<string, string>;
  children?: DomNode[];
}

interface RawBlock {
  type: 'text' | 'image';
  text?: string;
  src?: string;
  alt?: string;
  featured?: boolean;
}

interface ManifestRecord {
  id: number;
  slug: string;
  title: string;
  date: string;
  modified: string;
  link: string;
  categories: string[];
  featured_image: string | null;
  images: string[];
  excerpt: string;
  content_file: string;
  local_images?: Record<string, string>;
}

interface WpCategory {
  id: number;
  name: string;
  slug: string | null;
}

function toUnix(p: string): string {
  return p.replace(/\\/g, '/');
}

function loadJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

export function parseBlocks(html: string): RawBlock[] {
  const $ = cheerio.load(html || '');
  $('script, style, noscript').remove();

  const blocks: RawBlock[] = [];
  let buf: string[] = [];
  let lastParent: DomNode | null | undefined = undefined;

  const flush = (): void => {
    if (buf.length > 0) {
      const text = buf.filter(Boolean).join('\n\n').trim();
      if (text) {
        blocks.push({ type: 'text', text });
      }
    }
    buf = [];
  };

  const walk = (nodes: DomNode[], blockEl: DomNode | null): void => {
    for (const node of nodes) {
      if (node.type === 'text') {
        const s = (node.data ?? '').replace(/\s+/g, ' ').trim();
        if (!s) continue;
        if (buf.length > 0 && blockEl === lastParent) {
          buf[buf.length - 1] = `${buf[buf.length - 1]} ${s}`.trim();
        } else {
          buf.push(s);
        }
        lastParent = blockEl;
      } else if (node.type === 'tag' && node.tagName) {
        if (node.tagName.toLowerCase() === 'img') {
          flush();
          lastParent = null;
          const attribs = node.attribs ?? {};
          const src = attribs['src'] || attribs['data-src'] || attribs['data-lazy-src'];
          if (src && src.startsWith('http')) {
            blocks.push({ type: 'image', src, alt: attribs['alt'] || '' });
          }
        } else {
          walk(node.children ?? [], BLOCK_TAGS.has(node.tagName.toLowerCase()) ? node : blockEl);
        }
      }
    }
  };

  const rootChildren = ($.root()[0] ?? null) as unknown as DomNode | null;
  walk(rootChildren?.children ?? [], null);
  flush();
  return blocks;
}

export function buildBlocks(
  html: string,
  featured?: string | null,
  title?: string,
): RawBlock[] {
  const blocks = parseBlocks(html);
  if (featured) {
    const inBody = blocks.some((b) => b.type === 'image' && b.src === featured);
    if (!inBody) {
      blocks.unshift({ type: 'image', src: featured, alt: title ?? '', featured: true });
    }
  }
  return blocks;
}

export function buildImageIndex(rootDir: string): Map<string, string[]> {
  const index = new Map<string, string[]>();
  const imagesRoot = path.join(rootDir, 'images');
  if (!fs.existsSync(imagesRoot)) {
    return index;
  }
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

export function resolveLocal(
  url: string | undefined,
  localMap: Record<string, string>,
  index: Map<string, string[]>,
  postSlug: string,
): string | null {
  if (!url) {
    return null;
  }
  const exact = localMap[url];
  if (exact) {
    return exact;
  }
  let name: string;
  try {
    name = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
  } catch {
    return null;
  }
  const candidates = index.get(name);
  if (!candidates || candidates.length === 0) {
    return null;
  }
  if (candidates.length === 1) {
    return candidates[0];
  }
  const prefix = postSlug.slice(0, 60);
  const preferred = candidates.find((c) => c.includes(prefix));
  return preferred ?? candidates[0];
}

function mapRawBlock(
  block: RawBlock,
  position: number,
  localMap: Record<string, string>,
  imgIndex: Map<string, string[]>,
  slug: string,
  stats: { localImages: number },
): Prisma.NewsBlockUncheckedCreateWithoutArticleInput {
  if (block.type === 'image') {
    const localPath = resolveLocal(block.src, localMap, imgIndex, slug);
    if (localPath) {
      stats.localImages += 1;
    }
    return {
      position,
      type: BlockType.IMAGE,
      imageUrl: block.src ?? null,
      imageLocalPath: localPath,
      alt: block.alt ?? null,
      align: ImageAlign.CENTER,
      wrap: ImageWrap.NONE,
      isFeatured: Boolean(block.featured),
    };
  }
  return {
    position,
    type: BlockType.TEXT,
    text: block.text ?? null,
  };
}

async function ensureTaxonomies(categoriesJson: WpCategory[]) {
  for (const [index, topic] of TOPICS.entries()) {
    await prisma.newsTopic.upsert({
      where: { slug: topic.slug },
      update: { name: topic.name, shortName: topic.shortName, sortOrder: topic.sortOrder },
      create: topic,
    });
    console.log(`topic ok: ${topic.slug}`);
  }

  const topicIds = new Map(
    (await prisma.newsTopic.findMany()).map((t) => [t.slug, t.id]),
  );
  const fallbackTopicId = topicIds.get('da-nang-24h');
  if (!fallbackTopicId) {
    throw new Error('Không tìm thấy topic mặc định da-nang-24h');
  }

  const byName = new Map<string, { id: number }>();
  let order = 0;
  for (const cat of categoriesJson) {
    const topicSlug =
      CATEGORY_TO_TOPIC[cat.name] ??
      CATEGORY_TO_TOPIC[cat.slug ?? ''] ??
      'da-nang-24h';
    const topicId = topicIds.get(topicSlug) ?? fallbackTopicId;
    order += 1;
    const existing = await prisma.newsCategory.findUnique({ where: { wpId: cat.id } });
    const saved = await prisma.newsCategory.upsert({
      where: { wpId: cat.id },
      update: { name: cat.name, topicId },
      create: {
        wpId: cat.id,
        slug: cat.slug || `chuyen-muc-${cat.id}`,
        name: cat.name,
        topicId,
        sortOrder: order,
      },
    });
    void existing;
    byName.set(cat.name, saved);
    console.log(`category ok: ${cat.name} -> ${topicSlug}`);
  }
  return byName;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const limitArg = args.indexOf('--limit');
  const exportArg = args.indexOf('--export');
  const limit = limitArg >= 0 ? Number(args[limitArg + 1]) || 0 : 0;
  const rootDir = toUnix(
    (exportArg >= 0
      ? args[exportArg + 1]
      : process.env.EXPORT_DIR || path.join(__dirname, '..', 'craw-data', 'export')) ?? '',
  );
  if (!rootDir || !fs.existsSync(path.join(rootDir, 'manifest.json'))) {
    throw new Error(`Không tìm thấy manifest.json trong ${rootDir}`);
  }

  let manifest = loadJson<ManifestRecord[]>(path.join(rootDir, 'manifest.json'));
  const categoriesJson = loadJson<WpCategory[]>(path.join(rootDir, 'categories.json'));
  if (limit > 0) {
    manifest = manifest.slice(0, limit);
  }
  console.log(`Import ${manifest.length} bài từ ${rootDir}`);

  const categoryByName = await ensureTaxonomies(categoriesJson);
  const fallbackCategory = [...categoryByName.values()].find(Boolean);
  if (!fallbackCategory) {
    throw new Error('Không có danh mục nào trong DB');
  }

  const imgIndex = buildImageIndex(rootDir);
  console.log(`Ảnh local đã index: ${imgIndex.size} tên file`);

  const stats = {
    imported: 0,
    skipped: 0,
    missingContent: 0,
    totalBlocks: 0,
    localImages: 0,
    featuredBlocks: 0,
  };

  for (const [i, rec] of manifest.entries()) {
    const htmlPath = path.join(rootDir, toUnix(rec.content_file));
    const html = fs.existsSync(htmlPath)
      ? fs.readFileSync(htmlPath, 'utf8')
      : null;
    if (!html) {
      stats.missingContent += 1;
    }
    const rawBlocks = html ? buildBlocks(html, rec.featured_image, rec.title) : [];
    const localMap = Object.fromEntries(
      Object.entries(rec.local_images ?? {}).map(([k, v]) => [k, toUnix(v)]),
    );

    const categoryName = rec.categories?.[0] ?? 'Uncategorized';
    const category = categoryByName.get(categoryName) ?? fallbackCategory;

    // Resolve thumbnailUrl to local path if available
    const localThumbnail = resolveLocal(
      rec.featured_image ?? undefined,
      localMap,
      imgIndex,
      rec.slug,
    );

    const base = {
      wpId: rec.id,
      slug: rec.slug,
      title: rec.title,
      summary: rec.excerpt || null,
      thumbnailUrl: localThumbnail || rec.featured_image || null,
      categoryId: category.id,
      sourceUrl: rec.link || null,
      rawHtml: html,
      tags: [] as string[],
      status: ArticleStatus.PUBLISHED,
      publishedAt: rec.date ? new Date(rec.date) : null,
    };
    const blocksCreate = rawBlocks.map((block, position) =>
      mapRawBlock(block, position, localMap, imgIndex, rec.slug, stats),
    );
    const updateData = { ...base, blocks: { deleteMany: {}, create: blocksCreate } };
    const createData = { ...base, blocks: { create: blocksCreate } };

    try {
      await prisma.newsArticle.upsert({
        where: { wpId: rec.id },
        update: updateData,
        create: createData,
      });
      stats.imported += 1;
      stats.totalBlocks += rawBlocks.length;
      stats.featuredBlocks += rawBlocks.some((b) => b.featured) ? 1 : 0;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        stats.skipped += 1;
        console.warn(`! trùng slug, bỏ qua: ${rec.slug}`);
      } else {
        throw error;
      }
    }

    if ((i + 1) % 100 === 0) {
      console.log(`... ${i + 1}/${manifest.length}`);
    }
  }

  console.log('Hoàn tất import vào PostgreSQL.');
  console.log(`  bài import : ${stats.imported}`);
  console.log(`  bỏ qua     : ${stats.skipped}`);
  console.log(`  thiếu HTML : ${stats.missingContent}`);
  console.log(`  tổng block : ${stats.totalBlocks}`);
  console.log(`  ảnh local  : ${stats.localImages}`);
  console.log(`  bài có block featured đầu trang: ${stats.featuredBlocks}`);
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}