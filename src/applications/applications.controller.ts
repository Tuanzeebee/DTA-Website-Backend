import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { randomUUID } from 'crypto';
import { ApplicationStatus, RoleName } from '@prisma/client';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { ApplicationsService } from './applications.service';
import { SubmitApplicationDto } from './dto/application.dto';

const DOC_MIME = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
];
const MAX_DOC_SIZE = 10 * 1024 * 1024; // 10 MB

function docFileFilter(
  _req: unknown,
  file: Express.Multer.File,
  cb: (error: Error | null, accept: boolean) => void,
) {
  if (DOC_MIME.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      new BadRequestException(
        'Chỉ chấp nhận PDF hoặc ảnh (JPG, PNG, WebP) cho hồ sơ.',
      ),
      false,
    );
  }
}

@Controller()
export class ApplicationsController {
  constructor(private readonly applicationsService: ApplicationsService) {}

  /* ---- public: nộp đơn gia nhập ---- */

  @Public()
  @Post('applications')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'consentDoc', maxCount: 1 },
        { name: 'legalDoc', maxCount: 1 },
      ],
      {
        storage: diskStorage({
          destination: join(process.cwd(), 'uploads', 'applications'),
          filename: (_req, file, cb) => {
            const ext = extname(file.originalname).toLowerCase();
            cb(null, `${Date.now()}-${randomUUID()}${ext}`);
          },
        }),
        limits: { fileSize: MAX_DOC_SIZE },
        fileFilter: docFileFilter,
      },
    ),
  )
  submit(
    @Body() dto: SubmitApplicationDto,
    @UploadedFiles()
    files: {
      consentDoc?: Express.Multer.File[];
      legalDoc?: Express.Multer.File[];
    },
  ) {
    if (!dto.orgName?.trim() || !dto.email?.trim()) {
      throw new BadRequestException(
        'Thiếu thông tin bắt buộc (tên tổ chức, email).',
      );
    }
    const consent = files?.consentDoc?.[0];
    const legal = files?.legalDoc?.[0];
    return this.applicationsService.submit(dto, {
      consentDocUrl: consent ? `/uploads/applications/${consent.filename}` : undefined,
      legalDocUrl: legal ? `/uploads/applications/${legal.filename}` : undefined,
    });
  }

  /* ---- admin: xét duyệt ---- */

  @Get('admin/applications')
  @Roles(RoleName.SUPER_ADMIN, RoleName.ADMIN, RoleName.EDITOR)
  list(@Query('status') status?: string) {
    const upper = status?.toUpperCase();
    const valid =
      upper === 'PENDING' || upper === 'APPROVED' || upper === 'REJECTED'
        ? (upper as ApplicationStatus)
        : undefined;
    return this.applicationsService.list(valid);
  }

  @Patch('admin/applications/:id/approve')
  @Roles(RoleName.SUPER_ADMIN, RoleName.ADMIN)
  approve(@Param('id') id: string) {
    return this.applicationsService.approve(id);
  }

  @Patch('admin/applications/:id/reset-password')
  @Roles(RoleName.SUPER_ADMIN, RoleName.ADMIN)
  resetPassword(@Param('id') id: string) {
    return this.applicationsService.resetMemberPassword(id);
  }

  @Patch('admin/applications/:id/reject')
  @Roles(RoleName.SUPER_ADMIN, RoleName.ADMIN)
  reject(@Param('id') id: string) {
    return this.applicationsService.reject(id);
  }
}
