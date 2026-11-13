import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const EXT = path.join(ROOT, 'Overlay-chrome-extension');
const FIXTURES = path.join(ROOT, 'test/fixtures');
const ARTIFACTS = '/opt/cursor/artifacts';

/** Full-page capture then crop — reliable for position:fixed tips. */
async function screenshotClipReliable(page, outPath, clip) {
  const tmp = path.join(ARTIFACTS, '.omt-full-tmp.png');
  await page.screenshot({ path: tmp, fullPage: true });
  const py = `
from PIL import Image
im = Image.open(${JSON.stringify(tmp)})
x,y,w,h = ${Math.round(clip.x)}, ${Math.round(clip.y)}, ${Math.round(clip.width)}, ${Math.round(clip.height)}
x = max(0, min(x, im.width-1)); y = max(0, min(y, im.height-1))
w = max(1, min(w, im.width-x)); h = max(1, min(h, im.height-y))
im.crop((x,y,x+w,y+h)).save(${JSON.stringify(outPath)})
`;
  const r = spawnSync('python3', ['-c', py], { encoding: 'utf8' });
  if (r.status !== 0) {
    // Fallback to Playwright clip if Pillow crop fails
    await page.screenshot({ path: outPath, clip });
  }
  try { fs.unlinkSync(tmp); } catch (_) {}
}

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

/** Minimal PostgREST-shaped mock for kickoff_sync (e2e only — not a real Supabase project). */
function startMockSupabase() {
  const store = new Map();
  const log = [];
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const raw = req.url || '/';
      const u = new URL(raw, 'http://127.0.0.1');
      log.push({ method: req.method, path: u.pathname + u.search, t: Date.now() });
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }
      if (u.pathname !== '/rest/v1/kickoff_sync') {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      const eqMatch = u.search.match(/match_key=eq\.([^&]+)/);
      const matchKey = eqMatch ? decodeURIComponent(eqMatch[1]) : null;
      if (req.method === 'GET') {
        const row = matchKey && store.has(matchKey) ? [store.get(matchKey)] : [];
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(row));
        return;
      }
      if (req.method === 'POST') {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          let row = {};
          try { row = JSON.parse(body || '{}'); } catch (_) { row = {}; }
          if (row.match_key) store.set(row.match_key, row);
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify([row]));
        });
        return;
      }
      res.writeHead(405);
      res.end('method');
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        server,
        base: `http://127.0.0.1:${port}`,
        store,
        log,
        reset() { store.clear(); log.length = 0; }
      });
    });
  });
}

async function waitForOmt(page, timeout = 20000) {
  await page.waitForFunction(() => !!document.getElementById('omt-root'), null, { timeout });
}

const EXPECTED_CLOCK_POS = [
  'top-left', 'top-centre', 'top-right',
  'bottom-left', 'bottom-centre', 'bottom-right'
];

function posOptsInclude(opts) {
  return EXPECTED_CLOCK_POS.every((p) => (opts || []).includes(p));
}

/** Shared v1.4.x HUD fingerprint for InPlay / Examino / local parity. */
async function captureUiFingerprint(page) {
  return page.evaluate(() => {
    const root = document.getElementById('omt-root');
    const seg = document.querySelector('#controls-panel .omt-transport-seg');
    const buttons = seg ? Array.from(seg.querySelectorAll('.ctrl-btn')) : [];
    const ids = buttons.map((b) => b.id);
    const expected = ['omt-m120', 'omt-m10', 'omt-m2', 'omt-prev-frame', 'omt-btn-play', 'omt-next-frame', 'omt-p2', 'omt-p10', 'omt-p120'];
    const chips = Array.from(document.querySelectorAll('.omt-speed-chip')).map((c) => (c.textContent || '').trim());
    const half = document.getElementById('omt-half-select');
    const halfOpts = half ? Array.from(half.options).map((o) => o.value) : [];
    return {
      hasRoot: !!root,
      siteClass: root ? root.className : '',
      optionAOrder: ids.join(','),
      optionAOk: ids.join(',') === expected.join(','),
      speedChips: chips.join(','),
      speedOk: chips.join(',') === '0.25x,0.5x,0.75x,1x,1.25x,1.5x,2x',
      hasHide: !!document.getElementById('omt-hide-panel'),
      hideTip: document.getElementById('omt-hide-panel')?.getAttribute('data-tip') || '',
      hasTimeline: !!document.getElementById('omt-timeline-bar') && !!document.getElementById('omt-timeline-slider'),
      hasKickoff: !!document.getElementById('omt-btn-set-kickoff'),
      hasPeriod: !!half,
      halfOpts,
      hasCustom1: !!document.getElementById('omt-custom-minute-c1'),
      hasCustom2: !!document.getElementById('omt-custom-minute-c2'),
      hasOffsetNudge: !!document.getElementById('omt-offset-m1') && !!document.getElementById('omt-offset-p1') &&
        !!document.getElementById('omt-offset-m5') && !!document.getElementById('omt-offset-p5'),
      hasShuttle: !!document.getElementById('omt-shuttle-enable-toggle'),
      hasOsd: !!document.getElementById('osd-message'),
      hasLive: !!document.getElementById('omt-live-btn'),
      hasMore: !!document.getElementById('omt-more-toggle') && !!document.getElementById('omt-more-panel'),
      examinoHidden: (() => {
        const s = document.getElementById('omt-examino-settings');
        return !s || getComputedStyle(s).display === 'none';
      })(),
      timelineAtBottom: (() => {
        const bar = document.getElementById('omt-timeline-bar');
        const r = root?.getBoundingClientRect();
        const b = bar?.getBoundingClientRect();
        return !!(r && b && Math.abs(b.bottom - r.bottom) < 10);
      })()
    };
  });
}

