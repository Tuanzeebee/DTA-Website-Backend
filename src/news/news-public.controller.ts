import { Controller, Get, Param, Query } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { ArticlesService } from './articles.service';
import { QueryArticlesDto } from './dto/article.dto';
import { TaxonomiesService } from './taxonomies.service';

@Controller('news')
export class NewsPublicController {
  constructor(
    private readonly articlesService: ArticlesService,
    private readonly taxonomiesService: TaxonomiesService,
  ) {}

  @Public()
  @Get('topics')
  topics() {
    return this.taxonomiesService.listTopics();
  }

  @Public()
  @Get('categories')
  categories(@Query('topic') topic?: string) {
    return this.taxonomiesService.listCategories(topic);
  }

  @Public()
  @Get('articles')
  articles(@Query() query: QueryArticlesDto) {
    return this.articlesService.listPublished(query);
  }

  /** Single-call digest: returns latest N articles for each of the given topics. */
  @Public()
  @Get('articles/digest')
  digest(
    @Query('topics') topicsCsv?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const topics = topicsCsv
      ? topicsCsv.split(',').map((s) => s.trim()).filter(Boolean)
      : ['su-kien', 'tin-trong-nganh', 'dao-tao', 'xa-hoi', 'hoi-vien'];
    const size = Math.min(Number(pageSize) || 3, 10);
    return this.articlesService.getDigest(topics, size);
  }

  @Public()
  @Get('articles/:slug')
  articleDetail(@Param('slug') slug: string) {
    return this.articlesService.getPublishedBySlug(slug);
  }
}
