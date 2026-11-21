/**
 * v2.3.6 labeled preview mockups at 1920×1080 for Vasco.
 * Uses the real extension + fixtures; overlays a title banner on each shot.
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

async function waitForOmt(page, timeout = 20000) {
  await page.waitForFunction(() => !!document.getElementById('omt-root'), null, { timeout });
}

async function showPanel(page) {
  await page.evaluate(() => {
    const panel = document.getElementById('omt-controls-panel');
    const bar = document.getElementById('omt-timeline-bar');
    if (panel) {
      panel.style.opacity = '1';
      panel.style.pointerEvents = 'auto';
    }
    if (bar) {
      bar.style.opacity = '1';
      bar.style.pointerEvents = 'auto';
    }
    document.querySelectorAll('[data-omt-tile-root] .omt-controls-panel').forEach((p) => {
      p.style.opacity = '1';
      p.style.pointerEvents = 'auto';
    });
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
      '<div style="font-size:22px;font-weight:700;letter-spacing:0.02em">' + t + '</div>' +
      (s ? '<div style="margin-top:4px;font-size:14px;opacity:0.9;color:#F5831F">' + s + '</div>' : '');
  }, { title, subtitle });
  await page.waitForTimeout(80);
  const out = path.join(ARTIFACTS, outName);
  await page.screenshot({ path: out, fullPage: false });
  console.log('[mockup]', out);
  return out;
}

async function resetDefaultCenter(page) {
  await page.evaluate(() => {
    const panel = document.getElementById('omt-controls-panel');
    if (!panel) return;
    try { delete panel.dataset.omtUserDragged; } catch (_) {}
    ['left', 'top', 'right', 'bottom', 'transform'].forEach((k) => {
      try { panel.style.removeProperty(k); } catch (_) {}
    });
  });
}

async function dragPanelToTop(page) {
  return page.evaluate(() => {
    const root = document.getElementById('omt-root');
    const panel = document.getElementById('omt-controls-panel');
    if (!root || !panel) return { ok: false };
    try { panel.dataset.omtUserDragged = '1'; } catch (_) {}
    panel.style.opacity = '1';
    const safe = (typeof window.__omtPanelTopSafeMargin === 'function')
      ? window.__omtPanelTopSafeMargin(root)
      : 64;
    const rw = root.clientWidth || root.getBoundingClientRect().width;
    const pw = panel.offsetWidth || 480;
    panel.style.left = Math.max(24, Math.round((rw - pw) / 2)) + 'px';
    panel.style.top = '0px';
    panel.style.bottom = 'auto';
    panel.style.right = 'auto';
    panel.style.transform = 'none';
    if (typeof window.__omtClampAllPanels === 'function') window.__omtClampAllPanels();
    const rr = root.getBoundingClientRect();
    const pr = panel.getBoundingClientRect();
    return {
      ok: true,
      safe: Math.round(safe),
      top: Math.round(pr.top - rr.top),
      handleBelow: (pr.top - rr.top) >= safe - 2
    };
  });
}

async function run() {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const { server, base } = await startServer();
  const userDataDir = fs.mkdtempSync(path.join('/tmp', 'omt-mockup-'));
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
  // Prefer an already-open page from persistent context (extension service worker).
  let page = context.pages()[0] || await context.newPage();
  const shots = [];

  try {
    // 1) InPlay single — default centred
    await page.setViewportSize({ width: W, height: H });
    await page.goto(`${base}/inplayip-schedule-mock.html`, { waitUntil: 'domcontentloaded' });
    // Give MV3 service worker / content script a moment to attach.
    await page.waitForTimeout(800);
    await waitForOmt(page, 30000);
    await page.waitForTimeout(300);
    await resetDefaultCenter(page);
    await showPanel(page);
    shots.push(await labelAndShot(
      page,
      'v236_mockup_01_inplay_single_centered.png',
      '1) InPlay single video — default panel centred',
      'v2.3.6 · 1920×1080 · never dragged · CSS left:50% + translateX(-50%)'
    ));

    // 2a) InPlay MV 2 tiles compact S
    await page.goto(`${base}/inplayip-multiview-mock.html?tiles=2`, { waitUntil: 'domcontentloaded' });
    await waitForOmt(page);
    await page.waitForFunction(
      () => window.__omtInplayMvActive === true &&
        document.querySelectorAll('[data-omt-tile-root]').length >= 1,
      { timeout: 10000 }
    ).catch(() => {});
    await page.waitForTimeout(250);
    await page.evaluate(() => {
      try {
        localStorage.setItem('omtPanelSize', 'medium');
        localStorage.setItem('omtPanelCompact', 'false');
      } catch (_) {}
      if (typeof window.__omtInplayMvForceSync === 'function') window.__omtInplayMvForceSync();
      document.querySelectorAll('.omt-more-toggle[aria-expanded="true"]').forEach((b) => b.click());
    });
    await showPanel(page);
    await page.waitForTimeout(100);
    shots.push(await labelAndShot(
      page,
      'v236_mockup_02a_inplay_mv_2tile_compact_s.png',
      '2a) InPlay multi-view — 2 videos, compact S panels',
      'v2.3.6 · forced omt-panel-size-small on primary + tile while MV active'
    ));

    // 2b) InPlay MV 4 tiles compact S
    await page.goto(`${base}/inplayip-multiview-mock.html?tiles=4`, { waitUntil: 'domcontentloaded' });
    await waitForOmt(page);
    await page.waitForFunction(
      () => window.__omtInplayMvActive === true &&
        document.querySelectorAll('[data-omt-tile-root]').length === 3,
      { timeout: 10000 }
    ).catch(() => {});
    await page.waitForTimeout(250);
    await page.evaluate(() => {
      if (typeof window.__omtInplayMvForceSync === 'function') window.__omtInplayMvForceSync();
      document.querySelectorAll('.omt-more-toggle[aria-expanded="true"]').forEach((b) => b.click());
    });
    await showPanel(page);
    shots.push(await labelAndShot(
      page,
      'v236_mockup_02b_inplay_mv_4tile_compact_s.png',
      '2b) InPlay multi-view — 4 videos, compact S panels',
      'v2.3.6 · every tile + primary use S; reverts to user size at 1 video'
    ));

    // 3) InPlay panel dragged to top — handle below header/curtain
    await page.goto(`${base}/inplayip-schedule-mock.html`, { waitUntil: 'domcontentloaded' });
    await waitForOmt(page);
    await page.waitForTimeout(250);
    await showPanel(page);
    const inplayTop = await dragPanelToTop(page);
    // Draw a marker line at the measured safe top
    await page.evaluate((safe) => {
      const root = document.getElementById('omt-root');
      if (!root) return;
      const rr = root.getBoundingClientRect();
      let line = document.getElementById('omt-mockup-safe-line');
      if (!line) {
        line = document.createElement('div');
        line.id = 'omt-mockup-safe-line';
        document.documentElement.appendChild(line);
      }
      line.style.cssText = [
        'position:fixed', `left:${rr.left}px`, `top:${rr.top + safe}px`,
        `width:${rr.width}px`, 'height:2px', 'background:#F5831F',
        'z-index:2147483645', 'pointer-events:none',
        'box-shadow:0 0 0 1px rgba(0,0,0,0.5)'
      ].join(';');
      let tag = document.getElementById('omt-mockup-safe-tag');
      if (!tag) {
        tag = document.createElement('div');
        tag.id = 'omt-mockup-safe-tag';
        document.documentElement.appendChild(tag);
      }
      tag.textContent = 'top-safe (handle floor) = ' + safe + 'px';
      tag.style.cssText = [
        'position:fixed', `left:${rr.left + 12}px`, `top:${rr.top + safe + 6}px`,
        'z-index:2147483645', 'pointer-events:none',
        'background:rgba(245,131,31,0.92)', 'color:#111', 'font:600 12px Segoe UI,system-ui',
        'padding:3px 8px', 'border-radius:3px'
      ].join(';');
    }, inplayTop.safe || 64);
    shots.push(await labelAndShot(
      page,
      'v236_mockup_03_inplay_top_handle_below_header.png',
      '3) InPlay — panel dragged to top; :::: handle just below header/curtain',
      `measured top-safe ${inplayTop.safe}px · panel top ${inplayTop.top}px · orange line = handle floor`
    ));

    // 4) Examino — panel below dark top band
    await page.goto(`${base}/examino-mock.html`, { waitUntil: 'domcontentloaded' });
    await waitForOmt(page);
    await page.waitForTimeout(300);
    await showPanel(page);
    // Enlarge mock page to fill viewport for a field-like look
    await page.evaluate(() => {
      const pageEl = document.querySelector('.page');
      if (pageEl) {
        pageEl.style.width = '100vw';
        pageEl.style.height = '100vh';
        pageEl.style.margin = '0';
        pageEl.style.maxWidth = 'none';
      }
      const main = document.querySelector('.main-container');
      if (main) {
        main.style.height = 'calc(100% - 108px)';
      }
    });
    await page.waitForTimeout(80);
    const examinoTop = await dragPanelToTop(page);
    await page.evaluate((safe) => {
      const root = document.getElementById('omt-root');
      if (!root) return;
      const rr = root.getBoundingClientRect();
      let line = document.getElementById('omt-mockup-safe-line');
      if (!line) {
        line = document.createElement('div');
        line.id = 'omt-mockup-safe-line';
        document.documentElement.appendChild(line);
      }
      line.style.cssText = [
        'position:fixed', `left:${rr.left}px`, `top:${rr.top + safe}px`,
        `width:${rr.width}px`, 'height:2px', 'background:#F5831F',
        'z-index:2147483645', 'pointer-events:none'
      ].join(';');
      let tag = document.getElementById('omt-mockup-safe-tag');
      if (!tag) {
        tag = document.createElement('div');
        tag.id = 'omt-mockup-safe-tag';
        document.documentElement.appendChild(tag);
      }
      tag.textContent = 'Examino top-safe (dark band) = ' + safe + 'px';
      tag.style.cssText = [
        'position:fixed', `left:${rr.left + 12}px`, `top:${rr.top + safe + 6}px`,
        'z-index:2147483645', 'pointer-events:none',
        'background:rgba(245,131,31,0.92)', 'color:#111', 'font:600 12px Segoe UI,system-ui',
        'padding:3px 8px', 'border-radius:3px'
      ].join(';');
    }, examinoTop.safe || 104);
    shots.push(await labelAndShot(
      page,
      'v236_mockup_04_examino_top_below_dark_band.png',
      '4) Examino — panel stopped just below dark top overlay',
      `measured top-safe ${examinoTop.safe}px · .op-top-panel / probe · handle stays grabbable`
    ));

    // 5) Small → fullscreen → back, never dragged, stays centred
    await page.setViewportSize({ width: 960, height: 600 });
    await page.goto(`${base}/inplayip-schedule-mock.html`, { waitUntil: 'domcontentloaded' });
    await waitForOmt(page);
    await page.waitForTimeout(200);
    await resetDefaultCenter(page);
    await showPanel(page);
    shots.push(await labelAndShot(
      page,
      'v236_mockup_05a_inplay_small_centered.png',
      '5a) Small window — default panel centred (never dragged)',
      '960×600 · prepare for FS; no left/top px written'
    ));
    await page.setViewportSize({ width: W, height: H });
    await page.waitForTimeout(60);
    await page.evaluate(() => {
      document.dispatchEvent(new Event('fullscreenchange'));
      window.dispatchEvent(new Event('resize'));
      if (typeof window.__omtSchedulePanelClamp === 'function') window.__omtSchedulePanelClamp();
    });
    await page.waitForTimeout(160);
    await showPanel(page);
    shots.push(await labelAndShot(
      page,
      'v236_mockup_05b_inplay_fs_still_centered.png',
      '5b) After fullscreen/resize — still centred (no jump right)',
      '1920×1080 · clamp skips undragged panels · CSS center preserved'
    ));
    await page.setViewportSize({ width: 960, height: 600 });
    await page.waitForTimeout(60);
    await page.evaluate(() => {
      document.dispatchEvent(new Event('fullscreenchange'));
      window.dispatchEvent(new Event('resize'));
      if (typeof window.__omtSchedulePanelClamp === 'function') window.__omtSchedulePanelClamp();
    });
    await page.waitForTimeout(160);
    await showPanel(page);
    shots.push(await labelAndShot(
      page,
      'v236_mockup_05c_inplay_back_small_centered.png',
      '5c) Back to small window — still centred',
      '960×600 · both directions keep default center'
    ));

    // 6) Edge/corner drag grab visible
    await page.setViewportSize({ width: W, height: H });
    await page.goto(`${base}/inplayip-schedule-mock.html`, { waitUntil: 'domcontentloaded' });
    await waitForOmt(page);
    await page.waitForTimeout(250);
    await resetDefaultCenter(page);
    await showPanel(page);
    // Place mid-field and draw edge grab margins
    await page.evaluate(() => {
      const root = document.getElementById('omt-root');
      const panel = document.getElementById('omt-controls-panel');
      if (!root || !panel) return;
      try { panel.dataset.omtUserDragged = '1'; } catch (_) {}
      const rr = root.getBoundingClientRect();
      const pw = panel.offsetWidth || 500;
      const ph = panel.offsetHeight || 140;
      panel.style.left = Math.round((rr.width - pw) / 2) + 'px';
      panel.style.top = Math.round((rr.height - ph) / 2) + 'px';
      panel.style.bottom = 'auto';
      panel.style.right = 'auto';
      panel.style.transform = 'none';
      panel.style.opacity = '1';

      const pr = panel.getBoundingClientRect();
      const m = 8;
      const mk = (id, css) => {
        let el = document.getElementById(id);
        if (!el) {
          el = document.createElement('div');
          el.id = id;
          document.documentElement.appendChild(el);
        }
        el.style.cssText = css;
      };
      const ring =
        `position:fixed;left:${pr.left}px;top:${pr.top}px;width:${pr.width}px;height:${pr.height}px;` +
        `box-shadow:inset 0 0 0 ${m}px rgba(245,131,31,0.45);pointer-events:none;z-index:2147483645;` +
        'border-radius:8px';
      mk('omt-mockup-edge-ring', ring);
      // Corner dots
      [[0, 0], [pr.width, 0], [0, pr.height], [pr.width, pr.height]].forEach((xy, i) => {
        mk('omt-mockup-corner-' + i, [
          'position:fixed',
          `left:${pr.left + xy[0] - 6}px`,
          `top:${pr.top + xy[1] - 6}px`,
          'width:12px', 'height:12px', 'border-radius:50%',
          'background:#F5831F', 'border:2px solid #fff',
          'z-index:2147483646', 'pointer-events:none'
        ].join(';'));
      });
      mk('omt-mockup-edge-caption', [
        'position:fixed',
        `left:${pr.left}px`,
        `top:${pr.bottom + 10}px`,
        'z-index:2147483646', 'pointer-events:none',
        'background:rgba(0,0,0,0.8)', 'color:#fff',
        'font:600 13px Segoe UI,system-ui', 'padding:6px 10px', 'border-radius:4px'
      ].join(';'));
      document.getElementById('omt-mockup-edge-caption').textContent =
        '8px edge/corner grab (orange) + :::: handle — buttons stay clickable';
    });
    shots.push(await labelAndShot(
      page,
      'v236_mockup_06_edge_corner_drag_grab.png',
      '6) Edge / corner drag grab (≈8px invisible margin)',
      'Orange inset = grab zone · corners highlighted · handle still works'
    ));

    const index = path.join(ARTIFACTS, 'v236_mockup_INDEX.txt');
    fs.writeFileSync(index, shots.map((s, i) => `${i + 1}. ${path.basename(s)}`).join('\n') + '\n');
    console.log('[mockup] wrote', shots.length, 'shots + index');
  } finally {
    await context.close().catch(() => {});
    server.close();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
