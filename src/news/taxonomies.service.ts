import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { slugify } from '../common/utils/slugify';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateCategoryDto,
  CreateTopicDto,
  UpdateCategoryDto,
  UpdateTopicDto,
} from './dto/taxonomy.dto';

@Injectable()
export class TaxonomiesService {
  constructor(private readonly prisma: PrismaService) {}

  async listTopics() {
    return this.prisma.newsTopic.findMany({
      orderBy: { sortOrder: 'asc' },
      include: { categories: { orderBy: { sortOrder: 'asc' } } },
    });
  }

  async listCategories(topicSlug?: string) {
    return this.prisma.newsCategory.findMany({
      where: topicSlug ? { topic: { slug: topicSlug } } : undefined,
      orderBy: { sortOrder: 'asc' },
      include: { topic: { select: { slug: true, name: true } } },
    });
  }

  async createTopic(dto: CreateTopicDto) {
    const slug = await this.uniqueTopicSlug(
      dto.slug?.trim() || slugify(dto.name),
    );
    return this.prisma.newsTopic.create({
      data: {
        slug,
        name: dto.name,
        shortName: dto.shortName,
        nameEn: dto.nameEn,
        shortEn: dto.shortEn,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  async updateTopic(id: number, dto: UpdateTopicDto) {
    await this.ensureTopic(id);
    let slug: string | undefined;
    if (dto.slug !== undefined) {
      slug = await this.uniqueTopicSlug(slugify(dto.slug), id);
    }
    return this.prisma.newsTopic.update({
      where: { id },
      data: { ...dto, slug },
    });
  }

  async removeTopic(id: number) {
    await this.ensureTopic(id);
    const count = await this.prisma.newsCategory.count({
      where: { topicId: id },
    });
    if (count > 0) {
      throw new BadRequestException(
        `Không thể xóa chủ đề đang có ${count} danh mục con`,
      );
    }
    await this.prisma.newsTopic.delete({ where: { id } });
    return { id, deleted: true };
  }

  async createCategory(dto: CreateCategoryDto) {
    await this.ensureTopic(dto.topicId);
    const slug = await this.uniqueCategorySlug(
      dto.slug?.trim() || slugify(dto.name),
    );
    return this.prisma.newsCategory.create({
      data: {
        slug,
        name: dto.name,
        description: dto.description,
        sortOrder: dto.sortOrder ?? 0,
        topicId: dto.topicId,
      },
    });
  }

  async updateCategory(id: number, dto: UpdateCategoryDto) {
    await this.ensureCategory(id);
    let slug: string | undefined;
    if (dto.slug !== undefined) {
      slug = await this.uniqueCategorySlug(slugify(dto.slug), id);
    }
    if (dto.topicId !== undefined) {
      await this.ensureTopic(dto.topicId);
    }
    return this.prisma.newsCategory.update({
      where: { id },
      data: { ...dto, slug },
    });
  }

  async removeCategory(id: number) {
    await this.ensureCategory(id);
    const count = await this.prisma.newsArticle.count({
      where: { categoryId: id, deletedAt: null },
    });
    if (count > 0) {
      throw new BadRequestException(
        `Không thể xóa danh mục đang có ${count} bài viết`,
      );
    }
    await this.prisma.newsCategory.delete({ where: { id } });
    return { id, deleted: true };
  }

  private async ensureTopic(id: number) {
    const found = await this.prisma.newsTopic.findUnique({ where: { id } });
    if (!found) {
      throw new NotFoundException('Không tìm thấy chủ đề');
    }
  }

  private async ensureCategory(id: number) {
    const found = await this.prisma.newsCategory.findUnique({ where: { id } });
    if (!found) {
      throw new NotFoundException('Không tìm thấy danh mục');
    }
  }

  private async uniqueTopicSlug(
    base: string,
    excludeId?: number,
  ): Promise<string> {
    const clean = base.replace(/^-+|-+$/g, '') || 'chu-de';
    let candidate = clean;
    let counter = 2;
    for (;;) {
      const existing = await this.prisma.newsTopic.findUnique({
        where: { slug: candidate },
      });
      if (!existing || existing.id === excludeId) {
        return candidate;
      }
      candidate = `${clean}-${counter}`;
      counter += 1;
    }
  }

  private async uniqueCategorySlug(
    base: string,
    excludeId?: number,
  ): Promise<string> {
    const clean = base.replace(/^-+|-+$/g, '') || 'danh-muc';
    let candidate = clean;
    let counter = 2;
    for (;;) {
      const existing = await this.prisma.newsCategory.findUnique({
        where: { slug: candidate },
      });
      if (!existing || existing.id === excludeId) {
        return candidate;
      }
      candidate = `${clean}-${counter}`;
      counter += 1;
    }
  }
}
