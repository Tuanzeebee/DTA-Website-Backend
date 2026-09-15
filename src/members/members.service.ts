import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateMemberDto,
  UpdateMemberDto,
  UpdateMyProfileDto,
} from './dto/member.dto';

@Injectable()
export class MembersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.member.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async findOne(id: string) {
    const member = await this.prisma.member.findUnique({ where: { id } });
    if (!member) {
      throw new NotFoundException('Không tìm thấy hội viên');
    }
    return member;
  }

  async create(dto: CreateMemberDto) {
    return this.prisma.member.create({
      data: {
        name: dto.name,
        nameEn: dto.nameEn ?? null,
        role: dto.role ?? 'Hội viên',
        type: dto.type ?? 'organization',
        domain: dto.domain ?? '',
        ownership: dto.ownership ?? null,
        leader: dto.leader ?? null,
        phone: dto.phone ?? null,
        strengths: dto.strengths ?? null,
        logoUrl: dto.logoUrl ?? null,
        website: dto.website ?? null,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  async update(id: string, dto: UpdateMemberDto) {
    await this.findOne(id);
    return this.prisma.member.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.nameEn !== undefined && { nameEn: dto.nameEn }),
        ...(dto.role !== undefined && { role: dto.role }),
        ...(dto.type !== undefined && { type: dto.type }),
        ...(dto.domain !== undefined && { domain: dto.domain }),
        ...(dto.ownership !== undefined && { ownership: dto.ownership }),
        ...(dto.leader !== undefined && { leader: dto.leader }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        ...(dto.strengths !== undefined && { strengths: dto.strengths }),
        ...(dto.logoUrl !== undefined && { logoUrl: dto.logoUrl }),
        ...(dto.website !== undefined && { website: dto.website }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.member.delete({ where: { id } });
    return { id, deleted: true };
  }

  /** Hồ sơ của chính hội viên đang đăng nhập (qua User.memberId). */
  async findMyProfile(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.memberId) {
      throw new ForbiddenException('Tài khoản chưa liên kết hồ sơ hội viên');
    }
    return this.findOne(user.memberId);
  }

  /** Hội viên tự cập nhật các trường được phép của chính mình. */
  async updateMyProfile(userId: string, dto: UpdateMyProfileDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.memberId) {
      throw new ForbiddenException('Tài khoản chưa liên kết hồ sơ hội viên');
    }
    return this.prisma.member.update({
      where: { id: user.memberId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.nameEn !== undefined && { nameEn: dto.nameEn || null }),
        ...(dto.domain !== undefined && { domain: dto.domain }),
        ...(dto.ownership !== undefined && { ownership: dto.ownership || null }),
        ...(dto.leader !== undefined && { leader: dto.leader || null }),
        ...(dto.phone !== undefined && { phone: dto.phone || null }),
        ...(dto.strengths !== undefined && { strengths: dto.strengths || null }),
        ...(dto.logoUrl !== undefined && { logoUrl: dto.logoUrl || null }),
        ...(dto.website !== undefined && { website: dto.website || null }),
      },
    });
  }
}
