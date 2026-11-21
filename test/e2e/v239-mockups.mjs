/**
 * v2.3.9 labeled mockups at 1920×1080:
 * 1) Side-by-side: primary S+Compact More vs tile More (must match)
 * 2) MV 2 — More open on tile
 * 3) MV 4 — More open on tile
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

async function run() {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const { server, base } = await startServer();
  const userDataDir = fs.mkdtempSync(path.join('/tmp', 'omt-mockup239-'));
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

    // MV 2 — open More on primary AND tile for side-by-side parity
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

    const parity = await page.evaluate(async () => {
      const open = (btn, more) => {
        if (btn && more && !more.classList.contains('is-open')) btn.click();
      };
      const root = document.getElementById('omt-root');
      const tile = document.querySelector('[data-omt-tile-root]');
      open(root.querySelector('#omt-more-toggle'), root.querySelector('#omt-more-panel'));
      open(tile.querySelector('.omt-more-toggle'), tile.querySelector('.omt-more-panel'));
      await new Promise((r) => setTimeout(r, 100));

      const metric = (scope) => {
        const panel = scope.querySelector('.omt-controls-panel, #omt-controls-panel');
        const more = scope.querySelector('.omt-more-panel, #omt-more-panel');
        const kick = scope.querySelector('.btn-sync, [id$="omt-btn-set-kickoff"]');
        const clear = scope.querySelector('.btn-clear-timer, [id$="omt-btn-clear-timer"]');
        const nudge = scope.querySelector('.omt-offset-btn');
        const label = scope.querySelector('.omt-more-label');
        const cs = (el) => el ? getComputedStyle(el) : null;
        const box = (el) => {
          if (!el) return null;
          const r = el.getBoundingClientRect();
          const s = cs(el);
          return {
            w: Math.round(r.width),
            h: Math.round(r.height),
            pad: s.padding,
            fs: s.fontSize,
            radius: s.borderRadius,
            bg: s.backgroundColor,
            flex: s.flexGrow + '/' + s.flexShrink + '/' + s.flexBasis
          };
        };
        return {
          moreOpen: !!(more && more.classList.contains('is-open')),
          kick: box(kick),
          clear: box(clear),
          nudge: box(nudge),
          labelFs: label ? cs(label).fontSize : null,
          morePad: more ? cs(more).padding : null,
          moreMaxH: more ? cs(more).maxHeight : null
        };
      };
      const primary = metric(root);
      const secondary = metric(tile);
      const near = (a, b, tol = 2) => Math.abs(a - b) <= tol;
      const match = primary.kick && secondary.kick &&
        near(primary.kick.w, secondary.kick.w, 4) &&
        near(primary.kick.h, secondary.kick.h, 2) &&
        primary.kick.pad === secondary.kick.pad &&
        primary.kick.fs === secondary.kick.fs &&
        primary.kick.radius === secondary.kick.radius &&
        primary.clear && secondary.clear &&
        near(primary.clear.w, secondary.clear.w, 4) &&
        near(primary.clear.h, secondary.clear.h, 2) &&
        primary.clear.pad === secondary.clear.pad &&
        primary.morePad === secondary.morePad &&
        primary.moreMaxH === secondary.moreMaxH &&
        primary.kick.flex === secondary.kick.flex &&
        primary.kick.flex.indexOf('1') !== 0; // not flex-grow 1
      return { match, primary, secondary };
    });
    console.log('[parity]', JSON.stringify(parity, null, 2));

    shots.push(await labelAndShot(
      page,
      'v239_mockup_01_primary_vs_tile_more_side_by_side.png',
      '1) Primary S+Compact More (left) vs tile More (right) — must look identical',
      'v2.3.9 · same Kick-off / X / nudge size · shared .omt-kickoff-bar CSS'
    ));

    // MV 2 — tile More only (close primary for a clean tile shot)
    await page.evaluate(() => {
      const rootBtn = document.querySelector('#omt-more-toggle');
      const rootMore = document.querySelector('#omt-more-panel');
      if (rootBtn && rootMore && rootMore.classList.contains('is-open')) rootBtn.click();
      const tile = document.querySelector('[data-omt-tile-root]');
      const btn = tile && tile.querySelector('.omt-more-toggle');
      const more = tile && tile.querySelector('.omt-more-panel');
      if (btn && more && !more.classList.contains('is-open')) btn.click();
    });
    await page.waitForTimeout(100);
    await showPanels(page);
    shots.push(await labelAndShot(
      page,
      'v239_mockup_02_inplay_mv_2tile_more_open.png',
      '2) MV 2 — tile More controls open (S+Compact parity)',
      'v2.3.9 · compact Kick-off + X · not the giant 2.3.8 block'
    ));

    // MV 4
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
    const mv4 = await page.evaluate(async () => {
      const tile = document.querySelector('[data-omt-tile-root]');
      const btn = tile && tile.querySelector('.omt-more-toggle');
      const more = tile && tile.querySelector('.omt-more-panel');
      const panel = tile && tile.querySelector('.omt-controls-panel');
      if (btn && more && !more.classList.contains('is-open')) btn.click();
      await new Promise((r) => setTimeout(r, 100));
      const kick = tile.querySelector('.omt-kickoff-bar .btn-sync');
      const clear = tile.querySelector('.omt-kickoff-bar .btn-clear-timer');
      const kr = kick.getBoundingClientRect();
      const cr = clear.getBoundingClientRect();
      const tr = tile.getBoundingClientRect();
      const pr = panel.getBoundingClientRect();
      return {
        kickH: Math.round(kr.height),
        kickW: Math.round(kr.width),
        clearH: Math.round(cr.height),
        clearW: Math.round(cr.width),
        kickPad: getComputedStyle(kick).padding,
        flex: getComputedStyle(kick).flexGrow,
        inside: pr.top >= tr.top - 2 && pr.bottom <= tr.bottom + 2,
        moreMaxH: getComputedStyle(more).maxHeight
      };
    });
    console.log('[mv4more]', mv4);
    shots.push(await labelAndShot(
      page,
      'v239_mockup_03_inplay_mv_4tile_more_open.png',
      '3) MV 4 — tile More controls open (S+Compact parity)',
      'v2.3.9 · Kick-off / X match primary · panel inside tile'
    ));

    // FitMore vs dragged: ensure we do not rewrite top/left
    const dragCheck = await page.evaluate(async () => {
      const tile = document.querySelector('[data-omt-tile-root]');
      const panel = tile.querySelector('.omt-controls-panel');
      const btn = tile.querySelector('.omt-more-toggle');
      const more = tile.querySelector('.omt-more-panel');
      // Simulate user drag geometry
      panel.dataset.omtUserDragged = '1';
      panel.style.left = '24px';
      panel.style.top = '40px';
      panel.style.bottom = 'auto';
      panel.style.transform = 'none';
      const before = { left: panel.style.left, top: panel.style.top, bottom: panel.style.bottom };
      if (!more.classList.contains('is-open')) btn.click();
      else btn.click(); // toggle to invoke FitMore
      await new Promise((r) => setTimeout(r, 40));
      btn.click();
      await new Promise((r) => setTimeout(r, 40));
      const after = { left: panel.style.left, top: panel.style.top, bottom: panel.style.bottom };
      return {
        ok: before.left === after.left && before.top === after.top && after.bottom === 'auto',
        before, after
      };
    });
    console.log('[dragCheck]', dragCheck);

    fs.writeFileSync(
      path.join(ARTIFACTS, 'v239_mockup_INDEX.txt'),
      shots.map((s, i) => `${i + 1}. ${path.basename(s)}`).join('\n') + '\n' +
        'parity.match=' + parity.match + '\n' +
        'dragCheck.ok=' + dragCheck.ok + '\n'
    );
    console.log('[mockup] done', shots.length, 'parity', parity.match, 'drag', dragCheck.ok);
    if (!parity.match || !dragCheck.ok) process.exitCode = 1;
  } finally {
    await context.close().catch(() => {});
    server.close();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
