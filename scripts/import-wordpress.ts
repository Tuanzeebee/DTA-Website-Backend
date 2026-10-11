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

/** 5 Main Topic theo kiến trúc thông tin dsa.org.vn (góp ý 05/10/2026). */
const TOPICS = [
  { slug: 'su-kien', name: 'Sự kiện', shortName: 'Sự kiện', nameEn: 'Events', shortEn: 'Events', sortOrder: 1 },
  { slug: 'tin-trong-nganh', name: 'Tin trong ngành', shortName: 'Tin trong ngành', nameEn: 'Industry News', shortEn: 'Industry', sortOrder: 2 },
  { slug: 'dao-tao', name: 'Đào tạo', shortName: 'Đào tạo', nameEn: 'Training', shortEn: 'Training', sortOrder: 3 },
  { slug: 'xa-hoi', name: 'Xã hội', shortName: 'Xã hội', nameEn: 'Society', shortEn: 'Society', sortOrder: 4 },
  { slug: 'hoi-vien', name: 'Hội viên', shortName: 'Hội viên', nameEn: 'Members', shortEn: 'Members', sortOrder: 5 },
];

/** Chuyên mục WP (theo slug) -> Main Topic. */
const CATEGORY_TO_TOPIC: Record<string, string> = {
  'su-kien': 'su-kien',
  'tin-trong-nganh': 'tin-trong-nganh',
  'ho-tro-doanh-nghiep': 'tin-trong-nganh',
  'dao-tao': 'dao-tao',
  'xa-hoi': 'xa-hoi',
  'hoi-vien': 'hoi-vien',
  'tin-doanh-nghiep': 'hoi-vien',
};

/** Đổi tên hiển thị chuyên mục WP (chuẩn hoá chữ hoa). */
const CATEGORY_RENAME: Record<string, string> = { 'hoi-vien': 'Tin hội viên' };

/** Chuyên mục rác của WP — không tạo, bài của nó rơi về FALLBACK_CATEGORY. */
const SKIP_WP_SLUGS = new Set(['uncategorized', 'public']);
const FALLBACK_CATEGORY = 'tin-trong-nganh';

/** Chuyên mục con mới (không có trên DSA), tạo sẵn để đăng bài sau. */
const EXTRA_CATEGORIES = [
  {
    slug: 'san-pham-moi-giai-phap-moi',
    name: 'Sản phẩm mới – Giải pháp mới',
    topic: 'hoi-vien',
    sortOrder: 100,
  },
];

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
  count?: number;
}

/**
 * Bài DSA gắn nhiều chuyên mục. Chuyên mục chính = chuyên mục hiếm nhất
 * (cụ thể nhất) trong số đó; các chuyên mục còn lại là chuyên mục phụ.
 * Trả về slug WP. Bỏ chuyên mục rác; không còn gì thì về FALLBACK_CATEGORY.
 */
