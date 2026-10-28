import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ArticleStatus, ImageAlign, ImageWrap, Prisma } from '@prisma/client';
import {
  hasPermission,
  isMemberOnly,
  MEMBER_TOPIC_SLUG,
  Permission,
} from '../common/permissions';
import type { AuthUser } from '../common/permissions';
import { slugify } from '../common/utils/slugify';
import { PrismaService } from '../prisma/prisma.service';
import {
  AdminQueryArticlesDto,
  ArticleBlockDto,
  CreateArticleDto,
  QueryArticlesDto,
  UpdateArticleDto,
} from './dto/article.dto';

/* ------------------------------------------------------------------ *
 *  Simple in-memory TTL cache for public endpoints                    *
 *  Reduces DB load under high concurrent traffic.                     *
 * ------------------------------------------------------------------ */

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const CACHE_TTL_MS = 60_000; // 60 seconds

class MemoryCache {
  private store = new Map<string, CacheEntry<unknown>>();

  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.data as T;
  }

  set<T>(key: string, data: T): void {
    this.store.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  }

  invalidate(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
  }

  clear(): void {
    this.store.clear();
  }
}

const detailInclude = {
  blocks: { orderBy: { position: 'asc' as const } },
  category: { include: { topic: true } },
  author: { select: { id: true, fullName: true } },
};

type ArticleWithRelations = Prisma.NewsArticleGetPayload<{
  include: typeof detailInclude;
}>;

@Injectable()
export class ArticlesService {
  private cache = new MemoryCache();

  constructor(private readonly prisma: PrismaService) {}

