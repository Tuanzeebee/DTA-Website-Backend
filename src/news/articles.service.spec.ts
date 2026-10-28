import { ForbiddenException } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import type { AuthUser } from '../common/permissions';
import { PrismaService } from '../prisma/prisma.service';
import { ArticlesService } from './articles.service';

/** Phân quyền hội viên (góp ý 27/10/2026): chỉ đăng ở topic Hội viên, không đụng bài hệ thống. */
const CATEGORIES: Record<number, { id: number; topic: { slug: string } }> = {
  1: { id: 1, topic: { slug: 'hoi-vien' } },
  2: { id: 2, topic: { slug: 'su-kien' } },
};

const member: AuthUser = { id: 'm1', email: 'm@x.vn', roles: [RoleName.MEMBER] };
const editor: AuthUser = { id: 'e1', email: 'e@x.vn', roles: [RoleName.EDITOR] };

function makeService() {
  const prisma = {
    newsCategory: {
      findUnique: jest.fn(({ where }) => CATEGORIES[where.id] ?? null),
    },
    newsArticle: {
      findUnique: jest.fn(() => null),
      findFirst: jest.fn(() => ({ id: 'a1', authorId: null })),
      create: jest.fn(() => ({ id: 'new' })),
      update: jest.fn(() => ({ id: 'a1' })),
    },
  };
  const service = new ArticlesService(prisma as unknown as PrismaService);
  // toDetail cần đủ quan hệ của bài; ở đây chỉ kiểm tra quyền.
  jest.spyOn(service as never, 'toDetail').mockReturnValue({} as never);
  return { service, prisma };
}

describe('ArticlesService — quyền hội viên', () => {
  it('hội viên đăng vào topic khác Hội viên → 403', async () => {
    const { service, prisma } = makeService();
    await expect(
      service.create({ title: 'x', categoryId: 2 } as never, member),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.newsArticle.create).not.toHaveBeenCalled();
  });

  it('hội viên đăng vào topic Hội viên → OK', async () => {
    const { service, prisma } = makeService();
    await service.create({ title: 'x', categoryId: 1 } as never, member);
    expect(prisma.newsArticle.create).toHaveBeenCalled();
  });

  it('biên tập viên đăng vào topic bất kỳ → OK', async () => {
    const { service, prisma } = makeService();
    await service.create({ title: 'x', categoryId: 2 } as never, editor);
    expect(prisma.newsArticle.create).toHaveBeenCalled();
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
});
