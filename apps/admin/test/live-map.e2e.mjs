import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';

const require = createRequire(import.meta.url);
const { webpack } = require('next/dist/compiled/webpack/webpack');
const testDir = dirname(fileURLToPath(import.meta.url));
const output = await mkdtemp(join(tmpdir(), 'osta-map-regression-'));
let browser;
let server;
try {
  await new Promise((resolve, reject) => {
    const compiler = webpack({
      mode: 'development', devtool: false,
      entry: join(testDir, 'fixtures/live-map-harness.tsx'),
      output: { path: output, filename: 'map.js' },
      resolve: { extensions: ['.tsx', '.ts', '.js'], alias: { '@': join(testDir, '../src') } },
      module: { rules: [{ test: /\.(tsx?|css)$/, use: join(testDir, 'fixtures/map-test-loader.cjs') }] },
      plugins: [new webpack.DefinePlugin({ 'process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN': JSON.stringify('') })],
    });
    compiler.run((error, stats) => compiler.close(() => {
      if (error || stats.hasErrors()) reject(error ?? new Error(stats.toString()));
      else resolve();
    }));
  });
  server = createServer(async (req, res) => {
    const path = req.url?.split('?')[0];
    try {
      if (path === '/') {
        res.setHeader('Content-Type', 'text/html');
        res.end('<html><head><meta charset="utf-8"><link rel="stylesheet" href="/leaflet.css"><style>[aria-label="خريطة الفنيين والطلبات"]{height:544px;width:100%}</style></head><body><div id="root"></div><script src="/map.js"></script></body></html>');
      } else if (path === '/leaflet.css') {
        res.setHeader('Content-Type', 'text/css');
        res.end(await readFile(require.resolve('leaflet/dist/leaflet.css')));
      } else if (/^\/[a-zA-Z0-9_.-]+\.js$/.test(path ?? '')) {
        res.setHeader('Content-Type', 'application/javascript');
        res.end(await readFile(join(output, path.slice(1))));
      } else { res.statusCode = 404; res.end(); }
    } catch { res.statusCode = 500; res.end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  if (process.env.MAP_MANUAL === '1') {
    console.log(`Manual map verification: ${url}`);
    await new Promise((resolve) => process.once('SIGINT', resolve));
  } else {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let failTiles = false;
  let tileRequests = 0;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK1kAAAAASUVORK5CYII=', 'base64');
  // صور اختبار محلية فقط: لا ضغط ولا تنزيل آلي لبلاطات المزود العام.
  await page.route('https://tile.openstreetmap.org/**', (route) => {
    tileRequests += 1;
    return failTiles ? route.fulfill({ status: 503, body: '' }) : route.fulfill({ contentType: 'image/png', body: png });
  });
  await page.goto(url);
  await page.waitForFunction(() => document.querySelectorAll('.leaflet-overlay-pane path').length === 3);
  assert.equal(await page.locator('.leaflet-container').evaluate((element) => element.clientHeight), 544);
  assert.ok(tileRequests > 0, 'missing token must still request fallback tiles');
  assert.equal(await page.locator('.leaflet-control-attribution a[href*="openstreetmap.org"]').count(), 1);
  assert.equal(await page.locator('.leaflet-tile').first().getAttribute('referrerpolicy'), 'strict-origin-when-cross-origin');
  console.log('PASS fallback + immediate markers + attribution + Referer');
  await page.getByRole('button', { name: 'Update data' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.leaflet-overlay-pane path').length === 5);
  await page.getByRole('button', { name: 'Toggle map' }).click();
  await page.getByRole('button', { name: 'Toggle map' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.leaflet-overlay-pane path').length === 5);
  await page.setViewportSize({ width: 500, height: 800 });
  await page.waitForFunction(() => document.querySelector('.leaflet-container').clientWidth < 510);
  console.log('PASS data refresh + StrictMode cleanup/remount + resize');
  failTiles = true;
  await page.reload();
  await page.getByRole('alert').waitFor();
  await page.waitForTimeout(500);
  assert.equal(await page.getByRole('alert').count(), 1, 'error must survive failed tile load completion');
  failTiles = false;
  await page.getByRole('button', { name: 'إعادة المحاولة' }).click();
  await page.getByRole('alert').waitFor({ state: 'detached' });
  await page.waitForFunction(() => document.querySelectorAll('.leaflet-overlay-pane path').length === 3 && document.querySelector('.leaflet-tile-loaded'));
  assert.deepEqual(errors, []);
  console.log('PASS visible tile failure + retry recovery + no page errors');
  }
} finally {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  await rm(output, { recursive: true, force: true });
}
