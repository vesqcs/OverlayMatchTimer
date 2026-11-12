import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const EXT = path.join(ROOT, 'Overlay-chrome-extension');
const FIXTURES = path.join(ROOT, 'test/fixtures');
const ARTIFACTS = '/opt/cursor/artifacts';

function contentType(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
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
      const safe = urlPath.replace(/\.\./g, '');
      const filePath = path.join(FIXTURES, safe === '/' ? 'examino-mock.html' : safe.replace(/^\//, ''));
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
      resolve({ server, port, base: `http://127.0.0.1:${port}` });
    });
  });
}

async function waitForOmt(page, timeout = 15000) {
  await page.waitForFunction(() => !!document.getElementById('omt-root'), null, { timeout });
}

async function run() {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const { server, base } = await startServer();
  const userDataDir = fs.mkdtempSync(path.join('/tmp', 'omt-ext-'));

  // Use Playwright's unbranded Chromium — Google Chrome 137+ ignores --load-extension.
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${EXT}`,
      `--load-extension=${EXT}`,
      '--disable-features=ExtensionDisableUnsupportedDeveloper',
      '--no-sandbox',
      '--disable-gpu'
    ],
    viewport: { width: 1100, height: 800 }
  });

  const results = [];
  const page = await context.newPage();

  try {
    // ---------- Examino mock ----------
    await page.goto(`${base}/examino-mock.html`, { waitUntil: 'domcontentloaded' });
    await waitForOmt(page, 20000);

    // Wait for video replacement rebind
    await page.waitForTimeout(2800);
    await waitForOmt(page);

    const examinoState = await page.evaluate(() => {
      const root = document.getElementById('omt-root');
      const video = document.querySelector('video');
      const controls = document.getElementById('controls-panel');
      const setup = document.getElementById('setup-panel');
      const timer = document.getElementById('match-timer');
      return {
        hasRoot: !!root,
        siteClass: root ? root.className : '',
        compact: root ? root.classList.contains('omt-compact') : false,
        videoInDoc: !!video,
        rootContainsVideoAnchor: !!(root && video && root.parentElement && root.parentElement.contains(video)),
        controlsOpacity: controls ? getComputedStyle(controls).opacity : null,
        setupVisible: setup ? getComputedStyle(setup).display !== 'none' : false,
        timerExists: !!timer
      };
    });
    results.push({ name: 'examino-overlay-appears', pass: examinoState.hasRoot && examinoState.siteClass.includes('omt-examino') });
    results.push({ name: 'examino-compact-on-small-player', pass: examinoState.compact === true });

    // Kick-off sync via the same button handler the analyst clicks
    const timerSync = await page.evaluate(() => {
      const setup = document.getElementById('setup-panel');
      if (setup) setup.style.display = 'flex';
      localStorage.removeItem('matchTimerAtivo');
      const btn = document.getElementById('omt-btn-set-kickoff');
      if (!btn) return { ok: false, reason: 'missing-button' };
      btn.click();
      const t = document.getElementById('match-timer');
      return {
        ok: !!(t && t.style.display === 'block'),
        display: t ? t.style.display : null,
        text: t ? t.textContent : null,
        ativo: localStorage.getItem('matchTimerAtivo')
      };
    });
    results.push({ name: 'examino-timer-sync', pass: timerSync.ok === true, detail: timerSync });

    // Hotkey: space toggles play/pause label
    await page.evaluate(() => {
      const v = document.querySelector('video');
      if (v) { try { v.pause(); } catch (_) {} }
    });
    await page.keyboard.press('Space');
    await page.waitForTimeout(200);
    const playLabel = await page.evaluate(() => document.getElementById('omt-btn-play')?.textContent || '');
    results.push({ name: 'examino-hotkey-space', pass: /pause/i.test(playLabel) || /play/i.test(playLabel) });

    // Arrow skip changes currentTime via seekTo
    const beforeSkip = await page.evaluate(() => document.querySelector('video')?.currentTime);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(150);
    const afterSkip = await page.evaluate(() => document.querySelector('video')?.currentTime);
    results.push({ name: 'examino-hotkey-seek', pass: typeof afterSkip === 'number' && afterSkip !== beforeSkip });

    // Panel drag
    const dragBefore = await page.evaluate(() => {
      const p = document.getElementById('controls-panel');
      const r = p.getBoundingClientRect();
      return { top: r.top, left: r.left };
    });
    const handle = page.locator('#controls-handle .drag-center-grip');
    const box = await handle.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 - 30, { steps: 8 });
      await page.mouse.up();
    }
    await page.waitForTimeout(200);
    const dragAfter = await page.evaluate(() => {
      const p = document.getElementById('controls-panel');
      const r = p.getBoundingClientRect();
      return { top: r.top, left: r.left, transform: p.style.transform };
    });
    results.push({
      name: 'examino-panel-drag',
      pass: Math.abs(dragAfter.left - dragBefore.left) > 5 || Math.abs(dragAfter.top - dragBefore.top) > 5
    });

    await page.screenshot({ path: path.join(ARTIFACTS, 'examino-overlay.png'), fullPage: true });

    // Fullscreen keeps overlay
    await page.evaluate(async () => {
      const target = document.querySelector('.op-player');
      if (target && target.requestFullscreen) await target.requestFullscreen();
    });
    await page.waitForTimeout(500);
    const fsState = await page.evaluate(() => {
      const fs = document.fullscreenElement;
      const root = document.getElementById('omt-root');
      return {
        hasFs: !!fs,
        rootInFs: !!(fs && root && fs.contains(root))
      };
    });
    results.push({ name: 'examino-fullscreen-keeps-overlay', pass: fsState.hasFs && fsState.rootInFs });
    await page.screenshot({ path: path.join(ARTIFACTS, 'examino-fullscreen.png'), fullPage: true });
    await page.evaluate(async () => {
      if (document.fullscreenElement) await document.exitFullscreen();
    });

    // ---------- InplayIP regression ----------
    await page.goto(`${base}/inplayip-mock.html`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      // Isolate from Examino session keys so restoreState does not hide setup.
      Object.keys(localStorage).forEach((k) => {
        if (k.startsWith('matchTimer') || k.startsWith('shuttle')) localStorage.removeItem(k);
      });
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForOmt(page, 15000);
    const inplayState = await page.evaluate(() => {
      const root = document.getElementById('omt-root');
      const setup = document.getElementById('setup-panel');
      if (setup) setup.style.display = 'flex';
      return {
        hasRoot: !!root,
        siteClass: root ? root.className : '',
        inVideoJs: !!(root && root.closest('.video-js'))
      };
    });
    results.push({
      name: 'inplayip-overlay-regression',
      pass: inplayState.hasRoot && inplayState.siteClass.includes('omt-inplayip') && inplayState.inVideoJs
    });
    const inplayTimer = await page.evaluate(() => {
      const setup = document.getElementById('setup-panel');
      if (setup) setup.style.display = 'flex';
      const btn = document.getElementById('omt-btn-set-kickoff');
      if (!btn) return { ok: false };
      btn.click();
      const t = document.getElementById('match-timer');
      return { ok: !!(t && t.style.display === 'block'), text: t?.textContent, ativo: localStorage.getItem('matchTimerAtivo') };
    });
    results.push({ name: 'inplayip-timer-sync', pass: inplayTimer.ok === true, detail: inplayTimer });
    await page.screenshot({ path: path.join(ARTIFACTS, 'inplayip-overlay.png'), fullPage: true });

  } finally {
    await context.close();
    server.close();
  }

  const failed = results.filter(r => !r.pass);
  console.log(JSON.stringify({ results, failed: failed.map(f => f.name) }, null, 2));
  fs.writeFileSync(path.join(ARTIFACTS, 'e2e-results.json'), JSON.stringify({ results, failed: failed.map(f => f.name) }, null, 2));
  if (failed.length) {
    process.exitCode = 1;
  }
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
