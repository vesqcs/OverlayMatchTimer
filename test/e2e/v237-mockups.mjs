/**
 * v2.3.7 labeled mockups at 1920×1080:
 * MV 2 / MV 4 equal S+Compact (no speed row), then single restored.
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveFixture } from './host-scenarios.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const EXT = path.join(ROOT, 'Overlay-chrome-extension');
const FIXTURES = path.join(ROOT, 'test/fixtures');
const ARTIFACTS = '/opt/cursor/artifacts';
const W = 1920;
const H = 1080;

function contentType(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.mp4')) return 'video/mp4';
  return 'application/octet-stream';
}

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      if (urlPath.includes('favicon')) {
        res.writeHead(204);
        res.end();
        return;
      }
      const filePath = resolveFixture(FIXTURES, urlPath);
      if (!filePath.startsWith(FIXTURES) || !fs.existsSync(filePath)) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': contentType(filePath) });
      fs.createReadStream(filePath).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

async function waitForOmt(page, timeout = 30000) {
  await page.waitForFunction(() => !!document.getElementById('omt-root'), null, { timeout });
}

async function showPanels(page) {
  await page.evaluate(() => {
    document.querySelectorAll('.omt-controls-panel, #omt-controls-panel, .omt-timeline-bar').forEach((el) => {
      el.style.opacity = '1';
      el.style.pointerEvents = 'auto';
    });
    document.querySelectorAll('.omt-more-toggle[aria-expanded="true"]').forEach((b) => b.click());
  });
}

async function labelAndShot(page, outName, title, subtitle) {
  await page.evaluate(({ title: t, subtitle: s }) => {
    let banner = document.getElementById('omt-mockup-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'omt-mockup-banner';
      banner.style.cssText = [
        'position:fixed', 'left:0', 'right:0', 'top:0', 'z-index:2147483646',
        'pointer-events:none', 'padding:14px 28px 16px',
        'background:linear-gradient(180deg,rgba(0,0,0,0.88),rgba(0,0,0,0.55) 70%,transparent)',
        'font-family:"Segoe UI",system-ui,sans-serif', 'color:#fff'
      ].join(';');
      document.documentElement.appendChild(banner);
    }
    banner.innerHTML =
      '<div style="font-size:22px;font-weight:700">' + t + '</div>' +
      (s ? '<div style="margin-top:4px;font-size:14px;color:#F5831F">' + s + '</div>' : '');
  }, { title, subtitle });
  await page.waitForTimeout(80);
  const out = path.join(ARTIFACTS, outName);
  await page.screenshot({ path: out, fullPage: false });
  console.log('[mockup]', out);
  return out;
}

async function run() {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const { server, base } = await startServer();
  const userDataDir = fs.mkdtempSync(path.join('/tmp', 'omt-mockup237-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${EXT}`,
      `--load-extension=${EXT}`,
      '--disable-features=ExtensionDisableUnsupportedDeveloper',
      '--no-sandbox',
      '--disable-gpu'
    ],
    viewport: { width: W, height: H }
  });
  const page = context.pages()[0] || await context.newPage();
  const shots = [];

  try {
    await page.setViewportSize({ width: W, height: H });

    // Prefs: user normal = M, not compact — so MV force is visible vs restore.
    const setUserMedium = async () => {
      await page.evaluate(() => {
        try {
          localStorage.setItem('omtPanelSize', 'medium');
          localStorage.setItem('omtPanelCompact', 'false');
        } catch (_) {}
      });
    };

    // 1) MV 2 tiles — equal S + Compact, no speed
    await page.goto(`${base}/inplayip-multiview-mock.html?tiles=2`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    await waitForOmt(page);
    await page.waitForFunction(
      () => window.__omtInplayMvActive === true &&
        document.querySelectorAll('[data-omt-tile-root]').length >= 1,
      { timeout: 10000 }
    ).catch(() => {});
    await setUserMedium();
    await page.evaluate(() => {
      if (typeof window.__omtInplayMvForceSync === 'function') window.__omtInplayMvForceSync();
    });
    await page.waitForTimeout(120);
    await showPanels(page);
    const check2 = await page.evaluate(() => {
      const all = [
        document.getElementById('omt-controls-panel'),
        ...document.querySelectorAll('[data-omt-tile-root] .omt-controls-panel')
      ].filter(Boolean);
      return {
        n: all.length,
        allS: all.every((p) => p.classList.contains('omt-panel-size-small')),
        allC: all.every((p) => p.classList.contains('omt-panel-compact')),
        speedHidden: all.every((p) => {
          const r = p.querySelector('.omt-speed-row');
          return !r || getComputedStyle(r).display === 'none';
        }),
        widths: all.map((p) => Math.round(p.getBoundingClientRect().width))
      };
    });
    console.log('[check2]', check2);
    shots.push(await labelAndShot(
      page,
      'v237_mockup_01_inplay_mv_2tile_equal_s_no_speed.png',
      '1) InPlay multi-view — 2 videos, equal S panels (no speed row)',
      'v2.3.7 · omt-panel-size-small + omt-panel-compact on primary + tile'
    ));

    // 2) MV 4 tiles
    await page.goto(`${base}/inplayip-multiview-mock.html?tiles=4`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    await waitForOmt(page);
    await page.waitForFunction(
      () => window.__omtInplayMvActive === true &&
        document.querySelectorAll('[data-omt-tile-root]').length === 3,
      { timeout: 10000 }
    ).catch(() => {});
    await setUserMedium();
    await page.evaluate(() => {
      if (typeof window.__omtInplayMvForceSync === 'function') window.__omtInplayMvForceSync();
    });
    await page.waitForTimeout(120);
    await showPanels(page);
    const check4 = await page.evaluate(() => {
      const all = [
        document.getElementById('omt-controls-panel'),
        ...document.querySelectorAll('[data-omt-tile-root] .omt-controls-panel')
      ].filter(Boolean);
      return {
        n: all.length,
        allS: all.every((p) => p.classList.contains('omt-panel-size-small')),
        allC: all.every((p) => p.classList.contains('omt-panel-compact')),
        speedHidden: all.every((p) => {
          const r = p.querySelector('.omt-speed-row');
          return !r || getComputedStyle(r).display === 'none';
        }),
        widths: all.map((p) => Math.round(p.getBoundingClientRect().width))
      };
    });
    console.log('[check4]', check4);
    shots.push(await labelAndShot(
      page,
      'v237_mockup_02_inplay_mv_4tile_equal_s_no_speed.png',
      '2) InPlay multi-view — 4 videos, all equal S (no speed row)',
      'v2.3.7 · every tile + primary same Customization S+Compact look'
    ));

    // 3) Back to 1 video — normal M + speed restored
    await page.evaluate(() => { window.__omtSetTiles && window.__omtSetTiles(1); });
    await page.waitForFunction(
      () => !window.__omtInplayMvActive &&
        document.querySelectorAll('[data-omt-tile-root]').length === 0,
      { timeout: 10000 }
    ).catch(() => {});
    await page.waitForTimeout(200);
    await showPanels(page);
    const check1 = await page.evaluate(() => {
      const p = document.getElementById('omt-controls-panel');
      const row = p && p.querySelector('.omt-speed-row');
      return {
        small: !!(p && p.classList.contains('omt-panel-size-small')),
        compact: !!(p && p.classList.contains('omt-panel-compact')),
        speedVisible: !!(row && getComputedStyle(row).display !== 'none'),
        active: !!window.__omtInplayMvActive
      };
    });
    console.log('[check1]', check1);
    shots.push(await labelAndShot(
      page,
      'v237_mockup_03_inplay_single_restored_normal.png',
      '3) Back to 1 video — normal panel restored (speed row back)',
      'v2.3.7 · user M / not compact · multi-view force cleared'
    ));

    fs.writeFileSync(
      path.join(ARTIFACTS, 'v237_mockup_INDEX.txt'),
      shots.map((s, i) => `${i + 1}. ${path.basename(s)}`).join('\n') + '\n'
    );
    console.log('[mockup] done', shots.length);
  } finally {
    await context.close().catch(() => {});
    server.close();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
