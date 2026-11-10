import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ArticlesService } from './articles.service';
import { NewsAdminController } from './news-admin.controller';
import { NewsPublicController } from './news-public.controller';
import { ShareController } from './share.controller';
import { TaxonomiesService } from './taxonomies.service';

@Module({
  imports: [PrismaModule],
  controllers: [NewsPublicController, NewsAdminController, ShareController],
  providers: [ArticlesService, TaxonomiesService],
})
export class NewsModule {}
