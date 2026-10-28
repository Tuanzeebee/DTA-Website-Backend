import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { RoleName, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/permissions';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

const REFRESH_TTL_DAYS = Number(process.env.REFRESH_TOKEN_TTL_DAYS) || 7;

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    fullName: string;
    roles: RoleName[];
  };
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResult> {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    if (existing) {
      throw new ConflictException('Email đã được sử dụng');
    }
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const userRole = await this.prisma.role.findUnique({
      where: { name: RoleName.USER },
    });
    if (!userRole) {
      throw new Error('Chưa seed roles. Chạy: npm run seed:rbac');
    }
    const user = await this.prisma.user.create({
      data: {
        email: dto.email.toLowerCase(),
        passwordHash,
        fullName: dto.fullName,
        roles: { create: [{ roleId: userRole.id }] },
      },
    });
    return this.issueTokens(user.id, user.email, user.fullName);
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    const login = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findFirst({
      where: { OR: [{ email: login }, { username: login }] },
    });
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Tài khoản hoặc mật khẩu không đúng');
    }
    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Tài khoản đã bị khóa hoặc vô hiệu hóa');
    }
    return this.issueTokens(user.id, user.email, user.fullName);
  }

  /** Hội viên tự quản mật khẩu: đổi khi biết mật khẩu hiện tại. */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
      throw new UnauthorizedException('Mật khẩu hiện tại không đúng');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await bcrypt.hash(newPassword, 10) },
    });
  }

  async refresh(refreshToken: string): Promise<AuthResult> {
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(refreshToken) },
      include: { user: true },
    });
    if (!record || record.revokedAt || record.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token không hợp lệ');
    }
    if (record.user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Tài khoản đã bị khóa hoặc vô hiệu hóa');
    }
    await this.prisma.refreshToken.update({
      where: { id: record.id },
      data: { revokedAt: new Date() },
    });
    return this.issueTokens(
      record.userId,
      record.user.email,
      record.user.fullName,
    );
  }

  async logout(refreshToken?: string): Promise<void> {
    if (!refreshToken) {
      return;
    }
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: hashToken(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async issueTokens(
    userId: string,
    email: string,
    fullName: string,
  ): Promise<AuthResult> {
    const roleRows = await this.prisma.userRole.findMany({
      where: { userId },
      include: { role: true },
    });
    const roles = roleRows.map((row) => row.role.name);
    const payload = { sub: userId, email, roles };
    const accessToken = await this.jwt.signAsync(payload);
    const refreshToken = randomBytes(48).toString('hex');
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: hashToken(refreshToken),
        expiresAt: new Date(
          Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000,
        ),
      },
    });
    const authUser: AuthUser = { id: userId, email, roles };
    return { accessToken, refreshToken, user: { ...authUser, fullName } };
  }
}
