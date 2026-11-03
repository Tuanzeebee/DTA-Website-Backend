import { ForbiddenException } from '@nestjs/common';
import { ArticleStatus, RoleName } from '@prisma/client';
import type { AuthUser } from '../common/permissions';
import { PrismaService } from '../prisma/prisma.service';
import { ArticlesService } from './articles.service';

/** Phân quyền hội viên: chỉ đăng ở /hoi-vien/tin-doanh-nghiep, chờ duyệt, chỉ sửa bài của mình. */
const CATEGORIES = [
  { id: 1, slug: 'hoi-vien', topic: { slug: 'hoi-vien' } },
  { id: 2, slug: 'su-kien', topic: { slug: 'su-kien' } },
  { id: 7, slug: 'tin-doanh-nghiep', topic: { slug: 'hoi-vien' } },
];

const member: AuthUser = { id: 'm1', email: 'm@x.vn', roles: [RoleName.MEMBER] };
const editor: AuthUser = { id: 'e1', email: 'e@x.vn', roles: [RoleName.EDITOR] };

function makeService(article: Record<string, unknown> = { id: 'a1', authorId: null }) {
  const prisma = {
    newsCategory: {
      findUnique: jest.fn(
        ({ where }: { where: { id?: number; slug?: string } }) =>
          CATEGORIES.find((c) => c.id === where.id || c.slug === where.slug) ?? null,
      ),
    },
    newsArticle: {
      findUnique: jest.fn(() => null),
      findFirst: jest.fn(() => article),
      findMany: jest.fn((_args?: unknown) => [] as unknown[]),
      count: jest.fn(() => 0),
      create: jest.fn(() => ({ id: 'new' })),
      update: jest.fn(() => ({ id: 'a1' })),
    },
  };
  const service = new ArticlesService(prisma as unknown as PrismaService);
  // toDetail cần đủ quan hệ của bài; ở đây chỉ kiểm tra quyền.
  jest.spyOn(service as never, 'toDetail').mockReturnValue({} as never);
  return { service, prisma };
}

const saved2 = (fn: jest.Mock) => fn.mock.calls[0][0];
const saved = (fn: jest.Mock) => saved2(fn).data;

describe('ArticlesService — quyền hội viên', () => {
  it('hội viên đăng vào topic khác Hội viên → 403', async () => {
    const { service, prisma } = makeService();
    await expect(
      service.create({ title: 'x', categoryId: 2 } as never, member),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.newsArticle.create).not.toHaveBeenCalled();
  });

  it('bài hội viên luôn vào Tin doanh nghiệp, ở trạng thái chờ duyệt', async () => {
    const { service, prisma } = makeService();
    await service.create(
      {
        title: 'x',
        categoryId: 1,
        status: ArticleStatus.PUBLISHED,
        publishedAt: new Date(),
      } as never,
      member,
    );
    expect(saved(prisma.newsArticle.create)).toMatchObject({
      categoryId: 7,
      status: ArticleStatus.DRAFT,
      publishedAt: null,
      authorId: 'm1',
    });
  });

  it('hội viên để trống Tác giả → null (hiển thị tên đơn vị)', async () => {
    const { service, prisma } = makeService();
    await service.create({ title: 'x', author: ' ' } as never, member);
    expect(saved(prisma.newsArticle.create).authorName).toBeNull();
  });

  it('hội viên không gửi chuyên mục → vẫn vào Tin doanh nghiệp', async () => {
    const { service, prisma } = makeService();
    await service.create({ title: 'x' } as never, member);
    expect(saved(prisma.newsArticle.create).categoryId).toBe(7);
  });

  it('biên tập viên đăng vào topic bất kỳ → OK', async () => {
    const { service, prisma } = makeService();
    await service.create({ title: 'x', categoryId: 2 } as never, editor);
    expect(saved(prisma.newsArticle.create).categoryId).toBe(2);
  });

  it('hội viên không sửa/xoá được bài hệ thống (authorId null)', async () => {
    const { service, prisma } = makeService();
    await expect(
      service.update('a1', { title: 'y' } as never, member),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.remove('a1', member)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.newsArticle.update).not.toHaveBeenCalled();
  });

  it('hội viên không sửa/xoá được bài của hội viên khác', async () => {
    const { service, prisma } = makeService({ id: 'a1', authorId: 'm2' });
    await expect(
      service.update('a1', { title: 'y' } as never, member),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.remove('a1', member)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.newsArticle.update).not.toHaveBeenCalled();
  });

  it('hội viên sửa bài đã đăng của mình → gỡ xuống chờ duyệt lại', async () => {
    const { service, prisma } = makeService({
      id: 'a1',
      authorId: 'm1',
      slug: 'a1',
      status: ArticleStatus.PUBLISHED,
    });
    // Editor dùng chung với admin luôn gửi status — hội viên gửi DRAFT cho bài đã đăng vẫn được.
    await service.update(
      'a1',
      { title: 'y', categoryId: 1, status: ArticleStatus.DRAFT } as never,
      member,
    );
    expect(saved(prisma.newsArticle.update)).toMatchObject({
      categoryId: 7,
      status: ArticleStatus.DRAFT,
      reviewNote: null,
    });
  });

  it('hội viên liệt kê bài → chỉ thấy bài của mình', async () => {
    const { service, prisma } = makeService();
    await service.adminList({ page: 1, pageSize: 20 } as never, member);
    expect(saved2(prisma.newsArticle.findMany).where.authorId).toBe('m1');
  });

  it('chỉ biên tập/quản trị mới từ chối được bài', async () => {
    const { service, prisma } = makeService({ id: 'a1', authorId: 'm1' });
    await expect(service.reject('a1', 'x', member)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    prisma.newsArticle.update.mockReturnValue({ id: 'a1', reviewNote: 'Thiếu ảnh' } as never);
    await service.reject('a1', ' Thiếu ảnh ', editor);
    expect(saved(prisma.newsArticle.update)).toEqual({
      status: ArticleStatus.ARCHIVED,
      reviewNote: 'Thiếu ảnh',
    });
  });
});
