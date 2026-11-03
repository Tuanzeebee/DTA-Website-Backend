import { existsSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import sharp from 'sharp';
import { toWebp } from './image';

describe('toWebp', () => {
  it('resizes to ≤1920px webp and removes the original', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'img-'));
    const path = join(dir, 'a.png');
    writeFileSync(
      path,
      await sharp({ create: { width: 4000, height: 1000, channels: 3, background: '#036' } })
        .png()
        .toBuffer(),
    );
    const name = await toWebp({ path, filename: 'a.png', mimetype: 'image/png' } as Express.Multer.File);
    expect(name).toBe('a.webp');
    expect(existsSync(path)).toBe(false);
    const meta = await sharp(join(dir, name)).metadata();
    expect([meta.format, meta.width]).toEqual(['webp', 1920]);
  });

  it('keeps GIFs untouched', async () => {
    const file = { path: '/x/a.gif', filename: 'a.gif', mimetype: 'image/gif' } as Express.Multer.File;
    expect(await toWebp(file)).toBe('a.gif');
  });
});
