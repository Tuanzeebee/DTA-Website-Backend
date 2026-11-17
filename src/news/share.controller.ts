import {
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  StreamableFile,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ArticleStatus } from '@prisma/client';
import { readFile } from 'fs/promises';
import { resolve, sep } from 'path';
import sharp from 'sharp';
import { Public } from '../auth/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { resolveThumbnailUrl } from './articles.service';

export interface ShareMeta {
  title: string;
  description: string;
  url: string;
  image: string;
}

/** Facebook/Zalo's recommended large-card size. */
const OG_W = 1200;
const OG_H = 630;

/** Map a site-relative thumbnail URL (/uploads/…, /news-images/…) to its file
 *  on disk; null for external URLs or anything escaping its root folder. */
export function localImagePath(
  url: string,
  uploadsDir: string,
  newsImagesDir: string,
): string | null {
  const m = /^\/(uploads|news-images)\/([^?#]+)$/.exec(url);
  if (!m) return null;
  const root = resolve(m[1] === 'uploads' ? uploadsDir : newsImagesDir);
  const file = resolve(root, decodeURIComponent(m[2]));
  return file.startsWith(root + sep) ? file : null;
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
    `<meta property="og:site_name" content="DTA - Hiệp hội Công nghệ số Đà Nẵng" />`,
    `<meta property="og:locale" content="vi_VN" />`,
    `<meta property="og:image" content="${esc(m.image)}" />`,
    `<meta property="og:image:type" content="image/jpeg" />`,
    `<meta property="og:image:width" content="${OG_W}" />`,
    `<meta property="og:image:height" content="${OG_H}" />`,
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
  private readonly uploadsDir = resolve(process.cwd(), 'uploads');
  private readonly newsImagesDir: string;

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
    this.newsImagesDir = resolve(
      config.get<string>('EXPORT_DIR', './craw-data/export'),
      'images',
    );
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
      // Local images go through /og (JPEG 1200x630): uploads are WebP, which
      // Zalo doesn't preview reliably. /api/* is already proxied to us.
      image: !img
        ? `${this.siteUrl}/og-image.jpg`
        : img.startsWith('/')
          ? `${this.siteUrl}/api/share/og/${encodeURIComponent(slug)}.jpg`
          : img,
    });
  }

  /** GET /share/og/:slug.jpg — the article's cover as a 1200x630 JPEG. */
  @Public()
  @Get('og/:file')
  @Header('Content-Type', 'image/jpeg')
  @Header('Cache-Control', 'public, max-age=86400')
  async ogImage(@Param('file') file: string): Promise<StreamableFile> {
    const slug = file.replace(/\.jpg$/i, '');
    const a = await this.prisma.newsArticle.findFirst({
      where: { slug, status: ArticleStatus.PUBLISHED, deletedAt: null },
      select: { thumbnailUrl: true },
    });
    const path = localImagePath(
      resolveThumbnailUrl(a?.thumbnailUrl),
      this.uploadsDir,
      this.newsImagesDir,
    );
    if (!path) throw new NotFoundException();
    // ponytail: re-encodes per request; Cloudflare caches it a day. Write a
    // .og.jpg next to the upload if bot traffic ever shows up in CPU.
    const jpg = await sharp(
      await readFile(path).catch(() => {
        throw new NotFoundException();
      }),
    )
      .rotate()
      .resize(OG_W, OG_H, { fit: 'cover', position: 'attention' })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
    return new StreamableFile(jpg);
  }
}
