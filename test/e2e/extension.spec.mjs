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
      resolve({ server, base: `http://127.0.0.1:${port}` });
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
    await page.goto(`${base}/examino-mock.html`, { waitUntil: 'domcontentloaded' });
    await waitForOmt(page, 20000);

    // Auto-VOD should land quickly via MutationObserver (not a fixed 1.2s+ delay).
    const autoVodStarted = Date.now();
    await page.waitForFunction(() => {
      const v = document.querySelector('video');
      const sel = document.getElementById('omt-examino-source');
      return v && v.dataset.omtSource === 'VOD' && v.duration >= 7000 &&
        sel && sel.value === 'VOD' && !sel.disabled;
    }, null, { timeout: 12000 });
    const autoVodMs = Date.now() - autoVodStarted;
    results.push({
      name: 'examino-auto-vod-fast',
      pass: autoVodMs < 9000,
      detail: { autoVodMs }
    });

    // ---- Simplified settings: Source + Auto-VOD only ----
    const settingsShape = await page.evaluate(() => {
      const section = document.getElementById('omt-examino-settings');
      const sel = document.getElementById('omt-examino-source');
      const opts = sel ? Array.from(sel.options).map((o) => o.textContent.trim()) : [];
      return {
        visible: !!(section && getComputedStyle(section).display !== 'none'),
        hasSource: !!sel,
        hasAuto: !!document.getElementById('omt-examino-auto-vod'),
        hasAudio: !!document.getElementById('omt-examino-audio'),
        hasSpeed: !!document.getElementById('omt-examino-speed'),
        hasNative: !!document.getElementById('omt-btn-native-settings'),
        hasRefresh: !!document.getElementById('omt-examino-refresh-settings'),
        sourceValue: sel ? sel.value : null,
        sourceOptions: opts,
        liveSpacer: !!document.querySelector('#omt-root .omt-live-spacer')
      };
    });
    results.push({
      name: 'examino-settings-simplified',
      pass: settingsShape.visible && settingsShape.hasSource && settingsShape.hasAuto &&
        !settingsShape.hasAudio && !settingsShape.hasSpeed && !settingsShape.hasNative && !settingsShape.hasRefresh,
      detail: settingsShape
    });
    results.push({
      name: 'examino-source-label-vod',
      pass: settingsShape.sourceValue === 'VOD',
      detail: { sourceValue: settingsShape.sourceValue }
    });
    results.push({
      name: 'examino-source-options-clean',
      pass: settingsShape.sourceOptions.length === 2 &&
        settingsShape.sourceOptions.includes('DVR') &&
        settingsShape.sourceOptions.includes('VOD') &&
        settingsShape.sourceOptions.every((t) => t === 'DVR' || t === 'VOD'),
      detail: { sourceOptions: settingsShape.sourceOptions }
    });
    results.push({
      name: 'examino-live-spacer',
      pass: settingsShape.liveSpacer === true
    });

    // ---- Native gear/settings clicks must not be swallowed (v1.2.1 regression) ----
    await page.evaluate(async () => {
      const setup = document.getElementById('setup-panel');
      if (setup) setup.style.display = 'none';
      const panel = document.getElementById('controls-panel');
      if (panel) {
        panel.style.opacity = '0';
        panel.style.pointerEvents = 'none';
      }
      const timer = document.getElementById('match-timer');
      if (timer) timer.style.visibility = 'hidden';
      document.querySelectorAll('.op-setting-panel').forEach((p) => {
        p.classList.remove('open');
        p.classList.remove('omt-settings-raised');
      });
      // Temporarily show the normally-hidden gear so a real pointer click can hit it.
      const holder = document.querySelector('.setting-holder');
      const gear = document.getElementById('native-gear');
      if (holder) {
        holder.classList.remove('omt-examino-native-hidden');
        holder.style.setProperty('display', 'block', 'important');
        holder.style.setProperty('opacity', '1', 'important');
        holder.style.setProperty('pointer-events', 'auto', 'important');
        holder.style.setProperty('position', 'fixed', 'important');
        holder.style.setProperty('top', '12px', 'important');
        holder.style.setProperty('right', '12px', 'important');
        holder.style.setProperty('z-index', '2147483000', 'important');
        holder.style.setProperty('max-height', 'none', 'important');
      }
      if (gear) {
        gear.style.setProperty('display', 'block', 'important');
        gear.style.setProperty('opacity', '1', 'important');
        gear.style.setProperty('pointer-events', 'auto', 'important');
      }
      const v = document.querySelector('video');
      if (v) {
        try { await v.play(); } catch (_) {}
      }
      window.__omtGearPauseProbe = !!(v && v.paused);
    });
    await page.waitForTimeout(100);
    const gearBox = await page.locator('#native-gear').boundingBox();
    if (gearBox) {
      await page.mouse.click(gearBox.x + gearBox.width / 2, gearBox.y + gearBox.height / 2);
    }
    await page.waitForTimeout(200);
    const gearOpened = await page.evaluate(() => {
      const panel = document.querySelector('.op-setting-panel');
      const v = document.querySelector('video');
      return {
        open: !!(panel && panel.classList.contains('open')),
        paused: !!(v && v.paused),
        wasPaused: window.__omtGearPauseProbe === true
      };
    });
    results.push({
      name: 'examino-native-gear-unblocked',
      pass: gearOpened.open === true && gearOpened.paused === false,
      detail: gearOpened
    });

    // Native Source submenu still works with extension loaded (same clicks OpenPlayer uses)
    const nativeSource = await page.evaluate(async () => {
      const sourceRow = Array.from(document.querySelectorAll('.op-setting-item'))
        .find((el) => ((el.querySelector('.op-setting-item-title') || {}).textContent || '').trim() === 'Source');
      if (!sourceRow) return { ok: false, reason: 'no-source-row' };
      sourceRow.click();
      await new Promise((r) => setTimeout(r, 80));
      const dvr = Array.from(document.querySelectorAll('.op-setting-item'))
        .find((el) => el.getAttribute('op-data-value') === 'DVR' && !el.getAttribute('op-panel-type'));
      if (!dvr) return { ok: false, reason: 'no-dvr-option' };
      dvr.click();
      await new Promise((r) => setTimeout(r, 500));
      return {
        ok: (window.__omtMockSource || document.querySelector('video')?.dataset?.omtSource) === 'DVR',
        source: window.__omtMockSource
      };
    });
    results.push({ name: 'examino-native-source-switch', pass: nativeSource.ok === true, detail: nativeSource });

    // Overlay Source select must apply without "Source change failed"
    const overlaySwitch = await page.evaluate(async () => {
      const setup = document.getElementById('setup-panel');
      if (setup) setup.style.display = 'flex';
      const sel = document.getElementById('omt-examino-source');
      if (!sel) return { ok: false, reason: 'no-select' };
      sel.focus();
      await new Promise((r) => setTimeout(r, 700));
      if ([...sel.options].every((o) => o.value !== 'VOD')) {
        return { ok: false, reason: 'no-vod-option', options: [...sel.options].map((o) => o.value) };
      }
      sel.value = 'VOD';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 1400));
      const osd = document.getElementById('osd-message');
      const osdText = osd ? (osd.textContent || '') : '';
      return {
        ok: (window.__omtMockSource || document.querySelector('video')?.dataset?.omtSource) === 'VOD' &&
          sel.value === 'VOD' &&
          !/Source change failed/i.test(osdText),
        source: window.__omtMockSource,
        sel: sel.value,
        osdText
      };
    });
    results.push({ name: 'examino-overlay-source-switch', pass: overlaySwitch.ok === true, detail: overlaySwitch });

    // ---- Click to pause: only the video surface (not whole .op-player) ----
    await page.evaluate(async () => {
      const setup = document.getElementById('setup-panel');
      if (setup) setup.style.display = 'none';
      const panel = document.getElementById('controls-panel');
      if (panel) {
        panel.style.opacity = '0';
        panel.style.pointerEvents = 'none';
      }
      const timer = document.getElementById('match-timer');
      if (timer) timer.style.visibility = 'hidden';
      const v = document.querySelector('video');
      window.__omtNativeClickPlay = 0;
      if (v) {
        try { await v.play(); } catch (_) {}
      }
    });
    const videoBox = await page.locator('video').boundingBox();
    const clickVideoCenter = async () => {
      if (!videoBox) return;
      await page.mouse.click(videoBox.x + videoBox.width / 2, videoBox.y + videoBox.height / 2);
    };
    await clickVideoCenter();
    await page.waitForTimeout(200);
    const afterPause = await page.evaluate(() => {
      const v = document.querySelector('video');
      return { paused: !!(v && v.paused), native: window.__omtNativeClickPlay || 0 };
    });
    results.push({ name: 'examino-click-pauses', pass: afterPause.paused === true, detail: afterPause });
    await clickVideoCenter();
    await page.waitForTimeout(200);
    const afterPlay = await page.evaluate(() => {
      const v = document.querySelector('video');
      return { paused: !!(v && v.paused) };
    });
    results.push({ name: 'examino-click-plays', pass: afterPlay.paused === false, detail: afterPlay });

    // ---- Auto-hide: repeated clicks keep panel visible ----
    const autoHide = await page.evaluate(async () => {
      const panel = document.getElementById('controls-panel');
      const btn = document.getElementById('omt-m2');
      if (!panel || !btn) return { ok: false, reason: 'missing' };
      panel.style.opacity = '1';
      panel.style.pointerEvents = 'auto';
      // Simulate pointer resting on controls + repeated clicks without mousemove
      panel.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      for (let i = 0; i < 6; i++) {
        btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 500));
      }
      await new Promise((r) => setTimeout(r, 2800));
      const opacityWhileHover = panel.style.opacity;
      panel.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
      const setup = document.getElementById('setup-panel');
      if (setup) setup.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 3000));
      const opacityAfterLeave = panel.style.opacity;
      return {
        ok: opacityWhileHover === '1' && opacityAfterLeave === '0',
        opacityWhileHover,
        opacityAfterLeave
      };
    });
    results.push({ name: 'examino-autohide-respects-clicks', pass: autoHide.ok === true, detail: autoHide });

    // Kick-off sync
    const timerSync = await page.evaluate(() => {
      const setup = document.getElementById('setup-panel');
      if (setup) setup.style.display = 'flex';
      document.getElementById('omt-btn-set-kickoff')?.click();
      const t = document.getElementById('match-timer');
      return { ok: !!(t && t.style.display === 'block') };
    });
    results.push({ name: 'examino-timer-sync', pass: timerSync.ok === true });

    // Hotkeys still win
    await page.evaluate(() => { window.__omtHostileKeySeen = false; });
    const beforeSkip = await page.evaluate(() => document.querySelector('video')?.currentTime);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(150);
    const hotkey = await page.evaluate((before) => {
      const after = document.querySelector('video')?.currentTime;
      return { hostile: window.__omtHostileKeySeen === true, delta: (after ?? 0) - (before ?? 0) };
    }, beforeSkip);
    results.push({
      name: 'examino-hotkey-wins-over-page',
      pass: hotkey.hostile === false && Math.abs(hotkey.delta - 2) < 0.01,
      detail: hotkey
    });

    // Space must toggle via capture-phase (page hostile handler must not win)
    await page.evaluate(async () => {
      window.__omtHostileKeySeen = false;
      const v = document.querySelector('video');
      if (v) {
        try { await v.play(); } catch (_) {}
      }
    });
    await page.keyboard.press('Space');
    await page.waitForTimeout(150);
    const spaceToggle = await page.evaluate(() => {
      const v = document.querySelector('video');
      return {
        paused: !!(v && v.paused),
        hostile: window.__omtHostileKeySeen === true
      };
    });
    results.push({
      name: 'examino-space-hotkey-pauses',
      pass: spaceToggle.paused === true && spaceToggle.hostile === false,
      detail: spaceToggle
    });
    await page.keyboard.press('Space');
    await page.waitForTimeout(150);
    const spacePlay = await page.evaluate(() => !!(document.querySelector('video')?.paused));
    results.push({ name: 'examino-space-hotkey-plays', pass: spacePlay === false });

    // Native Examino / OpenPlayer chrome stays hidden
    const hiddenChrome = await page.evaluate(() => {
      const pick = (sel) => document.querySelector(sel);
      const hidden = (el) => {
        if (!el) return true;
        const cs = getComputedStyle(el);
        return cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0' ||
          el.classList.contains('omt-examino-native-hidden');
      };
      return {
        bottom: hidden(pick('.examino-bottom-controls')),
        hamburger: hidden(pick('.hamburger-menu')),
        settingHolder: hidden(pick('.setting-holder')),
        opControls: hidden(pick('.op-controls')),
        opUi: hidden(pick('.op-ui'))
      };
    });
    results.push({
      name: 'examino-native-bars-hidden',
      pass: hiddenChrome.bottom && hiddenChrome.hamburger && hiddenChrome.settingHolder &&
        hiddenChrome.opControls && hiddenChrome.opUi,
      detail: hiddenChrome
    });

    // LIVE control still present (untangle must not redesign / remove it)
    const liveBtn = await page.evaluate(() => {
      const btn = document.getElementById('omt-live-btn');
      const spacer = document.querySelector('#omt-root .omt-live-spacer');
      return { hasBtn: !!btn, hasSpacer: !!spacer, text: btn ? btn.textContent.replace(/\s+/g, ' ').trim() : null };
    });
    results.push({
      name: 'examino-live-button-unchanged',
      pass: liveBtn.hasBtn && liveBtn.hasSpacer && /LIVE/i.test(liveBtn.text || ''),
      detail: liveBtn
    });

    // ---- VOD deep seek → DVR must not freeze ----
    const vodToDvr = await page.evaluate(async () => {
      const setup = document.getElementById('setup-panel');
      if (setup) setup.style.display = 'flex';
      const v = document.querySelector('video');
      if (v) v.currentTime = 5000; // deep in VOD
      await new Promise((r) => setTimeout(r, 100));
      const sel = document.getElementById('omt-examino-source');
      if (!sel) return { ok: false, reason: 'no-select' };
      // Ensure options include DVR
      sel.focus();
      await new Promise((r) => setTimeout(r, 700));
      sel.value = 'DVR';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 1200));
      const v2 = document.querySelector('video');
      const frozen = window.__omtDvrFrozen === true;
      const source = window.__omtMockSource || v2?.dataset?.omtSource;
      const ct = v2 ? v2.currentTime : null;
      const dur = v2 ? v2.duration : null;
      // Play should work (not stuck)
      if (v2) {
        try { await v2.play(); } catch (_) {}
      }
      await new Promise((r) => setTimeout(r, 200));
      return {
        ok: source === 'DVR' && !frozen && typeof ct === 'number' && ct <= 330 && dur === 330,
        source,
        frozen,
        ct,
        dur,
        paused: v2 ? v2.paused : null
      };
    });
    results.push({ name: 'examino-vod-to-dvr-no-freeze', pass: vodToDvr.ok === true, detail: vodToDvr });

    // Manual DVR must stop auto-VOD from flipping back
    await page.waitForTimeout(2500);
    const stayedDvr = await page.evaluate(() => window.__omtMockSource || document.querySelector('video')?.dataset?.omtSource);
    results.push({ name: 'examino-manual-dvr-wins', pass: stayedDvr === 'DVR', detail: { stayedDvr } });

    await page.screenshot({ path: path.join(ARTIFACTS, 'examino-overlay.png'), fullPage: true });

    // Fullscreen
    await page.evaluate(async () => {
      const target = document.querySelector('.op-player');
      if (target?.requestFullscreen) await target.requestFullscreen();
    });
    await page.waitForTimeout(400);
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

    // ---------- InplayIP: auto-hide activity + regression ----------
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

    const inplayAutohide = await page.evaluate(async () => {
      const panel = document.getElementById('controls-panel');
      const btn = document.getElementById('omt-m2');
      if (!panel || !btn) return { ok: false };
      panel.style.opacity = '1';
      panel.style.pointerEvents = 'auto';
      panel.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      for (let i = 0; i < 5; i++) {
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 500));
      }
      await new Promise((r) => setTimeout(r, 2600));
      const whileHover = panel.style.opacity;
      panel.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 2600));
      return { ok: whileHover === '1' && panel.style.opacity === '0', whileHover, after: panel.style.opacity };
    });
    results.push({ name: 'inplayip-autohide-respects-clicks', pass: inplayAutohide.ok === true, detail: inplayAutohide });

    const inplayTimer = await page.evaluate(() => {
      document.getElementById('setup-panel').style.display = 'flex';
      document.getElementById('omt-btn-set-kickoff').click();
      const t = document.getElementById('match-timer');
      return { ok: !!(t && t.style.display === 'block') };
    });
    results.push({ name: 'inplayip-timer-sync', pass: inplayTimer.ok === true });
    await page.screenshot({ path: path.join(ARTIFACTS, 'inplayip-overlay.png'), fullPage: true });
    await page.screenshot({ path: path.join(ARTIFACTS, 'examino-settings.png'), fullPage: true });

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
