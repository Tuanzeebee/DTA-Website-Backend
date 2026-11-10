import { Controller, Get, Header, Param } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ArticleStatus } from '@prisma/client';
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { Public } from '../auth/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { resolveThumbnailUrl } from './articles.service';

export interface ShareMeta {
  title: string;
  description: string;
  url: string;
  image: string;
}

const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

/** Strip the SPA's generic <title>/description/og:/twitter: tags and insert
 *  the article's own — Facebook/Zalo don't run JS, they only read this HTML. */
export function injectShareMeta(html: string, m: ShareMeta): string {
  const t = esc(m.title);
  const d = esc(m.description);
  const tags = [
    `<title>${t}</title>`,
    `<meta name="description" content="${d}" />`,
    `<meta property="og:type" content="article" />`,
    `<meta property="og:title" content="${t}" />`,
    `<meta property="og:description" content="${d}" />`,
    `<meta property="og:url" content="${esc(m.url)}" />`,
    `<meta property="og:image" content="${esc(m.image)}" />`,
    `<meta property="og:image:alt" content="${t}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
  ].join('\n    ');
  return html
    .replace(/<title>[\s\S]*?<\/title>\s*/i, '')
    .replace(
      /<meta\s+(?:property|name)="(?:og:[^"]*|twitter:[^"]*|description)"[^>]*>\s*/gi,
      '',
    )
    .replace(/<\/head>/i, `    ${tags}\n  </head>`);
}

/**
 * GET /share/article/:slug — the web server rewrites /news/article/* here, so
 * every visitor (and every link-preview bot) gets index.html with the
 * article's og: tags; the React app then boots as usual. Does NOT count a
 * view: bots would inflate viewsCount.
 */
@Controller('share')
export class ShareController {
  private readonly indexPath: string;
  private readonly siteUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.indexPath = resolve(
      config.get<string>('FRONTEND_DIST', '../dta-news/dist'),
      'index.html',
    );
    this.siteUrl = config
      .get<string>('PUBLIC_SITE_URL', 'https://dta.com.vn')
      .replace(/\/+$/, '');
  }

  @Public()
  @Get('article/:slug')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-cache')
  async article(@Param('slug') slug: string): Promise<string> {
    // Re-read each time: a redeploy changes the hashed asset names inside.
    const html = await readFile(this.indexPath, 'utf8');
    const a = await this.prisma.newsArticle.findFirst({
      where: { slug, status: ArticleStatus.PUBLISHED, deletedAt: null },
      select: { title: true, summary: true, thumbnailUrl: true },
    });
    if (!a) return html; // SPA renders its own 404

    const img = resolveThumbnailUrl(a.thumbnailUrl);
    return injectShareMeta(html, {
      title: a.title,
      description: (a.summary ?? '').replace(/\s+/g, ' ').trim().slice(0, 200),
      url: `${this.siteUrl}/news/article/${encodeURIComponent(slug)}`,
      image: !img
        ? `${this.siteUrl}/og-image.jpg`
        : img.startsWith('/')
          ? `${this.siteUrl}${img}`
          : img,
    });
  }
}
