import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { randomUUID } from 'crypto';
import { RoleName } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthUser } from '../common/permissions';
import {
  AdminQueryArticlesDto,
  CreateArticleDto,
  UpdateArticleDto,
} from './dto/article.dto';
import {
  CreateCategoryDto,
  CreateTopicDto,
  UpdateCategoryDto,
  UpdateTopicDto,
} from './dto/taxonomy.dto';
import { ArticlesService } from './articles.service';
import { TaxonomiesService } from './taxonomies.service';

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

@Controller('admin/news')
export class NewsAdminController {
  constructor(
    private readonly articlesService: ArticlesService,
    private readonly taxonomiesService: TaxonomiesService,
  ) {}

  @Roles(RoleName.MEMBER, RoleName.AUTHOR, RoleName.EDITOR, RoleName.ADMIN, RoleName.SUPER_ADMIN)
  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: join(process.cwd(), 'uploads', 'news'),
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
    return { url: `/uploads/news/${file.filename}` };
  }

  @Roles(RoleName.MEMBER, RoleName.AUTHOR, RoleName.EDITOR, RoleName.ADMIN, RoleName.SUPER_ADMIN)
  @Post('articles')
  create(@Body() dto: CreateArticleDto, @CurrentUser() actor: AuthUser) {
    return this.articlesService.create(dto, actor);
  }

  @Roles(RoleName.MEMBER, RoleName.AUTHOR, RoleName.EDITOR, RoleName.ADMIN, RoleName.SUPER_ADMIN)
  @Get('articles')
  list(@Query() query: AdminQueryArticlesDto, @CurrentUser() actor: AuthUser) {
    return this.articlesService.adminList(query, actor);
  }

  @Roles(RoleName.MEMBER, RoleName.AUTHOR, RoleName.EDITOR, RoleName.ADMIN, RoleName.SUPER_ADMIN)
  @Get('articles/:id')
  detail(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.articlesService.findOneForAdmin(id, actor);
  }

  @Roles(RoleName.MEMBER, RoleName.AUTHOR, RoleName.EDITOR, RoleName.ADMIN, RoleName.SUPER_ADMIN)
  @Patch('articles/:id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateArticleDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.articlesService.update(id, dto, actor);
  }

  @Roles(RoleName.MEMBER, RoleName.AUTHOR, RoleName.EDITOR, RoleName.ADMIN, RoleName.SUPER_ADMIN)
  @Delete('articles/:id')
  remove(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.articlesService.remove(id, actor);
  }

  @Roles(RoleName.EDITOR, RoleName.ADMIN, RoleName.SUPER_ADMIN)
  @Patch('articles/:id/publish')
  publish(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.articlesService.setPublished(id, true, actor);
  }

  @Roles(RoleName.EDITOR, RoleName.ADMIN, RoleName.SUPER_ADMIN)
  @Patch('articles/:id/unpublish')
  unpublish(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.articlesService.setPublished(id, false, actor);
  }

  @Roles(RoleName.ADMIN, RoleName.SUPER_ADMIN)
  @Post('topics')
  createTopic(@Body() dto: CreateTopicDto) {
    return this.taxonomiesService.createTopic(dto);
  }

  @Roles(RoleName.ADMIN, RoleName.SUPER_ADMIN)
  @Patch('topics/:id')
  updateTopic(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTopicDto,
  ) {
    return this.taxonomiesService.updateTopic(id, dto);
  }

  @Roles(RoleName.ADMIN, RoleName.SUPER_ADMIN)
  @Delete('topics/:id')
  removeTopic(@Param('id', ParseIntPipe) id: number) {
    return this.taxonomiesService.removeTopic(id);
  }

  @Roles(RoleName.ADMIN, RoleName.SUPER_ADMIN)
  @Post('categories')
  createCategory(@Body() dto: CreateCategoryDto) {
    return this.taxonomiesService.createCategory(dto);
  }

  @Roles(RoleName.ADMIN, RoleName.SUPER_ADMIN)
  @Patch('categories/:id')
  updateCategory(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.taxonomiesService.updateCategory(id, dto);
  }

  @Roles(RoleName.ADMIN, RoleName.SUPER_ADMIN)
  @Delete('categories/:id')
  removeCategory(@Param('id', ParseIntPipe) id: number) {
    return this.taxonomiesService.removeCategory(id);
  }
}