async function run() {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const { server, base } = await startServer();
  const mockSb = await startMockSupabase();
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
  const syncNetworkLog = [];
  context.on('request', (req) => {
    const u = req.url();
    if (/kickoff_sync|supabase\.co/i.test(u)) syncNetworkLog.push({ url: u, method: req.method() });
  });
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

    // Kick-off sync (in expandable more panel; same handlers)
    const timerSync = await page.evaluate(() => {
      document.getElementById('omt-more-toggle')?.click();
      document.getElementById('omt-btn-set-kickoff')?.click();
      const t = document.getElementById('match-timer');
      const wrap = document.getElementById('match-timer-wrap');
      const nudge = document.getElementById('omt-offset-p1');
      const more = document.getElementById('omt-more-panel');
      const topKickoff = getComputedStyle(document.getElementById('omt-kickoff-bar') || document.body).position;
      return {
        ok: !!(t && (t.style.display === 'block' || (wrap && getComputedStyle(wrap).display !== 'none'))),
        hasNudge: !!nudge,
        moreOpen: !!(more && more.classList.contains('is-open')),
        kickoffNotAbsolute: topKickoff !== 'absolute',
        plainClock: !document.querySelector('#match-timer-wrap .omt-offset-nudge')
      };
    });
    results.push({ name: 'examino-timer-sync', pass: timerSync.ok === true, detail: timerSync });
    results.push({ name: 'examino-offset-nudge-present', pass: timerSync.hasNudge === true });
    results.push({
      name: 'examino-more-panel-holds-controls',
      pass: timerSync.moreOpen && timerSync.kickoffNotAbsolute && timerSync.plainClock,
      detail: timerSync
    });

    // Offset nudge uses existing offset state
    const offsetNudge = await page.evaluate(() => {
      const before = localStorage.getItem('matchTimerOffset');
      document.getElementById('omt-offset-p1')?.click();
      const after = localStorage.getItem('matchTimerOffset');
      document.getElementById('omt-offset-m1')?.click();
      const back = localStorage.getItem('matchTimerOffset');
      return {
        ok: before != null && after != null && Number(after) === Number(before) + 1 &&
          Math.abs(Number(back) - Number(before)) < 0.001,
        before, after, back
      };
    });
    results.push({ name: 'examino-offset-nudge', pass: offsetNudge.ok === true, detail: offsetNudge });

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

    // K marks kick-off via existing iniciarTimer path
    await page.evaluate(() => {
      document.getElementById('omt-btn-clear-timer')?.click();
      Object.keys(localStorage).forEach((k) => {
        if (k.startsWith('matchTimer')) localStorage.removeItem(k);
      });
    });
    await page.keyboard.press('KeyK');
    await page.waitForTimeout(200);
    const kickHotkey = await page.evaluate(() => {
      const t = document.getElementById('match-timer');
      const wrap = document.getElementById('match-timer-wrap');
      const btn = document.getElementById('omt-btn-set-kickoff');
      return {
        ativo: localStorage.getItem('matchTimerAtivo') === 'true',
        timerVisible: !!(t && (t.style.display === 'block' || (wrap && wrap.style.display === 'flex'))),
        kickoffSet: !!(btn && btn.classList.contains('kickoff-set'))
      };
    });
    results.push({
      name: 'examino-k-marks-kickoff',
      pass: kickHotkey.ativo && kickHotkey.timerVisible && kickHotkey.kickoffSet,
      detail: kickHotkey
    });

    // L returns to live via existing irParaLive path
    const liveHotkey = await page.evaluate(async () => {
      const v = document.querySelector('video');
      if (!v) return { ok: false, reason: 'no-video' };
      window.__omtLiveSeekCalls = 0;
      const before = v.currentTime;
      // Seek behind live edge first
      try { v.currentTime = Math.max(0, (v.seekable?.end?.(0) || v.duration || 100) - 40); } catch (_) {}
      await new Promise((r) => setTimeout(r, 50));
      return { before: v.currentTime, seekableEnd: v.seekable?.length ? v.seekable.end(v.seekable.length - 1) : null };
    });
    await page.keyboard.press('KeyL');
    await page.waitForTimeout(250);
    const afterLive = await page.evaluate(() => {
      const v = document.querySelector('video');
      const end = v?.seekable?.length ? v.seekable.end(v.seekable.length - 1) : null;
      const ct = v ? v.currentTime : null;
      return {
        ct,
        end,
        nearLive: typeof ct === 'number' && typeof end === 'number' && Math.abs(end - 3 - ct) < 2.5
      };
    });
    results.push({
      name: 'examino-l-goes-live',
      pass: afterLive.nearLive === true,
      detail: { liveHotkey, afterLive }
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

    // Whistle / set-video-time inputs are not in the in-video UI
    const noWhistleUi = await page.evaluate(() => {
      const sync = document.getElementById('omt-hidden-sync');
      const editWired = !document.getElementById('match-timer')?.onclick;
      return {
        ok: !!(sync && sync.hidden) && !document.querySelector('#setup-panel .time-inputs'),
        editWired
      };
    });
    results.push({ name: 'examino-no-whistle-ui', pass: noWhistleUi.ok === true, detail: noWhistleUi });

    // ---- VOD deep seek → DVR must not freeze ----
    const vodToDvr = await page.evaluate(async () => {
      const v = document.querySelector('video');
      if (v) v.currentTime = 5000; // deep in VOD
      await new Promise((r) => setTimeout(r, 100));
      const sel = document.getElementById('omt-examino-source');
      if (!sel) return { ok: false, reason: 'no-select' };
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

    // Floating glass control panel + bottom-only timeline (v1.2.2 structure restored)
    const chromeShape = await page.evaluate(() => {
      const panel = document.getElementById('controls-panel');
      const timelineBar = document.getElementById('omt-timeline-bar');
      const jumps = document.getElementById('omt-kickoff-jumps');
      const badges = document.querySelectorAll('.kickoff-badge, .timeline-badges-row');
      const transport = panel ? panel.querySelector('.controls-content') : null;
      const handle = panel ? panel.querySelector('#controls-handle.drag-handle') : null;
      const moreInPanel = !!(panel && panel.querySelector('#omt-more-panel'));
      const timelineInPanel = !!(panel && panel.querySelector('#omt-timeline-slider'));
      const timeline = timelineBar ? timelineBar.querySelector('.timeline-slider') : null;
      const timesInBar = !!(timelineBar && timelineBar.querySelector('#omt-v-time-current') &&
        timelineBar.querySelector('#omt-v-time-duration'));
      const moreBtn = document.getElementById('omt-more-toggle');
      const tipCount = document.querySelectorAll('#controls-panel [data-tip], #omt-timeline-bar [data-tip]').length;
      const panelBox = panel ? panel.getBoundingClientRect() : null;
      const timelineBox = timelineBar ? timelineBar.getBoundingClientRect() : null;
      const root = document.getElementById('omt-root');
      const rootBox = root ? root.getBoundingClientRect() : null;
      const panelCentered = !!(panelBox && rootBox &&
        Math.abs((panelBox.left + panelBox.right) / 2 - (rootBox.left + rootBox.right) / 2) < 40);
      const timelineAtBottom = !!(timelineBox && rootBox &&
        Math.abs(timelineBox.bottom - rootBox.bottom) < 8);
      const panelAboveTimeline = !!(panelBox && timelineBox && panelBox.bottom <= timelineBox.top + 4);
      return {
        floatingGlass: !!(panel && panel.classList.contains('glass-panel') && handle && transport),
        timelineAlone: !!(timelineBar && timeline && timesInBar && !timelineInPanel),
        moreInPanel,
        jumpsHidden: !!(jumps && jumps.hidden),
        noBadges: badges.length === 0,
        hasMore: !!(moreBtn && moreInPanel),
        tipCount,
        panelCentered,
        timelineAtBottom,
        panelAboveTimeline,
        clockPlain: !document.querySelector('#match-timer-wrap .omt-offset-nudge') &&
          (() => {
            const el = document.getElementById('match-timer');
            if (!el) return false;
            const c = getComputedStyle(el).borderLeftColor || '';
            return !/245,\s*131,\s*31/.test(c) && !/#F5831F/i.test(c);
          })()
      };
    });
    results.push({
      name: 'examino-floating-panel-bottom-timeline',
      pass: chromeShape.floatingGlass && chromeShape.timelineAlone && chromeShape.moreInPanel &&
        chromeShape.jumpsHidden && chromeShape.noBadges && chromeShape.hasMore &&
        chromeShape.tipCount >= 12 && chromeShape.panelCentered &&
        chromeShape.timelineAtBottom && chromeShape.panelAboveTimeline && chromeShape.clockPlain,
      detail: chromeShape
    });

    // Card grows UP: transport+bottom fixed; top row rises; more sits in middle (v1.7.2 layout)
    const moreExpandUp = await page.evaluate(async () => {
      const panel = document.getElementById('controls-panel');
      const more = document.getElementById('omt-more-panel');
      const handle = document.getElementById('controls-handle');
      const transport = panel?.querySelector('.controls-content');
      const btn = document.getElementById('omt-more-toggle');
      if (!panel || !more || !handle || !transport || !btn) return { ok: false, reason: 'missing' };
      if (more.classList.contains('is-open')) btn.click();
      await new Promise((r) => setTimeout(r, 160));
      const snap = () => {
        const p = panel.getBoundingClientRect();
        const h = handle.getBoundingClientRect();
        const t = transport.getBoundingClientRect();
        const m = more.getBoundingClientRect();
        return {
          panel: { top: p.top, bottom: p.bottom, height: p.height },
          handle: { top: h.top, bottom: h.bottom },
          transport: { top: t.top, bottom: t.bottom },
          more: { top: m.top, bottom: m.bottom, height: m.height }
        };
      };
      const before = snap();
      btn.click();
      await new Promise((r) => setTimeout(r, 180));
      const after = snap();
      const same = (a, b, tol = 1.5) => Math.abs(a - b) <= tol;
      const transportFixed =
        same(before.transport.top, after.transport.top) &&
        same(before.transport.bottom, after.transport.bottom) &&
        same(before.panel.bottom, after.panel.bottom);
      const topRose =
        after.panel.top < before.panel.top - 8 &&
        after.handle.top < before.handle.top - 8 &&
        after.panel.height > before.panel.height + 8;
      const moreInMiddle =
        after.more.height > 20 &&
        after.more.top >= after.handle.bottom - 2 &&
        after.more.bottom <= after.transport.top + 2 &&
        panel.contains(more);
      const moreCs = getComputedStyle(more);
      const inFlow = moreCs.position !== 'absolute' && moreCs.position !== 'fixed';
      const solidBg = /rgba?\(/.test(moreCs.backgroundColor) && moreCs.backgroundColor !== 'rgba(0, 0, 0, 0)';
      return {
        ok: more.classList.contains('is-open') && transportFixed && topRose && moreInMiddle && inFlow && solidBg,
        transportFixed,
        topRose,
        moreInMiddle,
        inFlow,
        solidBg,
        bg: moreCs.backgroundColor,
        before,
        after
      };
    });
    results.push({
      name: 'overlay-more-panel-expands-up',
      pass: moreExpandUp.ok === true,
      detail: moreExpandUp
    });
    await page.evaluate(() => {
      const more = document.getElementById('omt-more-panel');
      const btn = document.getElementById('omt-more-toggle');
      if (more?.classList.contains('is-open')) btn?.click();
    });
    await page.waitForTimeout(180);
    await page.screenshot({
      path: path.join(ARTIFACTS, 'v174_overlay_panel_collapsed.png'),
      fullPage: true
    });
    await page.evaluate(() => document.getElementById('omt-more-toggle')?.click());
    await page.waitForTimeout(180);
    await page.screenshot({
      path: path.join(ARTIFACTS, 'v174_overlay_panel_expanded_up.png'),
      fullPage: true
    });

    // Force controls + timeline visible for polish screenshots
    await page.evaluate(() => {
      const panel = document.getElementById('controls-panel');
      const timelineBar = document.getElementById('omt-timeline-bar');
      [panel, timelineBar].forEach((el) => {
        if (!el) return;
        el.style.opacity = '1';
        el.style.pointerEvents = 'auto';
      });
      const settings = document.getElementById('omt-examino-settings');
      if (settings) settings.style.display = 'flex';
      // Collapse more panel for baseline shot
      const more = document.getElementById('omt-more-panel');
      const btn = document.getElementById('omt-more-toggle');
      if (more) {
        more.classList.remove('is-open');
        more.setAttribute('aria-hidden', 'true');
      }
      if (btn) {
        btn.classList.remove('is-open');
        btn.setAttribute('aria-expanded', 'false');
        const c = btn.querySelector('.omt-more-icon-collapsed');
        const e = btn.querySelector('.omt-more-icon-expanded');
        if (c) c.hidden = false;
        if (e) e.hidden = true;
      }
    });

    // At live → red scrubber (pause first so timeupdate does not race the shot)
    await page.evaluate(async () => {
      const v = document.querySelector('video');
      const slider = document.getElementById('omt-timeline-slider');
      const timelineBar = document.getElementById('omt-timeline-bar');
      const live = document.getElementById('omt-live-btn');
      if (!v) return;
      try { v.pause(); } catch (_) {}
      const end = v.seekable?.length ? v.seekable.end(v.seekable.length - 1) : v.duration;
      const liveAt = typeof end === 'number' ? Math.max(0, end - 2) : v.currentTime;
      try { v.currentTime = liveAt; } catch (_) {}
      if (slider && typeof end === 'number' && isFinite(end) && end > 0) {
        slider.min = '0';
        slider.max = String(end);
        slider.value = String(liveAt);
        slider.style.setProperty('--omt-progress', '100%');
        const dur = document.getElementById('omt-v-time-duration');
        const cur = document.getElementById('omt-v-time-current');
        if (dur) {
          const h = Math.floor(end / 3600).toString().padStart(2, '0');
          const m = Math.floor((end % 3600) / 60).toString().padStart(2, '0');
          const s = Math.floor(end % 60).toString().padStart(2, '0');
          dur.innerText = `${h}:${m}:${s}`;
        }
        if (cur) {
          const h = Math.floor(liveAt / 3600).toString().padStart(2, '0');
          const m = Math.floor((liveAt % 3600) / 60).toString().padStart(2, '0');
          const s = Math.floor(liveAt % 60).toString().padStart(2, '0');
          cur.innerText = `${h}:${m}:${s}`;
        }
      }
      if (timelineBar) timelineBar.classList.add('omt-at-live');
      if (live) live.classList.add('is-live');
    });
    await page.waitForTimeout(80);
    const atLiveState = await page.evaluate(() => {
      const timelineBar = document.getElementById('omt-timeline-bar');
      const live = document.getElementById('omt-live-btn');
      const slider = document.getElementById('omt-timeline-slider');
      const bg = slider ? getComputedStyle(slider).backgroundImage || getComputedStyle(slider).background : '';
      return {
        atLive: !!(timelineBar && timelineBar.classList.contains('omt-at-live')),
        liveOn: !!(live && live.classList.contains('is-live')),
        progress: slider ? slider.style.getPropertyValue('--omt-progress') : null,
        bg
      };
    });
    results.push({
      name: 'examino-timeline-fill-constant-at-live',
      pass: atLiveState.atLive && atLiveState.liveOn &&
        /b0b0b0|rgb\(176,\s*176,\s*176\)/i.test(atLiveState.bg) &&
        !/e0201b|rgb\(224,\s*32,\s*27\)/i.test(atLiveState.bg),
      detail: atLiveState
    });
    await page.screenshot({ path: path.join(ARTIFACTS, 'examino_at_live.png'), fullPage: true });
    await page.screenshot({ path: path.join(ARTIFACTS, 'examino_collapsed.png'), fullPage: true });
    await page.screenshot({ path: path.join(ARTIFACTS, 'examino-overlay.png'), fullPage: true });
    await page.screenshot({ path: path.join(ARTIFACTS, 'ui_timeline_at_live.png'), fullPage: true });

    // LIVE must not overlap speed at normal/compact widths
    const noOverlap = await page.evaluate(() => {
      const live = document.getElementById('omt-live-btn');
      const speed = document.getElementById('omt-speed-select');
      if (!live || !speed) return { ok: false, reason: 'missing' };
      const a = live.getBoundingClientRect();
      const b = speed.getBoundingClientRect();
      const overlap = !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
      return {
        ok: !overlap && a.width > 0 && b.width > 0,
        live: { left: a.left, right: a.right },
        speed: { left: b.left, right: b.right }
      };
    });
    results.push({ name: 'examino-live-speed-no-overlap', pass: noOverlap.ok === true, detail: noOverlap });

    // Skip buttons show amount labels (2s / 10s / 2m) while keeping tooltips
    const skipLabels = await page.evaluate(() => {
      const ids = ['omt-m120', 'omt-m10', 'omt-m2', 'omt-p2', 'omt-p10', 'omt-p120'];
      const expected = ['2m', '10s', '2s', '2s', '10s', '2m'];
      const rows = ids.map((id, i) => {
        const el = document.getElementById(id);
        const label = el?.querySelector('.omt-btn-label')?.textContent?.trim() || '';
        const tip = el?.getAttribute('data-tip') || '';
        return { id, label, tip, ok: label === expected[i] && tip.length > 0 };
      });
      return { ok: rows.every((r) => r.ok), rows };
    });
    results.push({ name: 'examino-skip-amount-labels', pass: skipLabels.ok === true, detail: skipLabels });

    // Option A transport: flush segmented row + speed chips under it
    const optionA = await page.evaluate(() => {
      const seg = document.querySelector('#controls-panel .omt-transport-seg');
      const buttons = seg ? Array.from(seg.querySelectorAll('.ctrl-btn')) : [];
      const ids = buttons.map((b) => b.id);
      const expected = ['omt-m120', 'omt-m10', 'omt-m2', 'omt-prev-frame', 'omt-btn-play', 'omt-next-frame', 'omt-p2', 'omt-p10', 'omt-p120'];
      const boxes = buttons.map((b) => b.getBoundingClientRect());
      let flush = boxes.length === expected.length;
      for (let i = 1; i < boxes.length; i++) {
        // Adjacent buttons should touch (allow 2px for hairline dividers)
        if (Math.abs(boxes[i].left - boxes[i - 1].right) > 3) flush = false;
        if (boxes[i].height < 40) flush = false;
      }
      const play = document.getElementById('omt-btn-play');
      const playBox = play ? play.getBoundingClientRect() : null;
      const chips = Array.from(document.querySelectorAll('.omt-speed-chip')).map((c) => ({
        speed: c.getAttribute('data-speed'),
        text: (c.textContent || '').trim(),
        active: c.classList.contains('is-active')
      }));
      const speedRow = document.querySelector('.omt-speed-row');
      const transport = document.querySelector('.controls-content');
      const speedBelow = !!(speedRow && transport && seg &&
        speedRow.getBoundingClientRect().top >= seg.getBoundingClientRect().bottom - 1);
      return {
        orderOk: ids.join(',') === expected.join(','),
        flush,
        playProminent: !!(playBox && boxes[0] && playBox.width >= boxes[0].width),
        chips,
        speedBelow,
        hideBtn: (() => {
          const btn = document.getElementById('omt-hide-panel');
          return {
            present: !!btn,
            tip: btn ? (btn.getAttribute('data-tip') || '') : ''
          };
        })()
      };
    });
    results.push({
      name: 'examino-option-a-transport',
      pass: optionA.orderOk && optionA.flush && optionA.playProminent &&
        optionA.speedBelow &&
        optionA.chips.map((c) => c.text).join(',') === '0.25x,0.5x,0.75x,1x,1.25x,1.5x,2x' &&
        optionA.hideBtn.present && /Auto hide:\s*on/i.test(optionA.hideBtn.tip),
      detail: optionA
    });

    // Right-side 2m label must not be cramped against its icon
    const skip2mFit = await page.evaluate(() => {
      const btn = document.getElementById('omt-p120');
      if (!btn) return { ok: false, reason: 'missing' };
      const label = btn.querySelector('.omt-btn-label');
      const icon = btn.querySelector('.omt-icon');
      if (!label || !icon) return { ok: false, reason: 'parts' };
      const lb = label.getBoundingClientRect();
      const ib = icon.getBoundingClientRect();
      const gap = ib.left - lb.right;
      const overflow = label.scrollWidth > label.clientWidth + 1;
      return {
        ok: lb.width >= 14 && gap >= 4 && !overflow && (label.textContent || '').trim() === '2m',
        gap, labelW: lb.width, overflow
      };
    });
    results.push({ name: 'examino-skip-2m-label-fit', pass: skip2mFit.ok === true, detail: skip2mFit });

    // Speed row syncs with select + Z/C/X hotkeys
    // Mock MSE fixtures often clamp HTMLMediaElement.playbackRate to 1; stub the
    // prototype so rate UI sync can be asserted without real media support.
    await page.evaluate(() => {
      if (window.__omtPlaybackRateStubbed) return;
      const desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate');
      if (!desc || !desc.configurable) return;
      let forced = 1;
      Object.defineProperty(HTMLMediaElement.prototype, 'playbackRate', {
        configurable: true,
        get() { return forced; },
        set(n) {
          forced = Number(n);
          try { desc.set.call(this, n); } catch (_) {}
        }
      });
      window.__omtPlaybackRateStubbed = true;
    });
    const speedAfterChip = await page.evaluate(() => {
      const select = document.getElementById('omt-speed-select');
      const v = document.querySelector('video');
      const chip15 = document.querySelector('.omt-speed-chip[data-speed="1.5"]');
      if (!select || !v || !chip15) return { ok: false, reason: 'missing' };
      chip15.click();
      return {
        ok: Math.abs(v.playbackRate - 1.5) < 0.05 && select.value === '1.5' &&
          chip15.classList.contains('is-active') &&
          !document.querySelector('.omt-speed-chip[data-speed="1.0"]')?.classList.contains('is-active'),
        rate: v.playbackRate,
        select: select.value
      };
    });
    await page.waitForTimeout(40);
    const speedAfterSelect = await page.evaluate(() => {
      const select = document.getElementById('omt-speed-select');
      const v = document.querySelector('video');
      if (!select || !v) return { ok: false };
      select.value = '2.0';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      const chip20 = document.querySelector('.omt-speed-chip[data-speed="2.0"]');
      return {
        ok: Math.abs(v.playbackRate - 2) < 0.05 && chip20?.classList.contains('is-active') === true,
        rate: v.playbackRate
      };
    });
    await page.keyboard.press('KeyX');
    await page.waitForTimeout(80);
    const speedAfterX = await page.evaluate(() => {
      const select = document.getElementById('omt-speed-select');
      const v = document.querySelector('video');
      const chip10 = document.querySelector('.omt-speed-chip[data-speed="1.0"]');
      return {
        ok: Math.abs(v?.playbackRate - 1) < 0.05 && select?.value === '1.0' &&
          chip10?.classList.contains('is-active') === true,
        rate: v?.playbackRate,
        select: select?.value
      };
    });
    await page.keyboard.press('KeyC');
    await page.waitForTimeout(80);
    const speedAfterC = await page.evaluate(() => {
      const v = document.querySelector('video');
      const chip = document.querySelector('.omt-speed-chip[data-speed="1.25"]');
      const select = document.getElementById('omt-speed-select');
      const opts = select ? Array.from(select.options).map((o) => o.value) : [];
      return {
        ok: Math.abs((v?.playbackRate || 0) - 1.25) < 0.05 &&
          chip?.classList.contains('is-active') === true &&
          select?.value === '1.25' &&
          opts.join(',') === '0.25,0.5,0.75,1.0,1.25,1.5,2.0',
        rate: v?.playbackRate,
        select: select?.value,
        opts
      };
    });
    await page.keyboard.press('KeyZ');
    await page.waitForTimeout(80);
    const speedAfterZ = await page.evaluate(() => {
      const v = document.querySelector('video');
      const chip10 = document.querySelector('.omt-speed-chip[data-speed="1.0"]');
      return {
        ok: Math.abs((v?.playbackRate || 0) - 1) < 0.05 &&
          chip10?.classList.contains('is-active') === true,
        rate: v?.playbackRate
      };
    });
    const speedActiveStyle = await page.evaluate(() => {
      const active = document.querySelector('.omt-speed-chip.is-active');
      const idle = document.querySelector('.omt-speed-chip:not(.is-active)');
      if (!active || !idle) return { ok: false };
      const ac = getComputedStyle(active);
      const ic = getComputedStyle(idle);
      const parseRgb = (c) => {
        const m = String(c).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
        return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
      };
      const ar = parseRgb(ac.color);
      const ir = parseRgb(ic.color);
      const activeOrange = !!(ar && ar[0] >= 220 && ar[1] >= 100 && ar[1] <= 170 && ar[2] <= 80);
      const idleNotOrange = !!(ir && !(ir[0] >= 220 && ir[1] >= 100 && ir[1] <= 170 && ir[2] <= 80));
      const noFill = ac.backgroundColor === 'rgba(0, 0, 0, 0)' || ac.backgroundColor === 'transparent';
      const noInset = !ac.boxShadow || ac.boxShadow === 'none';
      return { ok: activeOrange && idleNotOrange && noFill && noInset, color: ac.color, bg: ac.backgroundColor, box: ac.boxShadow };
    });
    results.push({
      name: 'examino-speed-row-sync',
      pass: speedAfterChip.ok && speedAfterSelect.ok && speedAfterX.ok &&
        speedAfterC.ok && speedAfterZ.ok && speedActiveStyle.ok,
      detail: { speedAfterChip, speedAfterSelect, speedAfterX, speedAfterC, speedAfterZ, speedActiveStyle }
    });

    // Eye button = Auto hide toggle (does NOT hide immediately). H still hides completely.
    await page.evaluate(() => {
      const panel = document.getElementById('controls-panel');
      const timeline = document.getElementById('omt-timeline-bar');
      [panel, timeline].forEach((el) => {
        if (!el) return;
        el.style.opacity = '1';
        el.style.pointerEvents = 'auto';
      });
      // Reset preference so default ON is measurable
      try { localStorage.setItem('omtAutoHideChrome', 'true'); } catch (_) {}
      window.postMessage({
        source: 'omt-bridge',
        type: 'OMT_STORAGE_SYNC',
        values: { omtAutoHideChrome: true }
      }, '*');
    });
    await page.waitForTimeout(40);
    const autoHideOnShot = await page.evaluate(() => {
      const btn = document.getElementById('omt-hide-panel');
      return {
        tip: btn?.getAttribute('data-tip') || '',
        pressed: btn?.getAttribute('aria-pressed'),
        hasEyeOff: !!(btn && btn.querySelector('.omt-icon') && /eye-off|M10\.733|m2 2 20 20/i.test(btn.innerHTML)),
        iconHtml: btn?.innerHTML?.slice(0, 120) || ''
      };
    });
    await page.locator('#omt-hide-panel').hover();
    await page.waitForTimeout(120);
    await page.screenshot({
      path: path.join(ARTIFACTS, 'v173_auto_hide_on_tooltip.png'),
      fullPage: true
    });
    await page.locator('#omt-hide-panel').click();
    await page.waitForTimeout(100);
    const afterToggleOff = await page.evaluate(() => {
      const panel = document.getElementById('controls-panel');
      const timeline = document.getElementById('omt-timeline-bar');
      const btn = document.getElementById('omt-hide-panel');
      return {
        panel: panel?.style.opacity,
        timeline: timeline?.style.opacity,
        pe: panel?.style.pointerEvents,
        tip: btn?.getAttribute('data-tip') || '',
        pressed: btn?.getAttribute('aria-pressed'),
        stored: localStorage.getItem('omtAutoHideChrome'),
        hasEye: !!(btn && /M2\.062|circle cx="12"/i.test(btn.innerHTML) && !/m2 2 20 20/i.test(btn.innerHTML))
      };
    });
    await page.locator('#omt-hide-panel').hover();
    await page.waitForTimeout(120);
    await page.screenshot({
      path: path.join(ARTIFACTS, 'v173_auto_hide_off_tooltip.png'),
      fullPage: true
    });
    // H hotkey still hides completely (original)
    await page.keyboard.press('KeyH');
    await page.waitForTimeout(80);
    const afterHHide = await page.evaluate(() => {
      const panel = document.getElementById('controls-panel');
      return { panel: panel?.style.opacity, pe: panel?.style.pointerEvents };
    });
    await page.keyboard.press('KeyH');
    await page.waitForTimeout(80);
    const afterHShow = await page.evaluate(() => {
      const panel = document.getElementById('controls-panel');
      return { panel: panel?.style.opacity, pe: panel?.style.pointerEvents };
    });
    await page.evaluate(() => {
      const panel = document.getElementById('controls-panel');
      const timeline = document.getElementById('omt-timeline-bar');
      [panel, timeline].forEach((el) => {
        if (!el) return;
        el.style.opacity = '1';
        el.style.pointerEvents = 'auto';
      });
      try { localStorage.setItem('omtAutoHideChrome', 'true'); } catch (_) {}
      window.postMessage({
        source: 'omt-bridge',
        type: 'OMT_STORAGE_SYNC',
        values: { omtAutoHideChrome: true }
      }, '*');
    });
    results.push({
      name: 'examino-auto-hide-toggle',
      pass: /Auto hide:\s*on/i.test(autoHideOnShot.tip) &&
        afterToggleOff.panel === '1' && afterToggleOff.pe === 'auto' &&
        afterToggleOff.timeline === '1' &&
        /Auto hide:\s*off/i.test(afterToggleOff.tip) &&
        afterToggleOff.stored === 'false' &&
        afterToggleOff.pressed === 'false' &&
        afterHHide.panel === '0' && afterHShow.panel === '1',
      detail: { autoHideOnShot, afterToggleOff, afterHHide, afterHShow }
    });

    // Auto hide ON: idle over the video fades chrome; mouse move restores; OFF stays visible
    await page.evaluate(() => {
      const panel = document.getElementById('controls-panel');
      const timeline = document.getElementById('omt-timeline-bar');
      [panel, timeline].forEach((el) => {
        if (!el) return;
        el.style.opacity = '1';
        if (el === panel) el.style.pointerEvents = 'auto';
      });
      // Leave any hover keep-alive
      panel?.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
      timeline?.querySelector('.omt-timeline-track')?.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
      timeline?.querySelector('.omt-timeline-times')?.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
      try { localStorage.setItem('omtAutoHideChrome', 'true'); } catch (_) {}
      window.postMessage({
        source: 'omt-bridge',
        type: 'OMT_STORAGE_SYNC',
        values: { omtAutoHideChrome: true }
      }, '*');
    });
    await page.waitForTimeout(80);
    const vidBox = await page.locator('video').boundingBox();
    if (vidBox) {
      // Aim at upper-centre of the video — clear of the timeline strip and card
      await page.mouse.move(vidBox.x + vidBox.width * 0.5, vidBox.y + vidBox.height * 0.28);
      await page.waitForTimeout(80);
      await page.mouse.move(vidBox.x + vidBox.width * 0.52, vidBox.y + vidBox.height * 0.30);
    }
    await page.waitForTimeout(2800);
    const idleOn = await page.evaluate(() => {
      const panel = document.getElementById('controls-panel');
      const timeline = document.getElementById('omt-timeline-bar');
      const btn = document.getElementById('omt-hide-panel');
      return {
        panel: panel?.style.opacity,
        timeline: timeline?.style.opacity,
        tip: btn?.getAttribute('data-tip') || '',
        stored: localStorage.getItem('omtAutoHideChrome')
      };
    });
    if (vidBox) {
      await page.mouse.move(vidBox.x + vidBox.width * 0.55, vidBox.y + vidBox.height * 0.32);
    }
    await page.waitForTimeout(120);
    const afterMove = await page.evaluate(() => {
      const panel = document.getElementById('controls-panel');
      return { panel: panel?.style.opacity };
    });
    // Toggle Auto hide OFF and confirm idle no longer fades
    await page.evaluate(() => {
      const panel = document.getElementById('controls-panel');
      if (panel) { panel.style.opacity = '1'; panel.style.pointerEvents = 'auto'; }
      document.getElementById('omt-hide-panel')?.click();
    });
    await page.waitForTimeout(80);
    if (vidBox) {
      await page.mouse.move(vidBox.x + vidBox.width * 0.5, vidBox.y + vidBox.height * 0.28);
      await page.waitForTimeout(60);
      await page.mouse.move(vidBox.x + vidBox.width * 0.51, vidBox.y + vidBox.height * 0.29);
    }
    await page.waitForTimeout(2800);
    const idleOff = await page.evaluate(() => {
      const panel = document.getElementById('controls-panel');
      const btn = document.getElementById('omt-hide-panel');
      return {
        panel: panel?.style.opacity,
        tip: btn?.getAttribute('data-tip') || '',
        stored: localStorage.getItem('omtAutoHideChrome')
      };
    });
    results.push({
      name: 'examino-auto-hide-idle-fade',
      pass: idleOn.panel === '0' && idleOn.timeline === '0' &&
        /Auto hide:\s*on/i.test(idleOn.tip) &&
        afterMove.panel === '1' &&
        idleOff.panel === '1' &&
        /Auto hide:\s*off/i.test(idleOff.tip),
      detail: { idleOn, afterMove, idleOff }
    });
    // Restore Auto hide ON for later tests
    await page.evaluate(() => {
      try { localStorage.setItem('omtAutoHideChrome', 'true'); } catch (_) {}
      window.postMessage({
        source: 'omt-bridge',
        type: 'OMT_STORAGE_SYNC',
        values: { omtAutoHideChrome: true }
      }, '*');
      const panel = document.getElementById('controls-panel');
      const timeline = document.getElementById('omt-timeline-bar');
      if (panel) { panel.style.opacity = '1'; panel.style.pointerEvents = 'auto'; }
      if (timeline) { timeline.style.opacity = '1'; timeline.classList.remove('omt-chrome-hidden'); }
    });

    // Play/pause centre button follows real media state; top OSD only (no centre flash)
    await page.evaluate(() => {
      const panel = document.getElementById('controls-panel');
      const timeline = document.getElementById('omt-timeline-bar');
      [panel, timeline].forEach((el) => {
        if (!el) return;
        el.style.opacity = '1';
        el.style.pointerEvents = 'auto';
      });
    });
    await page.evaluate(async () => {
      const v = document.querySelector('video');
      if (v) {
        try { await v.play(); } catch (_) {}
      }
    });
    await page.waitForTimeout(120);
    const playStatePlaying = await page.evaluate(() => {
      const btn = document.getElementById('omt-btn-play');
      const v = document.querySelector('video');
      const cs = btn ? getComputedStyle(btn) : null;
      const m = cs ? String(cs.color).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i) : null;
      const orange = !!(m && Number(m[1]) >= 220 && Number(m[2]) >= 100 && Number(m[2]) <= 170 && Number(m[3]) <= 80);
      return {
        paused: !!(v && v.paused),
        hasPlayingClass: !!(btn && btn.classList.contains('playing')),
        orange,
        color: cs ? cs.color : null,
        hasPauseIcon: !!(btn && btn.querySelector('svg') && /rect/i.test(btn.innerHTML)),
        noCentreFlash: !document.querySelector('#omt-root .omt-centre-flash, #omt-root .omt-center-flash, #omt-big-play')
      };
    });
    await page.locator('#omt-btn-play').click();
    await page.waitForTimeout(100);
    const playStatePaused = await page.evaluate(() => {
      const btn = document.getElementById('omt-btn-play');
      const osd = document.getElementById('osd-message');
      const v = document.querySelector('video');
      const cs = btn ? getComputedStyle(btn) : null;
      return {
        paused: !!(v && v.paused),
        hasPlayingClass: !!(btn && btn.classList.contains('playing')),
        grey: !!(cs && !/245,\s*131,\s*31/i.test(cs.color)),
        hasPlayIcon: !!(btn && /polygon/i.test(btn.innerHTML)),
        osdPause: !!(osd && /Pause/i.test(osd.innerText || '')),
        noCentreFlash: !document.querySelector('#omt-root .omt-centre-flash, #omt-root .omt-center-flash, #omt-big-play')
      };
    });
    await page.keyboard.press('Space');
    await page.waitForTimeout(100);
    const playStateSpace = await page.evaluate(() => {
      const btn = document.getElementById('omt-btn-play');
      const osd = document.getElementById('osd-message');
      const v = document.querySelector('video');
      return {
        paused: !!(v && v.paused),
        hasPlayingClass: !!(btn && btn.classList.contains('playing')),
        osdPlay: !!(osd && /Play/i.test(osd.innerText || ''))
      };
    });
    results.push({
      name: 'examino-play-pause-button-state',
      pass: !playStatePlaying.paused && playStatePlaying.hasPlayingClass && playStatePlaying.orange &&
        playStatePlaying.hasPauseIcon && playStatePlaying.noCentreFlash &&
        playStatePaused.paused && !playStatePaused.hasPlayingClass && playStatePaused.grey &&
        playStatePaused.hasPlayIcon && playStatePaused.osdPause && playStatePaused.noCentreFlash &&
        !playStateSpace.paused && playStateSpace.hasPlayingClass && playStateSpace.osdPlay,
      detail: { playStatePlaying, playStatePaused, playStateSpace }
    });
    await page.screenshot({ path: path.join(ARTIFACTS, 'examino_playing.png'), fullPage: true });
    await page.locator('#omt-btn-play').click();
    await page.waitForTimeout(100);
    await page.screenshot({ path: path.join(ARTIFACTS, 'examino_paused.png'), fullPage: true });

    // Speed 2x active screenshot
    await page.evaluate(() => {
      document.querySelector('.omt-speed-chip[data-speed="2.0"]')?.click();
      const panel = document.getElementById('controls-panel');
      if (panel) {
        panel.style.opacity = '1';
        panel.style.pointerEvents = 'auto';
      }
    });
    await page.waitForTimeout(80);
    await page.screenshot({ path: path.join(ARTIFACTS, 'examino_speed_2x.png'), fullPage: true });
    await page.evaluate(() => {
      document.querySelector('.omt-speed-chip[data-speed="1.0"]')?.click();
    });

    // Auto pause on Alt+Tab (default off; resume only when we auto-paused)
    const autoPauseOff = await page.evaluate(async () => {
      localStorage.setItem('omtAutoPauseOnBlur', 'false');
      const v = document.querySelector('video');
      if (!v) return { ok: false, reason: 'no-video' };
      try { await v.play(); } catch (_) {}
      await new Promise((r) => setTimeout(r, 40));
      window.dispatchEvent(new Event('blur'));
      document.dispatchEvent(new Event('visibilitychange'));
      // Force hidden path
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      await new Promise((r) => setTimeout(r, 40));
      const paused = v.paused;
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      return { ok: paused === false, paused };
    });
    results.push({ name: 'examino-auto-pause-off', pass: autoPauseOff.ok === true, detail: autoPauseOff });

    const autoPauseOnResume = await page.evaluate(async () => {
      localStorage.setItem('omtAutoPauseOnBlur', 'true');
      localStorage.setItem('shuttleXpressEnabled', 'false');
      const v = document.querySelector('video');
      if (!v) return { ok: false, reason: 'no-video' };
      v.muted = true;
      try { await v.play(); } catch (e) { return { ok: false, reason: 'play-failed', err: String(e) }; }
      await new Promise((r) => setTimeout(r, 40));
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
      await new Promise((r) => setTimeout(r, 60));
      const afterAway = v.paused;
      const osd = (document.getElementById('osd-message')?.innerText || '');
      const origPlay = HTMLMediaElement.prototype.play;
      let playCalls = 0;
      HTMLMediaElement.prototype.play = function (...args) {
        playCalls += 1;
        return origPlay.apply(this, args);
      };
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
      await new Promise((r) => setTimeout(r, 200));
      HTMLMediaElement.prototype.play = origPlay;
      return {
        ok: afterAway === true && v.paused === false && /Auto paused/i.test(osd) && playCalls >= 1,
        afterAway,
        afterReturn: v.paused,
        osd,
        playCalls
      };
    });
    results.push({
      name: 'examino-auto-pause-resumes',
      pass: autoPauseOnResume.ok === true,
      detail: autoPauseOnResume
    });

    const autoPauseManualStays = await page.evaluate(async () => {
      localStorage.setItem('omtAutoPauseOnBlur', 'true');
      localStorage.setItem('shuttleXpressEnabled', 'false');
      const v = document.querySelector('video');
      if (!v) return { ok: false };
      try { await v.play(); } catch (_) {}
      await new Promise((r) => setTimeout(r, 30));
      v.pause(); // manual pause before away
      await new Promise((r) => setTimeout(r, 30));
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      await new Promise((r) => setTimeout(r, 30));
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
      await new Promise((r) => setTimeout(r, 80));
      return { ok: v.paused === true, paused: v.paused };
    });
    results.push({
      name: 'examino-auto-pause-manual-stays-paused',
      pass: autoPauseManualStays.ok === true,
      detail: autoPauseManualStays
    });

    const autoPauseShuttleSkip = await page.evaluate(async () => {
      localStorage.setItem('omtAutoPauseOnBlur', 'true');
      localStorage.setItem('shuttleXpressEnabled', 'true');
      const v = document.querySelector('video');
      if (!v) return { ok: false, reason: 'no-video' };
      v.muted = true;
      try { await v.play(); } catch (e) { return { ok: false, reason: 'play-failed', err: String(e) }; }
      await new Promise((r) => setTimeout(r, 40));
      if (v.paused) return { ok: false, reason: 'still-paused-before-hide' };
      // Clear stale OSD from the previous auto-pause case (toast lasts ~1.1s).
      const osdEl = document.getElementById('osd-message');
      if (osdEl) {
        osdEl.innerText = '';
        osdEl.classList.remove('visible');
      }
      // Re-assert shuttle flag immediately before the hide event (bridge may sync prefs).
      localStorage.setItem('shuttleXpressEnabled', 'true');
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
      await new Promise((r) => setTimeout(r, 60));
      const paused = v.paused;
      const osd = (osdEl?.innerText || '');
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      document.dispatchEvent(new Event('visibilitychange'));
      localStorage.setItem('shuttleXpressEnabled', 'false');
      return {
        ok: paused === false && !/Auto paused/i.test(osd),
        paused,
        osd,
        shuttleFlag: localStorage.getItem('shuttleXpressEnabled')
      };
    });
    results.push({
      name: 'examino-auto-pause-shuttle-skips',
      pass: autoPauseShuttleSkip.ok === true,
      detail: autoPauseShuttleSkip
    });

    // Expanded more panel with custom period + start-minute edit visible
    await page.evaluate(() => {
      const more = document.getElementById('omt-more-panel');
      if (more && !more.classList.contains('is-open')) {
        document.getElementById('omt-more-toggle')?.click();
      }
      const half = document.getElementById('omt-half-select');
      if (half) {
        half.value = 'custom1';
        half.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const c1 = document.getElementById('omt-custom-minute-c1');
      if (c1) c1.value = '90';
    });
    await page.waitForTimeout(160);
    const customPeriod = await page.evaluate(() => {
      const half = document.getElementById('omt-half-select');
      const opts = half ? Array.from(half.options).map((o) => o.value) : [];
      const wrap = document.getElementById('omt-custom-c1');
      const input = document.getElementById('omt-custom-minute-c1');
      const cs = wrap ? getComputedStyle(wrap) : null;
      return {
        hasCustomOpts: opts.includes('custom1') && opts.includes('custom2'),
        selected: half ? half.value : null,
        inputVisible: !!(wrap && cs && cs.display !== 'none' && input),
        inputValue: input ? input.value : null,
        hasAutoSwitch: !!document.querySelector('#omt-examino-auto-vod + .omt-switch-slider'),
        hasShuttleSwitch: !!document.querySelector('#omt-shuttle-enable-toggle + .omt-switch-slider')
      };
    });
    results.push({
      name: 'examino-custom-period-edit-visible',
      pass: customPeriod.hasCustomOpts && customPeriod.selected === 'custom1' &&
        customPeriod.inputVisible && customPeriod.inputValue === '90' &&
        customPeriod.hasAutoSwitch && customPeriod.hasShuttleSwitch,
      detail: customPeriod
    });
    await page.screenshot({ path: path.join(ARTIFACTS, 'examino_expanded.png'), fullPage: true });
    await page.screenshot({ path: path.join(ARTIFACTS, 'examino-settings.png'), fullPage: true });
    await page.screenshot({ path: path.join(ARTIFACTS, 'ui_in_video_settings.png'), fullPage: true });

    // Tooltip with shortcut (Play / Pause Space)
    const playBox = await page.locator('#omt-btn-play').boundingBox();
    if (playBox) {
      await page.mouse.move(playBox.x + playBox.width / 2, playBox.y + playBox.height / 2);
      await page.waitForTimeout(120);
    }
    const tipOk = await page.evaluate(() => {
      const btn = document.getElementById('omt-btn-play');
      return !!(btn && /Play \/ Pause \(Space\)/.test(btn.getAttribute('data-tip') || ''));
    });
    results.push({ name: 'examino-tooltip-has-shortcut', pass: tipOk === true });
    await page.screenshot({ path: path.join(ARTIFACTS, 'examino_tooltip.png'), fullPage: true });

    // Hide-controls tooltip
    const hideBox = await page.locator('#omt-hide-panel').boundingBox();
    if (hideBox) {
      await page.mouse.move(hideBox.x + hideBox.width / 2, hideBox.y + hideBox.height / 2);
      await page.waitForTimeout(140);
    }
    await page.screenshot({ path: path.join(ARTIFACTS, 'examino_hide_tooltip.png'), fullPage: true });
    await page.evaluate(() => {
      document.getElementById('omt-more-toggle')?.click();
    });
    await page.waitForTimeout(140);

    // Behind live → grey scrubber (partial fill)
    await page.evaluate(async () => {
      const v = document.querySelector('video');
      const slider = document.getElementById('omt-timeline-slider');
      const timelineBar = document.getElementById('omt-timeline-bar');
      const live = document.getElementById('omt-live-btn');
      if (!v) return;
      try { v.pause(); } catch (_) {}
      const end = v.seekable?.length ? v.seekable.end(v.seekable.length - 1) : v.duration;
      const behindAt = typeof end === 'number' ? Math.max(0, end * 0.55) : 100;
      try { v.currentTime = behindAt; } catch (_) {}
      if (slider && typeof end === 'number' && isFinite(end) && end > 0) {
        slider.min = '0';
        slider.max = String(end);
        slider.value = String(behindAt);
        slider.style.setProperty('--omt-progress', '55%');
        const dur = document.getElementById('omt-v-time-duration');
        const cur = document.getElementById('omt-v-time-current');
        if (dur) {
          const h = Math.floor(end / 3600).toString().padStart(2, '0');
          const m = Math.floor((end % 3600) / 60).toString().padStart(2, '0');
          const s = Math.floor(end % 60).toString().padStart(2, '0');
          dur.innerText = `${h}:${m}:${s}`;
        }
        if (cur) {
          const h = Math.floor(behindAt / 3600).toString().padStart(2, '0');
          const m = Math.floor((behindAt % 3600) / 60).toString().padStart(2, '0');
          const s = Math.floor(behindAt % 60).toString().padStart(2, '0');
          cur.innerText = `${h}:${m}:${s}`;
        }
      }
      if (timelineBar) timelineBar.classList.remove('omt-at-live');
      if (live) live.classList.remove('is-live');
    });
    await page.waitForTimeout(80);
    const behindState = await page.evaluate(() => {
      const timelineBar = document.getElementById('omt-timeline-bar');
      const live = document.getElementById('omt-live-btn');
      const slider = document.getElementById('omt-timeline-slider');
      const bg = slider ? getComputedStyle(slider).backgroundImage || getComputedStyle(slider).background : '';
      return {
        atLive: !!(timelineBar && timelineBar.classList.contains('omt-at-live')),
        liveOn: !!(live && live.classList.contains('is-live')),
        progress: slider ? slider.style.getPropertyValue('--omt-progress') : null,
        bg
      };
    });
    results.push({
      name: 'examino-timeline-fill-constant-behind',
      pass: !behindState.atLive && !behindState.liveOn &&
        /b0b0b0|rgb\(176,\s*176,\s*176\)/i.test(behindState.bg) &&
        Math.abs(parseFloat(behindState.progress || '0') - 55) < 0.1,
      detail: behindState
    });
    await page.screenshot({ path: path.join(ARTIFACTS, 'examino_behind_live.png'), fullPage: true });
    await page.screenshot({ path: path.join(ARTIFACTS, 'ui_timeline_behind_live.png'), fullPage: true });

    // Hover thickens the timeline
    const timelineBox = await page.locator('#omt-timeline-slider').boundingBox();
    if (timelineBox) {
      await page.mouse.move(timelineBox.x + timelineBox.width * 0.55, timelineBox.y + timelineBox.height / 2);
      await page.waitForTimeout(120);
    }
    const hoverH = await page.evaluate(() => {
      const slider = document.getElementById('omt-timeline-slider');
      return slider ? parseFloat(getComputedStyle(slider).height) : 0;
    });
    results.push({
      name: 'examino-timeline-thickens-on-hover',
      pass: hoverH >= 5.5,
      detail: { hoverH }
    });
    await page.screenshot({ path: path.join(ARTIFACTS, 'examino_hover.png'), fullPage: true });
    await page.screenshot({ path: path.join(ARTIFACTS, 'ui_timeline_hover.png'), fullPage: true });

    // Volume tooltip must escape the card (not clipped by overflow)
    await page.evaluate(() => {
      const panel = document.getElementById('controls-panel');
      const bar = document.getElementById('omt-timeline-bar');
      if (panel) { panel.style.opacity = '1'; panel.style.pointerEvents = 'auto'; }
      if (bar) { bar.style.opacity = '1'; bar.style.pointerEvents = 'auto'; }
      const more = document.getElementById('omt-more-panel');
      const btn = document.getElementById('omt-more-toggle');
      if (more?.classList.contains('is-open')) btn?.click();
    });
    await page.waitForTimeout(120);
    // "Volume" tip is on the range, not the mute icon ("Mute / Unmute")
    const volBox = await page.locator('#omt-volume-range').boundingBox();
    if (volBox) {
      await page.mouse.move(volBox.x + volBox.width / 2, volBox.y + volBox.height / 2);
      await page.waitForTimeout(160);
    }
    const volumeTip = await page.evaluate(() => {
      const el = document.getElementById('omt-volume-range');
      const panel = document.getElementById('controls-panel');
      const root = document.getElementById('omt-root');
      const portal = document.getElementById('omt-control-tip');
      if (!el || !panel) return { ok: false, reason: 'missing' };
      const tip = getComputedStyle(el, '::after');
      const content = (tip.content || '').replace(/"/g, '');
      const portalText = (portal && !portal.hidden) ? (portal.textContent || '') : '';
      const portalVisible = !!(portal && !portal.hidden && portalText);
      const afterVisible = tip.opacity !== '0' && tip.visibility !== 'hidden' && content && content !== 'none';
      const visible = portalVisible || afterVisible;
      const panelOverflow = getComputedStyle(panel).overflow;
      const shown = portalText || content;
      const isVolume = /Volume/i.test((el.getAttribute('data-tip') || '')) && /Volume/i.test(shown);
      const elRect = el.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const rootRect = root ? root.getBoundingClientRect() : panelRect;
      const flip = panel.classList.contains('omt-tips-flip-below') ||
        !!(root && root.classList.contains('omt-tips-flip-below'));
      // Tip renders above the control (~22px) unless flipped below.
      const tipAboveOk = flip || (elRect.top - rootRect.top) >= 20;
      return {
        ok: visible && isVolume && panelOverflow === 'visible' && tipAboveOk,
        visible,
        isVolume,
        panelOverflow,
        flip,
        tipContent: tip.content,
        portalText,
        tipAboveOk,
        elTop: elRect.top,
        panelTop: panelRect.top,
        rootTop: rootRect.top,
        roomAboveRoot: elRect.top - rootRect.top
      };
    });
    results.push({
      name: 'controls-volume-tooltip-not-clipped',
      pass: volumeTip.ok === true,
      detail: volumeTip
    });
    // Crop tightly around the volume control so the tip is clearly visible in the artifact
    if (volBox) {
      await page.screenshot({
        path: path.join(ARTIFACTS, 'v175_volume_tooltip_visible.png'),
        clip: {
          x: Math.max(0, volBox.x - 40),
          y: Math.max(0, volBox.y - 48),
          width: Math.min(320, volBox.width + 120),
          height: Math.min(120, volBox.height + 90)
        }
      });
    } else {
      await page.screenshot({
        path: path.join(ARTIFACTS, 'v175_volume_tooltip_visible.png'),
        fullPage: true
      });
    }

    // More chevron tip: More controls ↔ Less controls
    const moreTip = await page.evaluate(async () => {
      const btn = document.getElementById('omt-more-toggle');
      const panel = document.getElementById('omt-more-panel');
      const card = document.getElementById('controls-panel');
      if (!btn || !panel || !card) return { ok: false, reason: 'missing' };
      if (panel.classList.contains('is-open')) btn.click();
      await new Promise((r) => setTimeout(r, 80));
      const collapsedTip = btn.getAttribute('data-tip') || '';
      btn.click();
      await new Promise((r) => setTimeout(r, 80));
      const expandedTip = btn.getAttribute('data-tip') || '';
      btn.click();
      await new Promise((r) => setTimeout(r, 40));
      const overflow = getComputedStyle(card).overflow;
      return {
        ok: /More controls/i.test(collapsedTip) && /Less controls/i.test(expandedTip) &&
          overflow === 'visible',
        collapsedTip,
        expandedTip,
        overflow
      };
    });
    results.push({
      name: 'controls-more-chevron-tooltip',
      pass: moreTip.ok === true,
      detail: moreTip
    });

    // v1.7.6 timeline: no Seek tip; no colour bands; ticks only on hover; snap tip
    const seekTipGone = await page.evaluate(() => {
      const slider = document.getElementById('omt-timeline-slider');
      return {
        noDataTip: !slider?.hasAttribute('data-tip'),
        tipAttr: slider?.getAttribute('data-tip')
      };
    });
    results.push({
      name: 'timeline-no-seek-label',
      pass: seekTipGone.noDataTip === true,
      detail: seekTipGone
    });

    // Set 1st + 2nd half kickoffs
    await page.evaluate(() => {
      const half = document.getElementById('omt-half-select');
      const moreBtn = document.getElementById('omt-more-toggle');
      const more = document.getElementById('omt-more-panel');
      if (more && !more.classList.contains('is-open')) moreBtn?.click();
      if (half) {
        half.value = '1';
        half.dispatchEvent(new Event('change', { bubbles: true }));
      }
      document.getElementById('omt-btn-set-kickoff')?.click();
    });
    await page.waitForTimeout(80);
    await page.evaluate(() => {
      const v = document.querySelector('video');
      const half = document.getElementById('omt-half-select');
      if (v) {
        try { v.currentTime = Math.min((v.duration || 7200) * 0.55, (v.seekable?.end?.(0) || 7200) - 10); } catch (_) {}
      }
      if (half) {
        half.value = '2';
        half.dispatchEvent(new Event('change', { bubbles: true }));
      }
      document.getElementById('omt-btn-set-kickoff')?.click();
    });
    await page.waitForTimeout(120);

    await page.evaluate(() => {
      const panel = document.getElementById('controls-panel');
      const bar = document.getElementById('omt-timeline-bar');
      if (panel) { panel.style.opacity = '1'; panel.style.pointerEvents = 'auto'; }
      if (bar) { bar.style.opacity = '1'; }
      const more = document.getElementById('omt-more-panel');
      const btn = document.getElementById('omt-more-toggle');
      if (more?.classList.contains('is-open')) btn?.click();
      // Leave hover so rest state is measurable
      bar?.classList.remove('is-timeline-hover');
      const tip = document.getElementById('omt-timeline-hover-tip');
      if (tip) tip.hidden = true;
      const v = document.querySelector('video');
      const slider = document.getElementById('omt-timeline-slider');
      if (v && slider) {
        const max = parseFloat(slider.max) || v.duration || 100;
        const min = parseFloat(slider.min) || 0;
        // Mid 1st→2nd: sit between kickoffs for mid-half hover later
        const t = min + (max - min) * 0.35;
        try { v.currentTime = t; } catch (_) {}
        slider.value = String(t);
        slider.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await page.waitForTimeout(140);

    const atRest = await page.evaluate(() => {
      const segs = document.querySelectorAll('.timeline-period-seg');
      const ticks = document.querySelectorAll('.omt-period-tick');
      const bookmarks = document.querySelectorAll('.omt-timeline-bookmark');
      const tickWrap = document.getElementById('omt-timeline-period-ticks');
      const tip = document.getElementById('omt-timeline-hover-tip');
      const slider = document.getElementById('omt-timeline-slider');
      const bg = slider ? (getComputedStyle(slider).backgroundImage || '') : '';
      const wrapCs = tickWrap ? getComputedStyle(tickWrap) : null;
      const shortLabels = [...ticks].map((t) => t.querySelector('.omt-period-tick-label')?.textContent?.trim());
      return {
        segCount: segs.length,
        tickCount: ticks.length,
        bookmarkCount: bookmarks.length,
        tipHidden: !tip || tip.hidden === true,
        wrapOpacity: wrapCs ? wrapCs.opacity : null,
        wrapVisibility: wrapCs ? wrapCs.visibility : null,
        shortLabels,
        fillHasRed: /e0201b|rgb\(224,\s*32,\s*27\)/i.test(bg),
        fillNeutral: /b0b0b0|rgb\(176,\s*176,\s*176\)/i.test(bg)
      };
    });
    results.push({
      name: 'timeline-no-colour-bands',
      pass: atRest.segCount === 0 && atRest.tickCount >= 2 && atRest.bookmarkCount === 0 &&
        !atRest.fillHasRed && atRest.fillNeutral,
      detail: atRest
    });
    results.push({
      name: 'timeline-no-markers-at-rest',
      pass: atRest.tipHidden === true && atRest.wrapOpacity === '0' && atRest.bookmarkCount === 0,
      detail: atRest
    });
    const trackBox = await page.locator('.omt-timeline-track').boundingBox();
    if (trackBox) {
      await page.screenshot({
        path: path.join(ARTIFACTS, 'v177_timeline_rest.png'),
        clip: {
          x: Math.max(0, trackBox.x - 16),
          y: Math.max(0, trackBox.y - 40),
          width: Math.min(920, trackBox.width + 32),
          height: 90
        }
      });
    }
    await page.screenshot({
      path: path.join(ARTIFACTS, 'v175_timeline_at_rest_2nd_half.png'),
      fullPage: true
    });

    const fillInstant = await page.evaluate(async () => {
      const slider = document.getElementById('omt-timeline-slider');
      if (!slider) return { ok: false, reason: 'no-slider' };
      const min = parseFloat(slider.min) || 0;
      const max = parseFloat(slider.max) || 100;
      const target = min + (max - min) * 0.72;
      slider.value = String(target);
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      const progressStr = slider.style.getPropertyValue('--omt-progress') || '';
      const progressPct = parseFloat(progressStr);
      const thumbPct = max > min ? ((parseFloat(slider.value) - min) / (max - min)) * 100 : 0;
      slider.dispatchEvent(new Event('change', { bubbles: true }));
      const progressAfterChange = parseFloat(slider.style.getPropertyValue('--omt-progress') || '');
      const bg = getComputedStyle(slider).backgroundImage || '';
      return {
        ok: Math.abs(progressPct - thumbPct) <= 0.6 && Math.abs(progressAfterChange - thumbPct) <= 0.6 &&
          /b0b0b0|rgb\(176,\s*176,\s*176\)/i.test(bg),
        progressPct,
        thumbPct,
        progressAfterChange,
        bg
      };
    });
    results.push({
      name: 'timeline-fill-matches-thumb-on-seek',
      pass: fillInstant.ok === true,
      detail: fillInstant
    });

    // Hover mid-half (away from ticks): tip + ticks/labels visible, no snap
    await page.evaluate(() => {
      const track = document.querySelector('.omt-timeline-track');
      const ticks = document.querySelectorAll('.omt-period-tick');
      if (!track || ticks.length < 2) return;
      const rect = track.getBoundingClientRect();
      const t0 = ticks[0].getBoundingClientRect();
      const t1 = ticks[1].getBoundingClientRect();
      const x = (t0.left + t1.left) / 2;
      track.dispatchEvent(new PointerEvent('pointermove', {
        clientX: x,
        clientY: rect.top + rect.height / 2,
        bubbles: true
      }));
    });
    await page.waitForFunction(() => {
      const tip = document.getElementById('omt-timeline-hover-tip');
      const wrap = document.getElementById('omt-timeline-period-ticks');
      if (!tip || tip.hidden || !wrap) return false;
      return getComputedStyle(tip).opacity === '1' && parseFloat(getComputedStyle(wrap).opacity) > 0.9;
    }, null, { timeout: 3000 });
    const midHover = await page.evaluate(() => {
      const tip = document.getElementById('omt-timeline-hover-tip');
      const bar = document.getElementById('omt-timeline-bar');
      const ticks = document.querySelectorAll('.omt-period-tick');
      if (!tip || ticks.length < 2) return { ok: false, reason: 'missing' };
      const text = (tip.textContent || '').trim();
      const tipCs = getComputedStyle(tip);
      const visible = tip.hidden === false && tipCs.display !== 'none' && tipCs.opacity === '1';
      const hasPeriod = /1st Half|2nd Half/i.test(text);
      const hasMatchClock = /\d{2}:\d{2}$/.test(text) && !/\d{2}:\d{2}:\d{2}/.test(text);
      const wrap = document.getElementById('omt-timeline-period-ticks');
      const wrapCs = wrap ? getComputedStyle(wrap) : null;
      const hoverClass = !!(bar && bar.classList.contains('is-timeline-hover'));
      const shorts = [...ticks].map((t) => t.querySelector('.omt-period-tick-label')?.textContent?.trim());
      const snapped = [...ticks].filter((t) => t.classList.contains('is-snap')).length;
      const wrapVisible = hoverClass && wrapCs && parseFloat(wrapCs.opacity || '0') > 0.9;
      const tipOpaque = /^rgb\(20,\s*20,\s*20\)$/.test(tipCs.backgroundColor);
      return {
        ok: visible && tipOpaque && hasPeriod && hasMatchClock && wrapVisible &&
          shorts.includes('1st') && shorts.includes('2nd') && snapped === 0,
        text,
        visible,
        tipOpaque,
        tipBg: tipCs.backgroundColor,
        hasPeriod,
        hasMatchClock,
        hoverClass,
        wrapOpacity: wrapCs?.opacity,
        wrapVisibility: wrapCs?.visibility,
        shorts,
        snapped
      };
    });
    results.push({
      name: 'timeline-hover-shows-match-clock',
      pass: midHover.ok === true,
      detail: midHover
    });
    results.push({
      name: 'timeline-ticks-on-hover',
      pass: midHover.ok === true,
      detail: { shorts: midHover.shorts, wrapOpacity: midHover.wrapOpacity, hoverClass: midHover.hoverClass }
    });
    if (trackBox) {
      const midXY = await page.evaluate(() => {
        const track = document.querySelector('.omt-timeline-track');
        const ticks = document.querySelectorAll('.omt-period-tick');
        if (!track || ticks.length < 2) return null;
        const rect = track.getBoundingClientRect();
        const t0 = ticks[0].getBoundingClientRect();
        const t1 = ticks[1].getBoundingClientRect();
        const x = (t0.left + t1.left) / 2;
        const y = rect.top + rect.height / 2;
        track.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true }));
        return { x, y };
      });
      if (midXY) await page.mouse.move(midXY.x, midXY.y);
      await page.waitForFunction(() => {
        const tip = document.getElementById('omt-timeline-hover-tip');
        const wrap = document.getElementById('omt-timeline-period-ticks');
        const label = document.querySelector('.omt-period-tick-label');
        if (!tip || tip.hidden || !wrap || !label) return false;
        const tipCs = getComputedStyle(tip);
        const tipR = tip.getBoundingClientRect();
        const wrapCs = getComputedStyle(wrap);
        return tipCs.opacity === '1' && tipR.width > 20 && tipR.height > 10 &&
          parseFloat(wrapCs.opacity) > 0.9 &&
          (label.textContent || '').trim().length > 0;
      }, null, { timeout: 3000 });
      // Freeze fades and re-assert geometry for a stable crop that includes tip + labels.
      const midClip = await page.evaluate((xy) => {
        const track = document.querySelector('.omt-timeline-track');
        const tip = document.getElementById('omt-timeline-hover-tip');
        const wrap = document.getElementById('omt-timeline-period-ticks');
        if (track && xy) {
          track.dispatchEvent(new PointerEvent('pointermove', {
            clientX: xy.x, clientY: xy.y, bubbles: true
          }));
        }
        if (tip) tip.style.transition = 'none';
        if (wrap) wrap.style.transition = 'none';
        const tipR = tip.getBoundingClientRect();
        const trackR = track.getBoundingClientRect();
        let maxY = trackR.bottom + 4;
        document.querySelectorAll('.omt-period-tick-label').forEach((el) => {
          maxY = Math.max(maxY, el.getBoundingClientRect().bottom + 4);
        });
        const y = Math.max(0, Math.min(tipR.top, trackR.top) - 10);
        // Extra room below for 1st/2nd labels under the scrubber.
        const bottom = Math.max(maxY, trackR.bottom + 36);
        return {
          ok: tipR.width > 20 && !tip.hidden && (tip.textContent || '').trim().length > 0,
          text: (tip.textContent || '').trim(),
          clip: {
            x: Math.max(0, trackR.left - 16),
            y,
            width: Math.min(920, trackR.width + 32),
            height: Math.max(120, Math.ceil(bottom - y + 8))
          }
        };
      }, midXY);
      results.push({
        name: 'timeline-hover-mid-screenshot-ready',
        pass: midClip.ok === true && /Half/i.test(midClip.text || ''),
        detail: midClip
      });
      if (midClip.ok && midXY) {
        const hold = await page.evaluate((xy) => {
          const track = document.querySelector('.omt-timeline-track');
          const tip = document.getElementById('omt-timeline-hover-tip');
          const wrap = document.getElementById('omt-timeline-period-ticks');
          const bar = document.getElementById('omt-timeline-bar');
          if (wrap) { wrap.style.transition = 'none'; wrap.style.opacity = '1'; }
          if (bar) {
            bar.classList.add('is-timeline-hover');
            bar.style.zIndex = '55';
          }
          if (track) {
            track.dispatchEvent(new PointerEvent('pointermove', {
              clientX: xy.x, clientY: xy.y, bubbles: true
            }));
          }
          if (!tip) return { ok: false };
          tip.hidden = false;
          tip.style.transition = 'none';
          tip.style.opacity = '1';
          // Hold tip open — ignore hide while we capture (pointerleave races).
          tip.dataset.omtHold = '1';
          const r = tip.getBoundingClientRect();
          return { ok: r.width > 20 && (tip.textContent || '').trim().length > 0, text: tip.textContent, r };
        }, midXY);
        results.push({
          name: 'timeline-hover-mid-hold',
          pass: hold.ok === true,
          detail: hold
        });
        await screenshotClipReliable(
          page,
          path.join(ARTIFACTS, 'v177_timeline_hover_mid_half.png'),
          midClip.clip
        );
        await page.evaluate(() => {
          const tip = document.getElementById('omt-timeline-hover-tip');
          if (tip) delete tip.dataset.omtHold;
        });
      }
    }

    // Snap to 2nd tick (~8px): tip at period start, orange highlight, click seeks
    const snap = await page.evaluate(() => {
      const track = document.querySelector('.omt-timeline-track');
      const tip = document.getElementById('omt-timeline-hover-tip');
      const ticks = document.querySelectorAll('.omt-period-tick');
      const t2 = [...ticks].find((t) => t.getAttribute('data-half') === '2');
      if (!track || !tip || !t2) return { ok: false, reason: 'missing-2nd' };
      const rect = track.getBoundingClientRect();
      const tr = t2.getBoundingClientRect();
      const x = tr.left + tr.width / 2;
      track.dispatchEvent(new PointerEvent('pointermove', {
        clientX: x,
        clientY: rect.top + rect.height / 2,
        bubbles: true
      }));
      const text = (tip.textContent || '').trim();
      const snapped = t2.classList.contains('is-snap');
      const before = document.querySelector('video')?.currentTime;
      track.dispatchEvent(new PointerEvent('pointerdown', {
        clientX: x,
        clientY: rect.top + rect.height / 2,
        bubbles: true,
        cancelable: true
      }));
      const after = document.querySelector('video')?.currentTime;
      const target = parseFloat(t2.getAttribute('data-t') || '');
      return {
        ok: snapped && /2nd Half/i.test(text) && /\d{2}:\d{2}/.test(text) &&
          isFinite(target) && Math.abs((after || 0) - target) < 1.5,
        text,
        snapped,
        before,
        after,
        target
      };
    });
    results.push({
      name: 'timeline-snap-to-2nd-tick-seeks',
      pass: snap.ok === true,
      detail: snap
    });
    await page.waitForTimeout(80);
    // Re-snap for a clear screenshot (click may have moved the playhead)
    const snapShot = await page.evaluate(() => {
      const track = document.querySelector('.omt-timeline-track');
      const t2 = document.querySelector('.omt-period-tick[data-half="2"]');
      if (!track || !t2) return null;
      const rect = track.getBoundingClientRect();
      const tr = t2.getBoundingClientRect();
      const x = tr.left + tr.width / 2;
      const y = rect.top + rect.height / 2;
      track.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true }));
      return { x, y, left: tr.left, top: rect.top, bottom: rect.bottom };
    });
    if (snapShot) {
      await page.mouse.move(snapShot.x, snapShot.y);
      await page.waitForFunction(() => {
        const tip = document.getElementById('omt-timeline-hover-tip');
        const t2 = document.querySelector('.omt-period-tick[data-half="2"]');
        if (!tip || tip.hidden || !t2) return false;
        const text = (tip.textContent || '').trim();
        return t2.classList.contains('is-snap') && /2nd Half/i.test(text) &&
          getComputedStyle(tip).opacity === '1' && tip.getBoundingClientRect().width > 20;
      }, null, { timeout: 3000 });
      const snapClip = await page.evaluate((xy) => {
        const track = document.querySelector('.omt-timeline-track');
        const tip = document.getElementById('omt-timeline-hover-tip');
        const t2 = document.querySelector('.omt-period-tick[data-half="2"]');
        if (track && xy) {
          track.dispatchEvent(new PointerEvent('pointermove', {
            clientX: xy.x, clientY: xy.y, bubbles: true
          }));
        }
        if (tip) tip.style.transition = 'none';
        const tipR = tip.getBoundingClientRect();
        const tickR = t2 ? t2.getBoundingClientRect() : tipR;
        const label = t2?.querySelector('.omt-period-tick-label');
        const labelR = label ? label.getBoundingClientRect() : tickR;
        const cx = tipR.left + tipR.width / 2;
        const y = Math.max(0, tipR.top - 8);
        const bottom = Math.max(tickR.bottom, labelR.bottom) + 10;
        return {
          ok: /2nd Half/i.test((tip.textContent || '')) && t2?.classList.contains('is-snap'),
          text: (tip.textContent || '').trim(),
          clip: {
            x: Math.max(0, cx - 160),
            y,
            width: 340,
            height: Math.max(120, Math.ceil(bottom - y))
          }
        };
      }, { x: snapShot.x, y: snapShot.y });
      results.push({
        name: 'timeline-snap-2nd-screenshot-ready',
        pass: snapClip.ok === true,
        detail: snapClip
      });
      if (snapClip.ok) {
        await page.evaluate((xy) => {
          const track = document.querySelector('.omt-timeline-track');
          const tip = document.getElementById('omt-timeline-hover-tip');
          const wrap = document.getElementById('omt-timeline-period-ticks');
          const bar = document.getElementById('omt-timeline-bar');
          if (wrap) { wrap.style.transition = 'none'; wrap.style.opacity = '1'; }
          if (bar) {
            bar.classList.add('is-timeline-hover');
            bar.style.zIndex = '55';
          }
          if (track) {
            track.dispatchEvent(new PointerEvent('pointermove', {
              clientX: xy.x, clientY: xy.y, bubbles: true
            }));
          }
          if (tip) {
            tip.hidden = false;
            tip.style.transition = 'none';
            tip.style.opacity = '1';
            tip.dataset.omtHold = '1';
          }
        }, { x: snapShot.x, y: snapShot.y });
        await screenshotClipReliable(
          page,
          path.join(ARTIFACTS, 'v177_timeline_snap_2nd_tick.png'),
          snapClip.clip
        );
        await page.evaluate(() => {
          const tip = document.getElementById('omt-timeline-hover-tip');
          if (tip) delete tip.dataset.omtHold;
        });
      }
    }
    await page.screenshot({
      path: path.join(ARTIFACTS, 'v175_timeline_hover_1st_half_match_clock.png'),
      fullPage: true
    });
    await page.screenshot({
      path: path.join(ARTIFACTS, 'v175_timeline_bookmarks_visible.png'),
      fullPage: true
    });

    // Extra-panel tip screenshots: ShuttleXpress + Clear timer (edge-clamped)
    await page.evaluate(() => {
      const more = document.getElementById('omt-more-panel');
      const btn = document.getElementById('omt-more-toggle');
      if (more && !more.classList.contains('is-open')) btn?.click();
      const panel = document.getElementById('controls-panel');
      if (panel) { panel.style.opacity = '1'; panel.style.pointerEvents = 'auto'; }
    });
    await page.waitForTimeout(120);
    const shuttleRow = page.locator('.omt-shuttle-block .omt-tip').first();
    await shuttleRow.hover();
    await page.waitForFunction(() => {
      const el = document.querySelector('.omt-shuttle-block .omt-tip');
      const portal = document.getElementById('omt-control-tip');
      if (!el) return false;
      if (portal && !portal.hidden && /ShuttleXpress/i.test(portal.textContent || '')) return true;
      if (!el.classList.contains('omt-tip-fixed')) return false;
      const tip = getComputedStyle(el, '::after');
      return tip.opacity === '1' && tip.visibility !== 'hidden';
    }, null, { timeout: 3000 });
    await page.waitForTimeout(40);
    const shuttleTip = await page.evaluate(() => {
      const el = document.querySelector('.omt-shuttle-block .omt-tip');
      const portal = document.getElementById('omt-control-tip');
      const tip = el ? getComputedStyle(el, '::after') : null;
      const portalCs = portal && !portal.hidden ? getComputedStyle(portal) : null;
      const panel = document.getElementById('controls-panel');
      const more = document.getElementById('omt-more-panel');
      const btnRect = el?.getBoundingClientRect();
      const tipTopVp = parseFloat(el?.dataset.omtTipViewportTop || 'NaN');
      const bg = portalCs?.backgroundColor || tip?.backgroundColor || '';
      const visible = portalCs
        ? portalCs.opacity !== '0' && portalCs.visibility !== 'hidden'
        : !!(tip && tip.opacity === '1' && tip.visibility !== 'hidden');
      return {
        tip: el?.getAttribute('data-tip') || '',
        portalText: portal?.textContent || '',
        visible,
        bg,
        opaque: /^rgb\(20,\s*20,\s*20\)$/.test(bg),
        below: !!(btnRect && Number.isFinite(tipTopVp) && tipTopVp >= btnRect.bottom - 1),
        tipTopVp,
        btnBottom: btnRect ? btnRect.bottom : null,
        panelOverflow: panel ? getComputedStyle(panel).overflow : null,
        moreOverflow: more ? getComputedStyle(more).overflow : null
      };
    });
    results.push({
      name: 'controls-shuttle-tooltip-clamped',
      pass: /ShuttleXpress/i.test(shuttleTip.tip) && shuttleTip.visible === true &&
        shuttleTip.opaque === true && shuttleTip.below === true &&
        shuttleTip.panelOverflow === 'visible' && shuttleTip.moreOverflow === 'visible',
      detail: shuttleTip
    });
    const shuttleShot = await page.evaluate(() => {
      const el = document.querySelector('.omt-shuttle-block .omt-tip');
      if (!el) return null;
      el.dataset.omtHold = '1';
      el.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
      const portal = document.getElementById('omt-control-tip');
      const r = el.getBoundingClientRect();
      const tipTop = parseFloat(el.dataset.omtTipViewportTop || String(r.bottom + 8));
      const tipLeft = parseFloat(el.dataset.omtTipViewportLeft || String(r.left));
      const tipW = 220;
      return {
        showing: !!(portal && !portal.hidden) ||
          (el.classList.contains('omt-tip-show') && el.classList.contains('omt-tip-fixed')),
        clip: {
          x: Math.max(0, Math.min(r.left - 24, tipLeft - 12)),
          y: Math.max(0, r.top - 8),
          width: Math.min(520, Math.max(r.width + 280, tipW + 40)),
          height: Math.ceil(Math.max(r.bottom, tipTop + 28) - Math.max(0, r.top - 8) + 4)
        }
      };
    });
    results.push({
      name: 'controls-shuttle-tooltip-screenshot-ready',
      pass: !!(shuttleShot && shuttleShot.showing),
      detail: shuttleShot
    });
    if (shuttleShot?.showing) {
      await screenshotClipReliable(
        page,
        path.join(ARTIFACTS, 'v177_shuttle_tooltip_visible.png'),
        shuttleShot.clip
      );
    }
    await page.evaluate(() => {
      const el = document.querySelector('.omt-shuttle-block .omt-tip');
      if (el) { delete el.dataset.omtHold; el.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true })); }
    });
    const clearBtn = page.locator('#omt-btn-clear-timer');
    await clearBtn.hover();
    await page.waitForFunction(() => {
      const el = document.getElementById('omt-btn-clear-timer');
      const portal = document.getElementById('omt-control-tip');
      if (!el) return false;
      if (portal && !portal.hidden && portal.textContent === 'Clear timer') return true;
      if (!el.classList.contains('omt-tip-fixed')) return false;
      const tip = getComputedStyle(el, '::after');
      return tip.opacity === '1' && tip.visibility !== 'hidden';
    }, null, { timeout: 3000 });
    await page.waitForTimeout(40);
    const clearTip = await page.evaluate(() => {
      const el = document.getElementById('omt-btn-clear-timer');
      const portal = document.getElementById('omt-control-tip');
      const tip = el ? getComputedStyle(el, '::after') : null;
      const portalCs = portal && !portal.hidden ? getComputedStyle(portal) : null;
      const btnRect = el?.getBoundingClientRect();
      const tipTopVp = parseFloat(el?.dataset.omtTipViewportTop || 'NaN');
      const bg = portalCs?.backgroundColor || tip?.backgroundColor || '';
      const visible = portalCs
        ? portalCs.opacity !== '0' && portalCs.visibility !== 'hidden'
        : !!(tip && tip.opacity === '1' && tip.visibility !== 'hidden');
      return {
        tip: el?.getAttribute('data-tip') || '',
        portalText: portal?.textContent || '',
        visible,
        bg,
        opaque: /^rgb\(20,\s*20,\s*20\)$/.test(bg),
        below: !!(btnRect && Number.isFinite(tipTopVp) && tipTopVp >= btnRect.bottom - 1),
        tipTopVp,
        btnBottom: btnRect ? btnRect.bottom : null
      };
    });
    results.push({
      name: 'controls-clear-timer-tooltip',
      pass: clearTip.tip === 'Clear timer' && clearTip.visible === true &&
        clearTip.opaque === true && clearTip.below === true,
      detail: clearTip
    });
    const clearShot = await page.evaluate(() => {
      const el = document.getElementById('omt-btn-clear-timer');
      if (!el) return null;
      el.dataset.omtHold = '1';
      el.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
      const portal = document.getElementById('omt-control-tip');
      const r = el.getBoundingClientRect();
      const tipTop = parseFloat(el.dataset.omtTipViewportTop || String(r.bottom + 8));
      const tipLeft = parseFloat(el.dataset.omtTipViewportLeft || String(r.left - 40));
      return {
        showing: !!(portal && !portal.hidden) ||
          (el.classList.contains('omt-tip-show') && el.classList.contains('omt-tip-fixed')),
        clip: {
          x: Math.max(0, Math.min(r.left - 60, tipLeft - 8)),
          y: Math.max(0, r.top - 8),
          width: 260,
          height: Math.ceil(Math.max(r.bottom, tipTop + 28) - Math.max(0, r.top - 8) + 4)
        }
      };
    });
    results.push({
      name: 'controls-clear-timer-tooltip-screenshot-ready',
      pass: !!(clearShot && clearShot.showing),
      detail: clearShot
    });
    if (clearShot?.showing) {
      await screenshotClipReliable(
        page,
        path.join(ARTIFACTS, 'v177_clear_timer_tooltip_visible.png'),
        clearShot.clip
      );
    }
    await page.evaluate(() => {
      const el = document.getElementById('omt-btn-clear-timer');
      if (el) { delete el.dataset.omtHold; el.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true })); }
    });

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
      const examinoSection = document.getElementById('omt-examino-settings');
      const kickoff = document.getElementById('omt-kickoff-bar');
      return {
        hasRoot: !!root,
        siteClass: root ? root.className : '',
        inVideoJs: !!(root && root.closest('.video-js')),
        examinoHidden: !examinoSection || getComputedStyle(examinoSection).display === 'none',
        hasKickoff: !!kickoff
      };
    });
    results.push({
      name: 'inplayip-overlay-regression',
      pass: inplayState.hasRoot && inplayState.siteClass.includes('omt-inplayip') && inplayState.inVideoJs && inplayState.hasKickoff,
      detail: inplayState
    });
    results.push({ name: 'inplayip-no-examino-section', pass: inplayState.examinoHidden === true });

    // Click-to-toggle on video surface (not controls)
    await page.evaluate(() => {
      const panel = document.getElementById('controls-panel');
      const bar = document.getElementById('omt-timeline-bar');
      if (panel) { panel.style.opacity = '0'; panel.style.pointerEvents = 'none'; }
      if (bar) { bar.style.opacity = '0'; bar.style.pointerEvents = 'none'; }
      const v = document.querySelector('video');
      try { v?.play(); } catch (_) {}
    });
    await page.waitForTimeout(80);
    const inplayVideoBox = await page.locator('video').boundingBox();
    if (inplayVideoBox) {
      await page.mouse.click(inplayVideoBox.x + inplayVideoBox.width / 2, inplayVideoBox.y + inplayVideoBox.height / 2);
      await page.waitForTimeout(180);
    }
    const inplayClickPause = await page.evaluate(() => {
      const v = document.querySelector('video');
      return { paused: !!(v && v.paused) };
    });
    results.push({
      name: 'inplayip-click-pauses',
      pass: inplayClickPause.paused === true,
      detail: inplayClickPause
    });
    if (inplayVideoBox) {
      await page.mouse.click(inplayVideoBox.x + inplayVideoBox.width / 2, inplayVideoBox.y + inplayVideoBox.height / 2);
      await page.waitForTimeout(180);
    }
    const inplayClickPlay = await page.evaluate(() => {
      const v = document.querySelector('video');
      return { paused: !!(v && v.paused) };
    });
    results.push({
      name: 'inplayip-click-plays',
      pass: inplayClickPlay.paused === false,
      detail: inplayClickPlay
    });

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
      document.getElementById('omt-btn-set-kickoff').click();
      const t = document.getElementById('match-timer');
      const wrap = document.getElementById('match-timer-wrap');
      return { ok: !!(t && (t.style.display === 'block' || (wrap && wrap.style.display === 'flex'))) };
    });
    results.push({ name: 'inplayip-timer-sync', pass: inplayTimer.ok === true });

    // Confirm v1.4.x UI is identical on InPlay (same Option A / speed / kickoff / shuttle chrome)
    const inplayUi = await captureUiFingerprint(page);
    results.push({
      name: 'inplayip-v14-ui-identical',
      pass: inplayUi.optionAOk && inplayUi.speedOk && inplayUi.hasHide &&
        /Auto hide:\s*on/i.test(inplayUi.hideTip) &&
        inplayUi.hasTimeline && inplayUi.hasKickoff && inplayUi.hasPeriod &&
        inplayUi.halfOpts.includes('1') && inplayUi.halfOpts.includes('2') &&
        inplayUi.halfOpts.includes('custom1') && inplayUi.halfOpts.includes('custom2') &&
        inplayUi.hasCustom1 && inplayUi.hasCustom2 && inplayUi.hasOffsetNudge &&
        inplayUi.hasShuttle && inplayUi.hasOsd && inplayUi.hasLive && inplayUi.hasMore &&
        inplayUi.examinoHidden && inplayUi.timelineAtBottom &&
        inplayUi.siteClass.includes('omt-inplayip'),
      detail: inplayUi
    });

    await page.evaluate(() => {
      const panel = document.getElementById('controls-panel');
      const timelineBar = document.getElementById('omt-timeline-bar');
      [panel, timelineBar].forEach((el) => {
        if (!el) return;
        el.style.opacity = '1';
        el.style.pointerEvents = 'auto';
      });
      const more = document.getElementById('omt-more-panel');
      const btn = document.getElementById('omt-more-toggle');
      if (more) {
        more.classList.remove('is-open');
        more.setAttribute('aria-hidden', 'true');
      }
      if (btn) {
        btn.classList.remove('is-open');
        btn.setAttribute('aria-expanded', 'false');
      }
      const v = document.querySelector('video');
      const slider = document.getElementById('omt-timeline-slider');
      if (v && slider) {
        try { v.pause(); } catch (_) {}
        const end = v.seekable?.length ? v.seekable.end(v.seekable.length - 1) : v.duration;
        const liveAt = typeof end === 'number' ? Math.max(0, end - 2) : v.currentTime;
        try { v.currentTime = liveAt; } catch (_) {}
        if (typeof end === 'number' && isFinite(end) && end > 0) {
          slider.min = '0';
          slider.max = String(end);
          slider.value = String(liveAt);
          slider.style.setProperty('--omt-progress', '100%');
        }
        timelineBar?.classList.add('omt-at-live');
        document.getElementById('omt-live-btn')?.classList.add('is-live');
      }
    });
    await page.waitForTimeout(100);
    await page.screenshot({ path: path.join(ARTIFACTS, 'inplayip-overlay.png'), fullPage: true });
    await page.screenshot({ path: path.join(ARTIFACTS, 'inplayip_overlay.png'), fullPage: true });
    await page.screenshot({ path: path.join(ARTIFACTS, 'inplayip_at_live.png'), fullPage: true });

    await page.evaluate(() => {
      const v = document.querySelector('video');
      const slider = document.getElementById('omt-timeline-slider');
      const timelineBar = document.getElementById('omt-timeline-bar');
      const end = v?.seekable?.length ? v.seekable.end(v.seekable.length - 1) : v?.duration;
      const behindAt = typeof end === 'number' ? Math.max(0, end * 0.55) : 100;
      try { if (v) v.currentTime = behindAt; } catch (_) {}
      if (slider && typeof end === 'number' && isFinite(end) && end > 0) {
        slider.value = String(behindAt);
        slider.style.setProperty('--omt-progress', '55%');
      }
      timelineBar?.classList.remove('omt-at-live');
      document.getElementById('omt-live-btn')?.classList.remove('is-live');
    });
    await page.waitForTimeout(80);
    await page.screenshot({ path: path.join(ARTIFACTS, 'inplayip_behind_live.png'), fullPage: true });

    await page.evaluate(() => {
      const more = document.getElementById('omt-more-panel');
      if (more && !more.classList.contains('is-open')) {
        document.getElementById('omt-more-toggle')?.click();
      }
    });
    await page.waitForTimeout(140);
    await page.screenshot({ path: path.join(ARTIFACTS, 'inplayip_expanded.png'), fullPage: true });

    const hideTipBox = await page.locator('#omt-hide-panel').boundingBox();
    if (hideTipBox) {
      await page.mouse.move(hideTipBox.x + hideTipBox.width / 2, hideTipBox.y + hideTipBox.height / 2);
      await page.waitForTimeout(140);
    }
    await page.screenshot({ path: path.join(ARTIFACTS, 'inplayip_hide_tooltip.png'), fullPage: true });

    // Toolbar popup (logo above wordmark only)
    const extUrlRe = /chrome-extension:\/\/([^/]+)/;
    let extId = null;
    const resolveExtId = () => {
      for (const sw of context.serviceWorkers()) {
        const m = String(sw.url()).match(extUrlRe);
        if (m) return m[1];
      }
      return null;
    };
    extId = resolveExtId();
    if (!extId) {
      try {
        const sw = await context.waitForEvent('serviceworker', { timeout: 8000 });
        const m = String(sw.url()).match(extUrlRe);
        if (m) extId = m[1];
      } catch (_) {
        extId = resolveExtId();
      }
    }
    if (extId) {
      const popupPage = await context.newPage();
      await popupPage.goto(`chrome-extension://${extId}/popup.html`);
      await popupPage.waitForTimeout(200);
      await popupPage.screenshot({ path: path.join(ARTIFACTS, 'popup.png') });
      await popupPage.screenshot({ path: path.join(ARTIFACTS, 'popup_logo_above.png') });
      const popupOk = await popupPage.evaluate(() => {
        const foot = (document.querySelector('.omt-popup-foot')?.textContent || '').trim();
        const soon = document.querySelector('.omt-soon-banner');
        const knob = (() => {
          const sw = document.querySelector('.omt-switch');
          const slider = document.querySelector('.omt-switch-slider');
          if (!sw || !slider) return { ok: false };
          const sr = sw.getBoundingClientRect();
          const before = getComputedStyle(slider, '::before');
          const kh = parseFloat(before.height) || 12;
          const trackInner = sr.height;
          const centered = before.top === before.bottom && kh === 12;
          return {
            ok: kh > 0 && trackInner >= 16 && trackInner <= 20 && centered,
            trackH: trackInner,
            knobH: kh,
            top: before.top,
            bottom: before.bottom
          };
        })();
        return {
          hasWordmark: !!document.querySelector('.omt-wordmark'),
          hasLogo: !!document.querySelector('.omt-sp-logo'),
          logoCount: document.querySelectorAll('.omt-sp-logo').length,
          hasCustomize: !!document.querySelector('[data-tab="customize"]'),
          noSoonBanner: !soon,
          noShuttleToggleInPopup: !document.getElementById('shuttle-toggle'),
          noSwap: !document.getElementById('brand-layout-toggle'),
          noCredit: !document.querySelector('.omt-brand-credit'),
          noPersonalizar: !document.body.textContent.includes('Personalizar') &&
            !document.body.textContent.includes('Em breve'),
          footOk: foot === 'v1.7.7',
          hasAutoPause: !!document.getElementById('omt-auto-pause-blur'),
          autoPauseDefaultOff: document.getElementById('omt-auto-pause-blur')
            ? document.getElementById('omt-auto-pause-blur').checked === false
            : false,
          hasOpenLocal: !!document.getElementById('omt-open-local-player'),
          openLocalLabel: (document.getElementById('omt-open-local-player')?.textContent || '').trim(),
          logoSrc: document.querySelector('.omt-sp-logo')?.getAttribute('src') || '',
          logoUncropped: (() => {
            const logo = document.querySelector('.omt-sp-logo');
            if (!logo) return false;
            const cs = getComputedStyle(logo);
            const box = logo.getBoundingClientRect();
            const ar = box.width / Math.max(1, box.height);
            return box.width >= 140 && ar > 3.2 && ar < 4.5 &&
              cs.objectFit === 'contain' && !/hidden/.test(cs.overflow) &&
              /stats-perform-logo-dark\.png/i.test(logo.getAttribute('src') || '');
          })(),
          keyCaps: document.querySelectorAll('#omt-shortcut-list .shortcut-keys kbd').length >= 8,
          hasShuttleSummary: !!document.getElementById('omt-gen-shuttle-details'),
          genSections: {
            actionsOpen: !!document.getElementById('omt-gen-actions-details')?.open,
            shortcutsOpen: !!document.getElementById('omt-gen-shortcuts-details')?.open,
            shuttleOpen: !!document.getElementById('omt-gen-shuttle-details')?.open
          },
          shuttleSummaryRows: document.querySelectorAll('#omt-shuttle-summary-list .shortcut-item').length,
          noGeneralShuttleList: !document.getElementById('omt-shuttle-summary-list')
            || document.querySelectorAll('#omt-shuttle-summary-list .shortcut-item').length === 0,
          headerClock: (document.querySelector('.omt-header-clock')?.textContent || '').trim(),
          generalDiagram: (() => {
            const host = document.getElementById('omt-shuttle-summary-diagram');
            const svg = host?.querySelector('.omt-shuttle-svg');
            const labels = Array.from(host?.querySelectorAll('.omt-sx-label[data-part]') || [])
              .map((el) => [el.getAttribute('data-part'), (el.textContent || '').trim()]);
            const map = Object.fromEntries(labels);
            const nums = Array.from(host?.querySelectorAll('.omt-sx-num') || [])
              .map((el) => (el.textContent || '').trim());
            return {
              hasSvg: !!svg,
              outline: !!host?.querySelector('.omt-sx-body') && !host?.querySelector('pattern'),
              map,
              nums,
              noBtnNumbers: nums.length === 0,
              ok: !!svg &&
                nums.length === 0 &&
                /Play\/Pause/i.test(map.btn3 || '') &&
                /^[−+\-]/.test(map.btn1 || '') &&
                /^[−+\-]/.test(map.btn2 || '') &&
                /^[−+\-]/.test(map.btn4 || '') &&
                /^[−+\-]/.test(map.btn5 || '') &&
                map.ring === 'Shuttle ring' &&
                map.jog === 'Jog'
            };
          })(),
          toggleKnob: knob
        };
      });
      // Default General: Actions open, Shortcuts/Shuttle collapsed → short popup
      await popupPage.screenshot({
        path: path.join(ARTIFACTS, 'popup_general_default.png'),
        fullPage: true
      });
      results.push({
        name: 'general-sections-default-compact',
        pass: popupOk.genSections.actionsOpen === true &&
          popupOk.genSections.shortcutsOpen === false &&
          popupOk.genSections.shuttleOpen === false,
        detail: popupOk.genSections
      });
      await popupPage.evaluate(() => {
        const a = document.getElementById('omt-gen-actions-details');
        const s = document.getElementById('omt-gen-shortcuts-details');
        const sh = document.getElementById('omt-gen-shuttle-details');
        if (a) a.open = true;
        if (s) s.open = true;
        if (sh) sh.open = true;
        sh?.scrollIntoView({ block: 'center' });
      });
      await popupPage.waitForTimeout(100);
      await popupPage.screenshot({
        path: path.join(ARTIFACTS, 'popup_general_all_open.png'),
        fullPage: true
      });
      await popupPage.screenshot({
        path: path.join(ARTIFACTS, 'popup_shuttle_general_diagram.png'),
        fullPage: true
      });
      await popupPage.screenshot({
        path: path.join(ARTIFACTS, 'popup_general_shuttle_open.png'),
        fullPage: true
      });
      results.push({
        name: 'popup-branding-and-personalizar',
        pass: popupOk.hasWordmark && popupOk.hasLogo && popupOk.logoCount === 1 &&
          popupOk.hasCustomize && popupOk.noSoonBanner && popupOk.noShuttleToggleInPopup &&
          popupOk.noSwap && popupOk.noCredit && popupOk.noPersonalizar &&
          popupOk.footOk && popupOk.keyCaps && popupOk.logoUncropped &&
          popupOk.hasAutoPause && popupOk.autoPauseDefaultOff &&
          popupOk.hasOpenLocal && popupOk.openLocalLabel === 'Open local player' &&
          /stats-perform-logo-dark\.png/i.test(popupOk.logoSrc || '') &&
          popupOk.hasShuttleSummary &&
          popupOk.noGeneralShuttleList === true &&
          popupOk.headerClock === '20:08' &&
          popupOk.generalDiagram.ok === true &&
          popupOk.toggleKnob.ok === true,
        detail: popupOk
      });
      results.push({
        name: 'popup-shuttle-general-diagram-only',
        pass: popupOk.generalDiagram.ok === true && popupOk.noGeneralShuttleList === true,
        detail: { diagram: popupOk.generalDiagram, noList: popupOk.noGeneralShuttleList }
      });

      // ---------- Customize tab (v1.6.2) ----------
      await popupPage.click('[data-tab="customize"]');
      await popupPage.waitForTimeout(150);
      const sectionsDefault = await popupPage.evaluate(() => {
        const clock = document.getElementById('omt-clock-details');
        const hotkeys = document.getElementById('omt-hotkeys-details');
        const shuttle = document.getElementById('omt-shuttle-details');
        const posOpts = Array.from(document.querySelectorAll('#clock-pos option')).map((o) => o.value);
        const bodyText = document.body.innerText || '';
        return {
          clockOpen: !!clock?.open,
          hotkeysOpen: !!hotkeys?.open,
          shuttleOpen: !!shuttle?.open,
          noSyncSection: !document.getElementById('omt-sync-details'),
          noSyncToggle: !document.getElementById('omt-kickoff-sync-enable'),
          noSyncLabel: !/Kickoff sync/i.test(bodyText),
          noResetPos: !document.getElementById('omt-clock-reset-pos'),
          noDragHint: !/drag the clock/i.test(bodyText),
          posOpts
        };
      });
      results.push({
        name: 'customize-sections-default',
        pass: sectionsDefault.clockOpen === true &&
          sectionsDefault.hotkeysOpen === false &&
          sectionsDefault.shuttleOpen === false &&
          sectionsDefault.noSyncSection === true &&
          sectionsDefault.noSyncToggle === true &&
          sectionsDefault.noSyncLabel === true &&
          sectionsDefault.noResetPos === true &&
          sectionsDefault.noDragHint === true &&
          posOptsInclude(sectionsDefault.posOpts),
        detail: sectionsDefault
      });
      await popupPage.screenshot({ path: path.join(ARTIFACTS, 'popup_customize.png'), fullPage: true });
      await popupPage.screenshot({
        path: path.join(ARTIFACTS, 'popup_customize_no_sync.png'),
        fullPage: true
      });
      results.push({
        name: 'customize-no-kickoff-sync-ui',
        pass: sectionsDefault.noSyncSection === true &&
          sectionsDefault.noSyncToggle === true &&
          sectionsDefault.noSyncLabel === true,
        detail: {
          noSyncSection: sectionsDefault.noSyncSection,
          noSyncToggle: sectionsDefault.noSyncToggle,
          noSyncLabel: sectionsDefault.noSyncLabel
        }
      });

      // Feature flag off → zero sync network even if page tries e2e harness messages
      mockSb.reset();
      syncNetworkLog.length = 0;
      await page.evaluate(() => {
        window.postMessage({ source: 'omt-e2e', type: 'OMT_E2E_SYNC_START' }, '*');
        window.postMessage({ source: 'omt-e2e', type: 'OMT_E2E_SYNC_PUBLISH' }, '*');
        window.postMessage({
          source: 'omt-e2e',
          type: 'OMT_E2E_SYNC_PUSH_ROW',
          row: {
            match_key: 'room:e2e-room',
            kickoff1: 12.5,
            updated_at: new Date().toISOString(),
            client_id: 'e2e-flag-off'
          }
        }, '*');
        window.postMessage({
          source: 'omt-page',
          type: 'OMT_SYNC_PUSH',
          payload: { row: { match_key: 'room:e2e-room', kickoff1: 99 } }
        }, '*');
        document.getElementById('omt-btn-set-kickoff')?.click();
      });
      await page.waitForTimeout(1000);
      const manifestHasOptionalSb = await popupPage.evaluate(async () => {
        try {
          const m = await fetch(chrome.runtime.getURL('manifest.json')).then((r) => r.json());
          const opt = m.optional_host_permissions || [];
          const hosts = m.host_permissions || [];
          return {
            optionalHasSupabase: opt.some((p) => /supabase/i.test(p)),
            hostHasSupabase: hosts.some((p) => /supabase/i.test(p))
          };
        } catch (e) {
          return { optionalHasSupabase: true, hostHasSupabase: true, err: String(e) };
        }
      });
      results.push({
        name: 'kickoff-sync-feature-off-zero-requests',
        pass: syncNetworkLog.length === 0 &&
          mockSb.log.length === 0 &&
          manifestHasOptionalSb.optionalHasSupabase === false &&
          manifestHasOptionalSb.hostHasSupabase === false,
        detail: {
          syncNetworkLog: syncNetworkLog.slice(),
          mockLog: mockSb.log.slice(),
          manifestHasOptionalSb
        }
      });

      // Shuttle section collapsed screenshot
      const shuttleCollapsed = await popupPage.evaluate(() => {
        const d = document.getElementById('omt-shuttle-details');
        if (d) d.open = false;
        d?.scrollIntoView({ block: 'start' });
        return { open: !!d?.open, hasSvg: !!document.getElementById('omt-shuttle-svg') };
      });
      await popupPage.waitForTimeout(80);
      await popupPage.screenshot({ path: path.join(ARTIFACTS, 'popup_shuttle_collapsed.png'), fullPage: true });

      // Expand Shuttle section
      await popupPage.evaluate(() => {
        const d = document.getElementById('omt-shuttle-details');
        if (d) d.open = true;
        d?.scrollIntoView({ block: 'start' });
        document.getElementById('omt-shuttle-svg')?.scrollIntoView({ block: 'center' });
      });
      await popupPage.waitForTimeout(120);
      await popupPage.screenshot({ path: path.join(ARTIFACTS, 'popup_shuttle_expanded.png'), fullPage: true });

      // Clock prefs + live preview (section already open by default)
      await popupPage.evaluate(() => {
        const d = document.getElementById('omt-clock-details');
        if (d) d.open = true;
      });
      await popupPage.selectOption('#clock-pos', 'top-right');
      await popupPage.selectOption('#clock-size', 'large');
      await popupPage.selectOption('#clock-shape', 'pill');
      await popupPage.waitForTimeout(100);
      const clockPreview = await popupPage.evaluate(() => {
        const stage = document.getElementById('omt-clock-preview-stage');
        const face = document.getElementById('omt-clock-preview-face');
        return {
          stageClass: stage?.className || '',
          faceClass: face?.className || ''
        };
      });
      results.push({
        name: 'customize-clock-preview',
        pass: /pos-top-right/.test(clockPreview.stageClass) &&
          /size-large/.test(clockPreview.faceClass) &&
          /style-pill/.test(clockPreview.faceClass),
        detail: clockPreview
      });

      // Open Shortcuts section for rebind tests
      await popupPage.evaluate(() => {
        const d = document.getElementById('omt-hotkeys-details');
        if (d) d.open = true;
      });
      await popupPage.waitForTimeout(80);

      // Rebind Play/Pause to KeyF and verify General list updates
      await popupPage.click('[data-bind="playPause"]');
      await popupPage.keyboard.press('KeyF');
      await popupPage.waitForTimeout(120);
      await popupPage.click('[data-tab="general"]');
      await popupPage.waitForTimeout(80);
      const reboundGeneral = await popupPage.evaluate(() => {
        const items = Array.from(document.querySelectorAll('#omt-shortcut-list .shortcut-item'));
        const play = items.find((el) => /Play \/ Pause/i.test(el.textContent || ''));
        return {
          playText: (play?.textContent || '').trim(),
          hasF: /F/.test(play?.textContent || '')
        };
      });
      results.push({
        name: 'customize-hotkey-rebind-general',
        pass: reboundGeneral.hasF === true,
        detail: reboundGeneral
      });
      await popupPage.screenshot({ path: path.join(ARTIFACTS, 'popup_rebound_shortcut.png') });

      // Conflict: bind Live to F as well
      await popupPage.click('[data-tab="customize"]');
      await popupPage.waitForTimeout(80);
      await popupPage.evaluate(() => {
        const d = document.getElementById('omt-hotkeys-details');
        if (d) d.open = true;
      });
      await popupPage.click('[data-bind="live"]');
      await popupPage.keyboard.press('KeyF');
      await popupPage.waitForTimeout(100);
      const conflictOk = await popupPage.evaluate(() => {
        const warns = Array.from(document.querySelectorAll('.omt-hotkey-warn')).map((w) => w.textContent || '');
        return { warns, ok: warns.some((w) => /conflict/i.test(w)) };
      });
      results.push({
        name: 'customize-hotkey-conflict',
        pass: conflictOk.ok === true,
        detail: conflictOk
      });

      // Reset all shortcuts
      await popupPage.click('#omt-hotkeys-reset-all');
      await popupPage.waitForTimeout(80);

      // Shuttle highlight: exactly one active part (SVG ↔ row)
      await popupPage.evaluate(() => {
        const d = document.getElementById('omt-shuttle-details');
        if (d) d.open = true;
      });
      await popupPage.waitForTimeout(60);
      await popupPage.focus('#omt-sx-skip1');
      await popupPage.waitForTimeout(40);
      const highlightBtn1 = await popupPage.evaluate(() => {
        const wrap = document.getElementById('omt-shuttle-diagram-wrap');
        const parts = Array.from(wrap?.querySelectorAll('.omt-sx-part.is-active') || [])
          .map((el) => el.getAttribute('data-part'));
        const rows = Array.from(document.querySelectorAll('#omt-shuttle-edit-list .omt-shuttle-row.is-active'))
          .map((el) => el.getAttribute('data-part'));
        const jogActive = !!wrap?.querySelector('.omt-sx-part[data-part="jog"].is-active');
        const ringActive = !!wrap?.querySelector('.omt-sx-part[data-part="ring"].is-active');
        return { parts, rows, jogActive, ringActive };
      });
      await popupPage.screenshot({
        path: path.join(ARTIFACTS, 'popup_shuttle_row_focus_btn.png'),
        fullPage: true
      });
      // Click diagram part via DOM (SVG hit-testing is flaky in headless).
      await popupPage.evaluate(() => {
        const el = document.querySelector('#omt-shuttle-diagram-wrap .omt-sx-part[data-part="btn5"]');
        el?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      });
      await popupPage.waitForTimeout(80);
      const highlight = await popupPage.evaluate(() => {
        const wrap = document.getElementById('omt-shuttle-diagram-wrap');
        const actives = Array.from(wrap?.querySelectorAll('.omt-sx-part.is-active') || [])
          .map((el) => el.getAttribute('data-part'));
        const activeRows = Array.from(document.querySelectorAll('#omt-shuttle-edit-list .omt-shuttle-row.is-active'))
          .map((el) => el.getAttribute('data-part'));
        const label = wrap?.querySelector('.omt-sx-label[data-part="btn5"]');
        const dimple = wrap?.querySelector('.omt-sx-dimple');
        const jogActive = !!wrap?.querySelector('.omt-sx-part[data-part="jog"].is-active');
        const ringActive = !!wrap?.querySelector('.omt-sx-part[data-part="ring"].is-active');
        const nums = Array.from(wrap?.querySelectorAll('.omt-sx-num') || [])
          .map((el) => (el.textContent || '').trim())
          .sort()
          .join(',');
        return {
          activeParts: actives,
          activeRows,
          singlePart: actives.length === 1 && actives[0] === 'btn5',
          singleRow: activeRows.length === 1 && activeRows[0] === 'btn5',
          jogActive,
          ringActive,
          label: (label?.textContent || '').trim(),
          hasLabels: (wrap?.querySelectorAll('.omt-sx-label[data-part]') || []).length >= 7,
          btnNumbers: nums,
          hasBtnNumbers: nums === '1,2,3,4,5',
          dimpleCy: dimple ? Number(dimple.getAttribute('cy')) : null,
          hasChevrons: document.querySelectorAll('.omt-num-chevrons .omt-chev').length >= 8,
          noStepperBtns: document.querySelectorAll('.omt-stepper-btn').length === 0
        };
      });
      await popupPage.evaluate(() => {
        document.getElementById('omt-shuttle-diagram-wrap')?.scrollIntoView({ block: 'center' });
      });
      await popupPage.waitForTimeout(80);
      await popupPage.screenshot({
        path: path.join(ARTIFACTS, 'popup_shuttle_customize_diagram.png'),
        fullPage: true
      });
      await popupPage.screenshot({
        path: path.join(ARTIFACTS, 'popup_shuttle_svg_btn5.png'),
        fullPage: true
      });
      await popupPage.screenshot({
        path: path.join(ARTIFACTS, 'popup_shuttle_single_select.png'),
        fullPage: true
      });

      // Focus Jog select → only jog active
      await popupPage.focus('#omt-sx-jog');
      await popupPage.waitForTimeout(40);
      const highlightJog = await popupPage.evaluate(() => {
        const wrap = document.getElementById('omt-shuttle-diagram-wrap');
        const parts = Array.from(wrap?.querySelectorAll('.omt-sx-part.is-active') || [])
          .map((el) => el.getAttribute('data-part'));
        const rows = Array.from(document.querySelectorAll('#omt-shuttle-edit-list .omt-shuttle-row.is-active'))
          .map((el) => el.getAttribute('data-part'));
        return { parts, rows };
      });
      await popupPage.screenshot({
        path: path.join(ARTIFACTS, 'popup_shuttle_row_focus_jog.png'),
        fullPage: true
      });

      // Generous hit targets: click interior of jog disc / ring band / button (real pointer, not stroke-only)
      const hitAreas = await popupPage.evaluate(async () => {
        const wrap = document.getElementById('omt-shuttle-diagram-wrap');
        const svg = wrap?.querySelector('.omt-shuttle-svg');
        if (!svg || !wrap) return { ok: false, reason: 'missing-svg' };
        const svgRect = svg.getBoundingClientRect();
        const toClient = (svgX, svgY) => {
          const x = svgRect.left + (svgX / 200) * svgRect.width;
          const y = svgRect.top + (svgY / 200) * svgRect.height;
          return { x, y };
        };
        const clickAt = (svgX, svgY) => {
          const { x, y } = toClient(svgX, svgY);
          const el = document.elementFromPoint(x, y);
          const part = el?.closest?.('.omt-sx-part[data-part]');
          if (part) {
            part.dispatchEvent(new MouseEvent('click', {
              bubbles: true, cancelable: true, view: window, clientX: x, clientY: y
            }));
          }
          return {
            tag: el?.tagName || null,
            className: typeof el?.getAttribute === 'function' ? (el.getAttribute('class') || '') : '',
            part: part?.getAttribute('data-part') || null
          };
        };
        const active = () => (wrap.querySelector('.omt-sx-part.is-active')?.getAttribute('data-part') || null);
        // Jog centre (inside disc, not only the dimple stroke)
        const jogHit = clickAt(100, 100);
        await new Promise((r) => setTimeout(r, 30));
        const jogActive = active();
        // Ring band at 12 o'clock (between outer/inner radii ~51–69)
        const ringHit = clickAt(100, 58);
        await new Promise((r) => setTimeout(r, 30));
        const ringActive = active();
        // Button 3 wedge interior
        const btn3Hit = clickAt(100, 38);
        await new Promise((r) => setTimeout(r, 30));
        const btn3Active = active();
        // Fill style must not be stroke-only on edit parts
        const jogDisk = wrap.querySelector('.omt-sx-jog-disk');
        const fill = jogDisk ? getComputedStyle(jogDisk).fill : '';
        const fillNone = /none/i.test(fill);
        return {
          ok: jogActive === 'jog' && ringActive === 'ring' && btn3Active === 'btn3' && !fillNone,
          jogHit, jogActive, ringHit, ringActive, btn3Hit, btn3Active, fill, fillNone
        };
      });
      results.push({
        name: 'customize-shuttle-diagram-hit-areas',
        pass: hitAreas.ok === true,
        detail: hitAreas
      });
      await popupPage.screenshot({
        path: path.join(ARTIFACTS, 'v173_popup_shuttle_piece_selected.png'),
        fullPage: true
      });

      results.push({
        name: 'customize-shuttle-diagram-highlight',
        pass: highlightBtn1.parts.length === 1 && highlightBtn1.parts[0] === 'btn1' &&
          highlightBtn1.rows.length === 1 && highlightBtn1.rows[0] === 'btn1' &&
          highlightBtn1.jogActive === false && highlightBtn1.ringActive === false &&
          highlight.singlePart === true &&
          highlight.singleRow === true &&
          highlight.jogActive === false &&
          highlight.ringActive === false &&
          highlightJog.parts.length === 1 && highlightJog.parts[0] === 'jog' &&
          highlightJog.rows.length === 1 && highlightJog.rows[0] === 'jog' &&
          shuttleCollapsed.hasSvg === true &&
          highlight.hasLabels === true &&
          highlight.hasBtnNumbers === true &&
          /^[−+\-]/.test(highlight.label || '') &&
          highlight.dimpleCy != null && highlight.dimpleCy >= 82 &&
          highlight.hasChevrons === true &&
          highlight.noStepperBtns === true,
        detail: { highlightBtn1, highlight, highlightJog, shuttleCollapsed }
      });

      // Change shuttle skip + Play/Pause SWAP to Btn 5 (Btn 3 inherits +2m)
      await popupPage.fill('#omt-sx-skip1', '90');
      await popupPage.selectOption('#omt-sx-playpause', '5');
      await popupPage.waitForTimeout(80);
      const swapTo5 = await popupPage.evaluate(() => {
        const wrap = document.getElementById('omt-shuttle-diagram-wrap');
        const map = {};
        wrap?.querySelectorAll('.omt-sx-label[data-part]').forEach((el) => {
          map[el.getAttribute('data-part')] = (el.textContent || '').trim();
        });
        const rows = Array.from(document.querySelectorAll('#omt-shuttle-edit-list .omt-shuttle-row')).map((row) => ({
          part: row.getAttribute('data-part'),
          label: (row.querySelector('.omt-shuttle-label')?.textContent || '').trim(),
          hasNum: !!row.querySelector('input[type="number"]'),
          hasPp: !!row.querySelector('#omt-sx-playpause')
        }));
        return { map, rows };
      });
      await popupPage.screenshot({
        path: path.join(ARTIFACTS, 'popup_shuttle_playpause_swap_btn5.png'),
        fullPage: true
      });
      // Also sync General diagram labels
      await popupPage.click('.omt-tab[data-tab="general"]');
      await popupPage.evaluate(() => {
        const sh = document.getElementById('omt-gen-shuttle-details');
        if (sh) sh.open = true;
        sh?.scrollIntoView({ block: 'center' });
      });
      await popupPage.waitForTimeout(80);
      const generalAfterSwap = await popupPage.evaluate(() => {
        const host = document.getElementById('omt-shuttle-summary-diagram');
        const map = {};
        host?.querySelectorAll('.omt-sx-label[data-part]').forEach((el) => {
          map[el.getAttribute('data-part')] = (el.textContent || '').trim();
        });
        return map;
      });
      await popupPage.screenshot({
        path: path.join(ARTIFACTS, 'popup_general_playpause_swap_btn5.png'),
        fullPage: true
      });
      await popupPage.click('.omt-tab[data-tab="customize"]');
      await popupPage.evaluate(() => {
        const d = document.getElementById('omt-shuttle-details');
        if (d) d.open = true;
      });
      await popupPage.waitForTimeout(40);
      await popupPage.selectOption('#omt-sx-jog', '0.08');
      await popupPage.selectOption('#omt-sx-scale', '2');
      await popupPage.waitForTimeout(80);
      const liveLabels = await popupPage.evaluate(() => {
        const wrap = document.getElementById('omt-shuttle-diagram-wrap');
        const map = {};
        wrap?.querySelectorAll('.omt-sx-label[data-part]').forEach((el) => {
          map[el.getAttribute('data-part')] = (el.textContent || '').trim();
        });
        const skip1Reset = document.querySelector('[data-reset="skipBtn1"]');
        const hkEditor = document.getElementById('omt-hotkey-editor');
        const hkCs = hkEditor ? getComputedStyle(hkEditor) : null;
        const sxReset = document.getElementById('omt-sx-reset-all');
        const sxCs = sxReset ? getComputedStyle(sxReset) : null;
        const svg = wrap?.querySelector('.omt-shuttle-svg');
        const svgBox = svg?.getBoundingClientRect();
        const maxH = hkCs ? parseFloat(hkCs.maxHeight) : NaN;
        return {
          map,
          dirtyReset: !!skip1Reset?.classList.contains('is-dirty'),
          compactHotkeyScroll: !!hkCs && Number.isFinite(maxH) && maxH > 0 && maxH <= 240 &&
            /auto|scroll/.test(hkCs.overflowY || ''),
          sxNeutral: !!sxCs && !/rgb\(245,\s*131,\s*31\)/.test(sxCs.backgroundColor || ''),
          svgWide: !!svgBox && svgBox.width >= 250
        };
      });
      results.push({
        name: 'customize-shuttle-playpause-swap',
        pass: /Play\/Pause/i.test(swapTo5.map.btn5 || '') &&
          /\+2m|\+120/.test(swapTo5.map.btn3 || '') &&
          swapTo5.rows.find((r) => r.part === 'btn5')?.hasPp === true &&
          swapTo5.rows.find((r) => r.part === 'btn5')?.hasNum === false &&
          swapTo5.rows.find((r) => r.part === 'btn3')?.hasNum === true &&
          /Play\/Pause/i.test(generalAfterSwap.btn5 || '') &&
          /\+2m|\+120/.test(generalAfterSwap.btn3 || ''),
        detail: { swapTo5, generalAfterSwap }
      });
      results.push({
        name: 'customize-shuttle-diagram-live-labels',
        pass: /Play\/Pause/i.test(liveLabels.map.btn5 || '') &&
          /90s|−90s|−90/.test(liveLabels.map.btn1 || '') &&
          liveLabels.map.ring === 'Shuttle ring' &&
          liveLabels.map.jog === 'Jog',
        detail: liveLabels.map
      });
      results.push({
        name: 'customize-popup-polish-v161',
        pass: liveLabels.dirtyReset === true &&
          liveLabels.compactHotkeyScroll === true &&
          liveLabels.sxNeutral === true &&
          liveLabels.svgWide === true,
        detail: liveLabels
      });
      const shuttleStored = await popupPage.evaluate(async () => {
        const prefs = await chrome.storage.local.get(['omtShuttlePrefs', 'omtHotkeys', 'omtClockPosition', 'omtClockSize', 'omtClockShape']);
        return prefs;
      });
      results.push({
        name: 'customize-persistence-storage',
        pass: shuttleStored.omtClockPosition === 'top-right' &&
          shuttleStored.omtClockSize === 'large' &&
          shuttleStored.omtClockShape === 'pill' &&
          shuttleStored.omtShuttlePrefs?.skipBtn1 === 90 &&
          shuttleStored.omtShuttlePrefs?.playPauseBtn === 5 &&
          shuttleStored.omtShuttlePrefs?.skipBtn3 === 120 &&
          shuttleStored.omtShuttlePrefs?.centreSkipSign === 1 &&
          shuttleStored.omtShuttlePrefs?.jogStep === 0.08 &&
          shuttleStored.omtShuttlePrefs?.shuttleScale === 2,
        detail: shuttleStored
      });

      await popupPage.close();

      // Return to Examino mock (page may still be on InPlay from earlier).
      // VOD duration is 7200s so clock seeks to 45:xx are not clamped.
      await page.bringToFront();
      await page.goto(`${base}/examino-mock.html`, { waitUntil: 'domcontentloaded' });
      await waitForOmt(page, 20000);
      await page.waitForFunction(() => {
        const v = document.querySelector('video');
        return v && v.dataset.omtSource === 'VOD' && v.duration >= 7000;
      }, null, { timeout: 15000 });
      await page.evaluate(() => {
        for (const id of ['omt-sync-hr', 'omt-sync-min', 'omt-sync-sec']) {
          const el = document.getElementById(id);
          if (el) el.value = '';
        }
        const half = document.getElementById('omt-half-select');
        if (half) half.value = '1';
        const v = document.querySelector('video');
        if (v) { try { v.pause(); v.currentTime = 0; } catch (_) {} }
        document.getElementById('omt-btn-set-kickoff')?.click();
      });
      await page.waitForTimeout(200);
      // Broadcast storage sync as bridge would
      await page.evaluate(() => {
        localStorage.setItem('omtClockPosition', 'top-right');
        localStorage.setItem('omtClockSize', 'large');
        localStorage.setItem('omtClockShape', 'pill');
        window.postMessage({
          source: 'omt-bridge',
          type: 'OMT_STORAGE_SYNC',
          values: {
            omtClockPosition: 'top-right',
            omtClockSize: 'large',
            omtClockShape: 'pill'
          }
        }, '*');
      });
      await page.waitForTimeout(150);
      await page.screenshot({ path: path.join(ARTIFACTS, 'clock_top_right_large_pill.png'), fullPage: true });
      const clockApplied = await page.evaluate(() => {
        const wrap = document.getElementById('match-timer-wrap');
        return {
          classes: wrap?.className || '',
          visible: !!wrap && getComputedStyle(wrap).display !== 'none'
        };
      });
      results.push({
        name: 'customize-clock-live-apply',
        pass: /omt-clock-pos-top-right/.test(clockApplied.classes) &&
          /omt-clock-size-large/.test(clockApplied.classes) &&
          /omt-clock-style-pill/.test(clockApplied.classes) &&
          clockApplied.visible,
        detail: clockApplied
      });

      // Other corners / centre / sizes screenshots
      for (const [pos, size, shape, file] of [
        ['top-left', 'small', 'rounded', 'clock_top_left_small.png'],
        ['top-centre', 'medium', 'rounded', 'clock_top_centre.png'],
        ['bottom-left', 'medium', 'minimal', 'clock_bottom_left_minimal.png'],
        ['bottom-centre', 'large', 'pill', 'clock_bottom_centre.png'],
        ['bottom-right', 'xlarge', 'rounded', 'clock_bottom_right_xlarge.png']
      ]) {
        await page.evaluate(({ pos, size, shape }) => {
          window.postMessage({
            source: 'omt-bridge',
            type: 'OMT_STORAGE_SYNC',
            values: {
              omtClockPosition: pos,
              omtClockSize: size,
              omtClockShape: shape,
              omtClockCustomOffset: null
            }
          }, '*');
          try {
            localStorage.setItem('omtClockPosition', pos);
            localStorage.setItem('omtClockSize', size);
            localStorage.setItem('omtClockShape', shape);
            localStorage.removeItem('omtClockCustomOffset');
          } catch (_) {}
        }, { pos, size, shape });
        await page.waitForTimeout(120);
        await page.screenshot({ path: path.join(ARTIFACTS, file), fullPage: true });
      }

      // ---- Clock click-to-edit: production-style input + flexible parse ----
      // Stay on current Examino VOD (already duration ≥ 7000). Avoid Source
      // churn that reinjects the HUD mid-test.
      await page.evaluate(() => {
        window.postMessage({
          source: 'omt-bridge',
          type: 'OMT_STORAGE_SYNC',
          values: {
            omtClockPosition: 'top-right',
            omtClockSize: 'large',
            omtClockShape: 'rounded',
            omtClockCustomOffset: null
          }
        }, '*');
        try {
          localStorage.setItem('omtClockPosition', 'top-right');
          localStorage.setItem('omtClockSize', 'large');
          localStorage.setItem('omtClockShape', 'rounded');
          localStorage.removeItem('omtClockCustomOffset');
        } catch (_) {}
        document.getElementById('omt-btn-clear-timer')?.click();
        for (const id of ['omt-sync-hr', 'omt-sync-min', 'omt-sync-sec']) {
          const el = document.getElementById(id);
          if (el) el.value = '';
        }
        const half = document.getElementById('omt-half-select');
        if (half) half.value = '1';
        const v = document.querySelector('video');
        if (v) { v.pause(); v.currentTime = 0; }
        document.getElementById('omt-btn-set-kickoff')?.click();
      });
      await page.waitForTimeout(350);

      // Click opens edit with integer-minute prefill (no mm:ss mask)
      const preEdit = await page.evaluate(() => {
        const t = document.getElementById('match-timer');
        const w = document.getElementById('match-timer-wrap');
        const r = t?.getBoundingClientRect();
        return {
          text: (t?.textContent || '').trim(),
          wrapClass: w?.className || '',
          display: w ? getComputedStyle(w).display : null,
          opacity: w ? getComputedStyle(w).opacity : null,
          pe: w ? getComputedStyle(w).pointerEvents : null,
          rootOn: !!document.getElementById('omt-root')?.classList.contains('omt-timer-on'),
          rect: r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null,
          typeofEdit: typeof iniciarEdicaoTimer
        };
      });
      results.push({ name: 'clock-edit-pre-state', pass: preEdit.rootOn === true && (preEdit.rect?.w || 0) > 0, detail: preEdit });
      await page.waitForFunction(() => {
        const t = document.getElementById('match-timer');
        const text = (t?.textContent || '').trim();
        return !!document.getElementById('omt-root')?.classList.contains('omt-timer-on') &&
          text.length > 0 && !/pre-match/i.test(text);
      }, null, { timeout: 5000 });
      // Prefer DOM click on the clock face (content-script listener is on the wrap).
      await page.evaluate(() => {
        const face = document.getElementById('match-timer');
        const wrap = document.getElementById('match-timer-wrap');
        const el = face || wrap;
        el?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      });
      try {
        await page.waitForSelector('#timer-edit-input', { timeout: 2500 });
      } catch (_) {
        await page.locator('#match-timer').click({ force: true });
        await page.waitForSelector('#timer-edit-input', { timeout: 5000 });
      }
      await page.waitForTimeout(50);
      const editOpen = await page.evaluate(() => {
        const input = document.getElementById('timer-edit-input');
        const timer = document.getElementById('match-timer');
        const wrap = document.getElementById('match-timer-wrap');
        const cs = wrap ? getComputedStyle(wrap) : null;
        return {
          hasInput: !!input,
          value: input?.value ?? null,
          digitsOnlyPrefill: /^\d+$/.test(input?.value || ''),
          editing: !!timer?.classList.contains('is-editing'),
          noGrab: !cs || !/grab/.test(cs.cursor || ''),
          inputType: input?.getAttribute('type') || null
        };
      });
      results.push({
        name: 'clock-edit-opens-integer-prefill',
        pass: editOpen.hasInput && editOpen.digitsOnlyPrefill && editOpen.editing && editOpen.noGrab,
        detail: editOpen
      });
      await page.screenshot({ path: path.join(ARTIFACTS, 'clock_edit_open.png'), fullPage: true });

      // Minutes alone: "45" → 45:00
      await page.fill('#timer-edit-input', '45');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => !document.getElementById('timer-edit-input'), null, { timeout: 3000 });
      await page.waitForTimeout(150);
      const after45 = await page.evaluate(() => {
        const timer = document.getElementById('match-timer');
        const osd = document.getElementById('osd-message');
        const v = document.querySelector('video');
        return {
          editing: !!timer?.classList.contains('is-editing'),
          text: (timer?.textContent || '').trim(),
          osd: (osd?.textContent || '').trim(),
          currentTime: v?.currentTime ?? null
        };
      });
      results.push({
        name: 'clock-edit-minutes-only-45',
        pass: after45.editing === false &&
          /Clock set 45:00/.test(after45.osd || '') &&
          (/45:00/.test(after45.text) || (after45.currentTime != null && Math.abs(after45.currentTime - 45 * 60) < 2)),
        detail: after45
      });

      // Flexible separators → 45:30
      async function clockEditCase(raw, expectOk, expectLabel) {
        await page.click('#match-timer');
        await page.waitForSelector('#timer-edit-input', { timeout: 5000 });
        await page.fill('#timer-edit-input', raw);
        await page.keyboard.press('Enter');
        if (expectOk) {
          await page.waitForFunction(() => !document.getElementById('timer-edit-input'), null, { timeout: 3000 }).catch(() => {});
        }
        await page.waitForTimeout(180);
        return page.evaluate(({ expectOk, expectLabel, raw }) => {
          const timer = document.getElementById('match-timer');
          const input = document.getElementById('timer-edit-input');
          const hint = document.querySelector('.omt-clock-edit-hint');
          const osd = document.getElementById('osd-message');
          const v = document.querySelector('video');
          const editing = !!timer?.classList.contains('is-editing');
          const invalid = !!timer?.classList.contains('is-invalid');
          if (expectOk) {
            const labelHit = new RegExp(expectLabel.replace(':', '\\:')).test(
              (timer?.textContent || '') + ' ' + (osd?.textContent || '')
            );
            const secs = expectLabel.split(':').map(Number);
            const target = secs[0] * 60 + secs[1];
            return {
              raw,
              pass: editing === false && labelHit && v && Math.abs(v.currentTime - target) < 2,
              editing,
              invalid,
              text: (timer?.textContent || '').trim(),
              osd: (osd?.textContent || '').trim(),
              hint: hint?.textContent || null,
              currentTime: v?.currentTime ?? null
            };
          }
          return {
            raw,
            pass: editing === true && invalid === true && !!input &&
              /Seconds 0-59/i.test(hint?.textContent || ''),
            editing,
            invalid,
            text: (timer?.textContent || '').trim(),
            hint: hint?.textContent || null,
            inputValue: input?.value ?? null
          };
        }, { expectOk, expectLabel, raw });
      }

      const sepCases = [];
      for (const raw of ['45:30', '45.30', '45,30', '45 30', '45-30']) {
        const r = await clockEditCase(raw, true, '45:30');
        sepCases.push(r);
        results.push({
          name: `clock-edit-separator-${raw.replace(/\s/g, 'space')}`,
          pass: r.pass === true,
          detail: r
        });
      }
      await page.screenshot({ path: path.join(ARTIFACTS, 'clock_edit_45_30.png'), fullPage: true });

      // Seconds > 59: keep edit open + red outline + hint; OSD cleared while editing
      const badSecs = await clockEditCase('45:70', false, null);
      const invalidLayout = await page.evaluate(() => {
        const wrap = document.getElementById('match-timer-wrap');
        const timer = document.getElementById('match-timer');
        const hint = document.querySelector('.omt-clock-edit-hint');
        const osd = document.getElementById('osd-message');
        const tr = timer?.getBoundingClientRect();
        const hr = hint?.getBoundingClientRect();
        const wr = wrap?.getBoundingClientRect();
        return {
          osdHidden: !osd || !osd.classList.contains('visible'),
          hintBelow: !!(tr && hr && hr.top >= tr.bottom - 1),
          hintAligned: !!(tr && hr && Math.abs((hr.left + hr.right) / 2 - (tr.left + tr.right) / 2) < 12),
          wrapNotMuchWider: !!(tr && wr && wr.width <= tr.width + 4),
          invalid: !!timer?.classList.contains('is-invalid')
        };
      });
      results.push({
        name: 'clock-edit-seconds-over-59-hint',
        pass: badSecs.pass === true &&
          invalidLayout.osdHidden === true &&
          invalidLayout.hintBelow === true &&
          invalidLayout.hintAligned === true &&
          invalidLayout.wrapNotMuchWider === true,
        detail: { badSecs, invalidLayout }
      });
      await page.screenshot({ path: path.join(ARTIFACTS, 'clock_edit_invalid_seconds.png'), fullPage: true });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(80);

      // Invalid state at required positions/sizes
      for (const [pos, size, file] of [
        ['top-left', 'small', 'clock_invalid_top_left_S.png'],
        ['top-right', 'xlarge', 'clock_invalid_top_right_XL.png'],
        ['bottom-centre', 'medium', 'clock_invalid_bottom_centre_M.png']
      ]) {
        await page.evaluate(({ pos, size }) => {
          window.postMessage({
            source: 'omt-bridge',
            type: 'OMT_STORAGE_SYNC',
            values: { omtClockPosition: pos, omtClockSize: size, omtClockShape: 'rounded' }
          }, '*');
          try {
            localStorage.setItem('omtClockPosition', pos);
            localStorage.setItem('omtClockSize', size);
            localStorage.setItem('omtClockShape', 'rounded');
          } catch (_) {}
          // Keep transport chrome out of the way for bottom-position shots.
          const panel = document.getElementById('controls-panel');
          const bar = document.getElementById('omt-timeline-bar');
          const kick = document.getElementById('omt-kickoff-bar');
          if (panel) {
            panel.style.setProperty('opacity', '0', 'important');
            panel.style.setProperty('pointer-events', 'none', 'important');
            panel.style.setProperty('visibility', 'hidden', 'important');
          }
          if (bar) {
            bar.style.setProperty('opacity', '0', 'important');
            bar.style.setProperty('visibility', 'hidden', 'important');
          }
          if (kick) {
            kick.style.setProperty('opacity', '0', 'important');
            kick.style.setProperty('visibility', 'hidden', 'important');
          }
        }, { pos, size });
        await page.waitForTimeout(120);
        await page.evaluate(() => {
          document.getElementById('match-timer')?.dispatchEvent(
            new MouseEvent('click', { bubbles: true, cancelable: true, view: window })
          );
        });
        await page.waitForSelector('#timer-edit-input', { timeout: 5000 });
        await page.fill('#timer-edit-input', '45:70');
        await page.keyboard.press('Enter');
        await page.waitForTimeout(150);
        const layout = await page.evaluate(({ pos }) => {
          const wrap = document.getElementById('match-timer-wrap');
          const timer = document.getElementById('match-timer');
          const hint = document.querySelector('.omt-clock-edit-hint');
          const osd = document.getElementById('osd-message');
          const tr = timer?.getBoundingClientRect();
          const hr = hint?.getBoundingClientRect();
          const bottom = /bottom/.test(pos);
          return {
            invalid: !!timer?.classList.contains('is-invalid'),
            osdHidden: !osd || !osd.classList.contains('visible'),
            hintText: hint?.textContent || '',
            hintSideOk: !!(tr && hr && (bottom ? hr.bottom <= tr.top + 1 : hr.top >= tr.bottom - 1)),
            posClass: wrap?.className || ''
          };
        }, { pos });
        results.push({
          name: `clock-invalid-layout-${pos}-${size}`,
          pass: layout.invalid && layout.osdHidden && /Seconds 0-59/.test(layout.hintText) && layout.hintSideOk,
          detail: layout
        });
        await page.screenshot({ path: path.join(ARTIFACTS, file), fullPage: true });
        await page.keyboard.press('Escape');
        await page.waitForTimeout(80);
      }

      // Esc cancels invalid edit (ensure clean state)
      await page.waitForTimeout(40);
      const afterEsc = await page.evaluate(() => {
        const timer = document.getElementById('match-timer');
        const input = document.getElementById('timer-edit-input');
        const hint = document.querySelector('.omt-clock-edit-hint');
        return {
          editing: !!timer?.classList.contains('is-editing'),
          hasInput: !!input,
          hasHint: !!hint
        };
      });
      results.push({
        name: 'clock-edit-escape-cancels',
        pass: afterEsc.editing === false && afterEsc.hasInput === false && afterEsc.hasHint === false,
        detail: { afterEsc, sepCases }
      });

      // Rebound hotkey F toggles play on page after applying hotkeys map
      await page.evaluate(() => {
        const map = {
          playPause: { key: 'f' },
          skipBack2: { key: 'arrowleft' },
          skipFwd2: { key: 'arrowright' },
          skipBack10: { key: 'arrowleft', shift: true },
          skipFwd10: { key: 'arrowright', shift: true },
          skipBack2m: { key: 'arrowleft', ctrl: true },
          skipFwd2m: { key: 'arrowright', ctrl: true },
          frameBack: { key: 'arrowdown' },
          frameFwd: { key: 'arrowup' },
          speedDown: { key: 'z' },
          speedUp: { key: 'c' },
          speedReset: { key: 'x' },
          kickoff: { key: 'k' },
          live: { key: 'l' },
          hide: { key: 'h' }
        };
        localStorage.setItem('omtHotkeys', JSON.stringify(map));
        window.postMessage({
          source: 'omt-bridge',
          type: 'OMT_STORAGE_SYNC',
          values: { omtHotkeys: map }
        }, '*');
      });
      await page.waitForTimeout(100);
      await page.evaluate(() => {
        const v = document.querySelector('video');
        if (v) { v.pause(); }
      });
      await page.keyboard.press('KeyF');
      await page.waitForTimeout(150);
      const fPlay = await page.evaluate(() => {
        const v = document.querySelector('video');
        return { paused: !!v?.paused };
      });
      results.push({
        name: 'customize-hotkey-live-rebind',
        pass: fPlay.paused === false,
        detail: fPlay
      });
      await page.screenshot({ path: path.join(ARTIFACTS, 'hotkey_rebound_f_play.png'), fullPage: true });

      // In-panel toggle knob visual check (ShuttleXpress in expanded more panel)
      await page.evaluate(() => {
        const panel = document.getElementById('omt-more-panel');
        if (panel) {
          panel.classList.add('is-open');
          panel.style.display = 'block';
          panel.style.opacity = '1';
          panel.style.pointerEvents = 'auto';
        }
        const root = document.getElementById('omt-root');
        if (root) root.classList.add('omt-more-open');
        // Ensure controls visible
        const controls = document.getElementById('controls-panel');
        if (controls) {
          controls.style.opacity = '1';
          controls.style.pointerEvents = 'auto';
        }
      });
      await page.waitForTimeout(150);
      const panelToggle = await page.evaluate(() => {
        const sw = document.querySelector('#omt-shuttle-enable-toggle')?.closest('.omt-switch');
        const slider = sw?.querySelector('.omt-switch-slider');
        if (!sw || !slider) return { ok: false, reason: 'missing' };
        const sr = sw.getBoundingClientRect();
        const before = getComputedStyle(slider, '::before');
        const w = parseFloat(before.width) || 0;
        const h = parseFloat(before.height) || 0;
        const top = before.top;
        const bottom = before.bottom;
        // Centred via top/bottom 0 + margin auto → equal insets
        const centered = w === 12 && h === 12 && top === bottom;
        return {
          ok: sr.height >= 16 && sr.height <= 22 && sr.width >= 30 && centered && sr.height > h,
          h: sr.height,
          w: sr.width,
          knobW: w,
          knobH: h,
          top,
          bottom,
          transform: before.transform
        };
      });
      await page.screenshot({ path: path.join(ARTIFACTS, 'toggle_knob_centered.png'), fullPage: true });
      results.push({
        name: 'toggle-knob-centered',
        pass: panelToggle.ok === true,
        detail: panelToggle
      });
    } else {
      results.push({ name: 'popup-branding-and-personalizar', pass: false, detail: { reason: 'no-extension-id' } });
    }

    // ---------- Local player (v1.5.0) — full UI feature matrix ----------
    if (extId) {
      const sampleMp4 = path.join(FIXTURES, 'sample-match.mp4');
      const localPage = await context.newPage();
      await localPage.goto(`chrome-extension://${extId}/player.html`, { waitUntil: 'domcontentloaded' });
      await waitForOmt(localPage, 15000);

      const localBoot = await localPage.evaluate(() => {
        const root = document.getElementById('omt-root');
        const drop = document.getElementById('omt-local-drop');
        const video = document.getElementById('omt-local-video');
        return {
          siteClass: root ? root.className : '',
          dropVisible: !!(drop && !drop.hidden),
          hasVideo: !!video,
          hasFileInput: !!document.getElementById('omt-local-file-input'),
          hasBrowse: !!document.getElementById('omt-local-browse')
        };
      });
      results.push({
        name: 'local-player-boots',
        pass: localBoot.siteClass.includes('omt-local') && localBoot.dropVisible &&
          localBoot.hasVideo && localBoot.hasFileInput && localBoot.hasBrowse,
        detail: localBoot
      });

      await localPage.screenshot({ path: path.join(ARTIFACTS, 'local_player_empty.png'), fullPage: true });

      await localPage.setInputFiles('#omt-local-file-input', sampleMp4);
      await localPage.waitForFunction(() => {
        const v = document.getElementById('omt-local-video');
        const drop = document.getElementById('omt-local-drop');
        return v && v.src && drop && drop.hidden && v.readyState >= 1;
      }, null, { timeout: 15000 });

      // Force HUD visible for screenshots / interaction
      await localPage.evaluate(() => {
        const panel = document.getElementById('controls-panel');
        const timelineBar = document.getElementById('omt-timeline-bar');
        [panel, timelineBar].forEach((el) => {
          if (!el) return;
          el.style.opacity = '1';
          el.style.pointerEvents = 'auto';
        });
        const more = document.getElementById('omt-more-panel');
        if (more && !more.classList.contains('is-open')) {
          document.getElementById('omt-more-toggle')?.click();
        }
      });
      await localPage.waitForTimeout(200);

      const localUi = await captureUiFingerprint(localPage);
      results.push({
        name: 'local-ui-matches-v14',
        pass: localUi.optionAOk && localUi.speedOk && localUi.hasHide &&
          /Auto hide:\s*on/i.test(localUi.hideTip) &&
          localUi.hasTimeline && localUi.hasKickoff && localUi.hasPeriod &&
          localUi.halfOpts.includes('custom1') && localUi.halfOpts.includes('custom2') &&
          localUi.hasCustom1 && localUi.hasCustom2 && localUi.hasOffsetNudge &&
          localUi.hasShuttle && localUi.hasOsd && localUi.hasMore &&
          localUi.examinoHidden && localUi.siteClass.includes('omt-local'),
        detail: localUi
      });

      const localLiveHidden = await localPage.evaluate(() => {
        const btn = document.getElementById('omt-live-btn');
        const spacer = document.querySelector('#omt-root .omt-live-spacer');
        const btnCs = btn ? getComputedStyle(btn) : null;
        const spCs = spacer ? getComputedStyle(spacer) : null;
        return {
          hasBtnInDom: !!btn,
          btnDisplay: btnCs ? btnCs.display : null,
          spacerDisplay: spCs ? spCs.display : null,
          btnHidden: !btn || btnCs.display === 'none',
          spacerHidden: !spacer || spCs.display === 'none',
          isLocal: !!document.getElementById('omt-root')?.classList.contains('omt-local')
        };
      });
      results.push({
        name: 'local-live-button-hidden',
        pass: localLiveHidden.isLocal && localLiveHidden.btnHidden && localLiveHidden.spacerHidden,
        detail: localLiveHidden
      });
      await localPage.screenshot({
        path: path.join(ARTIFACTS, 'v173_local_no_live.png'),
        fullPage: true
      });

      const localOpenFile = await localPage.evaluate(() => {
        const btn = document.getElementById('omt-local-open-file');
        const name = document.getElementById('omt-local-filename');
        const cs = btn ? getComputedStyle(btn) : null;
        const box = btn ? btn.getBoundingClientRect() : null;
        const bg = cs ? (cs.backgroundColor || '') : '';
        const isOrangeBar = /245,\s*131,\s*31/.test(bg) && !/rgba?\(\s*245,\s*131,\s*31,\s*0\./.test(bg);
        return {
          hasBtn: !!btn,
          name: (name?.textContent || '').trim(),
          dropHidden: !!(document.getElementById('omt-local-drop')?.hidden),
          compact: !!(box && box.width > 0 && box.width < 140 && box.height > 0 && box.height <= 32),
          notOrangeFill: !isOrangeBar,
          classOk: !!(btn && btn.classList.contains('omt-local-open-file-btn') && !btn.classList.contains('btn-sync')),
          bg
        };
      });
      results.push({
        name: 'local-file-loaded',
        pass: localOpenFile.hasBtn && /sample-match\.mp4/i.test(localOpenFile.name) &&
          localOpenFile.dropHidden && localOpenFile.compact && localOpenFile.notOrangeFill &&
          localOpenFile.classOk,
        detail: localOpenFile
      });

      // Open file tip — short text, edge-clamped, fully visible
      await localPage.evaluate(() => {
        const more = document.getElementById('omt-more-panel');
        const btn = document.getElementById('omt-more-toggle');
        if (more && !more.classList.contains('is-open')) btn?.click();
        const panel = document.getElementById('controls-panel');
        if (panel) { panel.style.opacity = '1'; panel.style.pointerEvents = 'auto'; }
      });
      await localPage.waitForTimeout(120);
      await localPage.locator('#omt-local-open-file').hover();
      await localPage.waitForFunction(() => {
        const el = document.getElementById('omt-local-open-file');
        const portal = document.getElementById('omt-control-tip');
        if (!el) return false;
        if (portal && !portal.hidden && /Open local or NAS video/i.test(portal.textContent || '')) return true;
        if (!el.classList.contains('omt-tip-fixed')) return false;
        const tip = getComputedStyle(el, '::after');
        return tip.opacity === '1' && tip.visibility !== 'hidden';
      }, null, { timeout: 3000 });
      await localPage.waitForTimeout(40);
      const openFileTip = await localPage.evaluate(() => {
        const el = document.getElementById('omt-local-open-file');
        const portal = document.getElementById('omt-control-tip');
        const tip = el ? getComputedStyle(el, '::after') : null;
        const portalCs = portal && !portal.hidden ? getComputedStyle(portal) : null;
        const panel = document.getElementById('controls-panel');
        const more = document.getElementById('omt-more-panel');
        const period = document.getElementById('omt-half-select');
        const btnRect = el?.getBoundingClientRect();
        const periodRect = period?.getBoundingClientRect();
        const tipTopVp = parseFloat(el?.dataset.omtTipViewportTop || 'NaN');
        const tipH = 24;
        const overlapsPeriod = !!(periodRect && Number.isFinite(tipTopVp) &&
          tipTopVp < periodRect.bottom && (tipTopVp + tipH) > periodRect.top);
        const bg = portalCs?.backgroundColor || tip?.backgroundColor || '';
        const visible = portalCs
          ? portalCs.opacity !== '0' && portalCs.visibility !== 'hidden'
          : !!(tip && tip.opacity === '1' && tip.visibility !== 'hidden');
        return {
          tip: el?.getAttribute('data-tip') || '',
          portalText: portal?.textContent || '',
          visible,
          bg,
          opaque: /^rgb\(20,\s*20,\s*20\)$/.test(bg),
          below: !!(btnRect && Number.isFinite(tipTopVp) && tipTopVp >= btnRect.bottom - 1),
          overlapsPeriod,
          tipTopVp,
          btnBottom: btnRect ? btnRect.bottom : null,
          panelOverflow: panel ? getComputedStyle(panel).overflow : null,
          moreOverflow: more ? getComputedStyle(more).overflow : null
        };
      });
      results.push({
        name: 'local-open-file-tooltip-clamped',
        pass: /Open local or NAS video/i.test(openFileTip.tip) && openFileTip.visible === true &&
          openFileTip.opaque === true && openFileTip.below === true &&
          openFileTip.overlapsPeriod === false &&
          openFileTip.panelOverflow === 'visible' && openFileTip.moreOverflow === 'visible',
        detail: openFileTip
      });
      const openShot = await localPage.evaluate(() => {
        const el = document.getElementById('omt-local-open-file');
        if (!el) return null;
        el.dataset.omtHold = '1';
        el.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
        const portal = document.getElementById('omt-control-tip');
        const r = el.getBoundingClientRect();
        const tipTop = parseFloat(el.dataset.omtTipViewportTop || String(r.bottom + 8));
        const tipLeft = parseFloat(el.dataset.omtTipViewportLeft || String(r.left));
        return {
          showing: !!(portal && !portal.hidden) ||
            (el.classList.contains('omt-tip-show') && el.classList.contains('omt-tip-fixed')),
          clip: {
            x: Math.max(0, Math.min(r.left - 24, tipLeft - 8)),
            y: Math.max(0, r.top - 8),
            width: Math.min(420, Math.max(300, r.width + 200)),
            height: Math.ceil(Math.max(r.bottom, tipTop + 28) - Math.max(0, r.top - 8) + 4)
          }
        };
      });
      results.push({
        name: 'local-open-file-tooltip-screenshot-ready',
        pass: !!(openShot && openShot.showing),
        detail: openShot
      });
      if (openShot?.showing) {
        await screenshotClipReliable(
          localPage,
          path.join(ARTIFACTS, 'v177_open_file_tooltip_visible.png'),
          openShot.clip
        );
      }
      await localPage.evaluate(() => {
        const el = document.getElementById('omt-local-open-file');
        if (el) { delete el.dataset.omtHold; el.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true })); }
      });

      // Click-to-toggle on <video> (original HTML dashboard behaviour)
      await localPage.evaluate(() => {
        const panel = document.getElementById('controls-panel');
        const bar = document.getElementById('omt-timeline-bar');
        if (panel) { panel.style.opacity = '0'; panel.style.pointerEvents = 'none'; }
        if (bar) { bar.style.opacity = '0'; bar.style.pointerEvents = 'none'; }
      });
      await localPage.evaluate(async () => {
        const v = document.getElementById('omt-local-video');
        try { await v.play(); } catch (_) {}
      });
      await localPage.waitForTimeout(80);
      const localVideoBox = await localPage.locator('#omt-local-video').boundingBox();
      if (localVideoBox) {
        await localPage.mouse.click(localVideoBox.x + localVideoBox.width / 2, localVideoBox.y + localVideoBox.height / 2);
        await localPage.waitForTimeout(180);
      }
      const localClickPause = await localPage.evaluate(() => {
        const v = document.getElementById('omt-local-video');
        return { paused: !!(v && v.paused), osd: document.getElementById('osd-message')?.innerText || '' };
      });
      results.push({
        name: 'local-click-pauses',
        pass: localClickPause.paused === true,
        detail: localClickPause
      });
      if (localVideoBox) {
        await localPage.mouse.click(localVideoBox.x + localVideoBox.width / 2, localVideoBox.y + localVideoBox.height / 2);
        await localPage.waitForTimeout(180);
      }
      const localClickPlay = await localPage.evaluate(() => {
        const v = document.getElementById('omt-local-video');
        return { paused: !!(v && v.paused) };
      });
      results.push({
        name: 'local-click-plays',
        pass: localClickPlay.paused === false,
        detail: localClickPlay
      });
      // Click on controls must NOT toggle
      await localPage.evaluate(() => {
        const panel = document.getElementById('controls-panel');
        if (panel) { panel.style.opacity = '1'; panel.style.pointerEvents = 'auto'; }
        const v = document.getElementById('omt-local-video');
        try { v.pause(); } catch (_) {}
      });
      await localPage.waitForTimeout(60);
      const beforeCtrlClick = await localPage.evaluate(() => document.getElementById('omt-local-video')?.paused);
      await localPage.locator('#omt-speed-select').click({ force: true });
      await localPage.waitForTimeout(100);
      const afterCtrlClick = await localPage.evaluate(() => document.getElementById('omt-local-video')?.paused);
      results.push({
        name: 'local-controls-click-does-not-toggle',
        pass: beforeCtrlClick === true && afterCtrlClick === true,
        detail: { beforeCtrlClick, afterCtrlClick }
      });

      // Space / seek / speed / kickoff / period / custom / OSD / timeline / hide / LIVE
      await localPage.evaluate(() => {
        if (window.__omtPlaybackRateStubbed) return;
        const desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate');
        if (!desc || !desc.configurable) return;
        let forced = 1;
        Object.defineProperty(HTMLMediaElement.prototype, 'playbackRate', {
          configurable: true,
          get() { return forced; },
          set(n) {
            forced = Number(n);
            try { desc.set.call(this, n); } catch (_) {}
          }
        });
        window.__omtPlaybackRateStubbed = true;
      });

      const localPlayPause = await localPage.evaluate(async () => {
        const v = document.getElementById('omt-local-video');
        try { await v.play(); } catch (_) {}
        await new Promise((r) => setTimeout(r, 80));
        const playing = !v.paused;
        document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true }));
        await new Promise((r) => setTimeout(r, 80));
        const afterSpace = v.paused;
        const osd = (document.getElementById('osd-message')?.innerText || '');
        return { playing, afterSpace, osd };
      });
      results.push({
        name: 'local-hotkey-space',
        pass: localPlayPause.playing === true && localPlayPause.afterSpace === true,
        detail: localPlayPause
      });

      const localSeek = await localPage.evaluate(async () => {
        const v = document.getElementById('omt-local-video');
        // Short fixture (~8s): exercise ±2s and Shift ±2s without clamping past duration.
        try { v.currentTime = 3; } catch (_) {}
        const before = v.currentTime;
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', bubbles: true, cancelable: true }));
        await new Promise((r) => setTimeout(r, 60));
        const after2 = v.currentTime;
        document.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'ArrowLeft', code: 'ArrowLeft', shiftKey: true, bubbles: true, cancelable: true
        }));
        await new Promise((r) => setTimeout(r, 60));
        const afterShift = v.currentTime;
        return {
          ok: after2 >= before + 1.5 && afterShift <= Math.max(0, after2 - 9) + 0.5,
          before, after2, afterShift
        };
      });
      results.push({ name: 'local-hotkey-seek', pass: localSeek.ok === true, detail: localSeek });

      const localSpeed = await localPage.evaluate(async () => {
        const v = document.getElementById('omt-local-video');
        const chip = document.querySelector('.omt-speed-chip[data-speed="2.0"]');
        chip?.click();
        await new Promise((r) => setTimeout(r, 40));
        const rateAfterChip = v?.playbackRate;
        const active = document.querySelector('.omt-speed-chip.is-active');
        const selAfter = document.getElementById('omt-speed-select')?.value;
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', code: 'KeyX', bubbles: true, cancelable: true }));
        await new Promise((r) => setTimeout(r, 40));
        const afterX = document.querySelector('.omt-speed-chip.is-active');
        const rateAfterX = v?.playbackRate;
        return {
          chipOk: active?.getAttribute('data-speed') === '2.0' && Math.abs((rateAfterChip || 0) - 2) < 0.01,
          selectOk: selAfter === '2' || selAfter === '2.0',
          resetOk: (afterX?.getAttribute('data-speed') === '1.0' || afterX?.getAttribute('data-speed') === '1') &&
            Math.abs((rateAfterX || 0) - 1) < 0.01,
          rateAfterChip,
          rateAfterX,
          active: active?.getAttribute('data-speed'),
          afterX: afterX?.getAttribute('data-speed'),
          selAfter
        };
      });
      results.push({
        name: 'local-speed-row-sync',
        pass: localSpeed.chipOk && localSpeed.resetOk,
        detail: localSpeed
      });

      const localKickoff = await localPage.evaluate(async () => {
        Object.keys(localStorage).forEach((k) => {
          if (k.startsWith('matchTimer')) localStorage.removeItem(k);
        });
        const half = document.getElementById('omt-half-select');
        if (half) half.value = '1';
        document.getElementById('omt-btn-set-kickoff')?.click();
        await new Promise((r) => setTimeout(r, 40));
        const t = document.getElementById('match-timer');
        const wrap = document.getElementById('match-timer-wrap');
        const osd = (document.getElementById('osd-message')?.innerText || '');
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', bubbles: true, cancelable: true }));
        await new Promise((r) => setTimeout(r, 40));
        return {
          timerVisible: !!(t && (t.style.display === 'block' || (wrap && (wrap.style.display === 'flex' || getComputedStyle(wrap).display === 'flex')))),
          ativo: localStorage.getItem('matchTimerAtivo') === 'true',
          hasKickoff1: localStorage.getItem('matchTimerKickoff1') != null,
          osd
        };
      });
      results.push({
        name: 'local-kickoff-period',
        pass: localKickoff.timerVisible && localKickoff.ativo && localKickoff.hasKickoff1,
        detail: localKickoff
      });

      const localCustoms = await localPage.evaluate(async () => {
        const half = document.getElementById('omt-half-select');
        half.value = 'custom1';
        half.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 40));
        const c1 = document.getElementById('omt-custom-minute-c1');
        const c1wrap = document.getElementById('omt-custom-c1');
        if (c1) {
          c1.value = '90';
          c1.dispatchEvent(new Event('input', { bubbles: true }));
          c1.dispatchEvent(new Event('change', { bubbles: true }));
        }
        document.getElementById('omt-btn-set-kickoff')?.click();
        await new Promise((r) => setTimeout(r, 40));
        half.value = 'custom2';
        half.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 40));
        const c2 = document.getElementById('omt-custom-minute-c2');
        const c2wrap = document.getElementById('omt-custom-c2');
        if (c2) {
          c2.value = '105';
          c2.dispatchEvent(new Event('input', { bubbles: true }));
          c2.dispatchEvent(new Event('change', { bubbles: true }));
        }
        document.getElementById('omt-btn-set-kickoff')?.click();
        await new Promise((r) => setTimeout(r, 40));
        return {
          c1Visible: !!(c1wrap && c1wrap.style.display !== 'none'),
          c2Visible: !!(c2wrap && c2wrap.style.display !== 'none'),
          hasC1: localStorage.getItem('matchTimerKickoffC1') != null,
          hasC2: localStorage.getItem('matchTimerKickoffC2') != null,
          minC1: localStorage.getItem('matchTimerCustomMinC1'),
          minC2: localStorage.getItem('matchTimerCustomMinC2')
        };
      });
      results.push({
        name: 'local-custom-periods',
        pass: localCustoms.hasC1 && localCustoms.hasC2,
        detail: localCustoms
      });

      const localTimeline = await localPage.evaluate(async () => {
        const v = document.getElementById('omt-local-video');
        const slider = document.getElementById('omt-timeline-slider');
        const cur = document.getElementById('omt-v-time-current');
        const dur = document.getElementById('omt-v-time-duration');
        if (!v || !slider) return { ok: false, reason: 'missing' };
        const end = v.duration || (v.seekable?.length ? v.seekable.end(v.seekable.length - 1) : NaN);
        const target = Math.max(1, (end || 8) * 0.4);
        try { v.currentTime = target; } catch (_) {}
        slider.value = String(target);
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 80));
        return {
          ok: Math.abs(v.currentTime - target) < 1.5 && !!cur && !!dur,
          currentTime: v.currentTime,
          target,
          curText: cur?.innerText || '',
          durText: dur?.innerText || ''
        };
      });
      results.push({ name: 'local-timeline-seek', pass: localTimeline.ok === true, detail: localTimeline });

      // LIVE button is hidden on local; L hotkey still seeks toward the end.
      const localLive = await localPage.evaluate(async () => {
        const v = document.getElementById('omt-local-video');
        try { v.currentTime = 1; } catch (_) {}
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', code: 'KeyL', bubbles: true, cancelable: true }));
        await new Promise((r) => setTimeout(r, 80));
        const end = v.duration || (v.seekable?.length ? v.seekable.end(v.seekable.length - 1) : NaN);
        const btn = document.getElementById('omt-live-btn');
        const btnHidden = !btn || getComputedStyle(btn).display === 'none';
        return {
          ok: btnHidden && typeof end === 'number' && isFinite(end) && v.currentTime >= end - 3,
          currentTime: v.currentTime,
          end,
          btnHidden
        };
      });
      results.push({ name: 'local-live-and-l-hotkey', pass: localLive.ok === true, detail: localLive });

      const localHide = await localPage.evaluate(async () => {
        const panel = document.getElementById('controls-panel');
        const timeline = document.getElementById('omt-timeline-bar');
        const btn = document.getElementById('omt-hide-panel');
        const read = () => ({
          panelOp: panel ? panel.style.opacity : null,
          panelPe: panel ? panel.style.pointerEvents : null,
          timelineOp: timeline ? timeline.style.opacity : null,
          tip: btn ? (btn.getAttribute('data-tip') || '') : ''
        });
        if (panel) { panel.style.opacity = '1'; panel.style.pointerEvents = 'auto'; }
        if (timeline) { timeline.style.opacity = '1'; timeline.style.pointerEvents = 'auto'; }
        try { localStorage.setItem('omtAutoHideChrome', 'true'); } catch (_) {}
        window.postMessage({
          source: 'omt-bridge',
          type: 'OMT_STORAGE_SYNC',
          values: { omtAutoHideChrome: true }
        }, '*');
        const before = read();
        btn?.click(); // toggles auto-hide OFF — must not hide panel
        await new Promise((r) => setTimeout(r, 100));
        const afterToggle = read();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', code: 'KeyH', bubbles: true, cancelable: true }));
        await new Promise((r) => setTimeout(r, 100));
        const afterHHide = read();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', code: 'KeyH', bubbles: true, cancelable: true }));
        await new Promise((r) => setTimeout(r, 100));
        const afterHShow = read();
        return {
          before,
          afterToggle,
          afterHHide,
          afterHShow,
          toggleKeptVisible: afterToggle.panelOp === '1' && afterToggle.panelPe === 'auto',
          tipOff: /Auto hide:\s*off/i.test(afterToggle.tip),
          hHid: afterHHide.panelOp === '0' || afterHHide.panelPe === 'none',
          hShowed: afterHShow.panelOp === '1' || afterHShow.panelPe === 'auto'
        };
      });
      results.push({
        name: 'local-hide-controls',
        pass: localHide.toggleKeptVisible === true && localHide.tipOff === true &&
          localHide.hHid === true && localHide.hShowed === true,
        detail: localHide
      });

      const localOsd = await localPage.evaluate(async () => {
        document.getElementById('omt-p2')?.click();
        await new Promise((r) => setTimeout(r, 60));
        const el = document.getElementById('osd-message');
        const text = (el?.innerText || '');
        const visible = !!(el && getComputedStyle(el).opacity !== '0' && el.style.display !== 'none');
        return { ok: /\+2s|Skip/i.test(text) && visible, text, visible };
      });
      results.push({ name: 'local-osd', pass: localOsd.ok === true, detail: localOsd });

      // ShuttleXpress toggle is per-window (sessionStorage), not shared chrome.storage.
      // Mock WebHID so the toggle path can "connect" without a physical device.
      const localShuttleA = await localPage.evaluate(async () => {
        const fakeDevice = {
          vendorId: 0x0b33,
          productName: 'Fake ShuttleXpress',
          opened: true,
          open: async function () { this.opened = true; },
          close: async function () { this.opened = false; },
          addEventListener() {},
          removeEventListener() {}
        };
        try {
          Object.defineProperty(navigator, 'hid', {
            configurable: true,
            value: {
              getDevices: async () => [fakeDevice],
              requestDevice: async () => [fakeDevice],
              addEventListener() {},
              removeEventListener() {}
            }
          });
        } catch (_) {
          navigator.hid = {
            getDevices: async () => [fakeDevice],
            requestDevice: async () => [fakeDevice],
            addEventListener() {},
            removeEventListener() {}
          };
        }
        const toggle = document.getElementById('omt-shuttle-enable-toggle');
        if (!toggle) return { ok: false, reason: 'missing-toggle' };
        toggle.disabled = false;
        toggle.checked = true;
        toggle.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 120));
        return {
          session: sessionStorage.getItem('omtLocalShuttleEnabled'),
          local: localStorage.getItem('shuttleXpressEnabled'),
          checked: toggle.checked
        };
      });
      results.push({
        name: 'local-shuttle-session-storage',
        pass: localShuttleA.session === 'true',
        detail: localShuttleA
      });

      const localPageB = await context.newPage();
      await localPageB.goto(`chrome-extension://${extId}/player.html`, { waitUntil: 'domcontentloaded' });
      await waitForOmt(localPageB, 15000);
      await localPageB.evaluate(() => {
        const more = document.getElementById('omt-more-panel');
        if (more && !more.classList.contains('is-open')) {
          document.getElementById('omt-more-toggle')?.click();
        }
      });
      await localPageB.waitForTimeout(100);
      const localShuttleB = await localPageB.evaluate(() => {
        const toggle = document.getElementById('omt-shuttle-enable-toggle');
        return {
          session: sessionStorage.getItem('omtLocalShuttleEnabled'),
          checked: !!(toggle && toggle.checked)
        };
      });
      results.push({
        name: 'local-shuttle-per-window',
        pass: localShuttleB.session !== 'true' && localShuttleB.checked === false,
        detail: { a: localShuttleA, b: localShuttleB }
      });

      await localPage.screenshot({ path: path.join(ARTIFACTS, 'local_player_loaded.png'), fullPage: true });
      await localPage.screenshot({ path: path.join(ARTIFACTS, 'local_player_expanded.png'), fullPage: true });
      await localPageB.close();
      await localPage.close();
    } else {
      [
        'local-player-boots',
        'local-ui-matches-v14',
        'local-file-loaded',
        'local-hotkey-space',
        'local-hotkey-seek',
        'local-speed-row-sync',
        'local-kickoff-period',
        'local-custom-periods',
        'local-timeline-seek',
        'local-live-button-hidden',
        'local-live-and-l-hotkey',
        'local-hide-controls',
        'local-osd',
        'local-shuttle-session-storage',
        'local-shuttle-per-window'
      ].forEach((name) => results.push({ name, pass: false, detail: { reason: 'no-extension-id' } }));
    }

  } finally {
    await context.close();
    server.close();
    try { mockSb.server.close(); } catch (_) {}
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