export function pickCategories(
  names: string[],
  wpByName: Map<string, WpCategory>,
): { primary: string; secondary: string[] } {
  const cats = [...new Set(names)]
    .map((n) => wpByName.get(n))
    .filter((c): c is WpCategory => !!c && !!c.slug && !SKIP_WP_SLUGS.has(c.slug))
    .sort((a, b) => (a.count ?? 0) - (b.count ?? 0));
  if (cats.length === 0) return { primary: FALLBACK_CATEGORY, secondary: [] };
  const slugs = cats.map((c) => c.slug as string);
  return { primary: slugs[0], secondary: slugs.slice(1) };
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

/** Tạo/cập nhật 5 Main Topic + chuyên mục con. Trả về map slug WP -> id DB. */
async function ensureTaxonomies(categoriesJson: WpCategory[]) {
  for (const topic of TOPICS) {
    await prisma.newsTopic.upsert({
      where: { slug: topic.slug },
      update: topic,
      create: topic,
    });
    console.log(`topic ok: ${topic.slug}`);
  }
  const topicIds = new Map(
    (await prisma.newsTopic.findMany()).map((t) => [t.slug, t.id]),
  );
  const topicId = (slug: string): number => {
    const id = topicIds.get(slug);
    if (!id) throw new Error(`Không tìm thấy topic ${slug}`);
    return id;
  };

  const bySlug = new Map<string, number>();
  let order = 0;
  for (const cat of categoriesJson) {
    if (!cat.slug || SKIP_WP_SLUGS.has(cat.slug)) continue;
    const topicSlug = CATEGORY_TO_TOPIC[cat.slug] ?? FALLBACK_CATEGORY;
    const name = CATEGORY_RENAME[cat.slug] ?? cat.name;
    order += 1;
    const saved = await prisma.newsCategory.upsert({
      where: { wpId: cat.id },
      update: { name, topicId: topicId(topicSlug), sortOrder: order },
      create: {
        wpId: cat.id,
        slug: cat.slug,
        name,
        topicId: topicId(topicSlug),
        sortOrder: order,
      },
    });
    bySlug.set(cat.slug, saved.id);
    console.log(`category ok: ${name} -> ${topicSlug}`);
  }
  for (const extra of EXTRA_CATEGORIES) {
    const saved = await prisma.newsCategory.upsert({
      where: { slug: extra.slug },
      update: { name: extra.name, topicId: topicId(extra.topic) },
      create: {
        slug: extra.slug,
        name: extra.name,
        topicId: topicId(extra.topic),
        sortOrder: extra.sortOrder,
      },
    });
    bySlug.set(extra.slug, saved.id);
    console.log(`category ok: ${extra.name} -> ${extra.topic}`);
  }

  return bySlug;
}

/** Sau khi gán lại bài: xoá chuyên mục rác WP và chủ đề cũ nếu đã rỗng. */
async function cleanupTaxonomies() {
  const junk = await prisma.newsCategory.findMany({
    where: { slug: { in: [...SKIP_WP_SLUGS] } },
    include: { _count: { select: { articles: true } } },
  });
  for (const c of junk) {
    if (c._count.articles === 0) {
      await prisma.newsCategory.delete({ where: { id: c.id } });
      console.log(`danh mục rác đã xoá: ${c.slug}`);
    } else {
      console.warn(`! danh mục ${c.slug} còn ${c._count.articles} bài (không phải bài DSA) — chuyển tay`);
    }
  }

  // Dọn chủ đề cũ (Digi-Tech, Mái Nhà Chung, ĐN 24h...) khi đã rỗng.
  const keep = TOPICS.map((t) => t.slug);
  const stale = await prisma.newsTopic.findMany({
    where: { slug: { notIn: keep } },
    include: { _count: { select: { categories: true } } },
  });
  for (const t of stale) {
    if (t._count.categories === 0) {
      await prisma.newsTopic.delete({ where: { id: t.id } });
      console.log(`topic cũ đã xoá: ${t.slug}`);
    } else {
      console.warn(
        `! topic cũ ${t.slug} còn ${t._count.categories} danh mục do admin tạo — chuyển tay rồi xoá`,
      );
    }
  }
}

/**
 * "Kéo sạch": chỉ giữ ảnh đã tải về máy (phục vụ qua /news-images). Ảnh không
 * có bản local (404 ở site gốc, hotlink ngoài) bị bỏ để không hiện ảnh vỡ.
 */
function splitLocalImages(
  blocks: RawBlock[],
  localMap: Record<string, string>,
  index: Map<string, string[]>,
  postSlug: string,
): { kept: RawBlock[]; dropped: string[] } {
  const dropped: string[] = [];
  const kept = blocks.filter((b) => {
    if (b.type !== 'image' || resolveLocal(b.src, localMap, index, postSlug)) {
      return true;
    }
    dropped.push(b.src ?? '');
    return false;
  });
  return { kept, dropped };
}

function loadRecord(rootDir: string, rec: ManifestRecord) {
  const htmlPath = path.join(rootDir, toUnix(rec.content_file));
  const html = fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, 'utf8') : null;
  const localMap = Object.fromEntries(
    Object.entries(rec.local_images ?? {}).map(([k, v]) => [k, toUnix(v)]),
  );
  const rawBlocks = html ? buildBlocks(html, rec.featured_image, rec.title) : [];
  return { html, localMap, rawBlocks };
}