  async listPublished(query: QueryArticlesDto) {
    const cacheKey = `list:${JSON.stringify(query)}`;
    const cached = this.cache.get<Record<string, unknown>>(cacheKey);
    if (cached) return cached;

    const where = await this.buildPublicWhere(query);
    const orderBy: Prisma.NewsArticleOrderByWithRelationInput =
      query.flag === 'upcoming'
        ? { eventStartAt: 'asc' } // sự kiện gần nhất lên đầu
        : query.sort === 'oldest'
        ? { publishedAt: 'asc' }
        : query.sort === 'views'
          ? { viewsCount: 'desc' }
          : { publishedAt: 'desc' };
    const [total, rows] = await Promise.all([
      this.prisma.newsArticle.count({ where }),
      this.prisma.newsArticle.findMany({
        where,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          category: { include: { topic: true } },
          author: { select: { fullName: true } },
        },
      }),
    ]);
    const result = {
      items: rows.map((row) => this.toListItem(row)),
      total,
      page: query.page,
      pageCount: Math.max(1, Math.ceil(total / query.pageSize)),
    };
    this.cache.set(cacheKey, result);
    return result;
  }

  async getPublishedBySlug(slug: string) {
    const cacheKey = `detail:${slug}`;
    const cached = this.cache.get<Record<string, unknown>>(cacheKey);
    if (cached) {
      // still increment views (fire-and-forget)
      this.prisma.newsArticle
        .update({ where: { id: (cached as { id: string }).id }, data: { viewsCount: { increment: 1 } } })
        .catch(() => {});
      return cached;
    }
    const article = await this.prisma.newsArticle.findFirst({
      where: { slug, status: ArticleStatus.PUBLISHED, deletedAt: null },
      select: { id: true },
    });
    if (!article) {
      throw new NotFoundException('Không tìm thấy bài viết');
    }
    // Atomic increment — no race condition on concurrent reads
    await this.prisma.newsArticle.update({
      where: { id: article.id },
      data: { viewsCount: { increment: 1 } },
    });
    // Re-read with full relations for the response
    const full = await this.prisma.newsArticle.findFirst({
      where: { slug, status: ArticleStatus.PUBLISHED, deletedAt: null },
      include: detailInclude,
    });
    const result = this.toDetail(full!);
    this.cache.set(cacheKey, result);
    return result;
  }

  async adminList(query: AdminQueryArticlesDto, actor: AuthUser) {
    const where: Prisma.NewsArticleWhereInput = { deletedAt: null };
    if (query.status) {
      where.status = query.status;
    }
    if (query.mine) {
      where.authorId = actor.id;
    }
    const and: Prisma.NewsArticleWhereInput[] = [];
    const catFilter = await this.categoryFilter(query.category, query.topic);
    if (catFilter) and.push(catFilter);
    if (query.q) {
      and.push({
        OR: [
          { title: { contains: query.q, mode: 'insensitive' } },
          { summary: { contains: query.q, mode: 'insensitive' } },
        ],
      });
    }
    if (and.length) where.AND = and;
    const orderBy: Prisma.NewsArticleOrderByWithRelationInput = {
      updatedAt: 'desc',
    };
    const [total, rows] = await Promise.all([
      this.prisma.newsArticle.count({ where }),
      this.prisma.newsArticle.findMany({
        where,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          category: { include: { topic: true } },
          author: { select: { fullName: true } },
        },
      }),
    ]);
    return {
      items: rows.map((row) => ({
        ...this.toListItem(row),
        status: row.status,
        updatedAt: row.updatedAt,
        wpId: row.wpId,
      })),
      total,
      page: query.page,
      pageCount: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  async findOneForAdmin(id: string, actor: AuthUser) {
    const article = await this.prisma.newsArticle.findFirst({
      where: { id, deletedAt: null },
      include: detailInclude,
    });
    if (!article) {
      throw new NotFoundException('Không tìm thấy bài viết');
    }
    const canUpdateAny = hasPermission(actor, Permission.ARTICLE_UPDATE_ANY);
    // null authorId = system-imported article (crawl data) → any staff user can manage (not members)
    const isSystemOwned = article.authorId === null && !isMemberOnly(actor);
    if (!canUpdateAny && !isSystemOwned && article.authorId !== actor.id) {
      throw new ForbiddenException('Bạn chỉ có thể xem bài viết của mình');
    }
    return { ...this.toDetail(article), rawHtml: article.rawHtml };
  }

  async create(dto: CreateArticleDto, actor: AuthUser) {
    ensureEventRange(dto.eventStartAt, dto.eventEndAt);
    await this.ensureCategory(dto.categoryId, actor);
    const canPublish =
      dto.status === ArticleStatus.PUBLISHED &&
      hasPermission(actor, Permission.ARTICLE_PUBLISH);
    const slug = await this.uniqueSlug(dto.slug?.trim() || slugify(dto.title));
    const created = await this.prisma.newsArticle.create({
      data: {
        slug,
        title: dto.title,
        summary: dto.summary,
        thumbnailUrl: dto.thumbnailUrl,
        sourceUrl: dto.sourceUrl,
        rawHtml: dto.rawHtml,
        tags: dto.tags ?? [],
        pdfUrl: dto.pdfUrl,
        memberUrl: dto.memberUrl,
        isIntern: dto.isIntern ?? false,
        eventStartAt: dto.eventStartAt,
        eventEndAt: dto.eventEndAt,
        eventPostponed: dto.eventPostponed ?? false,
        categoryId: dto.categoryId,
        authorId: actor.id,
        authorName: dto.author?.trim(),
        status: canPublish ? ArticleStatus.PUBLISHED : ArticleStatus.DRAFT,
        publishedAt: dto.publishedAt ?? (canPublish ? new Date() : null),
        blocks: dto.blocks
          ? { create: dto.blocks.map((block, index) => mapBlock(block, index)) }
          : undefined,
      },
      include: detailInclude,
    });
    this.invalidateCache();
    return this.toDetail(created);
  }

  async update(id: string, dto: UpdateArticleDto, actor: AuthUser) {
    ensureEventRange(dto.eventStartAt, dto.eventEndAt);
    const article = await this.findExisting(id);
    // null authorId = system-imported article (crawl data) → any staff user can manage (not members)
    const isSystemOwned = article.authorId === null && !isMemberOnly(actor);
    const isOwner = article.authorId === actor.id;
    const canUpdate =
      hasPermission(actor, Permission.ARTICLE_UPDATE_ANY) ||
      isSystemOwned ||
      (isOwner && hasPermission(actor, Permission.ARTICLE_UPDATE_OWN));
    if (!canUpdate) {
      throw new ForbiddenException('Bạn không có quyền sửa bài viết này');
    }
    if (
      dto.status &&
      dto.status !== article.status &&
      !hasPermission(actor, Permission.ARTICLE_PUBLISH)
    ) {
      throw new ForbiddenException(
        'Bạn không có quyền thay đổi trạng thái bài viết',
      );
    }
    let slug = article.slug;
    if (dto.slug !== undefined && dto.slug !== article.slug) {
      slug = await this.uniqueSlug(slugify(dto.slug), id);
    }
    if (dto.categoryId !== undefined) {
      await this.ensureCategory(dto.categoryId, actor);
    }
    const updated = await this.prisma.newsArticle.update({
      where: { id },
      data: {
        title: dto.title,
        slug,
        authorName: dto.author?.trim(),
        summary: dto.summary,
        thumbnailUrl: dto.thumbnailUrl,
        sourceUrl: dto.sourceUrl,
        rawHtml: dto.rawHtml,
        tags: dto.tags,
        pdfUrl: dto.pdfUrl,
        memberUrl: dto.memberUrl,
        isIntern: dto.isIntern,
        eventStartAt: dto.eventStartAt,
        eventEndAt: dto.eventEndAt,
        eventPostponed: dto.eventPostponed,
        categoryId: dto.categoryId,
        status: dto.status,
        publishedAt: dto.publishedAt,
        blocks: dto.blocks
          ? {
              deleteMany: {},
              create: dto.blocks.map((block, index) => mapBlock(block, index)),
            }
          : undefined,
      },
      include: detailInclude,
    });
    this.invalidateCache();
    return this.toDetail(updated);
  }

  async remove(id: string, actor: AuthUser) {
    const article = await this.findExisting(id);
    // null authorId = system-imported article (crawl data) → any staff user can manage (not members)
    const isSystemOwned = article.authorId === null && !isMemberOnly(actor);
    const isOwner = article.authorId === actor.id;
    const canDelete =
      hasPermission(actor, Permission.ARTICLE_DELETE_ANY) ||
      isSystemOwned ||
      (isOwner && hasPermission(actor, Permission.ARTICLE_DELETE_OWN));
    if (!canDelete) {
      throw new ForbiddenException('Bạn không có quyền xóa bài viết này');
    }
    await this.prisma.newsArticle.update({
      where: { id },
      data: { deletedAt: new Date(), status: ArticleStatus.ARCHIVED },
    });
    this.invalidateCache();
    return { id, deleted: true };
  }

  async setPublished(id: string, published: boolean, actor: AuthUser) {
    if (!hasPermission(actor, Permission.ARTICLE_PUBLISH)) {
      throw new ForbiddenException('Bạn không có quyền xuất bản bài viết');
    }
    const article = await this.findExisting(id);
    const updated = await this.prisma.newsArticle.update({
      where: { id },
      data: {
        status: published ? ArticleStatus.PUBLISHED : ArticleStatus.DRAFT,
        publishedAt: published ? (article.publishedAt ?? new Date()) : null,
      },
      include: detailInclude,
    });
    this.invalidateCache();
    return this.toDetail(updated);
  }

  /**
   * Single-call digest: returns latest N articles for each requested topic.
   * Reduces N separate API calls into 1.
   */
  async getDigest(topicSlugs: string[], pageSize: number) {
    const cacheKey = `digest:${topicSlugs.join(',')}:${pageSize}`;
    const cached = this.cache.get<Record<string, unknown>>(cacheKey);
    if (cached) return cached;

    const groups = await Promise.all(
      topicSlugs.map(async (slug) => {
        const catFilter = await this.categoryFilter(undefined, slug);
        const rows = await this.prisma.newsArticle.findMany({
          where: {
            status: ArticleStatus.PUBLISHED,
            deletedAt: null,
            ...catFilter,
          },
          orderBy: { publishedAt: 'desc' },
          take: pageSize,
          include: {
            category: { include: { topic: true } },
            author: { select: { fullName: true } },
          },
        });
        return { topic: slug, items: rows.map((r) => this.toListItem(r)) };
      }),
    );

    const result = Object.fromEntries(groups.map((g) => [g.topic, g.items]));
    this.cache.set(cacheKey, result);
    return result;
  }

  /** Invalidate all public cache entries (call after any admin mutation). */
  private invalidateCache(): void {
    this.cache.clear();
  }

  /**
   * Lọc theo chuyên mục (ưu tiên) hoặc chủ đề — CHỈ chuyên mục chính.
   * secondaryCategoryIds (bài DSA gắn nhiều chuyên mục) không dùng để lọc nữa:
   * nó làm 1 bài hiện lẫn ở nhiều chủ đề (góp ý 28/10/2026).
   */
  private async categoryFilter(
    category?: string,
    topic?: string,
  ): Promise<Prisma.NewsArticleWhereInput | null> {
    if (!category && !topic) return null;
    const cats = await this.prisma.newsCategory.findMany({
      where: category ? { slug: category } : { topic: { slug: topic } },
      select: { id: true },
    });
    return { categoryId: { in: cats.map((c) => c.id) } };
  }

  private async buildPublicWhere(
    query: QueryArticlesDto,
  ): Promise<Prisma.NewsArticleWhereInput> {
    const where: Prisma.NewsArticleWhereInput = {
      status: ArticleStatus.PUBLISHED,
      deletedAt: null,
    };
    const and: Prisma.NewsArticleWhereInput[] = [];
    const catFilter = await this.categoryFilter(query.category, query.topic);
    if (catFilter) and.push(catFilter);
    if (query.flag === 'intern') {
      where.isIntern = true;
    }
    if (query.flag === 'upcoming') {
      // Sắp/đang diễn ra: chưa qua giờ kết thúc; không nhập kết thúc thì hết ngày
      // bắt đầu (giờ VN). Bỏ bài tạm hoãn và bài không có lịch.
      and.push({
        eventPostponed: false,
        OR: [
          { eventEndAt: { gte: new Date() } },
          { eventEndAt: null, eventStartAt: { gte: startOfTodayVn() } },
        ],
      });
    }
    if (query.q) {
      and.push({
        OR: [
          { title: { contains: query.q, mode: 'insensitive' } },
          { summary: { contains: query.q, mode: 'insensitive' } },
        ],
      });
    }
    if (and.length) where.AND = and;
    return where;
  }

  private async findExisting(id: string) {
    const article = await this.prisma.newsArticle.findFirst({
      where: { id, deletedAt: null },
    });
    if (!article) {
      throw new NotFoundException('Không tìm thấy bài viết');
    }
    return article;
  }

  private async ensureCategory(categoryId: number, actor: AuthUser) {
    const category = await this.prisma.newsCategory.findUnique({
      where: { id: categoryId },
      include: { topic: { select: { slug: true } } },
    });
    if (!category) {
      throw new BadRequestException('Danh mục không tồn tại');
    }
    if (isMemberOnly(actor) && category.topic.slug !== MEMBER_TOPIC_SLUG) {
      throw new ForbiddenException(
        'Hội viên chỉ được đăng bài trong chủ đề Hội viên',
      );
    }
  }

  private async uniqueSlug(base: string, excludeId?: string): Promise<string> {
    const clean = base.replace(/^-+|-+$/g, '') || 'bai-viet';
    let candidate = clean;
    let counter = 2;
    for (;;) {
      const existing = await this.prisma.newsArticle.findUnique({
        where: { slug: candidate },
      });
      if (!existing || existing.id === excludeId) {
        return candidate;
      }
      candidate = `${clean}-${counter}`;
      counter += 1;
    }
  }

  private toListItem(article: {
    id: string;
    slug: string;
    title: string;
    authorName?: string | null;
    summary: string | null;
    thumbnailUrl: string | null;
    tags: string[];
    viewsCount: number;
    isIntern: boolean;
    publishedAt: Date | null;
    eventStartAt: Date | null;
    eventEndAt: Date | null;
    eventPostponed: boolean;
    category: {
      slug: string;
      name: string;
      topic: { slug: string; name: string };
    };
    author?: { fullName: string | null } | null;
  }) {
    return {
      id: article.id,
      slug: article.slug,
      title: article.title,
      summary: article.summary,
      image: resolveThumbnailUrl(article.thumbnailUrl),
      topic: article.category.topic.slug,
      topicName: article.category.topic.name,
      category: article.category.slug,
      categoryName: article.category.name,
      date: article.publishedAt,
      tags: article.tags,
      views: article.viewsCount,
      isIntern: article.isIntern,
      eventStartAt: article.eventStartAt,
      eventEndAt: article.eventEndAt,
      eventPostponed: article.eventPostponed,
      author: article.authorName ?? article.author?.fullName ?? null,
    };
  }

  private toDetail(article: ArticleWithRelations) {
    return {
      ...this.toListItem(article),
      pdfUrl: article.pdfUrl,
      memberUrl: article.memberUrl,
      sourceUrl: article.sourceUrl,
      status: article.status,
      publishedAt: article.publishedAt,
      createdAt: article.createdAt,
      updatedAt: article.updatedAt,
      blocks: article.blocks.map((block) => {
        if (block.type === 'TEXT') {
          return block.text ?? '';
        }
        if (block.type === 'IMAGE') {
          return {
            src: resolveImageUrl(block.imageLocalPath, block.imageUrl),
            caption: block.caption,
            align: block.align.toLowerCase(),
            wrap: block.wrap.toLowerCase(),
            width: block.width,
          };
        }
        return { box: block.text ?? '' };
      }),
    };
  }
}

