import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
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
import { CreateAdDto, UpdateAdDto } from './dto/ad.dto';
import { AdsService } from './ads.service';

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_SIZE = 5 * 1024 * 1024;

@Controller()
export class AdsController {
  constructor(private readonly adsService: AdsService) {}

  /* ---- public ---- */

  @Public()
  @Get('news/ads')
  findPublic(@Query('slot') slot?: string) {
    if (slot) {
      return this.adsService.findActiveBySlot(slot);
    }
    return this.adsService.findAll();
  }

  /* ---- admin ---- */

  @Get('admin/ads')
  @Roles(RoleName.SUPER_ADMIN, RoleName.ADMIN, RoleName.EDITOR)
  findAll() {
    return this.adsService.findAll();
  }

  @Get('admin/ads/:id')
  @Roles(RoleName.SUPER_ADMIN, RoleName.ADMIN, RoleName.EDITOR)
  findOne(@Param('id') id: string) {
    return this.adsService.findOne(id);
  }

  @Post('admin/ads')
  @Roles(RoleName.SUPER_ADMIN, RoleName.ADMIN, RoleName.EDITOR)
  create(@Body() dto: CreateAdDto) {
    return this.adsService.create(dto);
  }

  @Patch('admin/ads/:id')
  @Roles(RoleName.SUPER_ADMIN, RoleName.ADMIN, RoleName.EDITOR)
  update(@Param('id') id: string, @Body() dto: UpdateAdDto) {
    return this.adsService.update(id, dto);
  }

  @Patch('admin/ads/:id/toggle')
  @Roles(RoleName.SUPER_ADMIN, RoleName.ADMIN, RoleName.EDITOR)
  toggleActive(@Param('id') id: string) {
    return this.adsService.toggleActive(id);
  }

  @Delete('admin/ads/:id')
  @Roles(RoleName.SUPER_ADMIN, RoleName.ADMIN)
  remove(@Param('id') id: string) {
    return this.adsService.remove(id);
  }

  /* ---- upload ---- */

  @Roles(RoleName.SUPER_ADMIN, RoleName.ADMIN, RoleName.EDITOR)
  @Post('admin/ads/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: join(process.cwd(), 'uploads', 'ads'),
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
    return { url: `/uploads/ads/${file.filename}` };
  }
}
