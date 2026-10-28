import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { RoleName, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateUserDto,
  SetRolesDto,
  SetPasswordDto,
  SetStatusDto,
  SetUsernameDto,
} from './dto/users.dto';
import type { AuthUser } from '../common/permissions';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    const users = await this.prisma.user.findMany({
      include: { roles: { include: { role: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return users.map((user) => ({
      id: user.id,
      email: user.email,
      username: user.username,
      fullName: user.fullName,
      status: user.status,
      avatarUrl: user.avatarUrl,
      roles: user.roles.map((row) => row.role.name),
      createdAt: user.createdAt,
    }));
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { roles: { include: { role: true } } },
    });
    if (!user) {
      throw new NotFoundException('Không tìm thấy người dùng');
    }
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      fullName: user.fullName,
      status: user.status,
      avatarUrl: user.avatarUrl,
      roles: user.roles.map((row) => row.role.name),
      createdAt: user.createdAt,
    };
  }

  async create(dto: CreateUserDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    if (existing) {
      throw new BadRequestException('Email đã được sử dụng');
    }
    if (dto.username) await this.ensureUsernameFree(dto.username);
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const roleNames = dto.roles?.length ? dto.roles : [RoleName.USER];
    const roles = await this.prisma.role.findMany({
      where: { name: { in: roleNames } },
    });
    if (roles.length !== roleNames.length) {
      throw new BadRequestException('Vai trò không hợp lệ');
    }
    const user = await this.prisma.user.create({
      data: {
        email: dto.email.toLowerCase(),
        username: dto.username || null,
        passwordHash,
        fullName: dto.fullName,
        roles: { create: roles.map((r) => ({ roleId: r.id })) },
      },
      include: { roles: { include: { role: true } } },
    });
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      fullName: user.fullName,
      status: user.status,
      roles: user.roles.map((row) => row.role.name),
      createdAt: user.createdAt,
    };
  }

  async setRoles(userId: string, dto: SetRolesDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('Không tìm thấy người dùng');
    }
    const roles = await this.prisma.role.findMany({
      where: { name: { in: dto.roles } },
    });
    if (roles.length !== dto.roles.length) {
      throw new BadRequestException('Vai trò không hợp lệ');
    }
    await this.prisma.$transaction([
      this.prisma.userRole.deleteMany({ where: { userId } }),
      ...roles.map((role) =>
        this.prisma.userRole.create({ data: { userId, roleId: role.id } }),
      ),
    ]);
    return { id: userId, roles: dto.roles };
  }

  /** Quản trị đặt lại mật khẩu (hội viên quên mật khẩu). ADMIN không đụng được tài khoản quản trị. */
  async setPassword(userId: string, dto: SetPasswordDto, actor: AuthUser) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { roles: { include: { role: true } } },
    });
    if (!user) {
      throw new NotFoundException('Không tìm thấy người dùng');
    }
    const targetIsAdmin = user.roles.some(
      (row) =>
        row.role.name === RoleName.ADMIN ||
        row.role.name === RoleName.SUPER_ADMIN,
    );
    if (targetIsAdmin && !actor.roles.includes(RoleName.SUPER_ADMIN)) {
      throw new ForbiddenException(
        'Chỉ Super Admin được đặt lại mật khẩu tài khoản quản trị',
      );
    }
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash: await bcrypt.hash(dto.password, 10) },
      }),
      // Đăng xuất mọi phiên cũ của tài khoản này.
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    return { id: userId };
  }

  async setUsername(userId: string, dto: SetUsernameDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('Không tìm thấy người dùng');
    }
    if (dto.username) await this.ensureUsernameFree(dto.username, userId);
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { username: dto.username },
    });
    return { id: updated.id, username: updated.username };
  }

  /** Tài khoản không chứa '@' nên không thể trùng email — chỉ cần kiểm tra trùng tài khoản. */
  private async ensureUsernameFree(username: string, exceptUserId?: string) {
    const taken = await this.prisma.user.findFirst({
      where: {
        username,
        NOT: exceptUserId ? { id: exceptUserId } : undefined,
      },
    });
    if (taken) {
      throw new BadRequestException('Tài khoản đã được sử dụng');
    }
  }

  async setStatus(userId: string, dto: SetStatusDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('Không tìm thấy người dùng');
    }
    if (
      dto.status === UserStatus.INACTIVE ||
      dto.status === UserStatus.BANNED
    ) {
      await this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { status: dto.status },
    });
    return { id: updated.id, status: updated.status };
  }

  async remove(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException('Không tìm thấy người dùng');
    }
    await this.prisma.refreshToken.updateMany({
      where: { userId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.prisma.userRole.deleteMany({ where: { userId: id } });
    await this.prisma.user.delete({ where: { id } });
    return { id, deleted: true };
  }
}
