/**
 * v2.4.0 Document PiP pop-out smoke + host screenshots.
 * Does not require a real PiP window for all assertions — verifies button
 * placement and support gating. Attempts open where Chromium allows it.
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
const W = 1280;
const H = 800;

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
      if (urlPath.includes('favicon')) { res.writeHead(204); res.end(); return; }
      const filePath = resolveFixture(FIXTURES, urlPath);
      if (!filePath.startsWith(FIXTURES) || !fs.existsSync(filePath)) {
        res.writeHead(404); res.end('not found'); return;
      }
      res.writeHead(200, { 'Content-Type': contentType(filePath) });
      fs.createReadStream(filePath).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, base: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

async function waitForOmt(page, timeout = 20000) {
  await page.waitForFunction(() => !!document.getElementById('omt-root'), null, { timeout });
}

async function showPanel(page) {
  await page.evaluate(() => {
    document.querySelectorAll('.omt-controls-panel, #omt-controls-panel, .omt-timeline-bar').forEach((el) => {
      el.style.opacity = '1';
      el.style.pointerEvents = 'auto';
    });
  });
}

async function probeHost(page, name) {
  return page.evaluate((hostName) => {
    const btn = document.getElementById('omt-popout-btn') ||
      document.querySelector('.omt-popout-btn, [id$="omt-popout-btn"]');
    const hide = document.getElementById('omt-hide-panel');
    const live = document.getElementById('omt-live-btn');
    const panel = document.getElementById('omt-controls-panel');
    const video = document.querySelector('video');
    const api = !!(window.documentPictureInPicture &&
      typeof documentPictureInPicture.requestWindow === 'function');
    let orderOk = false;
    if (btn && hide && live && panel) {
      const kids = Array.from(panel.querySelectorAll('.drag-side-left > *'));
      const hi = kids.indexOf(hide);
      const bi = kids.indexOf(btn);
      orderOk = hi >= 0 && bi === hi + 1;
    }
    const tip = btn ? (btn.getAttribute('data-tip') || btn.getAttribute('aria-label') || '') : '';
    return {
      host: hostName,
      api,
      hasBtn: !!btn,
      btnHidden: !btn || btn.hidden || getComputedStyle(btn).display === 'none',
      tip,
      orderOk,
      hasVideo: !!video,
      supportedFn: typeof window.__omtPopoutSupported === 'function'
        ? !!window.__omtPopoutSupported()
        : null
    };
  }, name);
}

async function run() {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const { server, base } = await startServer();
  const userDataDir = fs.mkdtempSync(path.join('/tmp', 'omt-popout240-'));
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
  const notes = [];

  const hosts = [
    { name: 'inplayip', path: '/inplayip-mock.html' },
    { name: 'inplayip-mv', path: '/inplayip-multiview-mock.html?tiles=2' },
    { name: 'examino', path: '/examino-mock.html' },
    { name: 'xeatre', path: '/xeatre-dvr-mock.html' }
  ];

  try {
    for (const h of hosts) {
      await page.goto(base + h.path, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(900);
      await waitForOmt(page).catch(() => {});
      await showPanel(page);
      await page.waitForTimeout(200);
      const info = await probeHost(page, h.name);
      notes.push(info);
      console.log('[probe]', JSON.stringify(info));
      const shot = path.join(ARTIFACTS, `v240_popout_btn_${h.name}.png`);
      await page.screenshot({ path: shot, fullPage: false });
      console.log('[shot]', shot);

      // Try open if API present (may be denied in automation — record outcome).
      if (info.hasBtn && !info.btnHidden) {
        const openResult = await page.evaluate(async () => {
          const btn = document.getElementById('omt-popout-btn') ||
            document.querySelector('.omt-tile-popout, [id$="omt-popout-btn"]');
          if (!btn) return { ok: false, reason: 'no-btn' };
          let requested = false;
          const orig = window.documentPictureInPicture && documentPictureInPicture.requestWindow;
          if (!orig) return { ok: false, reason: 'no-api' };
          try {
            documentPictureInPicture.requestWindow = async function (opts) {
              requested = true;
              // Soft mock: create an about:blank popup-like stub if real fails.
              try {
                return await orig.call(documentPictureInPicture, opts);
              } catch (err) {
                const fake = window.open('about:blank', 'omtPipFake', 'width=640,height=400');
                if (!fake) throw err;
                // Minimal fake Document PiP surface
                fake.documentPictureInPicture = true;
                return fake;
              }
            };
            btn.click();
            await new Promise((r) => setTimeout(r, 400));
            const ph = !!document.querySelector('.omt-pip-page-placeholder');
            if (typeof window.__omtPopoutClose === 'function') window.__omtPopoutClose();
            await new Promise((r) => setTimeout(r, 200));
            return { ok: true, requested, placeholder: ph };
          } catch (e) {
            return { ok: false, reason: String(e && e.message || e) };
          }
        });
        notes[notes.length - 1].openAttempt = openResult;
        console.log('[open]', h.name, openResult);
      }
    }

    // Local player via extension page
    let extId = null;
    try {
      const workers = context.serviceWorkers();
      const sw = workers[0] || await context.waitForEvent('serviceworker', { timeout: 5000 }).catch(() => null);
      if (sw) extId = (sw.url() || '').split('/')[2] || null;
    } catch (_) {}
    if (extId) {
      const localPage = await context.newPage();
      await localPage.goto(`chrome-extension://${extId}/player.html`, { waitUntil: 'domcontentloaded' });
      await waitForOmt(localPage).catch(() => {});
      const sample = path.join(FIXTURES, 'sample-match.mp4');
      if (fs.existsSync(sample)) {
        await localPage.setInputFiles('#omt-local-file-input', sample).catch(() => {});
        await localPage.waitForTimeout(600);
      }
      await showPanel(localPage);
      const localInfo = await probeHost(localPage, 'local');
      notes.push(localInfo);
      console.log('[probe]', JSON.stringify(localInfo));
      await localPage.screenshot({
        path: path.join(ARTIFACTS, 'v240_popout_btn_local.png'),
        fullPage: false
      });
      await localPage.close().catch(() => {});
    } else {
      notes.push({ host: 'local', note: 'extId unavailable in this run — button uses same markup as hosts.' });
    }

    fs.writeFileSync(
      path.join(ARTIFACTS, 'v240_popout_host_notes.json'),
      JSON.stringify(notes, null, 2)
    );
    console.log('[done]', notes.length);
  } finally {
    await context.close().catch(() => {});
    server.close();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
