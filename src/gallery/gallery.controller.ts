import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { RoleName } from '@prisma/client';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { randomUUID } from 'crypto';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreateGalleryPhotoDto, UpdateGalleryPhotoDto } from './dto/gallery.dto';
import { GalleryService } from './gallery.service';

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_SIZE = 5 * 1024 * 1024;

@Controller()
export class GalleryController {
  constructor(private readonly galleryService: GalleryService) {}

  /* ---- public ---- */

  @Public()
  @Get('news/gallery')
  findPublic() {
    return this.galleryService.findActive();
  }

  /* ---- admin ---- */

  @Get('admin/gallery')
  @Roles(RoleName.SUPER_ADMIN, RoleName.ADMIN, RoleName.EDITOR)
  findAll() {
    return this.galleryService.findAll();
  }

  @Get('admin/gallery/:id')
  @Roles(RoleName.SUPER_ADMIN, RoleName.ADMIN, RoleName.EDITOR)
  findOne(@Param('id') id: string) {
    return this.galleryService.findOne(id);
  }

  @Post('admin/gallery')
  @Roles(RoleName.SUPER_ADMIN, RoleName.ADMIN, RoleName.EDITOR)
  create(@Body() dto: CreateGalleryPhotoDto) {
    return this.galleryService.create(dto);
  }

  @Patch('admin/gallery/:id')
  @Roles(RoleName.SUPER_ADMIN, RoleName.ADMIN, RoleName.EDITOR)
  update(@Param('id') id: string, @Body() dto: UpdateGalleryPhotoDto) {
    return this.galleryService.update(id, dto);
  }

  @Patch('admin/gallery/:id/toggle')
  @Roles(RoleName.SUPER_ADMIN, RoleName.ADMIN, RoleName.EDITOR)
  toggleActive(@Param('id') id: string) {
    return this.galleryService.toggleActive(id);
  }

  @Delete('admin/gallery/:id')
  @Roles(RoleName.SUPER_ADMIN, RoleName.ADMIN, RoleName.EDITOR)
  remove(@Param('id') id: string) {
    return this.galleryService.remove(id);
  }

  /* ---- upload ---- */

  @Roles(RoleName.SUPER_ADMIN, RoleName.ADMIN, RoleName.EDITOR)
  @Post('admin/gallery/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: join(process.cwd(), 'uploads', 'gallery'),
        filename: (_req, file, cb) => {
          const ext = extname(file.originalname).toLowerCase();
          cb(null, `${Date.now()}-${randomUUID()}${ext}`);
        },
      }),
      limits: { fileSize: MAX_SIZE },
      fileFilter: (_req, file, cb) => {
        if (ALLOWED_MIME.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(
            new BadRequestException(
              'Chỉ chấp nhận file ảnh JPG, PNG, WebP, GIF',
            ),
            false,
          );
        }
      },
    }),
  )
  uploadFile(@UploadedFile() file: Express.Multer.File) {
    return { url: `/uploads/gallery/${file.filename}` };
  }
}
