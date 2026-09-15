import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ApplicationStatus, Prisma, RoleName } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SubmitApplicationDto } from './dto/application.dto';

function newTrackingCode(): string {
  return 'DTA-' + Math.floor(1000 + Math.random() * 9000);
}

/** Mật khẩu tạm 12 ký tự, chỉ trả về 1 lần lúc cấp/cấp lại. */
function newTempPassword(): string {
  return randomBytes(9).toString('base64url').slice(0, 12);
}

@Injectable()
export class ApplicationsService {
  constructor(private readonly prisma: PrismaService) {}

  async submit(
    dto: SubmitApplicationDto,
    files: { consentDocUrl?: string; legalDocUrl?: string },
  ) {
    if (!files.consentDocUrl) {
      throw new BadRequestException(
        'Vui lòng tải lên Công văn đồng ý trở thành Hội viên DTA.',
      );
    }
    if (!files.legalDocUrl) {
      throw new BadRequestException(
        'Vui lòng tải lên GPKD / Giấy chứng nhận ĐKKD / Quyết định thành lập.',
      );
    }
    // trackingCode unique — thử lại khi va chạm.
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await this.prisma.memberApplication.create({
          data: {
            trackingCode: newTrackingCode(),
            orgName: dto.orgName.trim(),
            nameEn: dto.nameEn?.trim() || null,
            ownership: dto.ownership ?? null,
            leader: dto.leader?.trim() || null,
            contactName: dto.contactName?.trim() || null,
            email: dto.email.trim().toLowerCase(),
            phone: dto.phone?.trim() || null,
            type: dto.type ?? 'organization',
            domain: dto.domain?.trim() ?? '',
            strengths: dto.strengths?.trim() || null,
            techField: dto.techField ?? null,
            consentDocUrl: files.consentDocUrl,
            legalDocUrl: files.legalDocUrl,
            message: dto.message?.trim() || null,
          },
        });
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          continue;
        }
        throw err;
      }
    }
    throw new BadRequestException('Không tạo được mã biên nhận, thử lại.');
  }

  async list(status?: ApplicationStatus) {
    return this.prisma.memberApplication.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const app = await this.prisma.memberApplication.findUnique({
      where: { id },
    });
    if (!app) throw new NotFoundException('Không tìm thấy hồ sơ đăng ký');
    return app;
  }

  /**
   * Duyệt đơn: chỉ nhận đơn PENDING; trong 1 transaction tạo Member trong
   * Danh bạ + User role MEMBER liên kết (email trong đơn). Trả mật khẩu tạm
   * 1 lần duy nhất — caller hiển thị cho admin copy, không lưu plaintext.
   */
  async approve(id: string) {
    const app = await this.findOne(id);
    if (app.status !== ApplicationStatus.PENDING) {
      throw new BadRequestException('Hồ sơ không ở trạng thái chờ duyệt');
    }
    const email = app.email.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new BadRequestException(
        `Email ${email} đã có tài khoản — gán vai trò MEMBER thủ công ở mục Người dùng & Quyền.`,
      );
    }
    const memberRole = await this.prisma.role.findUnique({
      where: { name: RoleName.MEMBER },
    });
    if (!memberRole) {
      throw new BadRequestException(
        'Chưa seed roles. Chạy: npm run seed:rbac',
      );
    }
    const tempPassword = newTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 10);
    const result = await this.prisma.$transaction(async (tx) => {
      const member = await tx.member.create({
        data: {
          name: app.orgName,
          nameEn: app.nameEn,
          role:
            app.type === 'organization'
              ? 'Hội viên Tổ chức · Kết nạp mới'
              : 'Hội viên Cá nhân · Kết nạp mới',
          type: app.type,
          domain: app.domain,
          ownership: app.ownership,
          leader: app.leader,
          phone: app.phone,
          strengths: app.strengths,
        },
      });
      await tx.user.create({
        data: {
          email,
          passwordHash,
          fullName: app.orgName,
          memberId: member.id,
          roles: { create: [{ roleId: memberRole.id }] },
        },
      });
      const application = await tx.memberApplication.update({
        where: { id },
        data: { status: ApplicationStatus.APPROVED, createdMemberId: member.id },
      });
      return { application, member };
    });
    return { ...result, tempPassword };
  }

  /**
   * Cấp lại mật khẩu cho hội viên đã duyệt (khi mất pass). Trả 1 lần duy nhất.
   */
  async resetMemberPassword(id: string) {
    const app = await this.findOne(id);
    if (app.status !== ApplicationStatus.APPROVED || !app.createdMemberId) {
      throw new BadRequestException('Đơn chưa được duyệt, không có tài khoản');
    }
    const user = await this.prisma.user.findUnique({
      where: { memberId: app.createdMemberId },
    });
    if (!user) {
      throw new NotFoundException(
        'Không tìm thấy tài khoản liên kết — tạo thủ công ở mục Người dùng & Quyền.',
      );
    }
    const tempPassword = newTempPassword();
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(tempPassword, 10) },
    });
    return { email: user.email, tempPassword };
  }

  async reject(id: string) {
    const app = await this.findOne(id);
    if (app.status !== ApplicationStatus.PENDING) {
      throw new BadRequestException('Hồ sơ không ở trạng thái chờ duyệt');
    }
    return this.prisma.memberApplication.update({
      where: { id },
      data: { status: ApplicationStatus.REJECTED },
    });
  }
}