/** Lưu danh sách ảnh bị bỏ vào <export>/khong-hien-thi/ để Hiệp hội tra cứu. */
function writeDroppedReport(rootDir: string, dropped: { post: string; url: string }[]) {
  const dir = path.join(rootDir, 'khong-hien-thi');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'anh-khong-hien-thi.json');
  fs.writeFileSync(file, JSON.stringify(dropped, null, 2), 'utf8');
  console.log(`  ảnh bỏ (không có bản local): ${dropped.length} -> ${toUnix(file)}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const limitArg = args.indexOf('--limit');
  const exportArg = args.indexOf('--export');
  const limit = limitArg >= 0 ? Number(args[limitArg + 1]) || 0 : 0;
  const dryRun = args.includes('--dry-run');
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

  const wpByName = new Map(categoriesJson.map((c) => [c.name, c]));
  const imgIndex = buildImageIndex(rootDir);
  console.log(`Ảnh local đã index: ${imgIndex.size} tên file`);
  const dropped: { post: string; url: string }[] = [];
  if (dryRun) {
    for (const rec of manifest) {
      const { localMap, rawBlocks } = loadRecord(rootDir, rec);
      for (const url of splitLocalImages(rawBlocks, localMap, imgIndex, rec.slug).dropped) {
        dropped.push({ post: rec.slug, url });
      }
    }
    writeDroppedReport(rootDir, dropped);
    // Không đụng DB: in số bài mỗi chuyên mục (chính / chính+phụ).
    const primary = new Map<string, number>();
    const any = new Map<string, number>();
    for (const rec of manifest) {
      const { primary: p, secondary } = pickCategories(rec.categories ?? [], wpByName);
      primary.set(p, (primary.get(p) ?? 0) + 1);
      for (const c of [p, ...secondary]) any.set(c, (any.get(c) ?? 0) + 1);
    }
    for (const [slug, n] of [...any].sort((a, b) => b[1] - a[1])) {
      const topic = CATEGORY_TO_TOPIC[slug] ?? FALLBACK_CATEGORY;
      console.log(`${topic.padEnd(16)} ${slug.padEnd(22)} chinh=${primary.get(slug) ?? 0}  hien-thi=${n}`);
    }
    return;
  }

  const categoryIds = await ensureTaxonomies(categoriesJson);
  const categoryId = (slug: string): number => {
    const id = categoryIds.get(slug) ?? categoryIds.get(FALLBACK_CATEGORY);
    if (!id) throw new Error(`Không có danh mục ${slug}`);
    return id;
  };

  const stats = {
    imported: 0,
    skipped: 0,
    missingContent: 0,
    totalBlocks: 0,
    localImages: 0,
    featuredBlocks: 0,
  };

  for (const [i, rec] of manifest.entries()) {
    const loaded = loadRecord(rootDir, rec);
    const { html, localMap } = loaded;
    if (!html) {
      stats.missingContent += 1;
    }
    const split = splitLocalImages(loaded.rawBlocks, localMap, imgIndex, rec.slug);
    const rawBlocks = split.kept;
    for (const url of split.dropped) dropped.push({ post: rec.slug, url });

    const picked = pickCategories(rec.categories ?? [], wpByName);

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
      thumbnailUrl: localThumbnail || null,
      categoryId: categoryId(picked.primary),
      secondaryCategoryIds: picked.secondary.map(categoryId),
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
  writeDroppedReport(rootDir, dropped);
  await cleanupTaxonomies();
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}