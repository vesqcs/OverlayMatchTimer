/**
 * v2.3.8 labeled mockups at 1920×1080:
 * 1) MV 4 fresh — no clock chips
 * 2) MV clock set on one tile + cleared with X on another
 * 3) More controls open on MV 2 tile
 * 4) More controls open on MV 4 tile
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

async function forceMvSync(page) {
  await page.evaluate(() => {
    try {
      localStorage.setItem('omtPanelSize', 'medium');
      localStorage.setItem('omtPanelCompact', 'false');
    } catch (_) {}
    if (typeof window.__omtInplayMvForceSync === 'function') window.__omtInplayMvForceSync();
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

function clockSnap() {
  return (() => {
    const primaryWrap = document.getElementById('match-timer-wrap');
    const primaryDisp = primaryWrap ? getComputedStyle(primaryWrap).display : 'none';
    const tiles = Array.from(document.querySelectorAll('[data-omt-tile-root]')).map((tr) => {
      const wrap = tr.querySelector('.omt-match-timer-wrap, [id$="match-timer-wrap"]');
      const clock = tr.querySelector('.omt-match-timer, [id$="match-timer"]');
      const disp = wrap ? getComputedStyle(wrap).display : 'none';
      return {
        on: tr.classList.contains('omt-timer-on'),
        visible: !!(wrap && disp !== 'none' && disp !== ''),
        text: clock ? (clock.textContent || '').trim() : ''
      };
    });
    return {
      primaryVisible: !!(primaryWrap && primaryDisp !== 'none' && primaryDisp !== ''),
      tiles
    };
  })();
}

async function run() {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const { server, base } = await startServer();
  const userDataDir = fs.mkdtempSync(path.join('/tmp', 'omt-mockup238-'));
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

    // 1) MV 4 fresh — no clock chips anywhere
    await page.goto(`${base}/inplayip-multiview-mock.html?tiles=4`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    await waitForOmt(page);
    await page.waitForFunction(
      () => window.__omtInplayMvActive === true &&
        document.querySelectorAll('[data-omt-tile-root]').length === 3,
      { timeout: 10000 }
    ).catch(() => {});
    await forceMvSync(page);
    await page.waitForTimeout(120);
    await showPanels(page);
    const checkFresh = await page.evaluate(clockSnap);
    console.log('[checkFresh]', JSON.stringify(checkFresh));
    shots.push(await labelAndShot(
      page,
      'v238_mockup_01_inplay_mv_4tile_fresh_no_clock_chips.png',
      '1) InPlay multi-view — 4 tiles fresh (no clock chips)',
      'v2.3.8 · no Pre-Match until kickoff is set on that tile'
    ));

    // 2) Clock on tile B only; set then clear tile C with X → no chip on C
    const checkKickClear = await page.evaluate(async () => {
      const tiles = Array.from(document.querySelectorAll('[data-omt-tile-root]'));
      const snap = () => {
        const primaryWrap = document.getElementById('match-timer-wrap');
        const primaryDisp = primaryWrap ? getComputedStyle(primaryWrap).display : 'none';
        return {
          primaryVisible: !!(primaryWrap && primaryDisp !== 'none' && primaryDisp !== ''),
          tiles: tiles.map((tr) => {
            const wrap = tr.querySelector('.omt-match-timer-wrap, [id$="match-timer-wrap"]');
            const clock = tr.querySelector('.omt-match-timer, [id$="match-timer"]');
            const disp = wrap ? getComputedStyle(wrap).display : 'none';
            return {
              on: tr.classList.contains('omt-timer-on'),
              visible: !!(wrap && disp !== 'none' && disp !== ''),
              text: clock ? (clock.textContent || '').trim() : ''
            };
          })
        };
      };
      const openMore = async (tile) => {
        const more = tile.querySelector('.omt-more-toggle');
        if (more && more.getAttribute('aria-expanded') !== 'true') more.click();
        await new Promise((r) => setTimeout(r, 50));
      };
      const closeMore = (tile) => {
        const more = tile.querySelector('.omt-more-toggle');
        if (more && more.getAttribute('aria-expanded') === 'true') more.click();
      };

      // Kickoff on B (first secondary)
      await openMore(tiles[0]);
      tiles[0].querySelector('[id$="omt-btn-set-kickoff"]')?.click();
      const videoB = document.querySelectorAll('video')[1];
      if (videoB) {
        videoB.currentTime = Math.min((videoB.currentTime || 0) + 8, (videoB.duration || 20) - 1);
        videoB.dispatchEvent(new Event('timeupdate'));
      }
      await new Promise((r) => setTimeout(r, 80));
      closeMore(tiles[0]);

      // Kickoff then clear C (second secondary)
      await openMore(tiles[1]);
      tiles[1].querySelector('[id$="omt-btn-set-kickoff"]')?.click();
      await new Promise((r) => setTimeout(r, 60));
      tiles[1].querySelector('[id$="omt-btn-clear-timer"]')?.click();
      await new Promise((r) => setTimeout(r, 60));
      closeMore(tiles[1]);

      document.querySelectorAll('.omt-more-toggle[aria-expanded="true"]').forEach((b) => b.click());
      await new Promise((r) => setTimeout(r, 40));
      return snap();
    });
    console.log('[checkKickClear]', JSON.stringify(checkKickClear));
    await showPanels(page);
    shots.push(await labelAndShot(
      page,
      'v238_mockup_02_inplay_mv_clock_one_set_one_cleared.png',
      '2) Clock set on one tile only · cleared with X on another (no chip)',
      'v2.3.8 · B has match clock · C cleared → nothing · D never set'
    ));

    // 3) More controls open on MV 2
    await page.goto(`${base}/inplayip-multiview-mock.html?tiles=2`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    await waitForOmt(page);
    await page.waitForFunction(
      () => window.__omtInplayMvActive === true &&
        document.querySelectorAll('[data-omt-tile-root]').length >= 1,
      { timeout: 10000 }
    ).catch(() => {});
    await forceMvSync(page);
    await page.waitForTimeout(120);
    await showPanels(page);
    const checkMore2 = await page.evaluate(async () => {
      const tile = document.querySelector('[data-omt-tile-root]');
      const btn = tile && tile.querySelector('.omt-more-toggle');
      const more = tile && tile.querySelector('.omt-more-panel');
      const panel = tile && tile.querySelector('.omt-controls-panel');
      if (!btn || !more || !panel) return { ok: false };
      if (!more.classList.contains('is-open')) btn.click();
      await new Promise((r) => setTimeout(r, 80));
      const tr = tile.getBoundingClientRect();
      const pr = panel.getBoundingClientRect();
      const mr = more.getBoundingClientRect();
      const inside = pr.top >= tr.top - 2 && pr.bottom <= tr.bottom + 2 &&
        mr.top >= tr.top - 2 && mr.bottom <= tr.bottom + 2;
      return {
        ok: more.classList.contains('is-open') && inside && mr.height > 20,
        inside,
        moreH: Math.round(mr.height),
        panelTop: Math.round(pr.top - tr.top)
      };
    });
    console.log('[checkMore2]', checkMore2);
    shots.push(await labelAndShot(
      page,
      'v238_mockup_03_inplay_mv_2tile_more_controls_open.png',
      '3) More controls open — MV 2 tiles (S+Compact)',
      'v2.3.8 · kickoff row visible · panel inside tile · not clipped'
    ));

    // 4) More controls open on MV 4
    await page.goto(`${base}/inplayip-multiview-mock.html?tiles=4`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    await waitForOmt(page);
    await page.waitForFunction(
      () => window.__omtInplayMvActive === true &&
        document.querySelectorAll('[data-omt-tile-root]').length === 3,
      { timeout: 10000 }
    ).catch(() => {});
    await forceMvSync(page);
    await page.waitForTimeout(120);
    await showPanels(page);
    const checkMore4 = await page.evaluate(async () => {
      const tile = document.querySelector('[data-omt-tile-root]');
      const btn = tile && tile.querySelector('.omt-more-toggle');
      const more = tile && tile.querySelector('.omt-more-panel');
      const panel = tile && tile.querySelector('.omt-controls-panel');
      if (!btn || !more || !panel) return { ok: false };
      if (!more.classList.contains('is-open')) btn.click();
      await new Promise((r) => setTimeout(r, 100));
      const tr = tile.getBoundingClientRect();
      const pr = panel.getBoundingClientRect();
      const mr = more.getBoundingClientRect();
      const inside = pr.top >= tr.top - 2 && pr.bottom <= tr.bottom + 2 &&
        mr.top >= tr.top - 2 && mr.bottom <= tr.bottom + 2;
      return {
        ok: more.classList.contains('is-open') && inside && mr.height > 20,
        inside,
        moreH: Math.round(mr.height),
        panelTop: Math.round(pr.top - tr.top),
        tileH: Math.round(tr.height)
      };
    });
    console.log('[checkMore4]', checkMore4);
    shots.push(await labelAndShot(
      page,
      'v238_mockup_04_inplay_mv_4tile_more_controls_open.png',
      '4) More controls open — MV 4 tiles (S+Compact)',
      'v2.3.8 · sized/positioned inside tile · closes via chevron'
    ));

    fs.writeFileSync(
      path.join(ARTIFACTS, 'v238_mockup_INDEX.txt'),
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