/** 00:00 hôm nay theo giờ Việt Nam (UTC+7, không đổi giờ), bất kể múi giờ server. */
function startOfTodayVn(now = Date.now()): Date {
  const VN = 7 * 3600_000;
  const DAY = 86400_000;
  return new Date(Math.floor((now + VN) / DAY) * DAY - VN);
}

/** Ngày kết thúc không được trước ngày bắt đầu (khi gửi cả hai). */
function ensureEventRange(start?: Date | null, end?: Date | null) {
  if (start && end && new Date(end) < new Date(start)) {
    throw new BadRequestException(
      'Ngày kết thúc sự kiện phải sau ngày bắt đầu',
    );
  }
}

function mapBlock(block: ArticleBlockDto, position: number) {
  return {
    position,
    type: block.type,
    text: block.text,
    imageUrl: block.imageUrl,
    imageLocalPath: block.imageLocalPath,
    alt: block.alt,
    caption: block.caption,
    align: block.align ?? ImageAlign.CENTER,
    wrap: block.wrap ?? ImageWrap.NONE,
    width: block.width,
    isFeatured: block.isFeatured ?? false,
  };
}

/**
 * Resolve an image path to a serveable URL.
 * - Admin uploads: `/uploads/news/xxx.jpg` (already a full path)
 * - WordPress import: `images/cat/slug/file.jpg` → `/news-images/cat/slug/file.jpg`
 * - External URL fallback: return as-is
 */
function resolveImageUrl(
  localPath: string | null | undefined,
  externalUrl: string | null | undefined,
): string {
  if (localPath) {
    if (localPath.startsWith('/')) {
      return localPath;
    }
    return `/news-images/${localPath.replace(/^images\//, '')}`;
  }
  return externalUrl ?? '';
}

/**
 * Resolve thumbnailUrl to a serveable URL.
 * - `/uploads/news/xxx.jpg` → admin upload, return as-is
 * - `images/cat/slug/file.jpg` → WordPress import local, prefix /news-images/
 * - `https://...` → external URL, return as-is
 */
function resolveThumbnailUrl(url: string | null | undefined): string {
  if (!url) return '';
  if (url.startsWith('/')) return url;
  if (url.startsWith('images/')) {
    return `/news-images/${url.replace(/^images\//, '')}`;
  }
  return url;
}
