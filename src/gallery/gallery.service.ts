import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateGalleryPhotoDto, UpdateGalleryPhotoDto } from './dto/gallery.dto';

@Injectable()
export class GalleryService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.galleryPhoto.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async findActive() {
    return this.prisma.galleryPhoto.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async findOne(id: string) {
    const photo = await this.prisma.galleryPhoto.findUnique({ where: { id } });
    if (!photo) {
      throw new NotFoundException('Không tìm thấy ảnh');
    }
    return photo;
  }

  async create(dto: CreateGalleryPhotoDto) {
    return this.prisma.galleryPhoto.create({
      data: {
        imageUrl: dto.imageUrl,
        caption: dto.caption ?? null,
        sortOrder: dto.sortOrder ?? 0,
        active: dto.active ?? true,
      },
    });
  }

  async update(id: string, dto: UpdateGalleryPhotoDto) {
    await this.findOne(id);
    return this.prisma.galleryPhoto.update({
      where: { id },
      data: {
        ...(dto.imageUrl !== undefined && { imageUrl: dto.imageUrl }),
        ...(dto.caption !== undefined && { caption: dto.caption || null }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
        ...(dto.active !== undefined && { active: dto.active }),
      },
    });
  }

  async toggleActive(id: string) {
    const photo = await this.findOne(id);
    return this.prisma.galleryPhoto.update({
      where: { id },
      data: { active: !photo.active },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.galleryPhoto.delete({ where: { id } });
    return { id, deleted: true };
  }
}
