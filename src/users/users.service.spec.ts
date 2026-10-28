import { ForbiddenException } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import type { AuthUser } from '../common/permissions';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';

const admin: AuthUser = { id: 'a', email: 'a@x.vn', roles: [RoleName.ADMIN] };
const superAdmin: AuthUser = {
  id: 's',
  email: 's@x.vn',
  roles: [RoleName.SUPER_ADMIN],
};

function makeService(targetRole: RoleName) {
  const prisma = {
    user: {
      findUnique: jest.fn(() => ({
        id: 't',
        roles: [{ role: { name: targetRole } }],
      })),
      update: jest.fn(),
    },
    refreshToken: { updateMany: jest.fn() },
    $transaction: jest.fn(),
  };
  return {
    service: new UsersService(prisma as unknown as PrismaService),
    prisma,
  };
}

describe('UsersService.setPassword', () => {
  it('ADMIN đặt lại mật khẩu hội viên → OK', async () => {
    const { service, prisma } = makeService(RoleName.MEMBER);
    await service.setPassword('t', { password: 'matkhau123' }, admin);
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('ADMIN đặt lại mật khẩu tài khoản quản trị → 403', async () => {
    const { service, prisma } = makeService(RoleName.SUPER_ADMIN);
    await expect(
      service.setPassword('t', { password: 'matkhau123' }, admin),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('SUPER_ADMIN đặt lại mật khẩu quản trị → OK', async () => {
    const { service, prisma } = makeService(RoleName.ADMIN);
    await service.setPassword('t', { password: 'matkhau123' }, superAdmin);
    expect(prisma.$transaction).toHaveBeenCalled();
  });
});
