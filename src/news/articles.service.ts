import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ArticleStatus, ImageAlign, ImageWrap, Prisma } from '@prisma/client';
import { hasPermission, Permission } from '../common/permissions';
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
  constructor(private readonly prisma: PrismaService) {}

  async listPublished(query: QueryArticlesDto) {
    const where = this.buildPublicWhere(query);
    const orderBy: Prisma.NewsArticleOrderByWithRelationInput =
      query.sort === 'oldest'
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
    return {
      items: rows.map((row) => this.toListItem(row)),
      total,
      page: query.page,
      pageCount: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  async getPublishedBySlug(slug: string) {
    const article = await this.prisma.newsArticle.findFirst({
      where: { slug, status: ArticleStatus.PUBLISHED, deletedAt: null },
      include: detailInclude,
    });
    if (!article) {
      throw new NotFoundException('Không tìm thấy bài viết');
    }
    await this.prisma.newsArticle.update({
      where: { id: article.id },
      data: { viewsCount: { increment: 1 } },
    });
    return this.toDetail(article);
  }

  async adminList(query: AdminQueryArticlesDto, actor: AuthUser) {
    const where: Prisma.NewsArticleWhereInput = { deletedAt: null };
    if (query.status) {
      where.status = query.status;
    }
    if (query.mine) {
      where.authorId = actor.id;
    }
    if (query.category || query.topic) {
      where.category = query.category
        ? { slug: query.category }
        : { topic: { slug: query.topic } };
    }
    if (query.q) {
      where.OR = [
        { title: { contains: query.q, mode: 'insensitive' } },
        { summary: { contains: query.q, mode: 'insensitive' } },
      ];
    }
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
    if (!canUpdateAny && article.authorId !== actor.id) {
      throw new ForbiddenException('Bạn chỉ có thể xem bài viết của mình');
    }
    return { ...this.toDetail(article), rawHtml: article.rawHtml };
  }

  async create(dto: CreateArticleDto, actor: AuthUser) {
    await this.ensureCategory(dto.categoryId);
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
        categoryId: dto.categoryId,
        authorId: actor.id,
        status: canPublish ? ArticleStatus.PUBLISHED : ArticleStatus.DRAFT,
        publishedAt: canPublish ? new Date() : null,
        blocks: dto.blocks
          ? { create: dto.blocks.map((block, index) => mapBlock(block, index)) }
          : undefined,
      },
      include: detailInclude,
    });
    return this.toDetail(created);
  }

  async update(id: string, dto: UpdateArticleDto, actor: AuthUser) {
    const article = await this.findExisting(id);
    const isOwner = article.authorId === actor.id;
    const canUpdate =
      hasPermission(actor, Permission.ARTICLE_UPDATE_ANY) ||
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
      await this.ensureCategory(dto.categoryId);
    }
    const updated = await this.prisma.newsArticle.update({
      where: { id },
      data: {
        title: dto.title,
        slug,
        summary: dto.summary,
        thumbnailUrl: dto.thumbnailUrl,
        sourceUrl: dto.sourceUrl,
        rawHtml: dto.rawHtml,
        tags: dto.tags,
        pdfUrl: dto.pdfUrl,
        memberUrl: dto.memberUrl,
        isIntern: dto.isIntern,
        categoryId: dto.categoryId,
        status: dto.status,
        blocks: dto.blocks
          ? {
              deleteMany: {},
              create: dto.blocks.map((block, index) => mapBlock(block, index)),
            }
          : undefined,
      },
      include: detailInclude,
    });
    return this.toDetail(updated);
  }

  async remove(id: string, actor: AuthUser) {
    const article = await this.findExisting(id);
    const isOwner = article.authorId === actor.id;
    const canDelete =
      hasPermission(actor, Permission.ARTICLE_DELETE_ANY) ||
      (isOwner && hasPermission(actor, Permission.ARTICLE_DELETE_OWN));
    if (!canDelete) {
      throw new ForbiddenException('Bạn không có quyền xóa bài viết này');
    }
    await this.prisma.newsArticle.update({
      where: { id },
      data: { deletedAt: new Date(), status: ArticleStatus.ARCHIVED },
    });
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
    return this.toDetail(updated);
  }

  private buildPublicWhere(
    query: QueryArticlesDto,
  ): Prisma.NewsArticleWhereInput {
    const where: Prisma.NewsArticleWhereInput = {
      status: ArticleStatus.PUBLISHED,
      deletedAt: null,
    };
    if (query.category) {
      where.category = { slug: query.category };
    } else if (query.topic) {
      where.category = { topic: { slug: query.topic } };
    }
    if (query.flag === 'intern') {
      where.isIntern = true;
    }
    if (query.q) {
      where.OR = [
        { title: { contains: query.q, mode: 'insensitive' } },
        { summary: { contains: query.q, mode: 'insensitive' } },
      ];
    }
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

  private async ensureCategory(categoryId: number) {
    const category = await this.prisma.newsCategory.findUnique({
      where: { id: categoryId },
    });
    if (!category) {
      throw new BadRequestException('Danh mục không tồn tại');
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
    summary: string | null;
    thumbnailUrl: string | null;
    tags: string[];
    viewsCount: number;
    isIntern: boolean;
    publishedAt: Date | null;
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
      author: article.author?.fullName ?? null,
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
