import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMemberDto, UpdateMemberDto } from './dto/member.dto';

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
        role: dto.role ?? 'Hội viên',
        type: dto.type ?? 'organization',
        domain: dto.domain ?? '',
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
        ...(dto.role !== undefined && { role: dto.role }),
        ...(dto.type !== undefined && { type: dto.type }),
        ...(dto.domain !== undefined && { domain: dto.domain }),
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
}
