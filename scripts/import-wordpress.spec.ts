import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { main, resolveLocal } from './import-wordpress';

jest.mock('@prisma/client', () => {
  const actual = jest.requireActual('@prisma/client');
  return {
    ...actual,
    PrismaClient: jest.fn(() => ({
      newsTopic: { upsert: jest.fn(), findMany: jest.fn(), delete: jest.fn() },
      newsCategory: { upsert: jest.fn(), findMany: jest.fn(), delete: jest.fn() },
      newsArticle: { upsert: jest.fn() },
    })),
  };
});

const db = (PrismaClient as unknown as jest.Mock).mock.results[0].value;

describe('WordPress refresh import', () => {
  let root: string;
  let argv: string[];
  let exportDir: string | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsa-import-test-'));
    exportDir = process.env.EXPORT_DIR;
    process.env.EXPORT_DIR = path.join(root, 'canonical-export');
    argv = process.argv;
    process.argv = ['node', 'import-wordpress.ts', '--export', root];
    fs.writeFileSync(path.join(root, 'categories.json'), JSON.stringify([
      { id: 1, slug: 'tin-trong-nganh', name: 'Tin trong ngành' },
    ]));
    fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify([
      {
        id: 123, slug: 'bai-dsa', title: 'Tiêu đề mới', excerpt: 'Mô tả mới',
        categories: ['Tin trong ngành'], content_file: 'post.html',
        date: '2026-10-11T12:00:00', link: 'https://dsa.org.vn/bai-dsa/',
        featured_image: null,
      },
    ]));
    fs.writeFileSync(path.join(root, 'post.html'), '<p>Nội dung mới</p>');
    db.newsTopic.findMany.mockImplementation(async (args) => args?.where ? [] : [
      { id: 1, slug: 'su-kien', _count: { categories: 1 } },
      { id: 2, slug: 'tin-trong-nganh', _count: { categories: 1 } },
      { id: 3, slug: 'dao-tao', _count: { categories: 1 } },
      { id: 4, slug: 'xa-hoi', _count: { categories: 1 } },
      { id: 5, slug: 'hoi-vien', _count: { categories: 1 } },
    ]);
    db.newsCategory.upsert.mockResolvedValue({ id: 9 });
    db.newsCategory.findMany.mockResolvedValue([]);
    db.newsArticle.upsert.mockResolvedValue({ id: 'stable-db-id' });
  });

  afterEach(() => {
    process.argv = argv;
    if (exportDir === undefined) delete process.env.EXPORT_DIR;
    else process.env.EXPORT_DIR = exportDir;
    fs.rmSync(root, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  it('refreshes the same WP ID and replaces blocks without resetting admin fields', async () => {
    await main();
    fs.writeFileSync(path.join(root, 'post.html'), '<p>Đã sửa tại DSA</p>');
    await main();
    const calls = db.newsArticle.upsert.mock.calls;
    expect(calls).toHaveLength(2);
    for (const [args] of calls) {
      expect(args.where).toEqual({ wpId: 123 });
      expect(args.create.status).toBe('PUBLISHED');
      for (const field of ['id', 'viewsCount', 'authorId', 'tags', 'status', 'deletedAt']) {
        expect(args.update).not.toHaveProperty(field);
      }
      expect(args.update.blocks.deleteMany).toEqual({});
    }
    expect(calls[1][0].update.blocks.create[0].text).toBe('Đã sửa tại DSA');
  });

  it.each([null, ''])('refuses missing/empty HTML before any DB write (%s)', async (html) => {
    if (html === null) fs.unlinkSync(path.join(root, 'post.html'));
    else fs.writeFileSync(path.join(root, 'post.html'), html);
    await expect(main()).rejects.toThrow('thiếu HTML');
    expect(db.newsTopic.upsert).not.toHaveBeenCalled();
    expect(db.newsCategory.upsert).not.toHaveBeenCalled();
    expect(db.newsArticle.upsert).not.toHaveBeenCalled();
  });

  it('dry-run validates local files without writing DB', async () => {
    process.argv.push('--dry-run');
    await main();
    expect(db.newsTopic.upsert).not.toHaveBeenCalled();
    expect(db.newsArticle.upsert).not.toHaveBeenCalled();
  });

  it('does not treat a stale image mapping as a local download', () => {
    const url = 'https://dsa.org.vn/photo.jpg';
    expect(resolveLocal(url, { [url]: 'images/missing.jpg' }, new Map(), 'post')).toBeNull();
    const index = new Map([['photo.jpg', ['images/post/photo.jpg']]]);
    expect(resolveLocal(url, { [url]: 'images/missing.jpg' }, index, 'post'))
      .toBe('images/post/photo.jpg');
  });

  it('merges batch images into the serving export while keeping old images', async () => {
    const source = path.join(root, 'images', 'batch', 'new.jpg');
    const target = path.join(process.env.EXPORT_DIR!, 'images', 'batch', 'new.jpg');
    const old = path.join(process.env.EXPORT_DIR!, 'images', 'old.jpg');
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.mkdirSync(path.dirname(old), { recursive: true });
    fs.writeFileSync(source, 'new image');
    fs.writeFileSync(old, 'old image');
    fs.writeFileSync(path.join(root, 'post.html'),
      '<p>Nội dung</p><img src="https://dsa.org.vn/new.jpg">');
    const manifestPath = path.join(root, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest[0].local_images = { 'https://dsa.org.vn/new.jpg': 'images/batch/new.jpg' };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    process.argv.push('--dry-run');
    await main();
    expect(fs.existsSync(target)).toBe(false);
    process.argv.pop();
    await main();
    expect(fs.readFileSync(target, 'utf8')).toBe('new image');
    expect(fs.readFileSync(old, 'utf8')).toBe('old image');
    expect(db.newsArticle.upsert.mock.calls[0][0].create.blocks.create[1].imageLocalPath)
      .toBe('images/batch/new.jpg');
  });

  it('refuses an unfinished batch before any DB write', async () => {
    fs.writeFileSync(path.join(root, 'batch.json'), JSON.stringify({ ready: false }));
    await expect(main()).rejects.toThrow('chưa hoàn tất');
    expect(db.newsArticle.upsert).not.toHaveBeenCalled();
    expect(db.newsTopic.upsert).not.toHaveBeenCalled();
  });

  it('does not write DB for an empty batch', async () => {
    fs.writeFileSync(path.join(root, 'manifest.json'), '[]');
    await main();
    expect(db.newsArticle.upsert).not.toHaveBeenCalled();
    expect(db.newsTopic.upsert).not.toHaveBeenCalled();
  });
});
