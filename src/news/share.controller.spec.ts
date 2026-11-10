import { injectShareMeta } from './share.controller';

const INDEX = `<!doctype html><html><head>
    <title>DTA - chung</title>
    <meta
      name="description"
      content="chung"
    />
    <meta property="og:title" content="chung" />
    <meta property="og:image" content="https://dta.com.vn/og-image.jpg" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="viewport" content="width=device-width" />
  </head><body><div id="root"></div></body></html>`;

it('replaces generic tags with the article ones, escaped, once each', () => {
  const out = injectShareMeta(INDEX, {
    title: 'FPGA & MCU "2026"',
    description: 'Mô tả <b>',
    url: 'https://dta.com.vn/news/article/x',
    image: 'https://dta.com.vn/uploads/news/a.jpg',
  });
  expect(out).toContain('<title>FPGA &amp; MCU &quot;2026&quot;</title>');
  expect(out).toContain('property="og:image" content="https://dta.com.vn/uploads/news/a.jpg"');
  expect(out).toContain('content="Mô tả &lt;b&gt;"');
  expect(out).not.toContain('chung');
  expect(out).not.toContain('og-image.jpg');
  expect(out.match(/og:image"/g)).toHaveLength(1);
  expect(out.match(/twitter:card/g)).toHaveLength(1);
  expect(out).toContain('name="viewport"'); // untouched
});
