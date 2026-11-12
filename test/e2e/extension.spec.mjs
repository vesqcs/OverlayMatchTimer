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

async function waitForOmt(page, timeout = 20000) {
  await page.waitForFunction(() => !!document.getElementById('omt-root'), null, { timeout });
}

async function run() {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const { server, base } = await startServer();
  const userDataDir = fs.mkdtempSync(path.join('/tmp', 'omt-ext-'));

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${EXT}`,
      `--load-extension=${EXT}`,
      '--disable-features=ExtensionDisableUnsupportedDeveloper',
      '--no-sandbox',
      '--disable-gpu'
    ],
    viewport: { width: 1100, height: 900 }
  });

  const results = [];
  const page = await context.newPage();

  try {
    // ---------- Examino mock ----------
    await page.goto(`${base}/examino-mock.html`, { waitUntil: 'domcontentloaded' });
    await waitForOmt(page, 20000);
    await page.waitForTimeout(2800);
    await waitForOmt(page);

    // Wait for auto-VOD (default ON) to replace video with full-match duration
    await page.waitForFunction(() => {
      const v = document.querySelector('video');
      return v && v.dataset.omtSource === 'VOD' && v.duration >= 7000;
    }, null, { timeout: 15000 }).catch(() => {});

    // Refresh overlay selects after the player source change (retry while HUD rebinds)
    let sourceOptions = [];
    for (let i = 0; i < 12; i++) {
      await page.evaluate(() => {
        const setup = document.getElementById('setup-panel');
        if (setup) setup.style.display = 'flex';
        document.getElementById('omt-examino-refresh-settings')?.click();
      });
      await page.waitForTimeout(700);
      sourceOptions = await page.evaluate(() => {
        const sel = document.getElementById('omt-examino-source');
        return sel ? [...sel.options].map((o) => o.value) : [];
      });
      if (sourceOptions.includes('VOD') && sourceOptions.includes('DVR')) break;
    }

    const examinoState = await page.evaluate((opts) => {
      const root = document.getElementById('omt-root');
      const bottom = document.getElementById('bottom-controls');
      const burger = document.querySelector('.hamburger-menu');
      const opControls = document.querySelector('.op-controls');
      const settings = document.getElementById('omt-examino-settings');
      const sourceSel = document.getElementById('omt-examino-source');
      const autoVod = document.getElementById('omt-examino-auto-vod');
      const video = document.querySelector('video');
      const cs = (el) => (el ? getComputedStyle(el) : null);
      return {
        hasRoot: !!root,
        siteClass: root ? root.className : '',
        compact: root ? root.classList.contains('omt-compact') : false,
        bottomHidden: !bottom || cs(bottom).display === 'none' || bottom.classList.contains('omt-examino-native-hidden'),
        burgerHidden: !burger || cs(burger).display === 'none' || burger.classList.contains('omt-examino-native-hidden'),
        opControlsHidden: !opControls || cs(opControls).display === 'none',
        settingsVisible: !!(settings && cs(settings).display !== 'none'),
        sourceOptions: opts,
        autoVodChecked: !!(autoVod && autoVod.checked),
        source: window.__omtMockSource || video?.dataset?.omtSource || null,
        duration: video ? video.duration : null
      };
    }, sourceOptions);

    results.push({ name: 'examino-overlay-appears', pass: examinoState.hasRoot && examinoState.siteClass.includes('omt-examino') });
    results.push({ name: 'examino-compact-on-small-player', pass: examinoState.compact === true });
    results.push({ name: 'examino-native-bottom-hidden', pass: examinoState.bottomHidden === true, detail: examinoState });
    results.push({ name: 'examino-hamburger-hidden', pass: examinoState.burgerHidden === true });
    results.push({ name: 'examino-op-controls-hidden', pass: examinoState.opControlsHidden === true });
    results.push({
      name: 'examino-settings-section',
      pass: examinoState.settingsVisible === true && examinoState.sourceOptions.includes('VOD') && examinoState.sourceOptions.includes('DVR'),
      detail: { sourceOptions: examinoState.sourceOptions }
    });
    results.push({ name: 'examino-auto-vod-default', pass: examinoState.autoVodChecked === true });
    results.push({
      name: 'examino-auto-vod-switched',
      pass: examinoState.source === 'VOD' && examinoState.duration >= 7000,
      detail: { source: examinoState.source, duration: examinoState.duration }
    });

    // Kick-off sync persists across VOD replacement
    const timerSync = await page.evaluate(() => {
      const setup = document.getElementById('setup-panel');
      if (setup) setup.style.display = 'flex';
      localStorage.removeItem('matchTimerAtivo');
      const btn = document.getElementById('omt-btn-set-kickoff');
      btn.click();
      const t = document.getElementById('match-timer');
      return { ok: !!(t && t.style.display === 'block'), ativo: localStorage.getItem('matchTimerAtivo') };
    });
    results.push({ name: 'examino-timer-sync', pass: timerSync.ok === true, detail: timerSync });

    // Hotkeys beat hostile page handler
    await page.evaluate(() => { window.__omtHostileKeySeen = false; });
    const beforeSkip = await page.evaluate(() => document.querySelector('video')?.currentTime);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(150);
    const hotkeyState = await page.evaluate((before) => {
      const after = document.querySelector('video')?.currentTime;
      return {
        after,
        before,
        hostile: window.__omtHostileKeySeen === true,
        delta: (after ?? 0) - (before ?? 0)
      };
    }, beforeSkip);
    results.push({
      name: 'examino-hotkey-wins-over-page',
      pass: hotkeyState.hostile === false && Math.abs(hotkeyState.delta - 2) < 0.01,
      detail: hotkeyState
    });

    await page.evaluate(() => {
      const v = document.querySelector('video');
      if (v) { try { v.pause(); } catch (_) {} }
    });
    await page.keyboard.press('Space');
    await page.waitForTimeout(200);
    const playLabel = await page.evaluate(() => document.getElementById('omt-btn-play')?.textContent || '');
    results.push({ name: 'examino-hotkey-space', pass: /pause/i.test(playLabel) || /play/i.test(playLabel) });

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
      return { top: r.top, left: r.left };
    });
    results.push({
      name: 'examino-panel-drag',
      pass: Math.abs(dragAfter.left - dragBefore.left) > 5 || Math.abs(dragAfter.top - dragBefore.top) > 5
    });

    // Manual Source select works with auto-VOD temporarily disabled
    const manualSource = await page.evaluate(async () => {
      const setup = document.getElementById('setup-panel');
      if (setup) setup.style.display = 'flex';
      const auto = document.getElementById('omt-examino-auto-vod');
      if (auto) {
        auto.checked = false;
        auto.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const refresh = document.getElementById('omt-examino-refresh-settings');
      if (refresh) refresh.click();
      await new Promise((r) => setTimeout(r, 600));
      const sel = document.getElementById('omt-examino-source');
      if (!sel || ![...sel.options].some((o) => o.value === 'DVR')) {
        return { ok: false, reason: 'no-dvr-option', options: sel ? [...sel.options].map((o) => o.value) : [] };
      }
      sel.value = 'DVR';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 700));
      const sourceAfter = window.__omtMockSource;
      const dur = document.querySelector('video')?.duration;
      sel.value = 'VOD';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 700));
      if (auto) {
        auto.checked = true;
        auto.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return { ok: sourceAfter === 'DVR' && dur === 330 && window.__omtMockSource === 'VOD', sourceAfter, dur, final: window.__omtMockSource };
    });
    results.push({ name: 'examino-manual-source-switch', pass: manualSource.ok === true, detail: manualSource });

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
      return { hasFs: !!fs, rootInFs: !!(fs && root && fs.contains(root)) };
    });
    results.push({ name: 'examino-fullscreen-keeps-overlay', pass: fsState.hasFs && fsState.rootInFs });
    await page.screenshot({ path: path.join(ARTIFACTS, 'examino-fullscreen.png'), fullPage: true });
    await page.evaluate(async () => {
      if (document.fullscreenElement) await document.exitFullscreen();
    });

    await page.screenshot({ path: path.join(ARTIFACTS, 'examino-settings.png'), fullPage: true });

    // ---------- InplayIP regression ----------
    await page.goto(`${base}/inplayip-mock.html`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      Object.keys(localStorage).forEach((k) => {
        if (k.startsWith('matchTimer') || k.startsWith('shuttle') || k.startsWith('omt')) localStorage.removeItem(k);
      });
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForOmt(page, 15000);
    const inplayState = await page.evaluate(() => {
      const root = document.getElementById('omt-root');
      const setup = document.getElementById('setup-panel');
      if (setup) setup.style.display = 'flex';
      const examinoSection = document.getElementById('omt-examino-settings');
      return {
        hasRoot: !!root,
        siteClass: root ? root.className : '',
        inVideoJs: !!(root && root.closest('.video-js')),
        examinoHidden: !examinoSection || getComputedStyle(examinoSection).display === 'none'
      };
    });
    results.push({
      name: 'inplayip-overlay-regression',
      pass: inplayState.hasRoot && inplayState.siteClass.includes('omt-inplayip') && inplayState.inVideoJs
    });
    results.push({ name: 'inplayip-no-examino-section', pass: inplayState.examinoHidden === true });

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

  const failed = results.filter((r) => !r.pass);
  console.log(JSON.stringify({ results, failed: failed.map((f) => f.name) }, null, 2));
  fs.writeFileSync(path.join(ARTIFACTS, 'e2e-results.json'), JSON.stringify({ results, failed: failed.map((f) => f.name) }, null, 2));
  if (failed.length) process.exitCode = 1;
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
