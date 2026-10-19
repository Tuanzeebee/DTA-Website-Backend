import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAdDto, UpdateAdDto } from './dto/ad.dto';

@Injectable()
export class AdsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.adPlacement.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async findActiveBySlot(slot?: string) {
    return this.prisma.adPlacement.findMany({
      where: { active: true, ...(slot && { slot }) },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const ad = await this.prisma.adPlacement.findUnique({ where: { id } });
    if (!ad) {
      throw new NotFoundException('Không tìm thấy quảng cáo');
    }
    return ad;
  }

  async create(dto: CreateAdDto) {
    return this.prisma.adPlacement.create({
      data: {
        title: dto.title,
        slot: dto.slot ?? 'banner',
        imageUrl: dto.imageUrl,
        linkUrl: dto.linkUrl,
        active: dto.active ?? true,
        note: dto.note ?? null,
      },
    });
  }

  async update(id: string, dto: UpdateAdDto) {
    await this.findOne(id);
    return this.prisma.adPlacement.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.slot !== undefined && { slot: dto.slot }),
        ...(dto.imageUrl !== undefined && { imageUrl: dto.imageUrl }),
        ...(dto.linkUrl !== undefined && { linkUrl: dto.linkUrl }),
        ...(dto.active !== undefined && { active: dto.active }),
        ...(dto.note !== undefined && { note: dto.note }),
      },
    });
  }

  async toggleActive(id: string) {
    const ad = await this.findOne(id);
    return this.prisma.adPlacement.update({
      where: { id },
      data: { active: !ad.active },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.adPlacement.delete({ where: { id } });
    return { id, deleted: true };
  }
}
