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

  @Public()
  @Get('articles/:slug')
  articleDetail(@Param('slug') slug: string) {
    return this.articlesService.getPublishedBySlug(slug);
  }
}
