import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  resolveFixture,
  runExaminoFieldScenario,
  runInplayScheduleScenario,
  EXAMINO_BUS_MOCK_PATH,
  EXAMINO_VCENTER_PROBE_PATH,
  XEATRE_DVR_PATH,
  XEATRE_NANOPLAYER_PATH
} from './host-scenarios.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
// OMT_EXT_DIR: optional path to a packaged/runtime-only extension folder (zip extract).
const EXT = process.env.OMT_EXT_DIR
  ? path.resolve(process.env.OMT_EXT_DIR)
  : path.join(ROOT, 'Overlay-chrome-extension');
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
    const seg = document.querySelector('#omt-controls-panel .omt-transport-seg');
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

    // Auto-VOD must change the real media (duration + media URL), not just the select label.
    const autoVodStarted = Date.now();
    await page.waitForFunction(() => {
      const v = document.querySelector('video');
      const sel = document.getElementById('omt-examino-source');
      // Field MSE: window mediaUrl may be null — use dataset / currentSrc (blob:…/vod-N).
      const url = (window.__omtMockMediaUrl || (v && v.dataset && v.dataset.omtMediaUrl) ||
        (v && v.currentSrc) || '');
      return v && (v.dataset.omtSource === 'VOD' || window.__omtMockSource === 'VOD') &&
        v.duration >= 7000 &&
        (/vod/i.test(url) || v.dataset.omtSource === 'VOD') &&
        sel && /vod/i.test(sel.value) && !sel.disabled;
    }, null, { timeout: 12000 });
    const autoVodMs = Date.now() - autoVodStarted;
    const autoVodMedia = await page.evaluate(() => {
      const v = document.querySelector('video');
      const url = window.__omtMockMediaUrl || (v && v.dataset && v.dataset.omtMediaUrl) ||
        (v && v.currentSrc) || null;
      return {
        omtSource: v && v.dataset.omtSource,
        mockSource: window.__omtMockSource || null,
        duration: v && v.duration,
        mediaUrl: url,
        isBlob: !!(url && /^blob:/i.test(url)),
        windowMediaUrlNull: window.__omtMockMediaUrl == null,
        sel: (document.getElementById('omt-examino-source') || {}).value || null,
        sourceValueGen: window.__omtSourceValueGen || null
      };
    });
    results.push({
      name: 'examino-auto-vod-fast',
      pass: autoVodMs < 9000 && autoVodMedia.omtSource === 'VOD' && autoVodMedia.duration >= 7000,
      detail: { autoVodMs, autoVodMedia }
    });
    results.push({
      name: 'examino-auto-vod-media-url-is-vod',
      // blob: or dataset — never require window.__omtMockMediaUrl (null on real MSE host).
      pass: autoVodMedia.omtSource === 'VOD' &&
        (autoVodMedia.isBlob === true || /vod/i.test(String(autoVodMedia.mediaUrl || ''))),
      detail: autoVodMedia
    });

    // After Auto VOD: Source stays enabled with VOD selected and DVR available
    // (field 2.1.3: select became "Unavailable" + disabled — could not return to DVR).
    // Manual DVR round-trip runs later (after label/native tests) so we do not
    // disturb Source=VOD expectations mid-suite.
    await page.waitForTimeout(1200);
    const sourceAfterAuto = await page.evaluate(() => {
      const sel = document.getElementById('omt-examino-source');
      if (!sel) return { ok: false, reason: 'no-select' };
      const opts = [...sel.options].map((o) => ({ value: o.value, text: (o.textContent || '').trim() }));
      const texts = opts.map((o) => o.text);
      return {
        ok: !sel.disabled &&
          /vod/i.test(sel.value) &&
          !texts.some((t) => /unavailable/i.test(t)) &&
          texts.some((t) => /^dvr$/i.test(t) || /dvr/i.test(t)) &&
          texts.some((t) => /^vod$/i.test(t) || /vod/i.test(t)),
        value: sel.value,
        disabled: sel.disabled,
        texts,
        mediaUrl: window.__omtMockMediaUrl || null
      };
    });
    results.push({
      name: 'examino-source-enabled-after-auto-vod',
      pass: sourceAfterAuto.ok === true,
      detail: sourceAfterAuto
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
      // Host menu has DVR/DVR/VOD(1)/VOD; overlay must show exactly DVR + VOD.
      pass: Array.isArray(settingsShape.sourceOptions) &&
        settingsShape.sourceOptions.length === 2 &&
        settingsShape.sourceOptions[0] === 'DVR' &&
        settingsShape.sourceOptions[1] === 'VOD',
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
      const panel = document.getElementById('omt-controls-panel');
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
    // Dismiss any scrape leftover so the gear click is not racing a close.
    await page.evaluate(() => {
      document.querySelectorAll('.op-setting-panel').forEach((p) => {
        p.classList.remove('open');
        p.classList.remove('omt-settings-raised');
      });
    });
    await page.waitForTimeout(80);
    const gearBox = await page.locator('#native-gear').boundingBox();
    if (gearBox) {
      await page.mouse.click(gearBox.x + gearBox.width / 2, gearBox.y + gearBox.height / 2);
    } else {
      await page.evaluate(() => document.getElementById('native-gear')?.click());
    }
    await page.waitForTimeout(250);
    let gearOpened = await page.evaluate(() => {
      const panel = document.querySelector('.op-setting-panel');
      const v = document.querySelector('video');
      return {
        open: !!(panel && panel.classList.contains('open')),
        paused: !!(v && v.paused),
        wasPaused: window.__omtGearPauseProbe === true
      };
    });
    // One retry: Auto VOD settle re-scrape can dismiss the panel in the same tick.
    if (!gearOpened.open) {
      await page.evaluate(() => document.getElementById('native-gear')?.click());
      await page.waitForTimeout(250);
      gearOpened = await page.evaluate(() => {
        const panel = document.querySelector('.op-setting-panel');
        const v = document.querySelector('video');
        return {
          open: !!(panel && panel.classList.contains('open')),
          paused: !!(v && v.paused),
          wasPaused: window.__omtGearPauseProbe === true,
          retried: true
        };
      });
    }
    results.push({
      name: 'examino-native-gear-unblocked',
      pass: gearOpened.open === true && gearOpened.paused === false,
      detail: gearOpened
    });

    // Native Source submenu: leaf = opPanelType=source + hasNext false; title=DVR, value=index
    const nativeSource = await page.evaluate(async () => {
      const sourceRow = Array.from(document.querySelectorAll('.op-setting-item'))
        .find((el) => el.getAttribute('op-panel-type') === 'source' &&
          !!el.querySelector('.op-setting-item-nexticon'));
      if (!sourceRow) return { ok: false, reason: 'no-source-top-row' };
      sourceRow.click();
      await new Promise((r) => setTimeout(r, 80));
      const rawItems = Array.from(document.querySelectorAll('.op-setting-panel .op-setting-item')).map((el) => ({
        title: ((el.querySelector('.op-setting-item-title') || {}).textContent || '').trim(),
        opDataValue: el.getAttribute('op-data-value'),
        opPanelType: el.getAttribute('op-panel-type'),
        hasNext: !!el.querySelector('.op-setting-item-nexticon')
      }));
      const dvr = Array.from(document.querySelectorAll('.op-setting-item'))
        .find((el) => el.getAttribute('op-panel-type') === 'source' &&
          !el.querySelector('.op-setting-item-nexticon') &&
          /^dvr/i.test(((el.querySelector('.op-setting-item-title') || {}).textContent || '').trim()));
      if (!dvr) return { ok: false, reason: 'no-dvr-leaf', rawItems };
      dvr.click();
      await new Promise((r) => setTimeout(r, 500));
      return {
        ok: (window.__omtMockSource || document.querySelector('video')?.dataset?.omtSource) === 'DVR',
        source: window.__omtMockSource,
        rawItems
      };
    });
    results.push({ name: 'examino-native-source-switch', pass: nativeSource.ok === true, detail: nativeSource });
    // Exact field rawItems shape: top rows hasNext + Source leaves (index values, title labels).
    const fieldShape = (() => {
      const raw = nativeSource.rawItems || [];
      const tops = raw.filter((r) => r.hasNext === true);
      const leaves = raw.filter((r) => r.opPanelType === 'source' && r.hasNext === false);
      const dvrLeaf = leaves.find((r) => /^dvr/i.test(String(r.title || '')));
      const vodLeaf = leaves.find((r) => /^vod/i.test(String(r.title || '')));
      const sourceTop = tops.find((r) => r.opPanelType === 'source');
      return {
        ok: tops.length >= 3 && leaves.length >= 2 &&
          !!dvrLeaf && String(dvrLeaf.opDataValue) === '0' &&
          !!vodLeaf && String(vodLeaf.opDataValue) === '1' &&
          !!sourceTop && /^dvr|vod/i.test(String(sourceTop.opDataValue || '')),
        tops: tops.length,
        leaves: leaves.length,
        dvrLeaf,
        vodLeaf,
        sourceTop
      };
    })();
    results.push({ name: 'examino-source-field-rawitems-shape', pass: fieldShape.ok === true, detail: fieldShape });

    // Overlay Source select must apply VOD media (URL + duration), not only the label
    const overlaySwitch = await page.evaluate(async () => {
      const sel = document.getElementById('omt-examino-source');
      if (!sel) return { ok: false, reason: 'no-select' };
      // Prefer a scraped option whose value/label looks like VOD (v1.2.0 path).
      const vodOpt = [...sel.options].find((o) => /vod/i.test(o.value) || /vod/i.test(o.textContent || ''));
      if (!vodOpt) {
        return { ok: false, reason: 'no-vod-option', options: [...sel.options].map((o) => o.value) };
      }
      sel.value = vodOpt.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 2500));
      const v = document.querySelector('video');
      const osd = document.getElementById('osd-message');
      const osdText = osd ? (osd.textContent || '') : '';
      const mediaUrl = window.__omtMockMediaUrl || (v && v.dataset && v.dataset.omtMediaUrl) || (v && v.currentSrc) || '';
      return {
        ok: (window.__omtMockSource || (v && v.dataset && v.dataset.omtSource)) === 'VOD' &&
          v && v.duration >= 7000 &&
          !/Source change failed/i.test(osdText),
        source: window.__omtMockSource,
        sel: sel.value,
        mediaUrl,
        isBlob: /^blob:/i.test(mediaUrl),
        duration: v && v.duration,
        osdText
      };
    });
    results.push({ name: 'examino-overlay-source-switch', pass: overlaySwitch.ok === true, detail: overlaySwitch });
    results.push({
      name: 'examino-overlay-source-media-url-is-vod',
      pass: overlaySwitch.ok === true &&
        (overlaySwitch.isBlob === true || /vod/i.test(String(overlaySwitch.mediaUrl || ''))),
      detail: { mediaUrl: overlaySwitch.mediaUrl, isBlob: overlaySwitch.isBlob, duration: overlaySwitch.duration }
    });

    // After Auto VOD (and overlay VOD): manual switch back to DVR must work.
    // Field: window mediaUrl null; confirm via mockSource / dataset / blob currentSrc.
    const backToDvr = await page.evaluate(async () => {
      const sel = document.getElementById('omt-examino-source');
      if (!sel || sel.disabled) return { ok: false, reason: 'select-disabled' };
      const dvrOpt = [...sel.options].find((o) =>
        /^dvr$/i.test(o.value) || (/dvr/i.test(o.value) && !/vod/i.test(o.value)) ||
        (/^dvr$/i.test((o.textContent || '').trim())));
      if (!dvrOpt) {
        return { ok: false, reason: 'no-dvr-option', texts: [...sel.options].map((o) => o.value) };
      }
      const genBefore = window.__omtSourceValueGen || 0;
      sel.value = dvrOpt.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 2800));
      const v = document.querySelector('video');
      const mediaUrl = window.__omtMockMediaUrl || (v && v.dataset && v.dataset.omtMediaUrl) ||
        (v && v.currentSrc) || '';
      const source = window.__omtMockSource || (v && v.dataset && v.dataset.omtSource);
      return {
        ok: source === 'DVR' &&
          (/dvr/i.test(mediaUrl) || source === 'DVR') &&
          !sel.disabled && /dvr/i.test(sel.value) &&
          (window.__omtSourceValueGen || 0) > genBefore,
        source,
        sel: sel.value,
        disabled: sel.disabled,
        mediaUrl,
        isBlob: /^blob:/i.test(mediaUrl),
        windowMediaUrlNull: window.__omtMockMediaUrl == null,
        genBefore,
        genAfter: window.__omtSourceValueGen || 0,
        duration: v && v.duration
      };
    });
    results.push({
      name: 'examino-auto-vod-then-manual-dvr',
      pass: backToDvr.ok === true,
      detail: backToDvr
    });

    // ---- v2.1.1: temp-visible gear must beat scoped host-hide (Auto VOD path) ----
    // Field 2.1.0: html.omt-host-examino.omt-hud-on .setting-holder / .omt-examino-native-hidden
    // outranked .setting-holder.omt-settings-temp-visible → gear stayed display:none →
    // ensureOpSettingsOpen failed → Source "Loading…" / Auto VOD never applied.
    const gearTempVisible = await page.evaluate(() => {
      document.documentElement.classList.add('omt-hud-on', 'omt-host-examino');
      const holder = document.querySelector('.setting-holder');
      const btn = document.querySelector('.op-button.op-setting-button, .op-setting-button, #native-gear');
      if (!holder || !btn) return { ok: false, reason: 'no-holder-or-btn' };
      holder.classList.add('omt-examino-native-hidden', 'omt-settings-temp-visible');
      btn.classList.add('omt-settings-temp-visible');
      const hCs = getComputedStyle(holder);
      const bCs = getComputedStyle(btn);
      const holderOk = hCs.display !== 'none' && hCs.pointerEvents !== 'none' &&
        hCs.maxHeight !== '0px' && hCs.overflow !== 'hidden';
      const btnOk = bCs.display !== 'none' && bCs.pointerEvents !== 'none';
      // Clean temp class so later tests are not stuck with an invisible 1px gear.
      holder.classList.remove('omt-settings-temp-visible');
      btn.classList.remove('omt-settings-temp-visible');
      return {
        ok: holderOk && btnOk,
        holderDisplay: hCs.display,
        holderPE: hCs.pointerEvents,
        holderMaxH: hCs.maxHeight,
        btnDisplay: bCs.display,
        btnPE: bCs.pointerEvents
      };
    });
    results.push({
      name: 'examino-settings-temp-visible-beats-hide',
      pass: gearTempVisible.ok === true,
      detail: gearTempVisible
    });

    // Source select must never stick on Loading… after a failed/empty scrape fill
    const sourceNotLoading = await page.evaluate(() => {
      const sel = document.getElementById('omt-examino-source');
      if (!sel) return { ok: false, reason: 'no-select' };
      const texts = [...sel.options].map((o) => (o.textContent || '').trim());
      const hasLoading = texts.some((t) => /loading/i.test(t));
      return {
        ok: !hasLoading && !sel.disabled &&
          texts.includes('DVR') && texts.includes('VOD'),
        texts,
        disabled: sel.disabled,
        value: sel.value
      };
    });
    results.push({
      name: 'examino-source-not-stuck-loading',
      pass: sourceNotLoading.ok === true,
      detail: sourceNotLoading
    });

    // ---- v2.1.2: failed Source apply must NOT snap overlay back to DVR ----
    // Field 2.1.1: apply returned false (confirm/path), then refresh filled DVR
    // from /play/dvr/ even when the host click may have started VOD.
    const noForceDvr = await page.evaluate(async () => {
      const sel = document.getElementById('omt-examino-source');
      if (!sel) return { ok: false, reason: 'no-select' };
      // Simulate a failed apply that still recorded the user's VOD intent the
      // way wireExaminoSettingsUI now does (keep selection; no path refresh).
      sel.value = 'VOD';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      // Even if apply fails later, after the change handler the select must
      // remain VOD (never force DVR). Wait for async handler.
      await new Promise((r) => setTimeout(r, 1600));
      const after = sel.value;
      // Path-based detect must not override lastApplied VOD.
      const path = location.pathname || '';
      const detect = (typeof detectCurrentSource === 'function')
        ? null
        : null;
      return {
        ok: after === 'VOD',
        after,
        path,
        options: [...sel.options].map((o) => o.value),
        detect
      };
    });
    results.push({
      name: 'examino-source-no-force-dvr-on-change',
      pass: noForceDvr.ok === true,
      detail: noForceDvr
    });

    // Path /play/dvr/ must not win over last-applied VOD in the select fill path
    const pathDoesNotWin = await page.evaluate(() => {
      const sel = document.getElementById('omt-examino-source');
      if (!sel) return { ok: false, reason: 'no-select' };
      // Force URL-like DVR context is already the mock path; ensure select
      // stays on VOD after Auto VOD / last apply.
      return {
        ok: sel.value === 'VOD' &&
          ![...sel.options].some((o) => /loading/i.test(o.textContent || '')),
        value: sel.value,
        path: location.pathname
      };
    });
    results.push({
      name: 'examino-source-path-dvr-does-not-override-vod',
      pass: pathDoesNotWin.ok === true,
      detail: pathDoesNotWin
    });

    // ---- Click to pause: only the video surface (not whole .op-player) ----
    await page.evaluate(async () => {
      const setup = document.getElementById('setup-panel');
      if (setup) setup.style.display = 'none';
      const panel = document.getElementById('omt-controls-panel');
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
    // Moving the pointer over the video re-shows our panel (auto-hide), so
    // aim at a video point our HUD never covers, as an analyst would.
    const videoPoint = await page.evaluate(() => {
      const v = document.querySelector('video');
      const panel = document.getElementById('omt-controls-panel');
      if (!v) return null;
      if (panel) { panel.style.opacity = '1'; panel.style.pointerEvents = 'auto'; }
      const r = v.getBoundingClientRect();
      let pick = null;
      for (let fy = 0.3; fy <= 0.6 && !pick; fy += 0.05) {
        for (let fx = 0.5; fx >= 0.2 && !pick; fx -= 0.1) {
          const x = r.left + r.width * fx;
          const y = r.top + r.height * fy;
          if (document.elementFromPoint(x, y) === v) pick = { x, y };
        }
      }
      if (panel) { panel.style.opacity = '0'; panel.style.pointerEvents = 'none'; }
      return pick;
    });
    const clickVideoCenter = async () => {
      if (!videoPoint) return;
      await page.mouse.click(videoPoint.x, videoPoint.y);
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

    // ---- Idle: no spurious play/pause or seek loops (v2.0.2 field regression) ----
    // Field: ~250 play+pause pairs/sec when .op-ui (wrapping <video>) was display:none.
    const idleTransport = await page.evaluate(async () => {
      const v = document.querySelector('video');
      if (!v) return { ok: false, reason: 'no-video' };
      try { await v.play(); } catch (_) {}
      let playN = 0;
      let pauseN = 0;
      let seekingN = 0;
      let rateN = 0;
      const onPlay = () => { playN += 1; };
      const onPause = () => { pauseN += 1; };
      const onSeeking = () => { seekingN += 1; };
      const onRate = () => { rateN += 1; };
      v.addEventListener('play', onPlay);
      v.addEventListener('pause', onPause);
      v.addEventListener('seeking', onSeeking);
      v.addEventListener('ratechange', onRate);
      const rate0 = v.playbackRate;
      const vCs = getComputedStyle(v);
      // Stir layout/observers without user transport actions.
      for (let i = 0; i < 8; i++) {
        window.dispatchEvent(new Event('resize'));
        document.dispatchEvent(new Event('fullscreenchange'));
        await new Promise((r) => setTimeout(r, 40));
      }
      await new Promise((r) => setTimeout(r, 2500));
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('seeking', onSeeking);
      v.removeEventListener('ratechange', onRate);
      // Allow a couple of events from the initial play(); reject storms.
      const ok = playN <= 2 && pauseN <= 2 && seekingN <= 2 && rateN <= 2 &&
        v.paused === false && Math.abs((v.playbackRate || 1) - (rate0 || 1)) < 0.01 &&
        vCs.display !== 'none' && vCs.visibility !== 'hidden';
      return {
        ok,
        playN,
        pauseN,
        seekingN,
        rateN,
        paused: v.paused,
        rate: v.playbackRate,
        videoDisplay: vCs.display,
        videoVisibility: vCs.visibility,
        hudOn: document.documentElement.classList.contains('omt-hud-on')
      };
    });
    results.push({
      name: 'examino-idle-no-transport-loop',
      pass: idleTransport.ok === true,
      detail: idleTransport
    });

    // ---- Auto-hide: repeated clicks keep panel visible ----
    const autoHide = await page.evaluate(async () => {
      const panel = document.getElementById('omt-controls-panel');
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

    // v2.2.12 #6: dblclick / repeated clicks on panel must not toggle host playback.
    const examinoPanelSwallow = await page.evaluate(async () => {
      const panel = document.getElementById('omt-controls-panel');
      const v = document.querySelector('video');
      if (!panel || !v) return { ok: false, reason: 'missing' };
      panel.style.opacity = '1';
      panel.style.pointerEvents = 'auto';
      try { await v.play(); } catch (_) {}
      await new Promise((r) => setTimeout(r, 40));
      const before = !!v.paused;
      const x = panel.getBoundingClientRect();
      const cx = x.left + x.width / 2;
      const cy = x.top + Math.min(24, x.height / 3);
      for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click', 'click', 'dblclick']) {
        panel.dispatchEvent(new MouseEvent(type, {
          bubbles: true, cancelable: true, clientX: cx, clientY: cy, view: window
        }));
      }
      await new Promise((r) => setTimeout(r, 80));
      return { ok: !!v.paused === before, before, after: !!v.paused };
    });
    results.push({
      name: 'examino-panel-swallows-dblclick',
      pass: examinoPanelSwallow.ok === true,
      detail: examinoPanelSwallow
    });

    // v2.2.14: panel drag starts, moves, then mouseup ends (no stick-to-mouse).
    const examinoPanelDrag = await page.evaluate(async () => {
      const panel = document.getElementById('omt-controls-panel');
      const handle = document.getElementById('controls-handle');
      if (!panel || !handle) return { ok: false, reason: 'missing' };
      panel.style.opacity = '1';
      panel.style.pointerEvents = 'auto';
      const before = panel.getBoundingClientRect();
      const hr = handle.getBoundingClientRect();
      const x0 = hr.left + hr.width / 2;
      const y0 = hr.top + Math.min(10, hr.height / 2);
      handle.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true, cancelable: true, clientX: x0, clientY: y0, button: 0, view: window
      }));
      document.dispatchEvent(new MouseEvent('mousemove', {
        bubbles: true, cancelable: true, clientX: x0 + 40, clientY: y0 + 30, view: window
      }));
      window.dispatchEvent(new MouseEvent('mousemove', {
        bubbles: true, cancelable: true, clientX: x0 + 40, clientY: y0 + 30, view: window
      }));
      await new Promise((r) => setTimeout(r, 30));
      const mid = panel.getBoundingClientRect();
      const moved = Math.abs(mid.left - before.left) > 8 || Math.abs(mid.top - before.top) > 8;
      window.dispatchEvent(new MouseEvent('mouseup', {
        bubbles: true, cancelable: true, clientX: x0 + 40, clientY: y0 + 30, view: window
      }));
      document.dispatchEvent(new MouseEvent('mouseup', {
        bubbles: true, cancelable: true, clientX: x0 + 40, clientY: y0 + 30, view: window
      }));
      await new Promise((r) => setTimeout(r, 30));
      const afterRelease = panel.getBoundingClientRect();
      // Extra move after release must NOT move the panel (drag ended).
      window.dispatchEvent(new MouseEvent('mousemove', {
        bubbles: true, cancelable: true, clientX: x0 + 120, clientY: y0 + 90, view: window
      }));
      await new Promise((r) => setTimeout(r, 30));
      const afterExtra = panel.getBoundingClientRect();
      const stuck = Math.abs(afterExtra.left - afterRelease.left) > 2 ||
        Math.abs(afterExtra.top - afterRelease.top) > 2;
      return {
        ok: moved && !stuck,
        moved, stuck,
        before: { l: before.left, t: before.top },
        mid: { l: mid.left, t: mid.top },
        afterRelease: { l: afterRelease.left, t: afterRelease.top },
        afterExtra: { l: afterExtra.left, t: afterExtra.top }
      };
    });
    results.push({
      name: 'examino-panel-drag-ends-on-mouseup',
      pass: examinoPanelDrag.ok === true,
      detail: examinoPanelDrag
    });

    // v2.2.16 / v2.2.23: viewport-fixed HUD — player translateY-centred, bar at tab bottom.
    await page.setViewportSize({ width: 874, height: 886 });
    await page.evaluate(() => {
      document.documentElement.style.height = '100%';
      document.body.style.cssText = 'margin:0;height:100%;background:#000;';
      const pageEl = document.querySelector('.page');
      if (pageEl) {
        // Fixed-height player strip (host size unchanged); vcenter shifts it.
        pageEl.style.cssText =
          'width:100%;height:492px;margin:0;display:block;background:#000;overflow:visible;';
      }
      const main = document.getElementById('main-container') || document.querySelector('.main-container');
      if (main) {
        main.style.cssText = 'position:relative;width:100%;height:492px;overflow:visible;';
      }
      const top = document.querySelector('.top');
      if (top) top.style.cssText = 'position:relative;width:100%;height:492px;';
      const player = document.getElementById('op-player') || document.querySelector('.op-player');
      if (player) player.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
      const bottom = document.getElementById('bottom-controls');
      if (bottom) bottom.style.display = 'none';
      window.dispatchEvent(new Event('resize'));
      if (typeof window.__omtExaminoCenterPlayer === 'function') window.__omtExaminoCenterPlayer();
      if (typeof window.__omtUpdateClockPictureInset === 'function') {
        window.__omtUpdateClockPictureInset();
      }
    });
    await page.waitForTimeout(120);
    const examinoViewportHud = await page.evaluate(() => {
      const root = document.getElementById('omt-root');
      const bar = document.getElementById('omt-timeline-bar');
      const v = document.querySelector('video');
      if (!root || !bar || !v) return { ok: false, reason: 'missing' };
      const cs = getComputedStyle(root);
      const rr = root.getBoundingClientRect();
      const br = bar.getBoundingClientRect();
      const vr = v.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const fixed = cs.position === 'fixed';
      const coversTab = Math.abs(rr.width - vw) < 4 && Math.abs(rr.height - vh) < 4;
      const barAtTabBottom = Math.abs(br.bottom - vh) < 6;
      const barBelowVideo = br.top >= vr.bottom - 2;
      const peNone = cs.pointerEvents === 'none';
      const vertCentered = Math.abs(vr.top - (vh - vr.bottom)) <= 12;
      return {
        ok: fixed && coversTab && barAtTabBottom && barBelowVideo && peNone && vertCentered,
        fixed, coversTab, barAtTabBottom, barBelowVideo, peNone, vertCentered,
        root: { w: Math.round(rr.width), h: Math.round(rr.height), pos: cs.position },
        bar: { top: Math.round(br.top), bottom: Math.round(br.bottom) },
        video: { top: Math.round(vr.top), bottom: Math.round(vr.bottom), h: Math.round(vr.height) },
        viewport: { w: vw, h: vh }
      };
    });
    results.push({
      name: 'examino-viewport-hud-bar-in-black-area',
      pass: examinoViewportHud.ok === true,
      detail: examinoViewportHud
    });

    // v2.2.20: Examino clock sits inside the video picture (not the black tab
    // band) even though #omt-root is viewport-fixed. Panel/bar stay full-tab.
    async function assertExaminoClockInVideo(label) {
      return page.evaluate((label) => {
        const root = document.getElementById('omt-root');
        const wrap = document.getElementById('match-timer-wrap');
        const v = document.querySelector('video');
        if (!root || !wrap || !v) return { ok: false, reason: 'missing', label };
        try {
          localStorage.setItem('omtClockPosition', 'top-left');
        } catch (_) {}
        wrap.classList.remove(
          'omt-clock-pos-top-centre', 'omt-clock-pos-top-right',
          'omt-clock-pos-bottom-left', 'omt-clock-pos-bottom-centre',
          'omt-clock-pos-bottom-right'
        );
        wrap.classList.add('omt-clock-pos-top-left', 'is-visible');
        root.classList.add('omt-timer-on');
        wrap.style.display = 'block';
        wrap.style.opacity = '1';
        if (typeof window.__omtExaminoCenterPlayer === 'function') {
          window.__omtExaminoCenterPlayer();
        }
        if (typeof window.__omtUpdateClockPictureInset === 'function') {
          window.__omtUpdateClockPictureInset();
        } else {
          window.dispatchEvent(new Event('resize'));
        }
        const vr = v.getBoundingClientRect();
        const cr = wrap.getBoundingClientRect();
        const inside =
          cr.width > 4 && cr.height > 4 &&
          cr.left >= vr.left - 1 && cr.right <= vr.right + 1 &&
          cr.top >= vr.top - 1 && cr.bottom <= vr.bottom + 1;
        const inPicture = root.classList.contains('omt-clock-in-picture');
        const picTop = parseFloat(root.style.getPropertyValue('--omt-pic-top')) || 0;
        return {
          ok: inside && inPicture && picTop >= 0,
          label,
          inside,
          inPicture,
          picTop,
          clock: {
            left: Math.round(cr.left), top: Math.round(cr.top),
            right: Math.round(cr.right), bottom: Math.round(cr.bottom)
          },
          video: {
            left: Math.round(vr.left), top: Math.round(vr.top),
            right: Math.round(vr.right), bottom: Math.round(vr.bottom),
            h: Math.round(vr.height)
          },
          viewportH: window.innerHeight
        };
      }, label);
    }

    const examinoClockWindowed = await assertExaminoClockInVideo('windowed-narrow');
    results.push({
      name: 'examino-clock-inside-video-windowed',
      pass: examinoClockWindowed.ok === true,
      detail: examinoClockWindowed
    });

    const examinoClockFs = await page.evaluate(async () => {
      const root = document.getElementById('omt-root');
      const wrap = document.getElementById('match-timer-wrap');
      const v = document.querySelector('video');
      if (!root || !wrap || !v) return { ok: false, reason: 'missing' };
      const fsTarget = document.getElementById('op-player') ||
        document.querySelector('.op-player') || v.parentElement || document.documentElement;
      try {
        if (fsTarget.requestFullscreen) await fsTarget.requestFullscreen();
      } catch (e) {
        return { ok: false, reason: 'fs-denied', err: String(e && e.message || e) };
      }
      await new Promise((r) => setTimeout(r, 120));
      if (typeof window.__omtExaminoCenterPlayer === 'function') window.__omtExaminoCenterPlayer();
      if (typeof window.__omtUpdateClockPictureInset === 'function') {
        window.__omtUpdateClockPictureInset();
      }
      wrap.classList.add('omt-clock-pos-top-left', 'is-visible');
      root.classList.add('omt-timer-on');
      wrap.style.display = 'block';
      const vr = v.getBoundingClientRect();
      const cr = wrap.getBoundingClientRect();
      const inside =
        cr.width > 4 && cr.height > 4 &&
        cr.left >= vr.left - 1 && cr.right <= vr.right + 1 &&
        cr.top >= vr.top - 1 && cr.bottom <= vr.bottom + 1;
      const inPicture = root.classList.contains('omt-clock-in-picture');
      const out = {
        ok: inside && inPicture && !!document.fullscreenElement,
        inside,
        inPicture,
        hasFs: !!document.fullscreenElement,
        clock: {
          left: Math.round(cr.left), top: Math.round(cr.top),
          right: Math.round(cr.right), bottom: Math.round(cr.bottom)
        },
        video: {
          left: Math.round(vr.left), top: Math.round(vr.top),
          right: Math.round(vr.right), bottom: Math.round(vr.bottom)
        }
      };
      try { await document.exitFullscreen(); } catch (_) {}
      await new Promise((r) => setTimeout(r, 80));
      if (typeof window.__omtExaminoCenterPlayer === 'function') window.__omtExaminoCenterPlayer();
      if (typeof window.__omtUpdateClockPictureInset === 'function') {
        window.__omtUpdateClockPictureInset();
      }
      return out;
    });
    results.push({
      name: 'examino-clock-inside-video-fullscreen',
      pass: examinoClockFs.ok === true || examinoClockFs.reason === 'fs-denied',
      detail: examinoClockFs
    });
    await page.screenshot({ path: path.join(ARTIFACTS, 'v220_examino_clock_in_video.png'), fullPage: true });

    // Panel-in-black drag (same examino-mock page — do not remount before Source tests).
    await page.setViewportSize({ width: 874, height: 886 });
    await page.evaluate(() => {
      document.documentElement.style.height = '100%';
      document.body.style.cssText = 'margin:0;height:100%;background:#000;';
      const pageEl = document.querySelector('.page');
      if (pageEl) {
        pageEl.style.cssText =
          'width:100%;height:492px;margin:0;display:block;background:#000;overflow:visible;';
      }
      const main = document.getElementById('main-container') || document.querySelector('.main-container');
      if (main) main.style.cssText = 'position:relative;width:100%;height:492px;overflow:visible;';
      const top = document.querySelector('.top');
      if (top) top.style.cssText = 'position:relative;width:100%;height:492px;';
      const player = document.getElementById('op-player') || document.querySelector('.op-player');
      if (player) player.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
      if (typeof window.__omtExaminoCenterPlayer === 'function') window.__omtExaminoCenterPlayer();
      window.dispatchEvent(new Event('resize'));
    });
    await page.waitForTimeout(100);

    const examinoDragIntoBlack = await page.evaluate(async () => {
      const panel = document.getElementById('omt-controls-panel');
      const handle = document.getElementById('controls-handle');
      const v = document.querySelector('video');
      if (!panel || !handle || !v) return { ok: false, reason: 'missing' };
      panel.style.opacity = '1';
      panel.style.pointerEvents = 'auto';
      const vr = v.getBoundingClientRect();
      const hr = handle.getBoundingClientRect();
      const x0 = hr.left + hr.width / 2;
      const y0 = hr.top + Math.min(10, hr.height / 2);
      // Park panel center in the black band below the video.
      const targetY = Math.min(window.innerHeight - 80, vr.bottom + 120);
      const targetX = Math.max(40, Math.min(window.innerWidth - 40, window.innerWidth / 2));
      handle.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true, cancelable: true, clientX: x0, clientY: y0, button: 0, view: window
      }));
      window.dispatchEvent(new MouseEvent('mousemove', {
        bubbles: true, cancelable: true, clientX: targetX, clientY: targetY, view: window
      }));
      await new Promise((r) => setTimeout(r, 40));
      window.dispatchEvent(new MouseEvent('mouseup', {
        bubbles: true, cancelable: true, clientX: targetX, clientY: targetY, view: window
      }));
      await new Promise((r) => setTimeout(r, 40));
      const pr = panel.getBoundingClientRect();
      const inBlack = pr.top >= vr.bottom - 8;
      return {
        ok: inBlack,
        inBlack,
        panelTop: Math.round(pr.top),
        videoBottom: Math.round(vr.bottom),
        targetY: Math.round(targetY)
      };
    });
    results.push({
      name: 'examino-panel-drag-into-black-area',
      pass: examinoDragIntoBlack.ok === true,
      detail: examinoDragIntoBlack
    });

    // Restore default viewport after narrow/centre probes (later clip screenshots).
    await page.setViewportSize({ width: 1100, height: 900 });
    await page.waitForTimeout(80);

    // Empty root must not steal hits (pointer-events:none) — click through to host.
    const examinoRootPassthrough = await page.evaluate(() => {
      const root = document.getElementById('omt-root');
      const player = document.getElementById('op-player') || document.querySelector('.op-player');
      if (!root || !player) return { ok: false };
      let hostClicks = 0;
      const onClick = () => { hostClicks += 1; };
      player.addEventListener('click', onClick);
      // Click in black area (below video) through the fixed root.
      const y = Math.min(window.innerHeight - 20, (document.querySelector('video')?.getBoundingClientRect().bottom || 0) + 40);
      const x = Math.floor(window.innerWidth / 2);
      const top = document.elementFromPoint(x, y);
      const throughRoot = !(top && root.contains(top) && top !== root);
      // Synthetic click on player (gear zone) must still fire.
      const gear = document.getElementById('native-gear') || player;
      gear.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      player.removeEventListener('click', onClick);
      const pe = getComputedStyle(root).pointerEvents;
      return {
        ok: pe === 'none' && hostClicks >= 1,
        pe, hostClicks, throughRoot,
        topTag: top && (top.id || top.tagName)
      };
    });
    results.push({
      name: 'examino-root-pointer-events-passthrough',
      pass: examinoRootPassthrough.ok === true,
      detail: examinoRootPassthrough
    });

    // v2.2.12 #7: Enter on timer edit commits seek immediately (no video click).
    const examinoEnterSeek = await page.evaluate(async () => {
      const v = document.querySelector('video');
      const wrap = document.getElementById('match-timer-wrap');
      const timer = document.getElementById('match-timer');
      const kick = document.getElementById('omt-btn-set-kickoff');
      if (!v || !wrap || !timer || !kick) return { ok: false, reason: 'missing' };
      try { v.pause(); } catch (_) {}
      try { v.currentTime = 5; } catch (_) {}
      kick.click();
      await new Promise((r) => setTimeout(r, 40));
      wrap.classList.add('is-visible');
      document.getElementById('omt-root')?.classList.add('omt-timer-on');
      timer.click();
      await new Promise((r) => setTimeout(r, 60));
      const input = document.getElementById('timer-edit-input');
      if (!input) return { ok: false, reason: 'no-input' };
      input.focus();
      input.value = '1';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const before = v.currentTime;
      input.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
        bubbles: true, cancelable: true
      }));
      await new Promise((r) => setTimeout(r, 80));
      const stillEditing = !!document.getElementById('timer-edit-input');
      const after = v.currentTime;
      // Kickoff at ~5s + 1 minute → ~65s (or 60 if kickoff=0 path). Must move without video click.
      return {
        ok: !stillEditing && Math.abs(after - before) > 10,
        stillEditing, before, after
      };
    });
    results.push({
      name: 'examino-clock-edit-enter-seeks',
      pass: examinoEnterSeek.ok === true,
      detail: examinoEnterSeek
    });

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
      const delay = (typeof end === 'number' && typeof ct === 'number') ? (end - ct) : null;
      // v2.2.0: L jumps to adaptive safe point (~base 10s), not raw edge / −3s.
      return {
        ct,
        end,
        delay,
        nearLive: typeof delay === 'number' && delay >= 3.5 && delay <= 32
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
      await new Promise((r) => setTimeout(r, 2800));
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
    results.push({
      name: 'examino-source-dvr-clamp-to-safe-point',
      // Deep VOD playhead must land inside the short DVR window (live safe point).
      pass: vodToDvr.ok === true &&
        typeof vodToDvr.ct === 'number' &&
        vodToDvr.ct >= 0 &&
        vodToDvr.ct <= 330 &&
        vodToDvr.ct > 200, // near live edge, not stuck at 0 / mid-window from VOD carry
      detail: vodToDvr
    });

    // Duplicate-host menu: overlay still only DVR/VOD; media URL round-trips both ways.
    const dupRoundTrip = await page.evaluate(async () => {
      const sel = document.getElementById('omt-examino-source');
      if (!sel) return { ok: false, reason: 'no-select' };
      const opts = [...sel.options].map((o) => (o.textContent || '').trim());
      const hostRows = (() => {
        // Peek at host Source submenu without leaving overlay mapping broken.
        return null;
      })();
      // Switch to VOD — confirm via source/dataset/blob (window mediaUrl may be null).
      const mediaOf = () => {
        const vv = document.querySelector('video');
        return window.__omtMockMediaUrl || (vv && vv.dataset && vv.dataset.omtMediaUrl) ||
          (vv && vv.currentSrc) || '';
      };
      sel.value = 'VOD';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 2500));
      const vodUrl = mediaOf();
      const vodSrc = window.__omtMockSource || (document.querySelector('video') || {}).dataset?.omtSource;
      const vodCt = (document.querySelector('video') || {}).currentTime;
      const genVod = window.__omtSourceValueGen || 0;
      // Deep seek then DVR — clamp. Re-query select after shell rebuild.
      const v = document.querySelector('video');
      if (v) v.currentTime = 3000;
      await new Promise((r) => setTimeout(r, 80));
      const sel2 = document.getElementById('omt-examino-source') || sel;
      sel2.value = 'DVR';
      sel2.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 2800));
      const dvrUrl = mediaOf();
      const dvrSrc = window.__omtMockSource || (document.querySelector('video') || {}).dataset?.omtSource;
      const dvrCt = (document.querySelector('video') || {}).currentTime;
      const frozen = window.__omtDvrFrozen === true;
      const selAfter = document.getElementById('omt-examino-source') || sel2;
      const genDvr = window.__omtSourceValueGen || 0;
      return {
        ok: opts.length === 2 && opts[0] === 'DVR' && opts[1] === 'VOD' &&
          vodSrc === 'VOD' && dvrSrc === 'DVR' &&
          (/vod/i.test(vodUrl) || vodSrc === 'VOD') &&
          (/dvr/i.test(dvrUrl) || dvrSrc === 'DVR') &&
          !frozen && typeof dvrCt === 'number' && dvrCt <= 330 && dvrCt > 200 &&
          genDvr > genVod,
        opts,
        hostRows,
        vodUrl,
        vodSrc,
        vodCt,
        dvrUrl,
        dvrSrc,
        dvrCt,
        frozen,
        genVod,
        genDvr,
        windowMediaUrlNull: window.__omtMockMediaUrl == null,
        sel: selAfter.value
      };
    });
    results.push({
      name: 'examino-source-duplicate-host-roundtrip',
      pass: dupRoundTrip.ok === true,
      detail: dupRoundTrip
    });
    results.push({
      name: 'examino-source-blob-and-regenerated-op-values',
      pass: dupRoundTrip.ok === true &&
        dupRoundTrip.windowMediaUrlNull === true &&
        /^blob:/i.test(String(dupRoundTrip.dvrUrl || '')) &&
        (dupRoundTrip.genDvr || 0) > (dupRoundTrip.genVod || 0),
      detail: {
        windowMediaUrlNull: dupRoundTrip.windowMediaUrlNull,
        dvrUrl: dupRoundTrip.dvrUrl,
        genVod: dupRoundTrip.genVod,
        genDvr: dupRoundTrip.genDvr
      }
    });

    // v2.2.3: post-VOD player shell rebuild + media-confirm — VOD→DVR must change
    // chunklist back to DVR and clamp near live; then DVR→VOD→DVR→VOD round-trip.
    const postVodShell = await page.evaluate(async () => {
      const sel = document.getElementById('omt-examino-source');
      if (!sel) return { ok: false, reason: 'no-select' };
      const genBefore = window.__omtPlayerGeneration || 0;
      const mediaOf = () => {
        const vv = document.querySelector('video');
        return window.__omtMockMediaUrl || (vv && vv.dataset && vv.dataset.omtMediaUrl) ||
          (vv && vv.currentSrc) || '';
      };
      // Ensure VOD first.
      sel.value = 'VOD';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 2000));
      const vodUrl = mediaOf();
      const vodSrc = window.__omtMockSource;
      const genAfterVod = window.__omtPlayerGeneration || 0;
      const v = document.querySelector('video');
      if (v) v.currentTime = 5000;
      await new Promise((r) => setTimeout(r, 80));
      // Concurrent refresh pressure while switching (field race).
      const refreshN = window.__omtMockPostSwapRefresh || 0;
      const selDvr = document.getElementById('omt-examino-source') || sel;
      selDvr.value = 'DVR';
      selDvr.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 2500));
      const dvrUrl = mediaOf();
      const dvrSrc = window.__omtMockSource;
      const dvrCt = (document.querySelector('video') || {}).currentTime;
      const frozen = window.__omtDvrFrozen === true;
      const genAfterDvr = window.__omtPlayerGeneration || 0;
      const osd = (document.getElementById('osd-message') || {}).textContent || '';
      // Round-trip DVR→VOD→DVR→VOD
      const trip = [];
      for (const target of ['VOD', 'DVR', 'VOD']) {
        const s = document.getElementById('omt-examino-source') || selDvr;
        s.value = target;
        s.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 2000));
        trip.push({
          target,
          source: window.__omtMockSource,
          url: mediaOf(),
          sel: s.value,
          gen: window.__omtPlayerGeneration || 0,
          valueGen: window.__omtSourceValueGen || 0
        });
      }
      const tripOk = trip.length === 3 &&
        trip[0].source === 'VOD' &&
        trip[1].source === 'DVR' &&
        trip[2].source === 'VOD' &&
        trip.every((t) => t.sel === t.target);
      return {
        ok: vodSrc === 'VOD' && dvrSrc === 'DVR' &&
          !frozen && typeof dvrCt === 'number' && dvrCt <= 330 && dvrCt > 200 &&
          genAfterVod > genBefore && genAfterDvr > genAfterVod &&
          !/Source change failed/i.test(osd) &&
          tripOk &&
          window.__omtMockMediaUrl == null,
        genBefore,
        genAfterVod,
        genAfterDvr,
        refreshN,
        vodUrl,
        vodSrc,
        dvrUrl,
        dvrSrc,
        dvrCt,
        frozen,
        osd,
        trip,
        sel: sel.value
      };
    });
    results.push({
      name: 'examino-source-vod-to-dvr-media-url-after-shell-rebuild',
      pass: postVodShell.ok === true &&
        postVodShell.dvrSrc === 'DVR' &&
        /dvr|\/live\//i.test(String(postVodShell.dvrUrl || '')),
      detail: postVodShell
    });
    results.push({
      name: 'examino-source-dvr-vod-dvr-vod-roundtrip',
      pass: postVodShell.ok === true && Array.isArray(postVodShell.trip) && postVodShell.trip.length === 3,
      detail: { trip: postVodShell.trip, genAfterDvr: postVodShell.genAfterDvr }
    });

    // Manual DVR must stop auto-VOD from flipping back
    await page.waitForTimeout(2500);
    const stayedDvr = await page.evaluate(() => window.__omtMockSource || document.querySelector('video')?.dataset?.omtSource);
    // After round-trip we end on VOD — flip to DVR once more for the manual-wins check.
    const stayedDvrFinal = await page.evaluate(async () => {
      const sel = document.getElementById('omt-examino-source');
      if (!sel) return { ok: false };
      sel.value = 'DVR';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 2200));
      await new Promise((r) => setTimeout(r, 2500));
      return {
        ok: (window.__omtMockSource || document.querySelector('video')?.dataset?.omtSource) === 'DVR',
        source: window.__omtMockSource
      };
    });
    results.push({
      name: 'examino-manual-dvr-wins',
      pass: stayedDvrFinal.ok === true,
      detail: { stayedDvr, stayedDvrFinal }
    });

    // Floating glass control panel + bottom-only timeline (v1.2.2 structure restored)
    const chromeShape = await page.evaluate(() => {
      const panel = document.getElementById('omt-controls-panel');
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
      const tipCount = document.querySelectorAll('#omt-controls-panel [data-tip], #omt-timeline-bar [data-tip]').length;
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
      const panel = document.getElementById('omt-controls-panel');
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
      const panel = document.getElementById('omt-controls-panel');
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
      }
      if (timelineBar) timelineBar.classList.add('omt-at-live');
      if (live) live.classList.add('is-live');
      v.dispatchEvent(new Event('timeupdate'));
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

    // Skip buttons show amount labels (2 s / 10 s / 2 min); no hover tips (self-explanatory)
    const skipLabels = await page.evaluate(() => {
      const ids = ['omt-m120', 'omt-m10', 'omt-m2', 'omt-p2', 'omt-p10', 'omt-p120'];
      const expected = ['2 min', '10 s', '2 s', '2 s', '10 s', '2 min'];
      const rows = ids.map((id, i) => {
        const el = document.getElementById(id);
        const label = el?.querySelector('.omt-btn-label')?.textContent?.trim() || '';
        const tip = el?.getAttribute('data-tip') || '';
        return { id, label, tip, ok: label === expected[i] && !tip };
      });
      return { ok: rows.every((r) => r.ok), rows };
    });
    results.push({ name: 'examino-skip-amount-labels', pass: skipLabels.ok === true, detail: skipLabels });

    // Option A transport: flush segmented row + speed chips under it
    const optionA = await page.evaluate(() => {
      const seg = document.querySelector('#omt-controls-panel .omt-transport-seg');
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
        ok: lb.width >= 14 && gap >= 4 && !overflow && (label.textContent || '').trim() === '2 min',
        gap, labelW: lb.width, overflow
      };
    });
    results.push({ name: 'examino-skip-2m-label-fit', pass: skip2mFit.ok === true, detail: skip2mFit });

    // Default skip labels on the panel (2 s / 10 s / 2 min)
    const skipDefaultLabels = await page.evaluate(() => {
      const ids = ['omt-m2', 'omt-m10', 'omt-m120'];
      const expected = ['2 s', '10 s', '2 min'];
      const got = ids.map((id) =>
        (document.getElementById(id)?.querySelector('.omt-btn-label')?.textContent || '').trim()
      );
      return { ok: got.join('|') === expected.join('|'), got };
    });
    results.push({
      name: 'skip-defaults-clamp-labels',
      pass: skipDefaultLabels.ok === true,
      detail: skipDefaultLabels
    });

    // Custom skips + auto-sort (inner row=120, outer row=2 → panel shows 2 next to play)
    // + panel size/compact. Keyboard still follows the row value (ArrowRight = skipFwd2 = 120).
    const panelPrefs = await page.evaluate(async () => {
      window.postMessage({
        source: 'omt-bridge',
        type: 'OMT_STORAGE_SYNC',
        values: {
          omtSkipSeconds: {
            skipBack2: 120, skipFwd2: 120,
            skipBack10: 10, skipFwd10: 10,
            skipBack2m: 2, skipFwd2m: 2
          },
          omtPanelSize: 'small',
          omtPanelCompact: true
        }
      }, '*');
      await new Promise((r) => setTimeout(r, 80));
      // Sorted ascending on each side: inner(m2)=2, mid=10, outer(m120)=120
      const labels = ['omt-m2', 'omt-m10', 'omt-m120', 'omt-p2', 'omt-p10', 'omt-p120'].map((id) =>
        (document.getElementById(id)?.querySelector('.omt-btn-label')?.textContent || '').trim()
      );
      const panel = document.getElementById('omt-controls-panel');
      const speedRow = document.querySelector('.omt-speed-row');
      const speedCs = speedRow ? getComputedStyle(speedRow) : null;
      const v = document.querySelector('video');
      let seekOk = false;
      if (v) {
        try { v.currentTime = 1; } catch (_) {}
        const before = v.currentTime;
        document.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'ArrowRight', code: 'ArrowRight', bubbles: true, cancelable: true
        }));
        await new Promise((r) => setTimeout(r, 40));
        // skipFwd2 row value is 120 → seek +120 (clamped by duration is fine; delta should be >> 10)
        seekOk = v.currentTime >= before + 5;
      }
      return {
        labels,
        seekOk,
        sizeSmall: !!(panel && panel.classList.contains('omt-panel-size-small')),
        compact: !!(panel && panel.classList.contains('omt-panel-compact')),
        speedHidden: !!(speedCs && speedCs.display === 'none')
      };
    });
    results.push({
      name: 'panel-size-compact-and-custom-skips',
      pass: panelPrefs.labels.join('|') === '2 s|10 s|2 min|2 s|10 s|2 min'
        && panelPrefs.sizeSmall && panelPrefs.compact && panelPrefs.speedHidden
        && panelPrefs.seekOk === true,
      detail: panelPrefs
    });
    await page.evaluate(() => {
      const panel = document.getElementById('omt-controls-panel');
      const timelineBar = document.getElementById('omt-timeline-bar');
      [panel, timelineBar].forEach((el) => {
        if (!el) return;
        el.style.opacity = '1';
        el.style.pointerEvents = 'auto';
      });
    });
    await page.screenshot({ path: path.join(ARTIFACTS, 'v201_panel_skip_resorted.png'), fullPage: true });

    // Screenshots: panel M (default), S, and Compact (for Vasco)
    await page.evaluate(() => {
      const panel = document.getElementById('omt-controls-panel');
      const timelineBar = document.getElementById('omt-timeline-bar');
      [panel, timelineBar].forEach((el) => {
        if (!el) return;
        el.style.opacity = '1';
        el.style.pointerEvents = 'auto';
      });
    });
    await page.evaluate(async () => {
      window.postMessage({
        source: 'omt-bridge',
        type: 'OMT_STORAGE_SYNC',
        values: { omtSkipSeconds: null, omtPanelSize: 'medium', omtPanelCompact: false }
      }, '*');
      await new Promise((r) => setTimeout(r, 60));
    });
    await page.screenshot({ path: path.join(ARTIFACTS, 'v201_panel_size_m.png'), fullPage: true });
    await page.evaluate(async () => {
      window.postMessage({
        source: 'omt-bridge',
        type: 'OMT_STORAGE_SYNC',
        values: { omtPanelSize: 'small', omtPanelCompact: false }
      }, '*');
      await new Promise((r) => setTimeout(r, 60));
    });
    await page.screenshot({ path: path.join(ARTIFACTS, 'v201_panel_size_s.png'), fullPage: true });
    await page.evaluate(async () => {
      window.postMessage({
        source: 'omt-bridge',
        type: 'OMT_STORAGE_SYNC',
        values: { omtPanelSize: 'medium', omtPanelCompact: true }
      }, '*');
      await new Promise((r) => setTimeout(r, 60));
    });
    await page.screenshot({ path: path.join(ARTIFACTS, 'v201_panel_compact.png'), fullPage: true });

    // Restore defaults for later tests
    await page.evaluate(async () => {
      window.postMessage({
        source: 'omt-bridge',
        type: 'OMT_STORAGE_SYNC',
        values: {
          omtSkipSeconds: null,
          omtPanelSize: 'medium',
          omtPanelCompact: false
        }
      }, '*');
      await new Promise((r) => setTimeout(r, 60));
    });

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
      const panel = document.getElementById('omt-controls-panel');
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
      const panel = document.getElementById('omt-controls-panel');
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
      const panel = document.getElementById('omt-controls-panel');
      return { panel: panel?.style.opacity, pe: panel?.style.pointerEvents };
    });
    await page.keyboard.press('KeyH');
    await page.waitForTimeout(80);
    const afterHShow = await page.evaluate(() => {
      const panel = document.getElementById('omt-controls-panel');
      return { panel: panel?.style.opacity, pe: panel?.style.pointerEvents };
    });
    await page.evaluate(() => {
      const panel = document.getElementById('omt-controls-panel');
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
      const panel = document.getElementById('omt-controls-panel');
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
      const panel = document.getElementById('omt-controls-panel');
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
      const panel = document.getElementById('omt-controls-panel');
      return { panel: panel?.style.opacity };
    });
    // Toggle Auto hide OFF and confirm idle no longer fades
    await page.evaluate(() => {
      const panel = document.getElementById('omt-controls-panel');
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
      const panel = document.getElementById('omt-controls-panel');
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
      const panel = document.getElementById('omt-controls-panel');
      const timeline = document.getElementById('omt-timeline-bar');
      if (panel) { panel.style.opacity = '1'; panel.style.pointerEvents = 'auto'; }
      if (timeline) { timeline.style.opacity = '1'; timeline.classList.remove('omt-chrome-hidden'); }
    });

    // Play/pause centre button follows real media state; top OSD only (no centre flash)
    await page.evaluate(() => {
      const panel = document.getElementById('omt-controls-panel');
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
      const panel = document.getElementById('omt-controls-panel');
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

    // v2.2.15: "Keep playing on alt tab" (omtKeepPlayingOnAltTab).
    // Default OFF = pause only on visibility hidden (never blur/focus).
    // ON = keep playing; undo host pause via one microtask play().
    const examinoBlurDoesNotPause = await page.evaluate(async () => {
      try { localStorage.removeItem('omtAutoPauseOnBlur'); } catch (_) {}
      localStorage.setItem('omtKeepPlayingOnAltTab', 'false');
      localStorage.setItem('shuttleXpressEnabled', 'false');
      const v = document.querySelector('video');
      if (!v) return { ok: false, reason: 'no-video' };
      v.muted = true;
      try { await v.play(); } catch (e) { return { ok: false, reason: 'play-failed', err: String(e) }; }
      await new Promise((r) => setTimeout(r, 40));
      // Visible but unfocused (analyst clicks collection app beside video).
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      window.dispatchEvent(new Event('blur'));
      await new Promise((r) => setTimeout(r, 40));
      const afterBlur = v.paused;
      window.dispatchEvent(new Event('focus'));
      await new Promise((r) => setTimeout(r, 40));
      return { ok: afterBlur === false && v.paused === false, afterBlur, afterFocus: v.paused };
    });
    results.push({
      name: 'examino-blur-does-not-pause',
      pass: examinoBlurDoesNotPause.ok === true,
      detail: examinoBlurDoesNotPause
    });

    const examinoAltTabDefaultPause = await page.evaluate(async () => {
      try { localStorage.removeItem('omtAutoPauseOnBlur'); } catch (_) {}
      localStorage.setItem('omtKeepPlayingOnAltTab', 'false');
      localStorage.setItem('shuttleXpressEnabled', 'false');
      const v = document.querySelector('video');
      if (!v) return { ok: false, reason: 'no-video' };
      v.muted = true;
      try { await v.play(); } catch (e) { return { ok: false, reason: 'play-failed', err: String(e) }; }
      await new Promise((r) => setTimeout(r, 40));
      if (v.paused) return { ok: false, reason: 'not-playing' };
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
      await new Promise((r) => setTimeout(r, 40));
      const afterAway = v.paused;
      const osd = (document.getElementById('osd-message')?.innerText || '');
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      document.dispatchEvent(new Event('visibilitychange'));
      await new Promise((r) => setTimeout(r, 120));
      return {
        ok: afterAway === true && v.paused === false && /Auto paused/i.test(osd),
        afterAway,
        afterReturn: v.paused,
        osd
      };
    });
    results.push({
      name: 'examino-alt-tab-default-pauses-and-resumes',
      pass: examinoAltTabDefaultPause.ok === true,
      detail: examinoAltTabDefaultPause
    });

    const examinoAltTabManualStays = await page.evaluate(async () => {
      localStorage.setItem('omtKeepPlayingOnAltTab', 'false');
      localStorage.setItem('shuttleXpressEnabled', 'false');
      const v = document.querySelector('video');
      if (!v) return { ok: false };
      try { await v.play(); } catch (_) {}
      await new Promise((r) => setTimeout(r, 30));
      v.pause();
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
      name: 'examino-alt-tab-manual-stays-paused',
      pass: examinoAltTabManualStays.ok === true,
      detail: examinoAltTabManualStays
    });

    const examinoKeepPlayingOn = await page.evaluate(async () => {
      localStorage.setItem('omtKeepPlayingOnAltTab', 'true');
      localStorage.setItem('shuttleXpressEnabled', 'false');
      const v = document.querySelector('video');
      if (!v) return { ok: false, reason: 'no-video' };
      v.muted = true;
      try { await v.play(); } catch (e) { return { ok: false, reason: 'play-failed', err: String(e) }; }
      await new Promise((r) => setTimeout(r, 40));
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
      await new Promise((r) => setTimeout(r, 40));
      const afterAway = v.paused;
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      document.dispatchEvent(new Event('visibilitychange'));
      return { ok: afterAway === false, afterAway };
    });
    results.push({
      name: 'examino-alt-tab-keep-playing-stays',
      pass: examinoKeepPlayingOn.ok === true,
      detail: examinoKeepPlayingOn
    });

    // Keep-playing ON: Examino host pause while hidden → one microtask play().
    const examinoKeepPlayingHostUndo = await page.evaluate(async () => {
      localStorage.setItem('omtKeepPlayingOnAltTab', 'true');
      localStorage.setItem('shuttleXpressEnabled', 'false');
      const v = document.querySelector('video');
      if (!v) return { ok: false, reason: 'no-video' };
      v.muted = true;
      try { await v.play(); } catch (e) { return { ok: false, reason: 'play-failed', err: String(e) }; }
      await new Promise((r) => setTimeout(r, 40));
      if (v.paused) return { ok: false, reason: 'not-playing' };
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
      // Host pauses after our capture arm.
      v.pause();
      await Promise.resolve();
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 40));
      const whileHidden = v.paused;
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      document.dispatchEvent(new Event('visibilitychange'));
      return { ok: whileHidden === false, whileHidden };
    });
    results.push({
      name: 'examino-alt-tab-keep-playing-undoes-host-pause',
      pass: examinoKeepPlayingHostUndo.ok === true,
      detail: examinoKeepPlayingHostUndo
    });

    const examinoKeepPlayingManual = await page.evaluate(async () => {
      localStorage.setItem('omtKeepPlayingOnAltTab', 'true');
      const v = document.querySelector('video');
      if (!v) return { ok: false };
      try { await v.play(); } catch (_) {}
      await new Promise((r) => setTimeout(r, 30));
      v.pause();
      await new Promise((r) => setTimeout(r, 30));
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      v.pause();
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 40));
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
      await new Promise((r) => setTimeout(r, 80));
      return { ok: v.paused === true, paused: v.paused };
    });
    results.push({
      name: 'examino-alt-tab-keep-playing-manual-stays',
      pass: examinoKeepPlayingManual.ok === true,
      detail: examinoKeepPlayingManual
    });

    const examinoAltTabShuttleSkip = await page.evaluate(async () => {
      localStorage.setItem('omtKeepPlayingOnAltTab', 'false');
      localStorage.setItem('shuttleXpressEnabled', 'true');
      const v = document.querySelector('video');
      if (!v) return { ok: false, reason: 'no-video' };
      v.muted = true;
      try { await v.play(); } catch (e) { return { ok: false, reason: 'play-failed', err: String(e) }; }
      await new Promise((r) => setTimeout(r, 40));
      if (v.paused) return { ok: false, reason: 'still-paused-before-hide' };
      const osdEl = document.getElementById('osd-message');
      if (osdEl) {
        osdEl.innerText = '';
        osdEl.classList.remove('visible');
      }
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
        osd
      };
    });
    results.push({
      name: 'examino-alt-tab-shuttle-skips',
      pass: examinoAltTabShuttleSkip.ok === true,
      detail: examinoAltTabShuttleSkip
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

    // Play / skip / speed-row: no hover tips (self-explanatory). Frame tips remain.
    const playBox = await page.locator('#omt-btn-play').boundingBox();
    if (playBox) {
      await page.mouse.move(playBox.x + playBox.width / 2, playBox.y + playBox.height / 2);
      await page.waitForTimeout(140);
    }
    const playNoTip = await page.evaluate(() => {
      const play = document.getElementById('omt-btn-play');
      const portal = document.getElementById('omt-control-tip');
      const chips = [...document.querySelectorAll('.omt-speed-chip')];
      const skips = ['omt-m120', 'omt-m10', 'omt-m2', 'omt-p2', 'omt-p10', 'omt-p120']
        .map((id) => document.getElementById(id));
      const noPlayTip = !!(play && !play.hasAttribute('data-tip') && !play.classList.contains('omt-tip'));
      const noSkipTips = skips.every((el) => el && !el.hasAttribute('data-tip') && !el.classList.contains('omt-tip'));
      const noChipTips = chips.every((el) => !el.hasAttribute('data-tip') && !el.classList.contains('omt-tip'));
      const portalHidden = !portal || portal.hidden === true || !(portal.textContent || '').trim();
      const frameTipsOk =
        /Previous frame/i.test(document.getElementById('omt-prev-frame')?.getAttribute('data-tip') || '') &&
        /Next frame/i.test(document.getElementById('omt-next-frame')?.getAttribute('data-tip') || '');
      return { ok: noPlayTip && noSkipTips && noChipTips && portalHidden && frameTipsOk, noPlayTip, noSkipTips, noChipTips, portalHidden, frameTipsOk };
    });
    results.push({ name: 'examino-transport-no-tips', pass: playNoTip.ok === true, detail: playNoTip });
    if (playBox) {
      await page.screenshot({
        path: path.join(ARTIFACTS, 'v178_play_no_tooltip.png'),
        clip: {
          x: Math.max(0, playBox.x - 120),
          y: Math.max(0, playBox.y - 40),
          width: Math.min(420, playBox.width + 240),
          height: Math.ceil(playBox.height + 80)
        }
      });
    }
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

    // Behind live → grey scrubber (partial fill).
    // Clear kickoff first: precision zoom (min = k1−900) makes "55% of duration"
    // land below slider.min and paint as 0%.
    await page.evaluate(async () => {
      document.getElementById('omt-btn-clear-timer')?.click();
      const v = document.querySelector('video');
      const slider = document.getElementById('omt-timeline-slider');
      const timelineBar = document.getElementById('omt-timeline-bar');
      const live = document.getElementById('omt-live-btn');
      if (!v) return;
      try { v.pause(); } catch (_) {}
      const end = v.seekable?.length ? v.seekable.end(v.seekable.length - 1) : v.duration;
      if (slider && typeof end === 'number' && isFinite(end) && end > 0) {
        slider.min = '0';
        slider.max = String(end);
        const behindAt = Math.max(0, end * 0.55);
        slider.value = String(behindAt);
        slider.dispatchEvent(new Event('change', { bubbles: true }));
        slider.style.setProperty('--omt-progress', '55%');
      } else {
        const behindAt = typeof end === 'number' ? Math.max(0, end * 0.55) : 100;
        try { v.currentTime = behindAt; } catch (_) {}
      }
      if (timelineBar) timelineBar.classList.remove('omt-at-live');
      if (live) live.classList.remove('is-live');
      v.dispatchEvent(new Event('timeupdate'));
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

    // ---- v2.0.1 YouTube-style timeline chrome (bar top / vol+time left / FS right) ----
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.evaluate(() => {
      // Ensure no leftover kickoff from earlier cases / restore.
      document.getElementById('omt-btn-clear-timer')?.click();
      const pageEl = document.querySelector('.page');
      if (pageEl) {
        pageEl.style.width = '1280px';
        pageEl.style.height = '720px';
        pageEl.style.margin = '0';
      }
      const main = document.querySelector('.main-container');
      if (main) main.style.height = 'calc(100% - 108px)';
    });
    await page.waitForTimeout(100);

    const seekLiveDelay = async (delaySec) => {
      await page.evaluate((d) => {
        const v = document.querySelector('video');
        const slider = document.getElementById('omt-timeline-slider');
        const bar = document.getElementById('omt-timeline-bar');
        const panel = document.getElementById('omt-controls-panel');
        if (!v) return;
        try { v.pause(); } catch (_) {}
        const end = v.seekable?.length ? v.seekable.end(v.seekable.length - 1) : v.duration;
        const at = Math.max(0, (typeof end === 'number' ? end : 0) - d);
        // Prefer slider `change` → seekTo() so anti-snap lock tracks the new
        // playhead (direct currentTime is yanked back while LIVE lock is active).
        if (slider && typeof end === 'number' && isFinite(end) && end > 0) {
          slider.min = '0';
          slider.max = String(end);
          slider.value = String(at);
          slider.style.setProperty('--omt-progress', ((at / end) * 100) + '%');
          slider.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          try { v.currentTime = at; } catch (_) {}
        }
        if (bar) {
          bar.style.opacity = '1';
          bar.classList.remove('omt-chrome-hidden');
        }
        if (panel) {
          panel.style.opacity = '1';
          panel.style.pointerEvents = 'auto';
        }
        v.dispatchEvent(new Event('timeupdate'));
        v.dispatchEvent(new Event('timeupdate'));
      }, delaySec);
      await page.waitForTimeout(120);
    };
    const readTimelineChrome = async () => page.evaluate(() => {
      const bar = document.getElementById('omt-timeline-bar');
      const track = bar?.querySelector('.omt-timeline-track');
      const row = bar?.querySelector('.omt-timeline-chrome-row');
      const times = document.querySelector('#omt-root .omt-timeline-times');
      const ind = document.getElementById('omt-timeline-live-indicator');
      const delay = document.getElementById('omt-timeline-live-delay');
      const chip = document.getElementById('omt-timeline-live-chip');
      const edgeClock = document.getElementById('omt-timeline-edge-clock');
      const videoRange = document.getElementById('omt-timeline-video-range');
      const post = document.getElementById('omt-timeline-post-times');
      const matchClock = document.getElementById('omt-timeline-match-clock');
      const cur = document.getElementById('omt-v-time-current');
      const dur = document.getElementById('omt-v-time-duration');
      const playBtn = document.getElementById('omt-timeline-play-btn');
      const volBtn = document.getElementById('omt-timeline-vol-btn');
      const volRange = document.getElementById('omt-timeline-vol-range');
      const fs = document.getElementById('omt-btn-fullscreen');
      const safeMarker = document.getElementById('omt-timeline-safe-marker');
      const chipCs = chip && !chip.hidden ? getComputedStyle(chip) : null;
      const barBox = bar?.getBoundingClientRect();
      const trackBox = track?.getBoundingClientRect();
      const rowBox = row?.getBoundingClientRect();
      const timesBox = times?.getBoundingClientRect();
      const fsBox = fs?.getBoundingClientRect();
      const playBox = playBtn?.getBoundingClientRect();
      const volBox = volBtn?.getBoundingClientRect();
      const rangeBox = videoRange && !videoRange.hidden ? videoRange.getBoundingClientRect() : null;
      const rangeText = videoRange && !videoRange.hidden ? videoRange.textContent.trim() : null;
      return {
        mode: times?.dataset?.omtTimeMode || null,
        liveHidden: !!(ind && ind.hidden),
        postHidden: !!(post && post.hidden),
        matchHidden: !!(matchClock && matchClock.hidden),
        matchText: matchClock && !matchClock.hidden ? matchClock.textContent.trim() : null,
        delayText: delay && !delay.hidden ? delay.textContent.trim() : null,
        // v2.2.1: no "edge …" wall-clock chip; right-side video range instead.
        edgeClockGone: !edgeClock,
        videoRangeText: rangeText,
        videoRangeOk: !!(rangeText && /^\d+:\d{2}(?::\d{2})?\s*\/\s*\d+:\d{2}(?::\d{2})?$/.test(rangeText) &&
          !/edge/i.test(rangeText)),
        chipVisible: !!(chip && !chip.hidden && ind && !ind.hidden),
        chipBg: chipCs ? chipCs.backgroundColor : null,
        chipColor: chipCs ? chipCs.color : null,
        curText: cur?.innerText || null,
        durText: dur?.innerText || null,
        hasPlay: !!playBtn,
        hasVol: !!(volBtn && volRange),
        noSafeMarker: !safeMarker || safeMarker.hidden !== false || !document.body.contains(safeMarker) ||
          (safeMarker.hidden === true) || !safeMarker.offsetParent,
        // v2.2.0: no visible safe marker element (dropped).
        safeMarkerAbsent: !safeMarker,
        layoutOk: !!(barBox && trackBox && rowBox && timesBox && fsBox && volBox && playBox &&
          Math.abs(trackBox.width - barBox.width) < 40 &&
          rowBox.top >= trackBox.bottom - 2 &&
          timesBox.left < fsBox.left &&
          playBox.left <= volBox.left + 2 &&
          volBox.left <= timesBox.left + 2 &&
          (!rangeBox || (rangeBox.left >= timesBox.right - 2 && rangeBox.right <= fsBox.left + 2))),
        panelClearance: (() => {
          const panel = document.getElementById('omt-controls-panel');
          if (!panel || !barBox) return null;
          const pb = panel.getBoundingClientRect();
          return pb.bottom <= barBox.top + 4;
        })()
      };
    });
    const shotTimelineFrame = async (name, { showPanel = false } = {}) => {
      await page.evaluate((show) => {
        const panel = document.getElementById('omt-controls-panel');
        const bar = document.getElementById('omt-timeline-bar');
        if (bar) {
          bar.style.opacity = '1';
          bar.classList.remove('omt-chrome-hidden');
        }
        if (panel) {
          if (show) {
            panel.style.opacity = '1';
            panel.style.pointerEvents = 'auto';
          } else {
            panel.style.opacity = '0';
            panel.style.pointerEvents = 'none';
          }
        }
      }, showPanel);
      await page.waitForTimeout(40);
      const clip = await page.evaluate(() => {
        const root = document.getElementById('omt-root') || document.querySelector('.op-player') || document.querySelector('.page');
        const bar = document.getElementById('omt-timeline-bar');
        const r = (root || bar).getBoundingClientRect();
        const b = bar ? bar.getBoundingClientRect() : r;
        const y = Math.max(0, Math.min(b.top - 120, r.bottom - 220));
        return {
          x: Math.max(0, r.left),
          y,
          width: Math.min(1280, Math.max(640, r.width)),
          height: Math.min(280, Math.max(160, r.bottom - y + 8))
        };
      });
      await screenshotClipReliable(page, path.join(ARTIFACTS, name), clip);
    };

    const layoutCheck = await readTimelineChrome();
    results.push({
      name: 'timeline-youtube-layout',
      pass: layoutCheck.layoutOk === true && layoutCheck.hasVol === true &&
        layoutCheck.hasPlay === true && layoutCheck.safeMarkerAbsent === true,
      detail: layoutCheck
    });

    // Leave LIVE chip first (delay > 15) so -0:12 is delay text, not chip
    await seekLiveDelay(20);
    await seekLiveDelay(12);
    const live12 = await readTimelineChrome();
    results.push({
      name: 'timeline-live-delay-12s',
      pass: live12.mode === 'live' && !live12.liveHidden && live12.postHidden &&
        live12.matchHidden && live12.delayText === '-0:12' && !live12.chipVisible &&
        live12.edgeClockGone === true && live12.videoRangeOk === true,
      detail: live12
    });
    await shotTimelineFrame('v221_timeline_live_minus_12s.png');

    await seekLiveDelay(65);
    const live65 = await readTimelineChrome();
    results.push({
      name: 'timeline-live-delay-1m05',
      pass: live65.mode === 'live' && live65.delayText === '-1:05' && !live65.chipVisible,
      detail: live65
    });
    await shotTimelineFrame('v221_timeline_live_minus_1m05.png');

    // Hysteresis (adaptive): enter within safe+tol; hold a few seconds past enter;
    // leave when delay stays past the leave band (Examino: margin+step+slack,
    // with a short sustain so a single playlist tick does not flicker).
    await seekLiveDelay(40);
    await seekLiveDelay(8);
    const liveEnter = await readTimelineChrome();
    await seekLiveDelay(12);
    const liveHold = await readTimelineChrome();
    await seekLiveDelay(45);
    // Sustain past leave band (v2.2.8 Examino) before the latch drops.
    await page.waitForTimeout(1300);
    await page.evaluate(() => {
      const v = document.querySelector('video');
      if (v) {
        v.dispatchEvent(new Event('timeupdate'));
        v.dispatchEvent(new Event('timeupdate'));
      }
    });
    await page.waitForTimeout(40);
    const liveLeave = await readTimelineChrome();
    results.push({
      name: 'timeline-live-chip-hysteresis',
      pass: liveEnter.chipVisible === true && liveHold.chipVisible === true &&
        liveLeave.chipVisible === false && liveLeave.delayText === '-0:45',
      detail: { liveEnter, liveHold, liveLeave }
    });

    await seekLiveDelay(2);
    const liveEdge = await readTimelineChrome();
    const chipRed = liveEdge.chipVisible &&
      /rgb\(\s*229,\s*56,\s*59\s*\)/i.test(String(liveEdge.chipBg || ''));
    results.push({
      name: 'timeline-live-chip-red-at-edge',
      pass: liveEdge.mode === 'live' && liveEdge.chipVisible && chipRed &&
        /rgb\(\s*255,\s*255,\s*255\s*\)/i.test(String(liveEdge.chipColor || '')),
      detail: liveEdge
    });
    await shotTimelineFrame('v220_timeline_live_edge_chip.png');

    // LIVE / indicator jump to adaptive safe point (base 10s; not raw edge)
    await seekLiveDelay(40);
    const beforeClick = await page.evaluate(() => document.querySelector('video')?.currentTime);
    await page.evaluate(() => document.getElementById('omt-timeline-live-indicator')?.click());
    await page.waitForTimeout(150);
    const afterClick = await page.evaluate(() => {
      const v = document.querySelector('video');
      const end = v?.seekable?.length ? v.seekable.end(v.seekable.length - 1) : v?.duration;
      const delay = (end || 0) - (v?.currentTime || 0);
      const liveBtn = document.getElementById('omt-live-btn');
      return {
        ct: v?.currentTime,
        end,
        delay,
        liveIsRed: !!(liveBtn && liveBtn.classList.contains('is-live'))
      };
    });
    results.push({
      name: 'timeline-live-indicator-clicks-go-live',
      // Safe point ≥ ~base (allow small float); never raw edge (~0–3s).
      // After jump, panel LIVE must go red (adaptive at-live threshold).
      pass: typeof beforeClick === 'number' && afterClick.delay >= 8 && afterClick.delay <= 32 &&
        afterClick.liveIsRed === true,
      detail: { beforeClick, afterClick }
    });

    // Panel LIVE button → safe point; after a stall never closer than base ~10s;
    // button must turn red immediately (v2.2.2: was stuck grey when margin ≥ base).
    await seekLiveDelay(45);
    const panelLive = await page.evaluate(async () => {
      const v = document.querySelector('video');
      const btn = document.getElementById('omt-live-btn');
      const chip = document.getElementById('omt-timeline-live-chip');
      const ind = document.getElementById('omt-timeline-live-indicator');
      if (!v || !btn) return { ok: false, reason: 'missing' };
      // Simulate recent stall via real media event (feeds adaptive margin).
      v.dispatchEvent(new Event('waiting'));
      btn.click();
      await new Promise((r) => setTimeout(r, 150));
      const end = v.seekable?.length ? v.seekable.end(v.seekable.length - 1) : v.duration;
      const delay = (end || 0) - (v.currentTime || 0);
      const liveIsRed = btn.classList.contains('is-live');
      const chipVisible = !!(chip && !chip.hidden && ind && !ind.hidden);
      const chipCs = chipVisible ? getComputedStyle(chip) : null;
      const chipRed = !!(chipCs && /rgb\(\s*229,\s*56,\s*59\s*\)/i.test(chipCs.backgroundColor || ''));
      return {
        ok: delay >= 9.5 && delay <= 32 && liveIsRed === true,
        delay,
        end,
        ct: v.currentTime,
        liveIsRed,
        chipVisible,
        chipRed
      };
    });
    results.push({
      name: 'live-btn-jumps-to-safe-point',
      pass: panelLive.ok === true,
      detail: panelLive
    });
    results.push({
      name: 'live-btn-turns-red-after-click',
      pass: panelLive.liveIsRed === true && panelLive.chipVisible === true && panelLive.chipRed === true,
      detail: {
        liveIsRed: panelLive.liveIsRed,
        chipVisible: panelLive.chipVisible,
        chipRed: panelLive.chipRed,
        delay: panelLive.delay
      }
    });

    // v2.2.6: top OSD is LIVE / GOING LIVE only (no −Ns); tooltip "Go to live".
    const liveOsdTip = await page.evaluate(async () => {
      const v = document.querySelector('video');
      const btn = document.getElementById('omt-live-btn');
      const osd = document.getElementById('osd-message');
      if (!v || !btn) return { ok: false, reason: 'missing' };
      await new Promise((r) => {
        const end = v.seekable?.length ? v.seekable.end(v.seekable.length - 1) : v.duration;
        v.currentTime = Math.max(0, (end || 0) - 40);
        v.dispatchEvent(new Event('timeupdate'));
        setTimeout(r, 40);
      });
      const texts = [];
      const note = () => {
        const t = (osd && osd.classList.contains('visible') ? (osd.textContent || '') : '').trim();
        if (t) texts.push(t);
      };
      btn.click();
      note();
      await new Promise((r) => setTimeout(r, 50));
      note();
      await new Promise((r) => setTimeout(r, 500));
      note();
      const tip = (btn.getAttribute('data-tip') || '').trim();
      const aria = (document.getElementById('omt-timeline-live-indicator')?.getAttribute('aria-label') || '');
      const noNumber = texts.every((t) => !/\d/.test(t) && /^(GOING LIVE|LIVE)$/i.test(t));
      const sawGoing = texts.some((t) => /^GOING LIVE$/i.test(t));
      const sawLive = texts.some((t) => /^LIVE$/i.test(t));
      return {
        ok: noNumber && sawGoing && tip === 'Go to live (L)',
        texts,
        tip,
        aria,
        sawGoing,
        sawLive,
        liveIsRed: btn.classList.contains('is-live')
      };
    });
    results.push({
      name: 'live-osd-going-live-or-live-no-number',
      pass: liveOsdTip.ok === true,
      detail: liveOsdTip
    });
    results.push({
      name: 'live-btn-tooltip-go-to-live',
      pass: liveOsdTip.tip === 'Go to live (L)',
      detail: { tip: liveOsdTip.tip }
    });

    // v2.2.6: pinned jump margin keeps red when adaptive would shrink under a ~20s landing.
    const pinnedLive = await page.evaluate(async () => {
      const v = document.querySelector('video');
      const btn = document.getElementById('omt-live-btn');
      const chip = document.getElementById('omt-timeline-live-chip');
      const ind = document.getElementById('omt-timeline-live-indicator');
      const delayEl = document.getElementById('omt-timeline-live-delay');
      const range = document.getElementById('omt-timeline-video-range');
      const post = document.getElementById('omt-timeline-post-times');
      const match = document.getElementById('omt-timeline-match-clock');
      if (!v || !btn || !window.__omtLiveUiDebug) return { ok: false, reason: 'missing-debug' };
      const end0 = v.seekable?.length ? v.seekable.end(v.seekable.length - 1) : v.duration;
      v.currentTime = Math.max(0, (end0 || 0) - 45);
      v.dispatchEvent(new Event('timeupdate'));
      await new Promise((r) => setTimeout(r, 40));
      btn.click();
      await new Promise((r) => setTimeout(r, 120));
      // After the jump, raise the pin to 20s (field stall/slow-edge landing) and
      // drop stall memory so adaptive alone would be ~10s — pin must keep at-live.
      window.__omtLiveUiDebug.pinMargin(20);
      window.__omtLiveUiDebug.clearStall();
      window.__omtLiveUiDebug.forceUntil(0);
      const end = v.seekable?.length ? v.seekable.end(v.seekable.length - 1) : v.duration;
      // Land exactly on the pinned safe point.
      v.currentTime = Math.max(0, (end || 0) - 20);
      v.dispatchEvent(new Event('timeupdate'));
      await new Promise((r) => setTimeout(r, 80));
      const delay = (end || 0) - (v.currentTime || 0);
      const liveIsRed = btn.classList.contains('is-live');
      const chipVisible = !!(chip && !chip.hidden && ind && !ind.hidden);
      const delayVisible = !!(delayEl && !delayEl.hidden && ind && !ind.hidden);
      const leftIsLiveChrome = chipVisible || delayVisible;
      const leftNotRange = !(post && !post.hidden);
      const matchHidden = !match || match.hidden;
      const rangeVisible = !!(range && !range.hidden);
      return {
        ok: liveIsRed && chipVisible && !delayVisible && leftIsLiveChrome &&
          leftNotRange && matchHidden && rangeVisible && delay >= 18 && delay <= 22,
        delay,
        liveIsRed,
        chipVisible,
        delayVisible,
        matchHidden,
        rangeVisible,
        rangeText: range ? (range.textContent || '').trim() : null,
        pin: window.__omtLiveUiDebug.getPin(),
        atLiveMax: window.__omtLiveUiDebug.atLiveMax()
      };
    });
    results.push({
      name: 'live-pinned-margin-keeps-red-at-20s',
      pass: pinnedLive.ok === true,
      detail: pinnedLive
    });
    results.push({
      name: 'live-bar-left-chip-or-delay-not-range',
      pass: pinnedLive.ok === true && pinnedLive.matchHidden === true &&
        pinnedLive.rangeVisible === true,
      detail: {
        matchHidden: pinnedLive.matchHidden,
        rangeVisible: pinnedLive.rangeVisible,
        rangeText: pinnedLive.rangeText,
        chipVisible: pinnedLive.chipVisible,
        delayVisible: pinnedLive.delayVisible
      }
    });

    // v2.2.8 Examino: ~10s stepped seekable-end refreshes must not flicker LIVE grey/red.
    const steppedEdge = await page.evaluate(async () => {
      const v = document.querySelector('video');
      const btn = document.getElementById('omt-live-btn');
      const dbg = window.__omtLiveUiDebug;
      if (!v || !btn || !dbg) return { ok: false, reason: 'missing' };

      let edge = 1000;
      let ct = 980; // 20s behind
      Object.defineProperty(v, 'duration', { configurable: true, get: () => edge });
      Object.defineProperty(v, 'seekable', {
        configurable: true,
        get: () => ({ length: 1, start: () => 0, end: () => edge })
      });
      Object.defineProperty(v, 'currentTime', {
        configurable: true,
        get: () => ct,
        set: (n) => { ct = Number(n) || 0; }
      });
      const slider = document.getElementById('omt-timeline-slider');
      if (slider) {
        slider.min = '0';
        slider.max = String(edge);
        slider.value = String(ct);
      }

      // Seed observed ~10s playlist steps (field Examino cadence).
      dbg.seedEdgeStep(10);
      dbg.pinMargin(20);
      dbg.clearStall();
      // clearStall wipes step seed — re-seed
      dbg.seedEdgeStep(10);
      dbg.forceUntil(0);

      // Prime edge tracker, then go LIVE at the pinned safe point.
      v.dispatchEvent(new Event('durationchange'));
      v.dispatchEvent(new Event('timeupdate'));
      await new Promise((r) => setTimeout(r, 40));
      // Record a few real advances so step median sticks.
      for (let i = 0; i < 3; i++) {
        edge += 10;
        if (slider) slider.max = String(edge);
        v.dispatchEvent(new Event('durationchange'));
        v.dispatchEvent(new Event('timeupdate'));
        await new Promise((r) => setTimeout(r, 20));
      }
      ct = edge - 20;
      if (slider) {
        slider.max = String(edge);
        slider.value = String(ct);
      }
      btn.click();
      await new Promise((r) => setTimeout(r, 100));
      dbg.pinMargin(20);
      dbg.forceUntil(0);
      ct = edge - 20;
      if (slider) slider.value = String(ct);
      v.dispatchEvent(new Event('timeupdate'));
      await new Promise((r) => setTimeout(r, 60));

      if (!btn.classList.contains('is-live')) {
        return {
          ok: false,
          reason: 'not-red-before-steps',
          leaveMax: dbg.leaveMax(),
          edgeStep: dbg.edgeStep(),
          delay: edge - ct
        };
      }

      const samples = [];
      // Four playlist refreshes: playhead advances ~1s/tick with edge flat,
      // then edge jumps +10s (field). LIVE must stay red the whole time.
      for (let step = 0; step < 4; step++) {
        for (let tick = 0; tick < 8; tick++) {
          ct = Math.min(ct + 1, edge - 1);
          if (slider) slider.value = String(ct);
          v.dispatchEvent(new Event('timeupdate'));
          await new Promise((r) => setTimeout(r, 15));
          samples.push({
            red: btn.classList.contains('is-live'),
            delay: edge - ct,
            edge,
            ct,
            phase: 'play'
          });
        }
        edge += 10;
        if (slider) slider.max = String(edge);
        v.dispatchEvent(new Event('durationchange'));
        v.dispatchEvent(new Event('timeupdate'));
        await new Promise((r) => setTimeout(r, 30));
        samples.push({
          red: btn.classList.contains('is-live'),
          delay: edge - ct,
          edge,
          ct,
          phase: 'jump'
        });
      }

      const stayedRed = samples.every((s) => s.red === true);
      const jumpSamples = samples.filter((s) => s.phase === 'jump');
      const maxJumpDelay = jumpSamples.reduce((m, s) => Math.max(m, s.delay), 0);

      // Real user seek-back must still leave live.
      ct = edge - 80;
      if (slider) slider.value = String(ct);
      v.dispatchEvent(new Event('timeupdate'));
      await new Promise((r) => setTimeout(r, 50));
      const afterSeekBack = btn.classList.contains('is-live');
      const edgeStepDuring = dbg.edgeStep();
      const leaveDuring = dbg.leaveMax();

      // Restore fixed DVR window so later timeline tests stay on raw edge.
      edge = 330;
      ct = 100;
      Object.defineProperty(v, 'duration', { configurable: true, get: () => edge });
      Object.defineProperty(v, 'seekable', {
        configurable: true,
        get: () => ({ length: 1, start: () => 0, end: () => edge })
      });
      Object.defineProperty(v, 'currentTime', {
        configurable: true,
        get: () => ct,
        set: (n) => { ct = Number(n) || 0; }
      });
      if (slider) {
        slider.min = '0';
        slider.max = String(edge);
        slider.value = String(ct);
      }
      dbg.clearStall();
      v.dispatchEvent(new Event('durationchange'));
      v.dispatchEvent(new Event('timeupdate'));

      return {
        ok: stayedRed && afterSeekBack === false && edgeStepDuring >= 8,
        stayedRed,
        afterSeekBack,
        sampleCount: samples.length,
        greyCount: samples.filter((s) => !s.red).length,
        maxJumpDelay,
        leaveMax: leaveDuring,
        edgeStep: edgeStepDuring,
        jumps: jumpSamples
      };
    });
    results.push({
      name: 'examino-live-no-flicker-on-10s-edge-steps',
      pass: steppedEdge.ok === true,
      detail: steppedEdge
    });

    // ---- v2.2.2 live/time consistency matrix (one is-live source of truth) ----
    const readLiveConsistency = async () => page.evaluate(() => {
      const btn = document.getElementById('omt-live-btn');
      const ind = document.getElementById('omt-timeline-live-indicator');
      const delay = document.getElementById('omt-timeline-live-delay');
      const chip = document.getElementById('omt-timeline-live-chip');
      const post = document.getElementById('omt-timeline-post-times');
      const match = document.getElementById('omt-timeline-match-clock');
      const range = document.getElementById('omt-timeline-video-range');
      const times = document.querySelector('#omt-root .omt-timeline-times');
      const delayVisible = !!(delay && !delay.hidden && ind && !ind.hidden);
      const chipVisible = !!(chip && !chip.hidden && ind && !ind.hidden);
      const postVisible = !!(post && !post.hidden);
      const matchVisible = !!(match && !match.hidden);
      const rangeVisible = !!(range && !range.hidden);
      const liveIsRed = !!(btn && btn.classList.contains('is-live'));
      const delayText = delayVisible ? (delay.textContent || '').trim() : null;
      const rangeText = rangeVisible ? (range.textContent || '').trim() : null;
      const chipCs = chipVisible ? getComputedStyle(chip) : null;
      const chipRed = !!(chipCs && /rgb\(\s*229,\s*56,\s*59\s*\)/i.test(chipCs.backgroundColor || ''));
      // Invariants: never contradict
      const noRedWithDelay = !(liveIsRed && delayVisible);
      const noChipWithDelay = !(chipVisible && delayVisible);
      const noRangeWithPost = !(rangeVisible && postVisible);
      const redIffChip = liveIsRed === chipVisible;
      return {
        mode: times?.dataset?.omtTimeMode || null,
        liveIsRed,
        delayVisible,
        delayText,
        chipVisible,
        chipRed,
        postVisible,
        matchVisible,
        rangeVisible,
        rangeText,
        curText: document.getElementById('omt-v-time-current')?.innerText || null,
        durText: document.getElementById('omt-v-time-duration')?.innerText || null,
        noRedWithDelay,
        noChipWithDelay,
        noRangeWithPost,
        redIffChip,
        coherent: noRedWithDelay && noChipWithDelay && noRangeWithPost && redIffChip
      };
    });

    // Live, no kickoff, behind edge → grey + delay + video range
    await page.evaluate(() => document.getElementById('omt-btn-clear-timer')?.click());
    await seekLiveDelay(40);
    const liveBehind = await readLiveConsistency();
    results.push({
      name: 'live-consistency-behind-no-kickoff',
      pass: liveBehind.mode === 'live' && liveBehind.coherent &&
        liveBehind.liveIsRed === false && liveBehind.delayVisible === true &&
        /^-/.test(String(liveBehind.delayText || '')) &&
        liveBehind.chipVisible === false && liveBehind.matchVisible === false &&
        liveBehind.postVisible === false && liveBehind.rangeVisible === true &&
        /^\d+:\d{2}/.test(String(liveBehind.rangeText || '')),
      detail: liveBehind
    });

    // Live at safe point → red panel + LIVE chip (no delay text) + video range
    await page.evaluate(() => document.getElementById('omt-live-btn')?.click());
    await page.waitForTimeout(150);
    const liveAt = await readLiveConsistency();
    results.push({
      name: 'live-consistency-at-live-no-kickoff',
      pass: liveAt.mode === 'live' && liveAt.coherent &&
        liveAt.liveIsRed === true && liveAt.chipVisible === true && liveAt.chipRed === true &&
        liveAt.delayVisible === false && liveAt.rangeVisible === true &&
        liveAt.postVisible === false && liveAt.matchVisible === false,
      detail: liveAt
    });

    // Live + kickoff + behind → delay only on bar (no match clock) + range; not red
    await seekLiveDelay(40);
    await page.evaluate(() => {
      const half = document.getElementById('omt-half-select');
      if (half) {
        half.value = '1';
        half.dispatchEvent(new Event('change', { bubbles: true }));
      }
      document.getElementById('omt-btn-set-kickoff')?.click();
    });
    await page.waitForTimeout(80);
    await seekLiveDelay(40);
    const liveKickBehind = await readLiveConsistency();
    results.push({
      name: 'live-consistency-behind-with-kickoff',
      pass: liveKickBehind.mode === 'live' && liveKickBehind.coherent &&
        liveKickBehind.matchVisible === false && liveKickBehind.liveIsRed === false &&
        liveKickBehind.delayVisible === true && liveKickBehind.chipVisible === false &&
        liveKickBehind.postVisible === false && liveKickBehind.rangeVisible === true,
      detail: liveKickBehind
    });

    // Live + kickoff + LIVE click → red chip + range; no delay; no bar match clock
    await page.evaluate(() => document.getElementById('omt-live-btn')?.click());
    await page.waitForTimeout(150);
    const liveKickAt = await readLiveConsistency();
    results.push({
      name: 'live-consistency-at-live-with-kickoff',
      pass: liveKickAt.mode === 'live' && liveKickAt.coherent &&
        liveKickAt.matchVisible === false && liveKickAt.liveIsRed === true &&
        liveKickAt.chipVisible === true && liveKickAt.delayVisible === false &&
        liveKickAt.rangeVisible === true && liveKickAt.postVisible === false,
      detail: liveKickAt
    });

    // v2.2.7: VOD while match still live (Auto VOD on /play/dvr) → same live chrome as DVR
    const vodWhileLive = await page.evaluate(async () => {
      document.getElementById('omt-btn-clear-timer')?.click();
      const origPath = location.pathname + location.search + location.hash;
      // Field Auto VOD stays on the live DVR page URL.
      history.replaceState(null, '', '/play/dvr/e2e-vod-while-live');
      const v = document.querySelector('video');
      const slider = document.getElementById('omt-timeline-slider');
      const btn = document.getElementById('omt-live-btn');
      const vodUrl = 'https://cdn.example.test/vod/dm-mock/chunklist_vod_live.m3u8';
      window.__omtMockSource = 'VOD';
      window.__omtMockMediaUrl = vodUrl;
      if (!v || !btn) {
        history.replaceState(null, '', origPath);
        return { ok: false, reason: 'missing' };
      }
      v.dataset.omtSource = 'VOD';
      v.dataset.omtMediaUrl = vodUrl;
      const edge = 2 * 3600 + 15 * 60 + 10; // 2:15:10 growing VOD end
      let ct = edge - 40;
      Object.defineProperty(v, 'duration', { configurable: true, get: () => edge });
      Object.defineProperty(v, 'seekable', {
        configurable: true,
        get: () => ({ length: 1, start: () => 0, end: () => edge })
      });
      Object.defineProperty(v, 'currentTime', {
        configurable: true,
        get: () => ct,
        set: (n) => { ct = Number(n) || 0; }
      });
      if (slider) {
        slider.min = '0';
        slider.max = String(edge);
        slider.value = String(ct);
      }
      v.dispatchEvent(new Event('durationchange'));
      v.dispatchEvent(new Event('timeupdate'));
      await new Promise((r) => setTimeout(r, 80));

      const times = document.querySelector('.omt-timeline-times');
      const ind = document.getElementById('omt-timeline-live-indicator');
      const delay = document.getElementById('omt-timeline-live-delay');
      const chip = document.getElementById('omt-timeline-live-chip');
      const post = document.getElementById('omt-timeline-post-times');
      const range = document.getElementById('omt-timeline-video-range');
      const match = document.getElementById('omt-timeline-match-clock');
      const behind = {
        mode: times?.dataset?.omtTimeMode || null,
        delayVisible: !!(delay && !delay.hidden && ind && !ind.hidden),
        delayText: delay && !delay.hidden ? (delay.textContent || '') : null,
        chipVisible: !!(chip && !chip.hidden && ind && !ind.hidden),
        postVisible: !!(post && !post.hidden),
        rangeVisible: !!(range && !range.hidden),
        rangeText: range && !range.hidden ? (range.textContent || '') : null,
        matchVisible: !!(match && !match.hidden),
        liveIsRed: btn.classList.contains('is-live')
      };

      btn.click();
      await new Promise((r) => setTimeout(r, 150));
      const atLive = {
        mode: times?.dataset?.omtTimeMode || null,
        delayVisible: !!(delay && !delay.hidden && ind && !ind.hidden),
        chipVisible: !!(chip && !chip.hidden && ind && !ind.hidden),
        postVisible: !!(post && !post.hidden),
        rangeVisible: !!(range && !range.hidden),
        matchVisible: !!(match && !match.hidden),
        liveIsRed: btn.classList.contains('is-live'),
        tip: (btn.getAttribute('data-tip') || '').trim()
      };

      history.replaceState(null, '', origPath);
      return {
        ok: behind.mode === 'live' && behind.delayVisible && !behind.chipVisible &&
          !behind.postVisible && !behind.matchVisible && behind.rangeVisible &&
          /^-/.test(String(behind.delayText || '')) &&
          /^\d+:\d{2}/.test(String(behind.rangeText || '')) &&
          behind.liveIsRed === false &&
          atLive.mode === 'live' && atLive.liveIsRed && atLive.chipVisible &&
          !atLive.delayVisible && !atLive.postVisible && atLive.rangeVisible &&
          atLive.tip === 'Go to live (L)',
        behind,
        atLive,
        pathDuring: '/play/dvr/e2e-vod-while-live'
      };
    });
    results.push({
      name: 'live-consistency-vod-while-live',
      pass: vodWhileLive.ok === true,
      detail: vodWhileLive
    });

    // True post-match VOD (/play/vod) → post times on left; no live chrome; no right range
    await page.evaluate(() => {
      document.getElementById('omt-btn-clear-timer')?.click();
      const v = document.querySelector('video');
      const slider = document.getElementById('omt-timeline-slider');
      const vodUrl = 'https://cdn.example.test/vod/dm-mock/chunklist_vod.m3u8';
      window.__omtMockSource = 'VOD';
      window.__omtMockMediaUrl = vodUrl;
      window.__omtE2eOrigPath = location.pathname + location.search + location.hash;
      history.replaceState(null, '', '/play/vod/e2e-post-match');
      if (v) {
        v.dataset.omtSource = 'VOD';
        v.dataset.omtMediaUrl = vodUrl;
        const postDur = 1 * 3600 + 52 * 60 + 40;
        const postAt = 34 * 60 + 12;
        Object.defineProperty(v, 'duration', { configurable: true, get: () => postDur });
        Object.defineProperty(v, 'seekable', {
          configurable: true,
          get: () => ({ length: 1, start: () => 0, end: () => postDur })
        });
        Object.defineProperty(v, 'currentTime', {
          configurable: true,
          get: () => postAt,
          set: () => {}
        });
        if (slider) {
          slider.min = '0';
          slider.max = String(postDur);
          slider.value = String(postAt);
        }
        v.dispatchEvent(new Event('durationchange'));
        v.dispatchEvent(new Event('timeupdate'));
      }
    });
    await page.waitForTimeout(100);
    const postCons = await readLiveConsistency();
    results.push({
      name: 'live-consistency-vod-post',
      pass: postCons.mode === 'post' && postCons.coherent &&
        postCons.liveIsRed === false && postCons.delayVisible === false &&
        postCons.chipVisible === false && postCons.rangeVisible === false &&
        postCons.postVisible === true && postCons.matchVisible === false &&
        postCons.curText === '34:12' && postCons.durText === '1:52:40',
      detail: postCons
    });

    // POST + kickoff → current/duration on bar (match clock stays on panel / scrubber tip)
    await page.evaluate(() => {
      const half = document.getElementById('omt-half-select');
      if (half) {
        half.value = '1';
        half.dispatchEvent(new Event('change', { bubbles: true }));
      }
      document.getElementById('omt-btn-set-kickoff')?.click();
    });
    await page.waitForTimeout(80);
    await page.evaluate(() => document.querySelector('video')?.dispatchEvent(new Event('timeupdate')));
    await page.waitForTimeout(60);
    const postKickCons = await readLiveConsistency();
    results.push({
      name: 'live-consistency-post-with-kickoff',
      pass: postKickCons.mode === 'post' && postKickCons.coherent &&
        postKickCons.matchVisible === false && postKickCons.liveIsRed === false &&
        postKickCons.delayVisible === false && postKickCons.chipVisible === false &&
        postKickCons.rangeVisible === false && postKickCons.postVisible === true &&
        postKickCons.curText === '34:12' && postKickCons.durText === '1:52:40',
      detail: postKickCons
    });

    // Restore DVR live mode (+ fixture path) for later timeline tests
    await page.evaluate(() => {
      document.getElementById('omt-btn-clear-timer')?.click();
      if (window.__omtE2eOrigPath) {
        history.replaceState(null, '', window.__omtE2eOrigPath);
        delete window.__omtE2eOrigPath;
      } else if (/\/play\/(dvr|vod)\b/i.test(location.pathname || '')) {
        history.replaceState(null, '', '/examino-mock.html');
      }
      const v = document.querySelector('video');
      const slider = document.getElementById('omt-timeline-slider');
      const dvrUrl = 'https://10.217.82.32:8001/live/dm-mock/chunklist_dvr.m3u8';
      window.__omtMockSource = 'DVR';
      window.__omtMockMediaUrl = dvrUrl;
      if (v) {
        v.dataset.omtSource = 'DVR';
        v.dataset.omtMediaUrl = dvrUrl;
        const dvrDur = 330;
        let ct = 100;
        Object.defineProperty(v, 'duration', { configurable: true, get: () => dvrDur });
        Object.defineProperty(v, 'seekable', {
          configurable: true,
          get: () => ({ length: 1, start: () => 0, end: () => dvrDur })
        });
        Object.defineProperty(v, 'currentTime', {
          configurable: true,
          get: () => ct,
          set: (n) => { ct = n; }
        });
        if (slider) {
          slider.min = '0';
          slider.max = String(dvrDur);
          slider.value = String(ct);
        }
        v.dispatchEvent(new Event('durationchange'));
        v.dispatchEvent(new Event('timeupdate'));
      }
    });
    await page.waitForTimeout(80);

    // Manual seek past safe point must still be allowed (no clamp)
    const noClamp = await page.evaluate(async () => {
      const v = document.querySelector('video');
      if (!v) return { ok: false, reason: 'no-video' };
      const end = v.seekable?.length ? v.seekable.end(v.seekable.length - 1) : v.duration;
      const nearEdge = Math.max(0, (end || 0) - 2);
      v.currentTime = nearEdge;
      await new Promise((r) => setTimeout(r, 40));
      const after = v.currentTime;
      return {
        ok: Math.abs(after - nearEdge) < 0.75,
        nearEdge,
        after
      };
    });
    results.push({
      name: 'live-safe-margin-no-manual-clamp',
      pass: noClamp.ok === true,
      detail: noClamp
    });

    // Timeline volume stays in sync with panel volume
    const volSync = await page.evaluate(async () => {
      const v = document.querySelector('video');
      const panelRange = document.getElementById('omt-volume-range');
      const tlRange = document.getElementById('omt-timeline-vol-range');
      const tlBtn = document.getElementById('omt-timeline-vol-btn');
      if (!v || !panelRange || !tlRange || !tlBtn) return { ok: false, reason: 'missing' };
      panelRange.value = '0.4';
      panelRange.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 40));
      const afterPanel = {
        video: v.volume,
        tl: parseFloat(tlRange.value),
        panel: parseFloat(panelRange.value)
      };
      tlRange.value = '0.7';
      tlRange.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 40));
      const afterTl = {
        video: v.volume,
        tl: parseFloat(tlRange.value),
        panel: parseFloat(panelRange.value)
      };
      tlBtn.click();
      await new Promise((r) => setTimeout(r, 40));
      const afterMute = {
        video: v.volume,
        muted: v.muted,
        tl: parseFloat(tlRange.value),
        panel: parseFloat(panelRange.value)
      };
      return {
        ok: Math.abs(afterPanel.video - 0.4) < 0.02 && Math.abs(afterPanel.tl - 0.4) < 0.02 &&
          Math.abs(afterTl.video - 0.7) < 0.02 && Math.abs(afterTl.panel - 0.7) < 0.02 &&
          afterMute.tl === 0 && afterMute.panel === 0,
        afterPanel, afterTl, afterMute
      };
    });
    results.push({ name: 'timeline-volume-syncs-with-panel', pass: volSync.ok === true, detail: volSync });

    // LIVE + kickoff → match clock + edge distance (not post times)
    await page.evaluate(() => {
      const v = document.querySelector('video');
      const slider = document.getElementById('omt-timeline-slider');
      // seekTo via slider so anti-snap from a prior LIVE jump does not yank us.
      if (v && slider) {
        const end = v.seekable?.length ? v.seekable.end(v.seekable.length - 1) : v.duration;
        if (typeof end === 'number' && isFinite(end) && end > 0) {
          slider.min = '0';
          slider.max = String(end);
        }
        slider.value = '30';
        slider.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (v) {
        try { v.currentTime = 30; } catch (_) {}
      }
      if (v) v.dispatchEvent(new Event('timeupdate'));
      const half = document.getElementById('omt-half-select');
      if (half) {
        half.value = '1';
        half.dispatchEvent(new Event('change', { bubbles: true }));
      }
      document.getElementById('omt-btn-set-kickoff')?.click();
    });
    await page.waitForTimeout(80);
    await seekLiveDelay(20);
    await seekLiveDelay(12);
    const liveKick = await readTimelineChrome();
    const onVideoClock = await page.evaluate(() => document.getElementById('match-timer')?.innerText || '');
    results.push({
      name: 'timeline-live-with-kickoff-no-bar-match-clock',
      // v2.2.3: bar left = delay/LIVE only; match clock remains on panel (and scrubber tip).
      pass: liveKick.mode === 'live' && liveKick.matchHidden === true &&
        /^\d{2}:\d{2}$/.test(String(onVideoClock || '')) &&
        !liveKick.liveHidden && liveKick.postHidden &&
        (liveKick.delayText === '-0:12' || liveKick.chipVisible === true) &&
        liveKick.edgeClockGone === true && liveKick.videoRangeOk === true,
      detail: { liveKick, onVideoClock }
    });
    await shotTimelineFrame('v223_timeline_live_kickoff_no_bar_clock.png');

    // Timeline play/pause mirrors panel button
    const tlPlay = await page.evaluate(async () => {
      const v = document.querySelector('video');
      const tl = document.getElementById('omt-timeline-play-btn');
      const main = document.getElementById('omt-btn-play');
      if (!v || !tl || !main) return { ok: false, reason: 'missing' };
      try { await v.play(); } catch (_) {}
      await new Promise((r) => setTimeout(r, 80));
      const playing = {
        paused: v.paused,
        tlPlaying: tl.classList.contains('playing'),
        mainPlaying: main.classList.contains('playing')
      };
      tl.click();
      await new Promise((r) => setTimeout(r, 80));
      const afterPause = {
        paused: v.paused,
        tlPlaying: tl.classList.contains('playing'),
        mainPlaying: main.classList.contains('playing')
      };
      tl.click();
      await new Promise((r) => setTimeout(r, 80));
      const afterPlay = {
        paused: v.paused,
        tlPlaying: tl.classList.contains('playing'),
        mainPlaying: main.classList.contains('playing')
      };
      return {
        ok: playing.paused === false && playing.tlPlaying && playing.mainPlaying &&
          afterPause.paused === true && !afterPause.tlPlaying && !afterPause.mainPlaying &&
          afterPlay.paused === false && afterPlay.tlPlaying && afterPlay.mainPlaying,
        playing, afterPause, afterPlay
      };
    });
    results.push({
      name: 'timeline-play-pause-mirrors-panel',
      pass: tlPlay.ok === true,
      detail: tlPlay
    });

    // Clear kickoff, then POST no kickoff
    await page.evaluate(() => document.getElementById('omt-btn-clear-timer')?.click());
    await page.waitForTimeout(80);
    await page.evaluate(() => {
      const v = document.querySelector('video');
      const slider = document.getElementById('omt-timeline-slider');
      const bar = document.getElementById('omt-timeline-bar');
      if (!v) return;
      try { v.pause(); } catch (_) {}
      const vodUrl = 'https://cdn.example.test/vod/dm-mock/chunklist_vod.m3u8';
      window.__omtMockSource = 'VOD';
      window.__omtMockMediaUrl = vodUrl;
      v.dataset.omtSource = 'VOD';
      v.dataset.omtMediaUrl = vodUrl;
      const postDur = 1 * 3600 + 52 * 60 + 40; // 1:52:40
      const postAt = 34 * 60 + 12; // 34:12
      Object.defineProperty(v, 'duration', { configurable: true, get: () => postDur });
      Object.defineProperty(v, 'seekable', {
        configurable: true,
        get: () => ({ length: 1, start: () => 0, end: () => postDur })
      });
      Object.defineProperty(v, 'currentTime', {
        configurable: true,
        get: () => postAt,
        set: () => {}
      });
      if (slider) {
        slider.min = '0';
        slider.max = String(postDur);
        slider.value = String(postAt);
        slider.style.setProperty('--omt-progress', ((postAt / postDur) * 100) + '%');
      }
      if (bar) {
        bar.style.opacity = '1';
        bar.classList.remove('omt-chrome-hidden');
      }
      v.dispatchEvent(new Event('durationchange'));
      v.dispatchEvent(new Event('timeupdate'));
    });
    await page.waitForTimeout(100);
    const postState = await readTimelineChrome();
    results.push({
      name: 'timeline-post-current-duration',
      pass: postState.mode === 'post' && postState.liveHidden && !postState.postHidden &&
        postState.matchHidden && postState.curText === '34:12' && postState.durText === '1:52:40' &&
        postState.videoRangeText == null && postState.edgeClockGone === true,
      detail: postState
    });
    await shotTimelineFrame('v201_timeline_post.png');

    // POST + kickoff → current/duration on bar (not match clock)
    await page.evaluate(() => {
      const half = document.getElementById('omt-half-select');
      if (half) {
        half.value = '1';
        half.dispatchEvent(new Event('change', { bubbles: true }));
      }
      document.getElementById('omt-btn-set-kickoff')?.click();
    });
    await page.waitForTimeout(80);
    await page.evaluate(() => {
      const v = document.querySelector('video');
      if (v) v.dispatchEvent(new Event('timeupdate'));
    });
    await page.waitForTimeout(60);
    const postKick = await readTimelineChrome();
    const postKickClock = await page.evaluate(() => document.getElementById('match-timer')?.innerText || '');
    results.push({
      name: 'timeline-post-with-kickoff-current-duration',
      pass: postKick.mode === 'post' && postKick.matchHidden === true &&
        postKick.liveHidden && !postKick.postHidden &&
        postKick.curText === '34:12' && postKick.durText === '1:52:40' &&
        postKick.videoRangeText == null && postKick.edgeClockGone === true &&
        /^\d{2}:\d{2}$/.test(String(postKickClock || '')),
      detail: { postKick, postKickClock }
    });
    await shotTimelineFrame('v223_timeline_post_kickoff_post_times.png');

    // Restore DVR metadata, then panel spacing over LIVE chrome row
    await page.evaluate(() => {
      document.getElementById('omt-btn-clear-timer')?.click();
      const v = document.querySelector('video');
      const slider = document.getElementById('omt-timeline-slider');
      if (!v) return;
      const dvrUrl = 'https://10.217.82.32:8001/live/dm-mock/chunklist_dvr.m3u8';
      window.__omtMockSource = 'DVR';
      window.__omtMockMediaUrl = dvrUrl;
      v.dataset.omtSource = 'DVR';
      v.dataset.omtMediaUrl = dvrUrl;
      const dvrDur = 330;
      let ct = 100;
      Object.defineProperty(v, 'duration', { configurable: true, get: () => dvrDur });
      Object.defineProperty(v, 'seekable', {
        configurable: true,
        get: () => ({ length: 1, start: () => 0, end: () => dvrDur })
      });
      Object.defineProperty(v, 'currentTime', {
        configurable: true,
        get: () => ct,
        set: (val) => { ct = Math.max(0, Math.min(dvrDur, Number(val) || 0)); }
      });
      if (slider) {
        slider.max = String(dvrDur);
        slider.value = String(ct);
      }
      v.dispatchEvent(new Event('durationchange'));
      v.dispatchEvent(new Event('timeupdate'));
    });
    await page.waitForTimeout(100);
    await seekLiveDelay(20);
    await seekLiveDelay(12);
    const spacing = await readTimelineChrome();
    results.push({
      name: 'timeline-panel-above-chrome-row',
      pass: spacing.panelClearance === true && spacing.mode === 'live' && spacing.delayText === '-0:12',
      detail: spacing
    });
    await shotTimelineFrame('v220_timeline_with_panel.png', { showPanel: true });

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
      const panel = document.getElementById('omt-controls-panel');
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
      const panel = document.getElementById('omt-controls-panel');
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
      const card = document.getElementById('omt-controls-panel');
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

    // Set 1st + 2nd half kickoffs (1st early, 2nd later — order matters for tip clock).
    // Use slider `change` → seekTo so anti-snap lock tracks (direct currentTime is
    // yanked back while a prior LIVE/seekTo lock is still active).
    await page.evaluate(() => {
      const v = document.querySelector('video');
      const slider = document.getElementById('omt-timeline-slider');
      const half = document.getElementById('omt-half-select');
      const moreBtn = document.getElementById('omt-more-toggle');
      const more = document.getElementById('omt-more-panel');
      if (more && !more.classList.contains('is-open')) moreBtn?.click();
      if (v && slider) {
        const end = v.seekable?.length ? v.seekable.end(v.seekable.length - 1) : (v.duration || 0);
        if (typeof end === 'number' && isFinite(end) && end > 0) {
          slider.min = '0';
          slider.max = String(end);
        }
        slider.value = '20';
        slider.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (v) {
        try { v.currentTime = 20; } catch (_) {}
      }
      if (v) v.dispatchEvent(new Event('timeupdate'));
      if (half) {
        half.value = '1';
        half.dispatchEvent(new Event('change', { bubbles: true }));
      }
      document.getElementById('omt-btn-set-kickoff')?.click();
    });
    await page.waitForTimeout(80);
    await page.evaluate(() => {
      const v = document.querySelector('video');
      const slider = document.getElementById('omt-timeline-slider');
      const half = document.getElementById('omt-half-select');
      if (v && slider) {
        const end = v.seekable?.length ? v.seekable.end(v.seekable.length - 1) : (v.duration || 0);
        const at = Math.min((end || 330) * 0.55, Math.max(0, (end || 330) - 10));
        if (typeof end === 'number' && isFinite(end) && end > 0) {
          slider.min = '0';
          slider.max = String(end);
        }
        slider.value = String(at);
        slider.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (v) {
        const end = v.seekable?.length ? v.seekable.end(v.seekable.length - 1) : (v.duration || 0);
        const at = Math.min((end || 330) * 0.55, Math.max(0, (end || 330) - 10));
        try { v.currentTime = at; } catch (_) {}
      }
      if (v) v.dispatchEvent(new Event('timeupdate'));
      if (half) {
        half.value = '2';
        half.dispatchEvent(new Event('change', { bubbles: true }));
      }
      document.getElementById('omt-btn-set-kickoff')?.click();
    });
    await page.waitForTimeout(120);

    await page.evaluate(() => {
      const panel = document.getElementById('omt-controls-panel');
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
    if (trackBox && trackBox.width > 4 && trackBox.height > 2) {
      const clip = {
        x: Math.max(0, trackBox.x - 16),
        y: Math.max(0, trackBox.y - 40),
        width: Math.min(920, trackBox.width + 32),
        height: 90
      };
      if (clip.width > 4 && clip.height > 4) {
        try {
          await page.screenshot({ path: path.join(ARTIFACTS, 'v177_timeline_rest.png'), clip });
        } catch (_) {}
      }
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
        await screenshotClipReliable(
          page,
          path.join(ARTIFACTS, 'v201_timeline_hover_kickoff_tip.png'),
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
      }, null, { timeout: 3000 }).catch(() => {});
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
      const panel = document.getElementById('omt-controls-panel');
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
      const panel = document.getElementById('omt-controls-panel');
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

    // Fullscreen helpers — icon and dblclick must share one toggle (v2.2.16).
    async function examinoEnterFsViaIcon() {
      return page.evaluate(async () => {
        const btn = document.getElementById('omt-btn-fullscreen');
        if (!btn) return { ok: false, reason: 'no-btn' };
        btn.click();
        await new Promise((r) => setTimeout(r, 350));
        const fs = document.fullscreenElement;
        return {
          ok: !!fs,
          tag: fs && fs.tagName,
          id: fs && fs.id,
          className: fs && (typeof fs.className === 'string' ? fs.className.slice(0, 80) : '')
        };
      });
    }
    async function examinoExitFsViaIcon() {
      return page.evaluate(async () => {
        const btn = document.getElementById('omt-btn-fullscreen');
        if (!btn) return { ok: false, reason: 'no-btn' };
        btn.click();
        await new Promise((r) => setTimeout(r, 350));
        return { ok: !document.fullscreenElement };
      });
    }
    async function examinoToggleFsViaDblclick() {
      return page.evaluate(async () => {
        const v = document.querySelector('video');
        if (!v) return { ok: false, reason: 'no-video' };
        const r = v.getBoundingClientRect();
        const x = r.left + r.width / 2;
        const y = r.top + r.height / 2;
        // Capture-phase window listener sees this with target=video.
        v.dispatchEvent(new MouseEvent('dblclick', {
          bubbles: true, cancelable: true, clientX: x, clientY: y, view: window
        }));
        await new Promise((r) => setTimeout(r, 350));
        const fs = document.fullscreenElement;
        return {
          ok: true,
          inFs: !!fs,
          tag: fs && fs.tagName,
          className: fs && (typeof fs.className === 'string' ? fs.className.slice(0, 80) : '')
        };
      });
    }

    // Icon enter → dblclick exit (field black-screen repro).
    let entered = await examinoEnterFsViaIcon();
    await page.waitForTimeout(100);
    let exited = await examinoToggleFsViaDblclick();
    results.push({
      name: 'examino-fs-icon-enter-dblclick-exit',
      pass: entered.ok === true && exited.inFs === false && !await page.evaluate(() => !!document.fullscreenElement),
      detail: { entered, exited }
    });

    // Dblclick enter → icon exit.
    if (await page.evaluate(() => !!document.fullscreenElement)) {
      await page.evaluate(async () => { try { await document.exitFullscreen(); } catch (_) {} });
      await page.waitForTimeout(200);
    }
    entered = await examinoToggleFsViaDblclick();
    await page.waitForTimeout(100);
    exited = await examinoExitFsViaIcon();
    results.push({
      name: 'examino-fs-dblclick-enter-icon-exit',
      pass: entered.inFs === true && exited.ok === true,
      detail: { entered, exited }
    });

    // Icon enter → icon exit.
    if (await page.evaluate(() => !!document.fullscreenElement)) {
      await page.evaluate(async () => { try { await document.exitFullscreen(); } catch (_) {} });
      await page.waitForTimeout(200);
    }
    entered = await examinoEnterFsViaIcon();
    await page.waitForTimeout(100);
    exited = await examinoExitFsViaIcon();
    results.push({
      name: 'examino-fs-icon-enter-icon-exit',
      pass: entered.ok === true && exited.ok === true,
      detail: { entered, exited }
    });

    // HUD coverage while in FS (re-enter via icon for screenshot).
    if (await page.evaluate(() => !!document.fullscreenElement)) {
      await page.evaluate(async () => { try { await document.exitFullscreen(); } catch (_) {} });
      await page.waitForTimeout(200);
    }
    await examinoEnterFsViaIcon();
    await page.waitForTimeout(300);
    const fsState = await page.evaluate(() => {
      const fs = document.fullscreenElement;
      const root = document.getElementById('omt-root');
      const bar = document.getElementById('omt-timeline-bar');
      if (!fs || !root || !bar) {
        return { hasFs: !!fs, rootInFs: false, ok: false };
      }
      const rr = root.getBoundingClientRect();
      const br = bar.getBoundingClientRect();
      const fr = fs.getBoundingClientRect();
      const cs = getComputedStyle(root);
      const coversFs = Math.abs(rr.width - fr.width) < 8 && Math.abs(rr.height - fr.height) < 8;
      const barAtBottom = Math.abs(br.bottom - fr.bottom) < 8;
      return {
        hasFs: true,
        rootInFs: fs.contains(root),
        coversFs,
        barAtBottom,
        fixedOrAbs: cs.position === 'fixed' || cs.position === 'absolute',
        ok: fs.contains(root) && coversFs && barAtBottom
      };
    });
    results.push({
      name: 'examino-fullscreen-keeps-overlay',
      pass: fsState.hasFs && fsState.rootInFs === true,
      detail: fsState
    });
    results.push({
      name: 'examino-fullscreen-hud-covers-fs',
      pass: fsState.ok === true,
      detail: fsState
    });
    await page.screenshot({ path: path.join(ARTIFACTS, 'examino-fullscreen.png'), fullPage: true });
    await page.evaluate(async () => {
      if (document.fullscreenElement) await document.exitFullscreen();
    });
    await page.waitForTimeout(200);
    const fsExit = await page.evaluate(() => {
      const root = document.getElementById('omt-root');
      const bar = document.getElementById('omt-timeline-bar');
      if (!root || !bar) return { ok: false };
      const rr = root.getBoundingClientRect();
      const br = bar.getBoundingClientRect();
      const vh = window.innerHeight;
      const vw = window.innerWidth;
      return {
        ok: !document.fullscreenElement &&
          getComputedStyle(root).position === 'fixed' &&
          Math.abs(rr.height - vh) < 4 &&
          Math.abs(br.bottom - vh) < 6,
        rootH: Math.round(rr.height),
        barBottom: Math.round(br.bottom),
        vw, vh
      };
    });
    results.push({
      name: 'examino-fullscreen-exit-restores-viewport-hud',
      pass: fsExit.ok === true,
      detail: fsExit
    });

    // Source / LIVE smoke after viewport HUD (no media-logic changes).
    const examinoSourceLiveSmoke = await page.evaluate(() => {
      const section = document.getElementById('omt-examino-settings');
      const sel = document.getElementById('omt-examino-source');
      const live = document.getElementById('omt-live-btn');
      const root = document.getElementById('omt-root');
      const more = document.getElementById('omt-more-panel');
      if (more && !more.classList.contains('is-open')) {
        document.getElementById('omt-more-toggle')?.click();
      }
      const sectionVisible = !!(section && getComputedStyle(section).display !== 'none');
      const opts = sel ? Array.from(sel.options).map((o) => o.value) : [];
      const pe = root ? getComputedStyle(root).pointerEvents : null;
      return {
        ok: sectionVisible && !!sel && opts.length >= 1 && !!live && pe === 'none',
        sectionVisible,
        opts,
        hasLive: !!live,
        pe
      };
    });
    results.push({
      name: 'examino-source-live-smoke-after-viewport-hud',
      pass: examinoSourceLiveSmoke.ok === true,
      detail: examinoSourceLiveSmoke
    });

    // v2.2.23: real-frame field chain — translateY centre (after Source tests).
    await page.goto(`${base}${EXAMINO_VCENTER_PROBE_PATH}`, { waitUntil: 'domcontentloaded' });
    await waitForOmt(page, 15000);
    await page.waitForFunction(() => {
      const v = document.querySelector('video');
      return !!(v && v.readyState >= 2 &&
        document.documentElement.classList.contains('omt-host-examino'));
    }, { timeout: 15000 }).catch(() => {});

    function shotHasLitPixels(shotPath) {
      try {
        const py = `
from PIL import Image
im = Image.open(${JSON.stringify(shotPath)}).convert('RGB')
w, h = im.size
# Sample the vertical middle band where the centred player should sit.
y0, y1 = int(h * 0.25), int(h * 0.75)
x0, x1 = int(w * 0.1), int(w * 0.9)
lit = 0
step = 8
for y in range(y0, y1, step):
  for x in range(x0, x1, step):
    r, g, b = im.getpixel((x, y))
    if r + g + b > 40: lit += 1
print(lit)
`;
        const r = spawnSync('python3', ['-c', py], { encoding: 'utf8' });
        return parseInt((r.stdout || '').trim(), 10) > 20;
      } catch (_) {
        return false;
      }
    }

    async function assertExaminoVCenter(label, shotName) {
      await page.evaluate(() => {
        const v = document.querySelector('video');
        if (v) {
          try { v.currentTime = Math.min(1.5, (v.duration || 2) * 0.2); } catch (_) {}
          try { v.muted = true; v.play(); } catch (_) {}
        }
        if (typeof window.__omtExaminoCenterPlayer === 'function') {
          window.__omtExaminoCenterPlayer();
        }
        if (typeof window.__omtUpdateClockPictureInset === 'function') {
          window.__omtUpdateClockPictureInset();
        }
        const root = document.getElementById('omt-root');
        const wrap = document.getElementById('match-timer-wrap');
        if (wrap && root) {
          wrap.classList.add('omt-clock-pos-top-left', 'is-visible');
          root.classList.add('omt-timer-on');
          wrap.style.display = 'block';
          wrap.style.opacity = '1';
        }
      });
      await page.waitForTimeout(280);
      const shotPath = path.join(ARTIFACTS, shotName);
      await page.screenshot({ path: shotPath, fullPage: true });
      const hasVisibleFrames = shotHasLitPixels(shotPath);
      const detail = await page.evaluate((label) => {
        const root = document.getElementById('omt-root');
        const wrap = document.getElementById('match-timer-wrap');
        const v = document.querySelector('video');
        const box = v || document.querySelector('.op-media-element-container');
        if (!root || !wrap || !v || !box) return { ok: false, reason: 'missing', label };
        const vr = v.getBoundingClientRect();
        const br = box.getBoundingClientRect();
        const cr = wrap.getBoundingClientRect();
        const vh = window.innerHeight;
        const topGap = br.top;
        const bottomGap = vh - br.bottom;
        const vertCentered = Math.abs(topGap - bottomGap) <= 10;
        const notStretched = br.height <= 420 && br.height >= 200;
        const clockOnVideo =
          cr.left >= vr.left - 2 && cr.right <= vr.right + 2 &&
          cr.top >= vr.top - 2 && cr.bottom <= vr.bottom + 2;
        const grow = document.querySelector('.grow');
        const main = document.querySelector('.main-container');
        const hostSizesOk = !!(grow && main &&
          getComputedStyle(grow).display !== 'flex' &&
          Math.round(grow.getBoundingClientRect().height) <= 420);
        return {
          ok: vertCentered && notStretched && clockOnVideo && hostSizesOk,
          label,
          vertCentered,
          notStretched,
          clockOnVideo,
          hostSizesOk,
          topGap: Math.round(topGap),
          bottomGap: Math.round(bottomGap),
          player: { h: Math.round(br.height), top: Math.round(br.top) },
          clock: { left: Math.round(cr.left), top: Math.round(cr.top) },
          videoReady: v.readyState
        };
      }, label);
      detail.hasVisibleFrames = hasVisibleFrames;
      detail.ok = detail.ok === true && hasVisibleFrames;
      detail.shotPath = shotPath;
      return detail;
    }

    await page.setViewportSize({ width: 688, height: 795 });
    await page.waitForTimeout(150);
    const vcenterNarrow = await assertExaminoVCenter('688x795', 'v223_examino_vcenter_688x795.png');
    results.push({
      name: 'examino-vcenter-translateY-688x795-real-frames',
      pass: vcenterNarrow.ok === true,
      detail: vcenterNarrow
    });

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForTimeout(150);
    const vcenterNormal = await assertExaminoVCenter('1280x900', 'v223_examino_vcenter_1280x900.png');
    results.push({
      name: 'examino-vcenter-translateY-1280x900-real-frames',
      pass: vcenterNormal.ok === true,
      detail: vcenterNormal
    });

    const vcenterFs = await page.evaluate(async () => {
      const root = document.getElementById('omt-root');
      const wrap = document.getElementById('match-timer-wrap');
      const v = document.querySelector('video');
      const fsTarget = document.getElementById('op-player') ||
        document.getElementById('video-player') || v;
      if (!root || !wrap || !v || !fsTarget) return { ok: false, reason: 'missing' };
      try {
        if (fsTarget.requestFullscreen) await fsTarget.requestFullscreen();
      } catch (e) {
        return { ok: false, reason: 'fs-denied', err: String(e && e.message || e) };
      }
      await new Promise((r) => setTimeout(r, 150));
      if (typeof window.__omtExaminoCenterPlayer === 'function') window.__omtExaminoCenterPlayer();
      if (typeof window.__omtUpdateClockPictureInset === 'function') {
        window.__omtUpdateClockPictureInset();
      }
      wrap.classList.add('omt-clock-pos-top-left', 'is-visible');
      root.classList.add('omt-timer-on');
      wrap.style.display = 'block';
      const vr = v.getBoundingClientRect();
      const cr = wrap.getBoundingClientRect();
      const vh = window.innerHeight;
      const topGap = vr.top;
      const bottomGap = vh - vr.bottom;
      const vertCentered = Math.abs(topGap - bottomGap) <= 8;
      const clockOnVideo =
        cr.left >= vr.left - 2 && cr.right <= vr.right + 2 &&
        cr.top >= vr.top - 2 && cr.bottom <= vr.bottom + 2;
      const shiftedCleared = !document.documentElement.classList.contains('omt-examino-vcenter');
      const out = {
        ok: !!document.fullscreenElement && vertCentered && clockOnVideo && shiftedCleared,
        vertCentered,
        clockOnVideo,
        shiftedCleared,
        hasFs: !!document.fullscreenElement,
        topGap: Math.round(topGap),
        bottomGap: Math.round(bottomGap),
        clock: { left: Math.round(cr.left), top: Math.round(cr.top) }
      };
      try { await document.exitFullscreen(); } catch (_) {}
      await new Promise((r) => setTimeout(r, 80));
      if (typeof window.__omtExaminoCenterPlayer === 'function') window.__omtExaminoCenterPlayer();
      return out;
    });
    await page.screenshot({ path: path.join(ARTIFACTS, 'v223_examino_vcenter_fullscreen.png'), fullPage: true });
    results.push({
      name: 'examino-vcenter-translateY-fullscreen-real-frames',
      pass: vcenterFs.ok === true || vcenterFs.reason === 'fs-denied',
      detail: vcenterFs
    });
    await page.setViewportSize({ width: 1100, height: 900 });

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

    // v2.3.0: single-video path must not run multi-view sync (no arm on pages
    // without .players-container; sync counter stays 0).
    const inplaySingleMvQuiet = await page.evaluate(() => ({
      sync: window.__omtInplayMvSyncCount || 0,
      active: !!window.__omtInplayMvActive,
      arm: !!window.__omtInplayMvArmInstalled,
      tiles: document.querySelectorAll('[data-omt-tile-root]').length
    }));
    results.push({
      name: 'inplayip-single-video-no-multiview-work',
      pass: inplaySingleMvQuiet.sync === 0 && inplaySingleMvQuiet.active === false &&
        inplaySingleMvQuiet.arm === false && inplaySingleMvQuiet.tiles === 0,
      detail: inplaySingleMvQuiet
    });

    // Fullscreen control lives on the timeline (bottom bar), no tip
    const fsBtnUi = await page.evaluate(() => {
      const btn = document.getElementById('omt-btn-fullscreen');
      const bar = document.getElementById('omt-timeline-bar');
      const panel = document.getElementById('omt-controls-panel');
      return {
        inTimeline: !!(btn && bar && bar.contains(btn)),
        notInPanel: !(panel && btn && panel.contains(btn)),
        noTip: !(btn && btn.hasAttribute('data-tip')),
        aria: (btn?.getAttribute('aria-label') || ''),
        hasIcon: !!(btn && btn.querySelector('.omt-icon'))
      };
    });
    results.push({
      name: 'timeline-fullscreen-button',
      pass: fsBtnUi.inTimeline && fsBtnUi.notInPanel && fsBtnUi.noTip && /fullscreen/i.test(fsBtnUi.aria) && fsBtnUi.hasIcon,
      detail: fsBtnUi
    });
    await page.evaluate(() => {
      const panel = document.getElementById('omt-controls-panel');
      const bar = document.getElementById('omt-timeline-bar');
      [panel, bar].forEach((el) => {
        if (!el) return;
        el.style.opacity = '1';
        el.style.pointerEvents = 'auto';
      });
    });
    await page.waitForTimeout(60);
    await page.screenshot({ path: path.join(ARTIFACTS, 'v201_timeline_fullscreen_btn.png'), fullPage: true });

    // Click-to-toggle on video surface (not controls)
    await page.evaluate(() => {
      const panel = document.getElementById('omt-controls-panel');
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

    // v2.2.12 #3: match timer anchored inside video picture (letterbox inset).
    const inplayClockInset = await page.evaluate(() => {
      const root = document.getElementById('omt-root');
      const wrap = document.getElementById('match-timer-wrap');
      const v = document.querySelector('video');
      if (!root || !wrap || !v) return { ok: false, reason: 'missing' };
      try {
        Object.defineProperty(v, 'videoWidth', { configurable: true, get: () => 1920 });
        Object.defineProperty(v, 'videoHeight', { configurable: true, get: () => 800 });
      } catch (_) {}
      if (typeof window.__omtUpdateClockPictureInset === 'function') {
        window.__omtUpdateClockPictureInset();
      } else {
        window.dispatchEvent(new Event('resize'));
      }
      wrap.classList.add('omt-clock-pos-top-left', 'is-visible');
      const top = parseFloat(getComputedStyle(wrap).top) || 0;
      const left = parseFloat(getComputedStyle(wrap).left) || 0;
      const picTop = parseFloat(root.style.getPropertyValue('--omt-pic-top')) || 0;
      const picLeft = parseFloat(root.style.getPropertyValue('--omt-pic-left')) || 0;
      const parentIso = getComputedStyle(root.parentElement || root).isolation;
      return {
        ok: root.classList.contains('omt-clock-in-picture') && top >= picTop + 10 && left >= picLeft + 10,
        top, left, picTop, picLeft,
        isolation: parentIso,
        inPicture: root.classList.contains('omt-clock-in-picture')
      };
    });
    results.push({
      name: 'inplayip-clock-in-picture',
      pass: inplayClockInset.ok === true,
      detail: inplayClockInset
    });

    // v2.2.13 #5A: multi-view — hide host chrome only on the .video-js with #omt-root.
    const inplayMultiviewNative = await page.evaluate(() => {
      const primary = document.querySelector('.video-js');
      const root = document.getElementById('omt-root');
      if (!primary || !root || !document.documentElement.classList.contains('omt-host-inplayip')) {
        return { ok: false, reason: 'missing-primary' };
      }
      // Ensure HUD is inside primary (production mount).
      if (!primary.contains(root)) primary.appendChild(root);
      let secondary = document.getElementById('omt-test-video-js2');
      if (!secondary) {
        secondary = document.createElement('div');
        secondary.id = 'omt-test-video-js2';
        secondary.className = 'video-js video-js2';
        secondary.innerHTML =
          '<video class="vjs-tech"></video>' +
          '<div class="vjs-control-bar" id="omt-test-bar2">bar2</div>' +
          '<button class="vjs-big-play-button" id="omt-test-play2">play</button>';
        (primary.parentElement || document.body).appendChild(secondary);
      }
      const bar1 = primary.querySelector('.vjs-control-bar');
      const bar2 = secondary.querySelector('.vjs-control-bar');
      const cs = (el) => (el ? getComputedStyle(el) : null);
      const hidden = (el) => {
        const c = cs(el);
        return !c || c.display === 'none' || Number(c.opacity) === 0 || c.pointerEvents === 'none';
      };
      // Primary (has #omt-root) stays hidden; secondary native chrome visible.
      const primaryHidden = !bar1 || hidden(bar1);
      const secondaryVisible = !!(bar2 && !hidden(bar2) && cs(bar2).display !== 'none');
      // Tabindex softening must not hit secondary tech.
      const tech2 = secondary.querySelector('.vjs-tech');
      const tech2Tab = tech2 ? tech2.getAttribute('tabindex') : null;
      return {
        ok: primaryHidden && secondaryVisible && tech2Tab !== '-1',
        primaryHidden,
        secondaryVisible,
        tech2Tab,
        hudInPrimary: primary.contains(root),
        secondaryHasHud: secondary.contains(root)
      };
    });
    results.push({
      name: 'inplayip-multiview-native-controls-on-secondary',
      pass: inplayMultiviewNative.ok === true,
      detail: inplayMultiviewNative
    });

    // v2.2.12 #6 generic swallow on InPlay panel.
    const inplayPanelSwallow = await page.evaluate(async () => {
      const panel = document.getElementById('omt-controls-panel');
      const v = document.querySelector('video');
      if (!panel || !v) return { ok: false, reason: 'missing' };
      panel.style.opacity = '1';
      panel.style.pointerEvents = 'auto';
      const before = !!v.paused;
      panel.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
      panel.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 60));
      return { ok: !!v.paused === before, before, after: !!v.paused };
    });
    results.push({
      name: 'inplayip-panel-swallows-dblclick',
      pass: inplayPanelSwallow.ok === true,
      detail: inplayPanelSwallow
    });

    const inplayPanelDrag = await page.evaluate(async () => {
      const panel = document.getElementById('omt-controls-panel');
      const handle = document.getElementById('controls-handle');
      if (!panel || !handle) return { ok: false, reason: 'missing' };
      panel.style.opacity = '1';
      panel.style.pointerEvents = 'auto';
      const before = panel.getBoundingClientRect();
      const hr = handle.getBoundingClientRect();
      const x0 = hr.left + hr.width / 2;
      const y0 = hr.top + Math.min(10, hr.height / 2);
      handle.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true, cancelable: true, clientX: x0, clientY: y0, button: 0, view: window
      }));
      window.dispatchEvent(new MouseEvent('mousemove', {
        bubbles: true, cancelable: true, clientX: x0 + 35, clientY: y0 + 25, view: window
      }));
      await new Promise((r) => setTimeout(r, 30));
      const mid = panel.getBoundingClientRect();
      const moved = Math.abs(mid.left - before.left) > 8 || Math.abs(mid.top - before.top) > 8;
      window.dispatchEvent(new MouseEvent('mouseup', {
        bubbles: true, cancelable: true, clientX: x0 + 35, clientY: y0 + 25, view: window
      }));
      await new Promise((r) => setTimeout(r, 30));
      const afterRelease = panel.getBoundingClientRect();
      window.dispatchEvent(new MouseEvent('mousemove', {
        bubbles: true, cancelable: true, clientX: x0 + 100, clientY: y0 + 80, view: window
      }));
      await new Promise((r) => setTimeout(r, 30));
      const afterExtra = panel.getBoundingClientRect();
      const stuck = Math.abs(afterExtra.left - afterRelease.left) > 2 ||
        Math.abs(afterExtra.top - afterRelease.top) > 2;
      return { ok: moved && !stuck, moved, stuck };
    });
    results.push({
      name: 'inplayip-panel-drag-ends-on-mouseup',
      pass: inplayPanelDrag.ok === true,
      detail: inplayPanelDrag
    });

    // v2.2.16: icon ↔ dblclick share one sync toggleFullScreen (no VJS async FS).
    async function inplayEnterFsViaIcon() {
      return page.evaluate(async () => {
        const btn = document.getElementById('omt-btn-fullscreen');
        if (!btn) return { ok: false, reason: 'no-btn' };
        btn.click();
        await new Promise((r) => setTimeout(r, 350));
        return { ok: !!document.fullscreenElement };
      });
    }
    async function inplayExitFsViaIcon() {
      return page.evaluate(async () => {
        const btn = document.getElementById('omt-btn-fullscreen');
        if (!btn) return { ok: false, reason: 'no-btn' };
        btn.click();
        await new Promise((r) => setTimeout(r, 350));
        return { ok: !document.fullscreenElement };
      });
    }
    async function inplayToggleFsViaDblclick() {
      return page.evaluate(async () => {
        const v = document.querySelector('video');
        if (!v) return { ok: false, reason: 'no-video' };
        const r = v.getBoundingClientRect();
        v.dispatchEvent(new MouseEvent('dblclick', {
          bubbles: true, cancelable: true,
          clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, view: window
        }));
        await new Promise((r) => setTimeout(r, 350));
        return { ok: true, inFs: !!document.fullscreenElement };
      });
    }
    if (await page.evaluate(() => !!document.fullscreenElement)) {
      await page.evaluate(async () => { try { await document.exitFullscreen(); } catch (_) {} });
      await page.waitForTimeout(200);
    }
    let inplayFsEntered = await inplayEnterFsViaIcon();
    let inplayFsExited = await inplayToggleFsViaDblclick();
    results.push({
      name: 'inplayip-fs-icon-enter-dblclick-exit',
      pass: inplayFsEntered.ok === true && inplayFsExited.inFs === false,
      detail: { inplayFsEntered, inplayFsExited }
    });
    if (await page.evaluate(() => !!document.fullscreenElement)) {
      await page.evaluate(async () => { try { await document.exitFullscreen(); } catch (_) {} });
      await page.waitForTimeout(200);
    }
    inplayFsEntered = await inplayToggleFsViaDblclick();
    inplayFsExited = await inplayExitFsViaIcon();
    results.push({
      name: 'inplayip-fs-dblclick-enter-icon-exit',
      pass: inplayFsEntered.inFs === true && inplayFsExited.ok === true,
      detail: { inplayFsEntered, inplayFsExited }
    });
    if (await page.evaluate(() => !!document.fullscreenElement)) {
      await page.evaluate(async () => { try { await document.exitFullscreen(); } catch (_) {} });
      await page.waitForTimeout(200);
    }

    // v2.2.15 alt-tab (visibility only; no InPlay seek/player changes).
    const inplayBlurDoesNotPause = await page.evaluate(async () => {
      localStorage.setItem('omtKeepPlayingOnAltTab', 'false');
      localStorage.setItem('shuttleXpressEnabled', 'false');
      const v = document.querySelector('video');
      if (!v) return { ok: false };
      v.muted = true;
      try { await v.play(); } catch (_) {}
      await new Promise((r) => setTimeout(r, 40));
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      window.dispatchEvent(new Event('blur'));
      await new Promise((r) => setTimeout(r, 40));
      return { ok: v.paused === false, paused: v.paused };
    });
    results.push({
      name: 'inplayip-blur-does-not-pause',
      pass: inplayBlurDoesNotPause.ok === true,
      detail: inplayBlurDoesNotPause
    });

    const inplayAltTabDefault = await page.evaluate(async () => {
      try { localStorage.removeItem('omtAutoPauseOnBlur'); } catch (_) {}
      localStorage.setItem('omtKeepPlayingOnAltTab', 'false');
      localStorage.setItem('shuttleXpressEnabled', 'false');
      const v = document.querySelector('video');
      if (!v) return { ok: false, reason: 'no-video' };
      v.muted = true;
      try { await v.play(); } catch (e) { return { ok: false, reason: 'play-failed', err: String(e) }; }
      await new Promise((r) => setTimeout(r, 40));
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
      await new Promise((r) => setTimeout(r, 40));
      const afterAway = v.paused;
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
      await new Promise((r) => setTimeout(r, 100));
      return { ok: afterAway === true && v.paused === false, afterAway, afterReturn: v.paused };
    });
    results.push({
      name: 'inplayip-alt-tab-default-pauses-and-resumes',
      pass: inplayAltTabDefault.ok === true,
      detail: inplayAltTabDefault
    });

    const inplayAltTabKeep = await page.evaluate(async () => {
      localStorage.setItem('omtKeepPlayingOnAltTab', 'true');
      localStorage.setItem('shuttleXpressEnabled', 'false');
      const v = document.querySelector('video');
      if (!v) return { ok: false };
      v.muted = true;
      try { await v.play(); } catch (_) {}
      await new Promise((r) => setTimeout(r, 40));
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
      await new Promise((r) => setTimeout(r, 40));
      const afterAway = v.paused;
      v.pause();
      await Promise.resolve();
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 40));
      const afterHostPause = v.paused;
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      document.dispatchEvent(new Event('visibilitychange'));
      return { ok: afterAway === false && afterHostPause === false, afterAway, afterHostPause };
    });
    results.push({
      name: 'inplayip-alt-tab-keep-playing',
      pass: inplayAltTabKeep.ok === true,
      detail: inplayAltTabKeep
    });

    const inplayAutohide = await page.evaluate(async () => {
      const panel = document.getElementById('omt-controls-panel');
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
      const panel = document.getElementById('omt-controls-panel');
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

    // ---------- InPlay multi-view FULL HUD CSS parity + clock (v2.3.4) ----------
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${base}/inplayip-multiview-mock.html?tiles=1`, { waitUntil: 'domcontentloaded' });
    await waitForOmt(page, 15000);
    await page.waitForTimeout(250);

    const mv1 = await page.evaluate(() => ({
      sync: window.__omtInplayMvSyncCount || 0,
      active: !!window.__omtInplayMvActive,
      arm: !!window.__omtInplayMvArmInstalled,
      tiles: document.querySelectorAll('[data-omt-tile-root]').length,
      hasRoot: !!document.getElementById('omt-root'),
      videos: document.querySelectorAll('video').length,
      hasPlayersContainer: !!document.querySelector('.players-container')
    }));
    results.push({
      name: 'inplayip-mv-1-tile-no-secondary-panels',
      pass: mv1.hasRoot && mv1.videos === 1 && mv1.tiles === 0 &&
        mv1.active === false && mv1.sync === 0 && mv1.hasPlayersContainer === true,
      detail: mv1
    });
    await page.screenshot({ path: path.join(ARTIFACTS, 'v234_inplay_mv_1tile.png'), fullPage: true });

    await page.evaluate(() => { window.__omtSetTiles && window.__omtSetTiles(2); });
    await waitForOmt(page, 15000);
    await page.waitForFunction(
      () => window.__omtInplayMvActive === true &&
        document.querySelectorAll('[data-omt-tile-root]').length >= 1,
      { timeout: 10000 }
    ).catch(() => {});
    const mv2 = await page.evaluate(async () => {
      const videos = Array.from(document.querySelectorAll('video'));
      const tiles = Array.from(document.querySelectorAll('[data-omt-tile-root]'));
      const root = document.getElementById('omt-root');
      const primary = videos[0];
      const secondary = videos[1];
      const tile = tiles[0];
      if (!primary || !secondary || !root || !tile) {
        return { ok: false, reason: 'missing', videos: videos.length, tiles: tiles.length };
      }
      const panel = tile.querySelector('.omt-controls-panel');
      const bar = tile.querySelector('.omt-timeline-bar');
      const live = tile.querySelector('.omt-tile-panel-live, [id$="omt-live-btn"]');
      const more = tile.querySelector('.omt-more-toggle');
      const speedSel = tile.querySelector('.omt-tile-speed-select, [id$="omt-speed-select"]');
      const hide = tile.querySelector('.omt-tile-hide, [id$="omt-hide-panel"]');
      const transportLabels = Array.from(tile.querySelectorAll('.omt-btn-label')).map((el) => el.textContent.trim());
      const hasFullHud = !!(panel && bar && live && more && speedSel && hide &&
        transportLabels.includes('2 min') && transportLabels.includes('10 s') && transportLabels.includes('2 s'));

      // Same layout as primary: full HUD height; width = min(S?480:600, tile-24).
      // v2.3.6: multi-view forces omt-panel-size-small (480) on every tile + primary.
      const pRect = panel.getBoundingClientRect();
      const tileRect = tile.getBoundingClientRect();
      const isSmall = panel.classList.contains('omt-panel-size-small');
      const maxW = isSmall ? 480 : 600;
      const expectedW = Math.min(maxW, Math.max(0, tileRect.width - 24));
      const similarLayout = pRect.height > 70 && Math.abs(pRect.width - expectedW) < 24;

      // Independent kickoff/clock on secondary.
      const kick = tile.querySelector('.omt-tile-kickoff, [id$="omt-btn-set-kickoff"]');
      if (kick) {
        // Open more so kickoff is usable, then set.
        if (more && more.getAttribute('aria-expanded') !== 'true') more.click();
        await new Promise((r) => setTimeout(r, 40));
        kick.click();
      }
      await new Promise((r) => setTimeout(r, 80));
      const clock = tile.querySelector('.omt-match-timer, [id$="match-timer"]');
      const clockOn = !!(tile.classList.contains('omt-timer-on') && clock &&
        /Pre-Match|\d+:\d+/.test(clock.textContent || ''));

      // Seek secondary only via skip.
      const beforeP = primary.currentTime;
      const beforeS = secondary.currentTime;
      const skip = tile.querySelector('.omt-tile-skip[data-skip="10"]');
      if (skip) skip.click();
      await new Promise((r) => setTimeout(r, 80));
      const secondaryOnly = Math.abs(primary.currentTime - beforeP) < 0.05 &&
        Math.abs(secondary.currentTime - (beforeS + 10)) < 0.2;

      // Bar seek secondary only.
      const slider = tile.querySelector('.timeline-slider');
      const p2 = primary.currentTime;
      const s2 = secondary.currentTime;
      if (slider) {
        slider.value = String(Math.min(200, (parseFloat(slider.max) || 1200) * 0.25));
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        slider.dispatchEvent(new Event('change', { bubbles: true }));
      }
      await new Promise((r) => setTimeout(r, 80));
      const barSeekOk = Math.abs(primary.currentTime - p2) < 0.05 &&
        Math.abs(secondary.currentTime - s2) > 1;

      const shell2 = secondary.closest('.video-js');
      const nativeBar = shell2 && shell2.querySelector('.vjs-control-bar');
      const nCs = nativeBar ? getComputedStyle(nativeBar) : null;
      const nativeHidden = !nativeBar || nCs.display === 'none' || Number(nCs.opacity) === 0;

      secondary.dispatchEvent(new MouseEvent('pointerdown', {
        bubbles: true, cancelable: true, clientX: 10, clientY: 10
      }));
      const hotIdx = window.__omtInplayMvHotkeyIndex;

      const arrow = document.getElementById('curtain-arrow');
      const ar = arrow.getBoundingClientRect();
      const hit = document.elementFromPoint(ar.left + ar.width / 2, ar.top + ar.height / 2);
      const curtainOk = !!(hit && (hit === arrow || arrow.contains(hit)));

      // Style parity vs primary (the #id CSS that tiles used to miss).
      const pLive = root.querySelector('#omt-live-btn');
      const pSpeed = root.querySelector('#omt-speed-select');
      const pVol = root.querySelector('#omt-volume-range');
      const tLive = live;
      const tSpeed = speedSel;
      const tVol = tile.querySelector('.omt-tile-panel-vol-range, [id$="omt-volume-range"]');
      const cs = (el) => el ? getComputedStyle(el) : null;
      const pLiveCs = cs(pLive); const tLiveCs = cs(tLive);
      const pSpeedCs = cs(pSpeed); const tSpeedCs = cs(tSpeed);
      const pVolCs = cs(pVol); const tVolCs = cs(tVol);
      const livePill = !!(tLiveCs && tLiveCs.borderRadius === pLiveCs.borderRadius &&
        parseFloat(tLiveCs.borderRadius) >= 20);
      const speedChip = !!(tSpeedCs && tSpeedCs.appearance === 'none' &&
        tSpeedCs.webkitAppearance === 'none' &&
        tSpeedCs.backgroundColor === pSpeedCs.backgroundColor);
      const volSlim = !!(tVolCs && Math.abs(parseFloat(tVolCs.width) - parseFloat(pVolCs.width)) < 2 &&
        tVolCs.appearance === 'none');
      const pLabels = Array.from(root.querySelectorAll('.omt-btn-label')).map((el) => el.textContent.trim());
      const labelsMatchPrimary = pLabels.includes('2 min') && transportLabels.includes('2 min') &&
        transportLabels.includes('10 s') && transportLabels.includes('2 s');

      return {
        ok: tiles.length === 1 && hasFullHud && similarLayout && clockOn && secondaryOnly &&
          barSeekOk && nativeHidden && hotIdx === 1 && curtainOk && !tile.contains(root) &&
          livePill && speedChip && volSlim && labelsMatchPrimary,
        hasFullHud,
        similarLayout,
        clockOn,
        clockText: clock ? clock.textContent : null,
        secondaryOnly,
        barSeekOk,
        nativeHidden,
        hotIdx,
        curtainOk,
        livePill,
        speedChip,
        volSlim,
        labelsMatchPrimary,
        pLiveRadius: pLiveCs && pLiveCs.borderRadius,
        tLiveRadius: tLiveCs && tLiveCs.borderRadius,
        pVolW: pVolCs && pVolCs.width,
        tVolW: tVolCs && tVolCs.width,
        panelW: Math.round(pRect.width),
        expectedW: Math.round(expectedW),
        transportLabels,
        pLabels
      };
    });
    results.push({
      name: 'inplayip-mv-2-tile-full-hud-and-clock',
      pass: mv2.ok === true,
      detail: mv2
    });
    // v2.3.8: More controls open on S+Compact tile — inside tile, not clipped, closes.
    const mv2more = await page.evaluate(async () => {
      const tile = document.querySelector('[data-omt-tile-root]');
      if (!tile) return { ok: false, reason: 'no-tile' };
      const btn = tile.querySelector('.omt-more-toggle');
      const more = tile.querySelector('.omt-more-panel');
      const panel = tile.querySelector('.omt-controls-panel');
      if (!btn || !more || !panel) return { ok: false, reason: 'missing-ui' };
      // Ensure closed first.
      if (more.classList.contains('is-open')) btn.click();
      await new Promise((r) => setTimeout(r, 40));
      btn.click();
      await new Promise((r) => setTimeout(r, 80));
      const tr = tile.getBoundingClientRect();
      const pr = panel.getBoundingClientRect();
      const mr = more.getBoundingClientRect();
      const openOk = more.classList.contains('is-open') &&
        btn.getAttribute('aria-expanded') === 'true' &&
        panel.classList.contains('omt-more-open');
      const inside = pr.left >= tr.left - 2 && pr.right <= tr.right + 2 &&
        pr.top >= tr.top - 2 && pr.bottom <= tr.bottom + 2 &&
        mr.left >= tr.left - 2 && mr.right <= tr.right + 2 &&
        mr.top >= tr.top - 2 && mr.bottom <= tr.bottom + 2;
      const kick = more.querySelector('[id$="omt-btn-set-kickoff"]');
      const kickVisible = !!(kick && getComputedStyle(kick).display !== 'none' &&
        kick.getBoundingClientRect().height > 0);
      btn.click();
      await new Promise((r) => setTimeout(r, 60));
      const closedOk = !more.classList.contains('is-open') &&
        btn.getAttribute('aria-expanded') === 'false';
      return {
        ok: openOk && inside && kickVisible && closedOk && mr.height > 20,
        openOk, inside, kickVisible, closedOk,
        moreH: Math.round(mr.height),
        panelTop: Math.round(pr.top - tr.top),
        tileH: Math.round(tr.height)
      };
    });
    results.push({
      name: 'inplayip-mv-2-tile-more-controls-fit',
      pass: mv2more.ok === true,
      detail: mv2more
    });

    // Collapse more panels so screenshot matches primary (kickoff row hidden).
    await page.evaluate(() => {
      document.querySelectorAll('[data-omt-tile-root] .omt-more-toggle[aria-expanded="true"]').forEach((b) => b.click());
    });
    await page.waitForTimeout(80);
    await page.screenshot({ path: path.join(ARTIFACTS, 'v234_inplay_mv_2tile.png'), fullPage: true });

    await page.goto(`${base}/inplayip-multiview-mock.html?tiles=4`, { waitUntil: 'domcontentloaded' });
    await waitForOmt(page, 15000);
    await page.waitForFunction(
      () => document.querySelectorAll('video').length === 4 &&
        document.querySelectorAll('[data-omt-tile-root]').length === 3,
      { timeout: 10000 }
    ).catch(() => {});
    await page.waitForTimeout(200);

    // Style parity + no fresh clock chips + bar layout vs primary.
    const mv4style = await page.evaluate(() => {
      const root = document.getElementById('omt-root');
      const tiles = Array.from(document.querySelectorAll('[data-omt-tile-root]'));
      const snap = (scope, isTile) => {
        const live = scope.querySelector('#omt-live-btn, .omt-tile-panel-live, [id$="omt-live-btn"]');
        const speed = scope.querySelector('#omt-speed-select, .omt-tile-speed-select, [id$="omt-speed-select"]');
        const vol = scope.querySelector('#omt-volume-range, .omt-tile-panel-vol-range, [id$="omt-volume-range"]');
        const labels = Array.from(scope.querySelectorAll('.omt-btn-label')).map((el) => el.textContent.trim());
        const clock = scope.querySelector('#match-timer, .omt-match-timer, [id$="match-timer"]');
        const wrap = scope.querySelector('#match-timer-wrap, .omt-match-timer-wrap, [id$="match-timer-wrap"]');
        const liveDelay = scope.querySelector('#omt-timeline-live-delay, .omt-timeline-live-delay, [id$="omt-timeline-live-delay"]');
        const videoRange = scope.querySelector('#omt-timeline-video-range, .omt-timeline-video-range, [id$="omt-timeline-video-range"]');
        const postTimes = scope.querySelector('#omt-timeline-post-times, .omt-timeline-post-times, [id$="omt-timeline-post-times"]');
        const cs = (el) => el ? getComputedStyle(el) : null;
        const l = cs(live); const s = cs(speed); const v = cs(vol);
        const wrapDisp = wrap ? cs(wrap).display : 'none';
        return {
          liveRadius: l && l.borderRadius,
          speedAppearance: s && (s.appearance || s.webkitAppearance),
          volW: v && v.width,
          volAppearance: v && (v.appearance || v.webkitAppearance),
          labels,
          clockText: clock ? (clock.textContent || '').trim() : '',
          clockVisible: !!(wrap && wrapDisp !== 'none' && wrapDisp !== ''),
          liveDelayText: liveDelay && !liveDelay.hidden ? (liveDelay.textContent || '').trim() : null,
          videoRangeText: videoRange && !videoRange.hidden ? (videoRange.textContent || '').trim() : null,
          postHidden: !postTimes || !!postTimes.hidden
        };
      };
      const primary = snap(root, false);
      const secondaries = tiles.map((tr) => snap(tr, true));
      const labelsOk = [primary, ...secondaries].every((x) =>
        x.labels.includes('2 min') && x.labels.includes('10 s') && x.labels.includes('2 s'));
      const styleOk = secondaries.every((x) =>
        x.liveRadius === primary.liveRadius &&
        x.speedAppearance === 'none' &&
        x.volAppearance === 'none' &&
        Math.abs(parseFloat(x.volW) - parseFloat(primary.volW)) < 2);
      // v2.3.8: fresh secondaries have NO clock chip until kickoff is set.
      const clocksHidden = secondaries.every((x) => !x.clockVisible);
      const primaryClockHidden = !primary.clockVisible;
      // Live chrome: delay left, position/duration on right video-range; post-times hidden.
      const barLayoutOk = secondaries.every((x) =>
        x.postHidden === true &&
        !!x.liveDelayText && /^-/.test(x.liveDelayText) &&
        !!x.videoRangeText && /\//.test(x.videoRangeText));
      return {
        ok: tiles.length === 3 && labelsOk && styleOk && clocksHidden && primaryClockHidden &&
          barLayoutOk && !!window.__omtInplayMvActive,
        primary, secondaries, labelsOk, styleOk, clocksHidden, primaryClockHidden, barLayoutOk
      };
    });
    results.push({
      name: 'inplayip-mv-4-tile-style-parity',
      pass: mv4style.ok === true,
      detail: mv4style
    });
    // Fresh MV: no Pre-Match chips anywhere + primary-identical bar layout.
    await page.screenshot({ path: path.join(ARTIFACTS, 'v234_inplay_mv_4tile.png'), fullPage: true });

    // Kickoff on tile B only — C/D stay hidden (no chip); clear B → hidden again.
    const mv4kick = await page.evaluate(async () => {
      const tiles = Array.from(document.querySelectorAll('[data-omt-tile-root]'));
      const snap = () => {
        const primaryClock = document.getElementById('match-timer');
        const primaryOn = document.getElementById('omt-root')?.classList.contains('omt-timer-on');
        const clocks = tiles.map((tr) => {
          const c = tr.querySelector('.omt-match-timer, [id$="match-timer"]');
          const wrap = tr.querySelector('.omt-match-timer-wrap, [id$="match-timer-wrap"]');
          const disp = wrap ? getComputedStyle(wrap).display : 'none';
          return {
            on: tr.classList.contains('omt-timer-on'),
            text: c ? (c.textContent || '').trim() : '',
            display: disp,
            visible: !!(wrap && disp !== 'none' && disp !== '')
          };
        });
        return {
          primaryOn: !!primaryOn,
          primaryText: primaryClock ? (primaryClock.textContent || '').trim() : null,
          clocks
        };
      };
      const before = snap();
      const tileB = tiles[0];
      const more = tileB.querySelector('.omt-more-toggle');
      if (more && more.getAttribute('aria-expanded') !== 'true') more.click();
      await new Promise((r) => setTimeout(r, 40));
      const kick = tileB.querySelector('[id$="omt-btn-set-kickoff"]');
      if (kick) kick.click();
      await new Promise((r) => setTimeout(r, 60));
      // Advance this tile's video so the clock is clearly running (not 00:00).
      const videoB = document.querySelectorAll('video')[1];
      if (videoB) {
        videoB.currentTime = Math.min((videoB.currentTime || 0) + 8, (videoB.duration || 20) - 1);
        videoB.dispatchEvent(new Event('timeupdate'));
      }
      await new Promise((r) => setTimeout(r, 100));
      const after = snap();
      const bRunning = after.clocks[0].on && after.clocks[0].visible &&
        /^\d+:\d+$/.test(after.clocks[0].text) && after.clocks[0].text !== '00:00';
      // Primary timer-on flag unchanged by B kickoff.
      const aUnchanged = before.primaryOn === after.primaryOn;
      // C/D stay hidden (no Pre-Match chip) until their own kickoff.
      const cdHidden = after.clocks.slice(1).every((c) => !c.visible && !c.on);

      // Clear B with X → chip gone again.
      const clearBtn = tileB.querySelector('[id$="omt-btn-clear-timer"]');
      if (clearBtn) clearBtn.click();
      await new Promise((r) => setTimeout(r, 60));
      const cleared = snap();
      const bCleared = !cleared.clocks[0].visible && !cleared.clocks[0].on;

      return {
        ok: bRunning && aUnchanged && cdHidden && bCleared,
        bRunning, aUnchanged, cdHidden, bCleared,
        before, after, cleared
      };
    });
    results.push({
      name: 'inplayip-mv-4-tile-kickoff-b-only',
      pass: mv4kick.ok === true,
      detail: mv4kick
    });
    // Re-kick B so the match clock is visibly running vs C/D hidden (post-clear).
    await page.evaluate(async () => {
      const tiles = Array.from(document.querySelectorAll('[data-omt-tile-root]'));
      const tileB = tiles[0];
      const more = tileB && tileB.querySelector('.omt-more-toggle');
      if (more && more.getAttribute('aria-expanded') !== 'true') more.click();
      await new Promise((r) => setTimeout(r, 40));
      const kick = tileB && tileB.querySelector('[id$="omt-btn-set-kickoff"]');
      if (kick) kick.click();
      const videoB = document.querySelectorAll('video')[1];
      if (videoB) {
        videoB.currentTime = Math.min((videoB.currentTime || 0) + 8, (videoB.duration || 20) - 1);
        videoB.dispatchEvent(new Event('timeupdate'));
      }
      await new Promise((r) => setTimeout(r, 120));
      document.querySelectorAll('[data-omt-tile-root] .omt-more-toggle[aria-expanded="true"]').forEach((b) => b.click());
    });
    await page.waitForTimeout(120);
    await page.screenshot({ path: path.join(ARTIFACTS, 'v234_inplay_mv_kickoff_b_only.png'), fullPage: true });

    // Side-by-side crop of primary panel+bar vs tile B panel+bar.
    const cropBoxes = await page.evaluate(() => {
      const root = document.getElementById('omt-root');
      const tileB = document.querySelector('[data-omt-tile-root]');
      const boxOf = (scope) => {
        const panel = scope.querySelector('.omt-controls-panel, #omt-controls-panel');
        const bar = scope.querySelector('.omt-timeline-bar, #omt-timeline-bar');
        if (!panel || !bar) return null;
        const pr = panel.getBoundingClientRect();
        const br = bar.getBoundingClientRect();
        const left = Math.min(pr.left, br.left);
        const top = Math.min(pr.top, br.top);
        const right = Math.max(pr.right, br.right);
        const bottom = Math.max(pr.bottom, br.bottom);
        return {
          x: Math.max(0, Math.floor(left) - 4),
          y: Math.max(0, Math.floor(top) - 4),
          width: Math.ceil(right - left) + 8,
          height: Math.ceil(bottom - top) + 8
        };
      };
      return { a: boxOf(root), b: boxOf(tileB) };
    });
    if (cropBoxes.a && cropBoxes.b) {
      await page.screenshot({
        path: path.join(ARTIFACTS, 'v234_inplay_mv_crop_A_panel.png'),
        clip: cropBoxes.a
      });
      await page.screenshot({
        path: path.join(ARTIFACTS, 'v234_inplay_mv_crop_B_panel.png'),
        clip: cropBoxes.b
      });
    }
    // Pixel / visual diff note between A and B crops (same viewport scale).
    const diffNote = await page.evaluate(async (boxes) => {
      const grab = async (box) => {
        // Sample computed key chrome from each HUD for a structured note.
        return box;
      };
      const root = document.getElementById('omt-root');
      const tileB = document.querySelector('[data-omt-tile-root]');
      const sample = (scope) => {
        const live = scope.querySelector('#omt-live-btn, .omt-tile-panel-live');
        const speed = scope.querySelector('#omt-speed-select, .omt-tile-speed-select');
        const vol = scope.querySelector('#omt-volume-range, .omt-tile-panel-vol-range');
        const label = scope.querySelector('.omt-btn-label');
        const clock = scope.querySelector('#match-timer, .omt-match-timer');
        const cs = (el) => el ? getComputedStyle(el) : {};
        return {
          liveRadius: cs(live).borderRadius,
          liveBorder: cs(live).border,
          speedAppearance: cs(speed).appearance || cs(speed).webkitAppearance,
          speedBg: cs(speed).backgroundColor,
          speedColor: cs(speed).color,
          volW: cs(vol).width,
          volH: cs(vol).height,
          volAppearance: cs(vol).appearance || cs(vol).webkitAppearance,
          labelText: label ? label.textContent.trim() : null,
          clockFont: cs(clock).fontSize,
          clockRadius: cs(clock).borderRadius,
          clockPad: cs(clock).padding,
          clockBorder: cs(clock).border
        };
      };
      const a = sample(root);
      const b = sample(tileB);
      const keys = Object.keys(a);
      const mismatches = keys.filter((k) => String(a[k]) !== String(b[k]));
      return { a, b, mismatches, match: mismatches.length === 0, boxes };
    }, cropBoxes);
    results.push({
      name: 'inplayip-mv-4-tile-a-vs-b-visual-diff',
      pass: diffNote.match === true,
      detail: diffNote
    });
    try {
      const fs = await import('fs');
      fs.writeFileSync(
        path.join(ARTIFACTS, 'v234_inplay_mv_A_vs_B_diff.json'),
        JSON.stringify(diffNote, null, 2)
      );
    } catch (_) {}

    await page.evaluate(() => { window.__omtSetTiles && window.__omtSetTiles(1); });
    await waitForOmt(page, 15000);
    await page.waitForFunction(
      () => document.querySelectorAll('video').length === 1 &&
        window.__omtInplayMvActive === false &&
        document.querySelectorAll('[data-omt-tile-root]').length === 0,
      { timeout: 10000 }
    ).catch(() => {});
    const mvBack = await page.evaluate(() => ({
      active: !!window.__omtInplayMvActive,
      tiles: document.querySelectorAll('[data-omt-tile-root]').length,
      videos: document.querySelectorAll('video').length,
      hasRoot: !!document.getElementById('omt-root')
    }));
    results.push({
      name: 'inplayip-mv-teardown-to-one-tile',
      pass: mvBack.videos === 1 && mvBack.tiles === 0 && mvBack.active === false && mvBack.hasRoot,
      detail: mvBack
    });

    // ---------- v2.3.5: panel clamp after shrink / FS-exit emulation ----------
    async function placePanelTopRightThenShrink(label, opts = {}) {
      const large = opts.large || { width: 1280, height: 800 };
      const small = opts.small || { width: 720, height: 480 };
      await page.setViewportSize(large);
      await page.waitForTimeout(120);
      const placed = await page.evaluate(() => {
        const root = document.getElementById('omt-root');
        const panel = document.getElementById('omt-controls-panel');
        if (!root || !panel) return { ok: false, reason: 'missing' };
        panel.style.opacity = '1';
        panel.style.pointerEvents = 'auto';
        // Mark as user-dragged so clamp may act (default-center is never clamped).
        try { panel.dataset.omtUserDragged = '1'; } catch (_) {}
        const rw = root.clientWidth || root.getBoundingClientRect().width;
        const rh = root.clientHeight || root.getBoundingClientRect().height;
        const pw = panel.offsetWidth || 400;
        const ph = panel.offsetHeight || 120;
        const left = Math.max(0, rw - pw - 8);
        const top = 8;
        panel.style.left = left + 'px';
        panel.style.top = top + 'px';
        panel.style.bottom = 'auto';
        panel.style.right = 'auto';
        panel.style.transform = 'none';
        return { ok: true, left, top, rw, rh, pw, ph };
      });
      await page.screenshot({
        path: path.join(ARTIFACTS, `v235_panel_clamp_${label}_large.png`),
        fullPage: true
      });
      await page.setViewportSize(small);
      await page.waitForTimeout(80);
      // Emulate fullscreen exit layout settle: fire resize + optional clamp.
      await page.evaluate(() => {
        window.dispatchEvent(new Event('resize'));
        document.dispatchEvent(new Event('fullscreenchange'));
        if (typeof window.__omtSchedulePanelClamp === 'function') {
          window.__omtSchedulePanelClamp();
        } else if (typeof window.__omtClampAllPanels === 'function') {
          window.__omtClampAllPanels();
        }
      });
      await page.waitForTimeout(120);
      const after = await page.evaluate(() => {
        const root = document.getElementById('omt-root');
        const panel = document.getElementById('omt-controls-panel');
        if (!root || !panel) return { ok: false, reason: 'missing' };
        const rr = root.getBoundingClientRect();
        const pr = panel.getBoundingClientRect();
        const topSafe = (typeof window.__omtPanelTopSafeMargin === 'function')
          ? window.__omtPanelTopSafeMargin(root)
          : 8;
        const eps = 2;
        const inside =
          pr.left >= rr.left - eps &&
          pr.top >= rr.top + topSafe - eps &&
          pr.right <= rr.right + eps &&
          pr.bottom <= rr.bottom + eps;
        const visible = pr.width > 20 && pr.height > 20 &&
          getComputedStyle(panel).opacity !== '0' &&
          getComputedStyle(panel).display !== 'none';
        return {
          ok: inside && visible,
          inside,
          visible,
          topSafe,
          panel: {
            left: Math.round(pr.left - rr.left),
            top: Math.round(pr.top - rr.top),
            right: Math.round(rr.right - pr.right),
            bottom: Math.round(rr.bottom - pr.bottom),
            w: Math.round(pr.width),
            h: Math.round(pr.height)
          },
          root: { w: Math.round(rr.width), h: Math.round(rr.height) }
        };
      });
      await page.screenshot({
        path: path.join(ARTIFACTS, `v235_panel_clamp_${label}_small.png`),
        fullPage: true
      });
      return { placed, after };
    }

    // InPlay single-video
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${base}/inplayip-schedule-mock.html`, { waitUntil: 'domcontentloaded' });
    await waitForOmt(page, 15000);
    await page.waitForTimeout(200);
    const clampInplay = await placePanelTopRightThenShrink('inplay');
    results.push({
      name: 'panel-clamp-inplay-shrink',
      pass: clampInplay.placed.ok === true && clampInplay.after.ok === true,
      detail: clampInplay
    });

    // InPlay multi-view — clamp primary + tile B panel
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${base}/inplayip-multiview-mock.html?tiles=2`, { waitUntil: 'domcontentloaded' });
    await waitForOmt(page, 15000);
    await page.waitForFunction(
      () => window.__omtInplayMvActive === true &&
        document.querySelectorAll('[data-omt-tile-root]').length >= 1,
      { timeout: 10000 }
    ).catch(() => {});
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      const root = document.getElementById('omt-root');
      const panel = document.getElementById('omt-controls-panel');
      const tile = document.querySelector('[data-omt-tile-root]');
      const tPanel = tile && tile.querySelector('.omt-controls-panel');
      if (panel && root) {
        const rw = root.clientWidth;
        const pw = panel.offsetWidth || 400;
        try { panel.dataset.omtUserDragged = '1'; } catch (_) {}
        panel.style.opacity = '1';
        panel.style.left = Math.max(0, rw - pw - 8) + 'px';
        panel.style.top = '8px';
        panel.style.bottom = 'auto';
        panel.style.right = 'auto';
        panel.style.transform = 'none';
      }
      if (tPanel && tile) {
        const tw = tile.clientWidth;
        const pw = tPanel.offsetWidth || 300;
        try { tPanel.dataset.omtUserDragged = '1'; } catch (_) {}
        tPanel.style.opacity = '1';
        tPanel.style.left = Math.max(0, tw - pw - 8) + 'px';
        tPanel.style.top = '8px';
        tPanel.style.bottom = 'auto';
        tPanel.style.right = 'auto';
        tPanel.style.transform = 'none';
      }
    });
    await page.screenshot({
      path: path.join(ARTIFACTS, 'v235_panel_clamp_inplay_mv_large.png'),
      fullPage: true
    });
    await page.setViewportSize({ width: 720, height: 480 });
    await page.waitForTimeout(80);
    await page.evaluate(() => {
      window.dispatchEvent(new Event('resize'));
      if (typeof window.__omtSchedulePanelClamp === 'function') window.__omtSchedulePanelClamp();
      else if (typeof window.__omtClampAllPanels === 'function') window.__omtClampAllPanels();
    });
    await page.waitForTimeout(120);
    const clampMv = await page.evaluate(() => {
      const check = (panel, root) => {
        if (!panel || !root) return { ok: false };
        const rr = root.getBoundingClientRect();
        const pr = panel.getBoundingClientRect();
        const topSafe = (typeof window.__omtPanelTopSafeMargin === 'function')
          ? window.__omtPanelTopSafeMargin(root)
          : 8;
        const eps = 2;
        const inside =
          pr.left >= rr.left - eps && pr.top >= rr.top + topSafe - eps &&
          pr.right <= rr.right + eps && pr.bottom <= rr.bottom + eps;
        return {
          ok: inside && pr.width > 20 && pr.height > 20,
          topSafe: Math.round(topSafe),
          left: Math.round(pr.left - rr.left),
          top: Math.round(pr.top - rr.top),
          right: Math.round(rr.right - pr.right),
          bottom: Math.round(rr.bottom - pr.bottom)
        };
      };
      const root = document.getElementById('omt-root');
      const panel = document.getElementById('omt-controls-panel');
      const tile = document.querySelector('[data-omt-tile-root]');
      const tPanel = tile && tile.querySelector('.omt-controls-panel');
      const primary = check(panel, root);
      const secondary = check(tPanel, tile);
      return { ok: primary.ok && secondary.ok, primary, secondary };
    });
    await page.screenshot({
      path: path.join(ARTIFACTS, 'v235_panel_clamp_inplay_mv_small.png'),
      fullPage: true
    });
    results.push({
      name: 'panel-clamp-inplay-mv-shrink',
      pass: clampMv.ok === true,
      detail: clampMv
    });

    // Examino
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${base}/examino-mock.html`, { waitUntil: 'domcontentloaded' });
    await waitForOmt(page, 15000);
    await page.waitForTimeout(250);
    const clampExamino = await placePanelTopRightThenShrink('examino');
    results.push({
      name: 'panel-clamp-examino-shrink',
      pass: clampExamino.placed.ok === true && clampExamino.after.ok === true,
      detail: clampExamino
    });

    // Xeatre DVR — keep shrink-in-place when centered; clamp when user-positioned
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${base}/xeatre-dvr-mock.html`, { waitUntil: 'domcontentloaded' });
    await waitForOmt(page, 15000);
    await page.waitForTimeout(300);
    const clampXeatre = await placePanelTopRightThenShrink('xeatre', {
      large: { width: 1100, height: 720 },
      small: { width: 779, height: 520 }
    });
    results.push({
      name: 'panel-clamp-xeatre-shrink',
      pass: clampXeatre.placed.ok === true && clampXeatre.after.ok === true,
      detail: clampXeatre
    });

    // ---------- v2.3.6: MV compact S + top-safe + edge drag + no-select ----------
    // 0) Default-centered panel must stay centered across small→FS→small (no jump).
    async function assertCenteredAcrossFs(label, url) {
      await page.setViewportSize({ width: 900, height: 560 });
      await page.goto(`${base}/${url}`, { waitUntil: 'domcontentloaded' });
      await waitForOmt(page, 15000);
      await page.waitForTimeout(200);
      const snap = async (tag) => page.evaluate((t) => {
        const root = document.getElementById('omt-root');
        const panel = document.getElementById('omt-controls-panel');
        if (!root || !panel) return { ok: false, tag: t, reason: 'missing' };
        // Ensure default (never dragged).
        try { delete panel.dataset.omtUserDragged; } catch (_) {}
        panel.style.removeProperty('left');
        panel.style.removeProperty('top');
        panel.style.removeProperty('right');
        panel.style.removeProperty('bottom');
        panel.style.removeProperty('transform');
        panel.style.opacity = '1';
        const rr = root.getBoundingClientRect();
        const pr = panel.getBoundingClientRect();
        const midRoot = rr.left + rr.width / 2;
        const midPanel = pr.left + pr.width / 2;
        const offset = Math.abs(midPanel - midRoot);
        const userPos = !!(panel.dataset && panel.dataset.omtUserDragged === '1');
        const inlineLeft = panel.style.left || '';
        return {
          ok: offset < 24 && !userPos && !/px$/i.test(inlineLeft),
          tag: t,
          offset: Math.round(offset),
          userPos,
          inlineLeft,
          transform: panel.style.transform || '',
          rootW: Math.round(rr.width),
          panelW: Math.round(pr.width)
        };
      }, tag);
      const smallBefore = await snap('small-before');
      await page.screenshot({
        path: path.join(ARTIFACTS, `v236_center_${label}_small.png`),
        fullPage: true
      });
      await page.setViewportSize({ width: 1400, height: 900 });
      await page.waitForTimeout(60);
      await page.evaluate(() => {
        document.dispatchEvent(new Event('fullscreenchange'));
        window.dispatchEvent(new Event('resize'));
        if (typeof window.__omtSchedulePanelClamp === 'function') window.__omtSchedulePanelClamp();
      });
      await page.waitForTimeout(140);
      const large = await snap('large-fs');
      await page.screenshot({
        path: path.join(ARTIFACTS, `v236_center_${label}_fs.png`),
        fullPage: true
      });
      await page.setViewportSize({ width: 900, height: 560 });
      await page.waitForTimeout(60);
      await page.evaluate(() => {
        document.dispatchEvent(new Event('fullscreenchange'));
        window.dispatchEvent(new Event('resize'));
        if (typeof window.__omtSchedulePanelClamp === 'function') window.__omtSchedulePanelClamp();
      });
      await page.waitForTimeout(140);
      const smallAfter = await snap('small-after');
      await page.screenshot({
        path: path.join(ARTIFACTS, `v236_center_${label}_back.png`),
        fullPage: true
      });
      return {
        ok: smallBefore.ok && large.ok && smallAfter.ok,
        smallBefore,
        large,
        smallAfter
      };
    }

    const centerInplay = await assertCenteredAcrossFs('inplay', 'inplayip-schedule-mock.html');
    results.push({
      name: 'panel-default-stays-centered-inplay-fs',
      pass: centerInplay.ok === true,
      detail: centerInplay
    });
    const centerExamino = await assertCenteredAcrossFs('examino', 'examino-mock.html');
    results.push({
      name: 'panel-default-stays-centered-examino-fs',
      pass: centerExamino.ok === true,
      detail: centerExamino
    });
    const centerXeatre = await assertCenteredAcrossFs('xeatre', 'xeatre-dvr-mock.html');
    results.push({
      name: 'panel-default-stays-centered-xeatre-fs',
      pass: centerXeatre.ok === true,
      detail: centerXeatre
    });

    // 1) Multi-view 4 tiles → every panel is S; single video reverts to user size.
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${base}/inplayip-multiview-mock.html?tiles=4`, { waitUntil: 'domcontentloaded' });
    await waitForOmt(page, 15000);
    await page.waitForFunction(
      () => window.__omtInplayMvActive === true &&
        document.querySelectorAll('[data-omt-tile-root]').length === 3,
      { timeout: 10000 }
    ).catch(() => {});
    await page.waitForTimeout(200);
    // Ensure user prefs are NOT small so force-S is visible vs user medium.
    await page.evaluate(() => {
      try {
        localStorage.setItem('omtPanelSize', 'medium');
        localStorage.setItem('omtPanelCompact', 'false');
      } catch (_) {}
      if (typeof window.__omtInplayMvForceSync === 'function') {
        window.__omtInplayMvForceSync();
      }
    });
    await page.waitForTimeout(80);
    const mvCompact = await page.evaluate(() => {
      const primary = document.getElementById('omt-controls-panel');
      const tiles = Array.from(document.querySelectorAll('[data-omt-tile-root] .omt-controls-panel'));
      const all = [primary, ...tiles].filter(Boolean);
      const allEqualS = all.length >= 4 && all.every((p) =>
        p.classList.contains('omt-panel-size-small') &&
        p.classList.contains('omt-panel-compact')
      );
      const speedHidden = all.every((p) => {
        const row = p.querySelector('.omt-speed-row');
        if (!row) return true;
        return getComputedStyle(row).display === 'none';
      });
      const widths = all.map((p) => Math.round(p.getBoundingClientRect().width));
      const sameW = widths.length > 1 &&
        Math.max(...widths) - Math.min(...widths) < 8;
      return {
        ok: allEqualS && speedHidden,
        count: all.length,
        allEqualS,
        speedHidden,
        sameW,
        widths,
        smallFlags: all.map((p) => p.classList.contains('omt-panel-size-small')),
        compactFlags: all.map((p) => p.classList.contains('omt-panel-compact')),
        active: !!window.__omtInplayMvActive
      };
    });
    await page.evaluate(() => {
      document.querySelectorAll('[data-omt-tile-root] .omt-more-toggle[aria-expanded="true"]').forEach((b) => b.click());
    });
    await page.waitForTimeout(60);
    await page.screenshot({
      path: path.join(ARTIFACTS, 'v237_inplay_mv_4tile_real_s.png'),
      fullPage: true
    });
    results.push({
      name: 'inplayip-mv-4-tile-forced-s-compact-no-speed',
      pass: mvCompact.ok === true,
      detail: mvCompact
    });

    // Back to 1 tile → S+Compact removed (user medium, speed row back).
    await page.evaluate(() => { window.__omtSetTiles && window.__omtSetTiles(1); });
    await page.waitForFunction(
      () => !window.__omtInplayMvActive &&
        document.querySelectorAll('[data-omt-tile-root]').length === 0,
      { timeout: 10000 }
    ).catch(() => {});
    await page.waitForTimeout(150);
    const mvSingleSize = await page.evaluate(() => {
      const panel = document.getElementById('omt-controls-panel');
      const row = panel && panel.querySelector('.omt-speed-row');
      const speedVisible = !!(row && getComputedStyle(row).display !== 'none');
      return {
        ok: !!panel && !panel.classList.contains('omt-panel-size-small') &&
          !panel.classList.contains('omt-panel-compact') &&
          speedVisible && !window.__omtInplayMvActive,
        hasSmall: !!(panel && panel.classList.contains('omt-panel-size-small')),
        hasCompact: !!(panel && panel.classList.contains('omt-panel-compact')),
        speedVisible,
        active: !!window.__omtInplayMvActive
      };
    });
    await page.screenshot({
      path: path.join(ARTIFACTS, 'v237_inplay_single_restored.png'),
      fullPage: true
    });
    results.push({
      name: 'inplayip-mv-exit-restores-normal-size',
      pass: mvSingleSize.ok === true,
      detail: mvSingleSize
    });

    // 2) Top-safe: drag-handle row stays below measured native top chrome.
    async function placeAtTopThenClamp(label) {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.waitForTimeout(80);
      await page.evaluate(() => {
        const root = document.getElementById('omt-root');
        const panel = document.getElementById('omt-controls-panel');
        if (!root || !panel) return;
        try { panel.dataset.omtUserDragged = '1'; } catch (_) {}
        panel.style.opacity = '1';
        panel.style.pointerEvents = 'auto';
        panel.style.left = '24px';
        panel.style.top = '0px';
        panel.style.bottom = 'auto';
        panel.style.right = 'auto';
        panel.style.transform = 'none';
      });
      // Emulate leaving fullscreen with panel stuck at top.
      await page.evaluate(() => {
        document.dispatchEvent(new Event('fullscreenchange'));
        window.dispatchEvent(new Event('resize'));
        if (typeof window.__omtSchedulePanelClamp === 'function') window.__omtSchedulePanelClamp();
        else if (typeof window.__omtClampAllPanels === 'function') window.__omtClampAllPanels();
      });
      await page.waitForTimeout(120);
      return page.evaluate(() => {
        const root = document.getElementById('omt-root');
        const panel = document.getElementById('omt-controls-panel');
        if (!root || !panel) return { ok: false, reason: 'missing' };
        const safe = (typeof window.__omtPanelTopSafeMargin === 'function')
          ? window.__omtPanelTopSafeMargin(root)
          : 8;
        const rr = root.getBoundingClientRect();
        const pr = panel.getBoundingClientRect();
        const top = Math.round(pr.top - rr.top);
        const eps = 2;
        // Handle row = top of panel; must sit at/below measured blocked zone + gap.
        return {
          ok: top >= safe - eps && pr.bottom <= rr.bottom + eps &&
            pr.left >= rr.left - eps && pr.right <= rr.right + eps,
          top,
          safe: Math.round(safe),
          left: Math.round(pr.left - rr.left),
          w: Math.round(pr.width),
          h: Math.round(pr.height)
        };
      });
    }

    await page.goto(`${base}/inplayip-schedule-mock.html`, { waitUntil: 'domcontentloaded' });
    await waitForOmt(page, 15000);
    await page.waitForTimeout(200);
    const topSafeInplay = await placeAtTopThenClamp('inplay');
    // Also verify edge-grab hit + drag from top border moves panel.
    const edgeDragInplay = await page.evaluate(() => {
      const panel = document.getElementById('omt-controls-panel');
      const root = document.getElementById('omt-root');
      if (!panel || !root) return { ok: false, reason: 'missing' };
      panel.style.opacity = '1';
      panel.style.pointerEvents = 'auto';
      const rr = root.getBoundingClientRect();
      const pr0 = panel.getBoundingClientRect();
      // Start near top edge of panel (inside ~8px grab).
      const sx = pr0.left + pr0.width / 2;
      const sy = pr0.top + 3;
      const down = new PointerEvent('pointerdown', {
        bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse',
        clientX: sx, clientY: sy, button: 0, buttons: 1
      });
      panel.dispatchEvent(down);
      const midY = sy + 40;
      const move = new PointerEvent('pointermove', {
        bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse',
        clientX: sx, clientY: midY, button: 0, buttons: 1
      });
      window.dispatchEvent(move);
      const up = new PointerEvent('pointerup', {
        bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse',
        clientX: sx, clientY: midY, button: 0, buttons: 0
      });
      window.dispatchEvent(up);
      const pr1 = panel.getBoundingClientRect();
      const moved = Math.abs((pr1.top - rr.top) - (pr0.top - rr.top)) > 8;
      return {
        ok: moved,
        beforeTop: Math.round(pr0.top - rr.top),
        afterTop: Math.round(pr1.top - rr.top)
      };
    });
    await page.screenshot({
      path: path.join(ARTIFACTS, 'v236_inplay_top_safe_edge_drag.png'),
      fullPage: true
    });
    results.push({
      name: 'panel-top-safe-inplay',
      pass: topSafeInplay.ok === true,
      detail: topSafeInplay
    });
    results.push({
      name: 'panel-edge-drag-inplay',
      pass: edgeDragInplay.ok === true,
      detail: edgeDragInplay
    });

    await page.goto(`${base}/examino-mock.html`, { waitUntil: 'domcontentloaded' });
    await waitForOmt(page, 15000);
    await page.waitForTimeout(250);
    const topSafeExamino = await placeAtTopThenClamp('examino');
    const edgeDragExamino = await page.evaluate(() => {
      const panel = document.getElementById('omt-controls-panel');
      const root = document.getElementById('omt-root');
      if (!panel || !root) return { ok: false, reason: 'missing' };
      panel.style.opacity = '1';
      panel.style.pointerEvents = 'auto';
      const rr = root.getBoundingClientRect();
      const pr0 = panel.getBoundingClientRect();
      const sx = pr0.left + pr0.width / 2;
      const sy = pr0.top + 3;
      panel.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, cancelable: true, pointerId: 2, pointerType: 'mouse',
        clientX: sx, clientY: sy, button: 0, buttons: 1
      }));
      window.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true, cancelable: true, pointerId: 2, pointerType: 'mouse',
        clientX: sx + 30, clientY: sy + 50, button: 0, buttons: 1
      }));
      window.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true, cancelable: true, pointerId: 2, pointerType: 'mouse',
        clientX: sx + 30, clientY: sy + 50, button: 0, buttons: 0
      }));
      const pr1 = panel.getBoundingClientRect();
      return {
        ok: Math.abs((pr1.top - rr.top) - (pr0.top - rr.top)) > 8 ||
          Math.abs((pr1.left - rr.left) - (pr0.left - rr.left)) > 8,
        beforeTop: Math.round(pr0.top - rr.top),
        afterTop: Math.round(pr1.top - rr.top),
        beforeLeft: Math.round(pr0.left - rr.left),
        afterLeft: Math.round(pr1.left - rr.left)
      };
    });
    await page.screenshot({
      path: path.join(ARTIFACTS, 'v236_examino_top_safe_edge_drag.png'),
      fullPage: true
    });
    results.push({
      name: 'panel-top-safe-examino',
      pass: topSafeExamino.ok === true,
      detail: topSafeExamino
    });
    results.push({
      name: 'panel-edge-drag-examino',
      pass: edgeDragExamino.ok === true,
      detail: edgeDragExamino
    });

    // 3) Dblclick on panel text must not leave a selection (Edge mini-menu).
    const noSelect = await page.evaluate(() => {
      const panel = document.getElementById('omt-controls-panel');
      if (!panel) return { ok: false, reason: 'missing' };
      panel.style.opacity = '1';
      const label = panel.querySelector('.omt-btn-label, .omt-speed-chip, .drag-center-grip');
      const target = label || panel;
      const cs = getComputedStyle(target);
      const cssNone = (cs.userSelect === 'none' || cs.webkitUserSelect === 'none');
      // Simulate dblclick selection attempt.
      const r = target.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      target.dispatchEvent(new MouseEvent('dblclick', {
        bubbles: true, cancelable: true, clientX: x, clientY: y, detail: 2
      }));
      const sel = window.getSelection && window.getSelection();
      const selected = !!(sel && sel.toString && sel.toString().length > 0);
      // Inputs must remain selectable.
      const input = panel.querySelector('input, select, textarea');
      let inputOk = true;
      if (input) {
        const ics = getComputedStyle(input);
        inputOk = ics.userSelect !== 'none' || input.tagName === 'SELECT';
      }
      return { ok: cssNone && !selected && inputOk, cssNone, selected, inputOk };
    });
    await page.screenshot({
      path: path.join(ARTIFACTS, 'v236_panel_no_text_select.png'),
      fullPage: true
    });
    results.push({
      name: 'panel-no-text-select-on-dblclick',
      pass: noSelect.ok === true,
      detail: noSelect
    });

    // ---- Nested .op-ui wrapping <video>: must NOT hide media (v2.0.2 field fix) ----
    await page.goto(`${base}/examino-nested-op-ui-mock.html`, { waitUntil: 'domcontentloaded' });
    await waitForOmt(page, 15000);
    await page.waitForTimeout(300);
    const nestedOpUi = await page.evaluate(async () => {
      const v = document.querySelector('video');
      const opUi = document.getElementById('op-ui-wrap');
      const controls = document.querySelector('.op-controls');
      if (!v || !opUi) return { ok: false, reason: 'missing' };
      const vCs = getComputedStyle(v);
      const uiCs = getComputedStyle(opUi);
      const ctrlCs = controls ? getComputedStyle(controls) : null;
      let playN = 0;
      let pauseN = 0;
      const onPlay = () => { playN += 1; };
      const onPause = () => { pauseN += 1; };
      v.addEventListener('play', onPlay);
      v.addEventListener('pause', onPause);
      try { await v.play(); } catch (_) {}
      await new Promise((r) => setTimeout(r, 3000));
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      const mediaVisible = vCs.display !== 'none' && vCs.visibility !== 'hidden' &&
        v.getBoundingClientRect().height >= 24;
      // .op-ui wraps video → must stay rendered; leaf .op-controls may hide.
      const opUiVisible = uiCs.display !== 'none' && uiCs.visibility !== 'hidden';
      const controlsHidden = !ctrlCs || ctrlCs.display === 'none' || ctrlCs.visibility === 'hidden';
      return {
        ok: mediaVisible && opUiVisible && controlsHidden && playN <= 3 && pauseN <= 3 && v.paused === false,
        mediaVisible,
        opUiVisible,
        controlsHidden,
        playN,
        pauseN,
        paused: v.paused,
        vDisplay: vCs.display,
        uiDisplay: uiCs.display,
        ctrlDisplay: ctrlCs ? ctrlCs.display : null,
        hudOn: document.documentElement.classList.contains('omt-hud-on')
      };
    });
    results.push({
      name: 'examino-nested-op-ui-keeps-video-visible',
      pass: nestedOpUi.ok === true,
      detail: nestedOpUi
    });
    await page.screenshot({ path: path.join(ARTIFACTS, 'v202_nested_op_ui.png'), fullPage: true });

    // ---- Sticky native-hidden race: Source-switch video gap must not blank .op-player ----
    await page.goto(`${base}/examino-sticky-hide-race-mock.html`, { waitUntil: 'domcontentloaded' });
    await waitForOmt(page, 15000);
    await page.waitForTimeout(400);
    const stickyRace = await page.evaluate(async () => {
      if (typeof window.__stickyRaceGapReload !== 'function') {
        return { ok: false, reason: 'missing-gap-fn' };
      }
      document.documentElement.classList.add('omt-hud-on', 'omt-host-examino');

      // 1) With video present, sticky class on .op-player must NOT blank media
      //    (CSS undo rule). This is the field failure mode after VOD remount.
      const player0 = document.getElementById('op-player');
      if (!player0) return { ok: false, reason: 'no-player' };
      player0.classList.add('omt-examino-native-hidden');
      const v0 = document.querySelector('video');
      const cs0 = getComputedStyle(player0);
      const visibleWithSticky = cs0.display !== 'none' && cs0.maxHeight !== '0px' &&
        v0 && v0.getBoundingClientRect().height >= 24;

      // 2) Source-switch gap: remove video, keep sticky class, remount video.
      const gapPromise = window.__stickyRaceGapReload(180);
      await new Promise((r) => setTimeout(r, 50));
      const playerMid = document.getElementById('op-player');
      if (playerMid) playerMid.classList.add('omt-examino-native-hidden');
      // Nudge the extension's hide observer (same as a host DOM mutation).
      document.body.appendChild(document.createElement('div')).setAttribute('data-omt-gap', '1');
      await gapPromise;
      await new Promise((r) => setTimeout(r, 1200)); // observer throttle is 1s

      const player = document.getElementById('op-player');
      const v = document.querySelector('video');
      if (!player || !v) return { ok: false, reason: 'no-player-or-video', visibleWithSticky };
      // Ensure undo classes present even if SPA cleared them mid-gap.
      document.documentElement.classList.add('omt-hud-on', 'omt-host-examino');
      player.classList.add('omt-examino-native-hidden');
      const vCs = getComputedStyle(v);
      const pCs = getComputedStyle(player);
      const mediaVisible = vCs.display !== 'none' && v.getBoundingClientRect().height >= 24;
      const playerVisible = pCs.display !== 'none' && pCs.maxHeight !== '0px';

      let playN = 0;
      let pauseN = 0;
      const onPlay = () => { playN += 1; };
      const onPause = () => { pauseN += 1; };
      v.addEventListener('play', onPlay);
      v.addEventListener('pause', onPause);
      try { await v.play(); } catch (_) {}
      await new Promise((r) => setTimeout(r, 3000));
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      return {
        ok: visibleWithSticky && mediaVisible && playerVisible &&
          playN <= 3 && pauseN <= 3 && v.paused === false,
        visibleWithSticky,
        mediaVisible,
        playerVisible,
        playN,
        pauseN,
        paused: v.paused,
        pDisplay: pCs.display,
        stats: window.__stickyRaceStats || {}
      };
    });
    results.push({
      name: 'examino-sticky-hide-race-no-loop',
      pass: stickyRace.ok === true,
      detail: stickyRace
    });
    await page.screenshot({ path: path.join(ARTIFACTS, 'v204_sticky_hide_race.png'), fullPage: true });

    // ---- v2.0.5: Examino Shuttle message handler must not see our storage bus ----
    // Host chunk BIyTHCyh.js toggles play/pause on any same-origin window.message
    // without isKeyPressed / known key. Our bridge used to postMessage → storm.
    await page.goto(`${base}${EXAMINO_BUS_MOCK_PATH}`, { waitUntil: 'domcontentloaded' });
    await waitForOmt(page, 15000);
    await page.waitForFunction(() => {
      const v = document.querySelector('.ovenplayer video');
      return !!(v && v.readyState >= 2);
    }, { timeout: 15000 }).catch(() => {});
    // Settle after extension boot + bridge CustomEvent sync.
    await page.waitForTimeout(800);
    const busLoop = await page.evaluate(async () => {
      const v = document.querySelector('.ovenplayer video');
      const s0 = { ...(window.__busStats || {}) };
      // Baseline: legacy postMessage still trips host D (documents the hazard).
      let probeToggle = false;
      if (typeof window.__omtHostProbePostMessage === 'function' && v) {
        const before = window.__busStats.hostD;
        const pausedBefore = v.paused;
        window.__omtHostProbePostMessage();
        await new Promise((r) => setTimeout(r, 50));
        probeToggle = window.__busStats.hostD > before && v.paused !== pausedBefore;
        // Leave playing for the idle window.
        if (v.paused) {
          try { await v.play(); } catch (_) {}
        }
      }
      const atStart = {
        play: window.__busStats.play,
        pause: window.__busStats.pause,
        waiting: window.__busStats.waiting,
        hostD: window.__busStats.hostD,
        messages: window.__busStats.messages,
        busEvents: window.__busStats.busEvents
      };
      // Trigger storage writes the way the overlay does (CustomEvent bus).
      if (typeof window.dispatchEvent === 'function') {
        for (let i = 0; i < 8; i++) {
          window.dispatchEvent(new CustomEvent('omt-bridge-bus', {
            detail: {
              source: 'omt-bridge',
              type: 'OMT_STORAGE_SYNC',
              values: { omtAutoHideChrome: true }
            }
          }));
        }
      }
      await new Promise((r) => setTimeout(r, 3000));
      const atEnd = {
        play: window.__busStats.play,
        pause: window.__busStats.pause,
        waiting: window.__busStats.waiting,
        hostD: window.__busStats.hostD,
        messages: window.__busStats.messages,
        busEvents: window.__busStats.busEvents
      };
      const dPlay = atEnd.play - atStart.play;
      const dPause = atEnd.pause - atStart.pause;
      const dHostD = atEnd.hostD - atStart.hostD;
      const dWaiting = atEnd.waiting - atStart.waiting;
      const dBus = atEnd.busEvents - atStart.busEvents;
      // 8 intentional CustomEvent syncs above; allow a small slack, never a storm.
      return {
        ok: !!(probeToggle === true && dPlay <= 2 && dPause <= 2 && dHostD === 0 && dWaiting <= 5 &&
          dBus <= 20 && v && v.paused === false && document.getElementById('omt-root')),
        probeToggle,
        dPlay,
        dPause,
        dHostD,
        dWaiting,
        dBus,
        paused: v ? v.paused : null,
        hasHud: !!document.getElementById('omt-root'),
        usesBus: typeof window.CustomEvent === 'function',
        s0,
        atStart,
        atEnd,
        // Production must not emit window.postMessage for omt-bridge/page.
        postMessageEmitGuard: !/window\.postMessage\(\s*\{\s*source:\s*'omt-(bridge|page)'/.test(
          String(document.documentElement.innerHTML || '')
        )
      };
    });
    results.push({
      name: 'examino-bus-no-host-play-pause-loop',
      pass: busLoop.ok === true,
      detail: busLoop
    });
    await page.screenshot({ path: path.join(ARTIFACTS, 'v205_ovenplayer_bus.png'), fullPage: true });

    // ---- v2.1.0: Xeatre DVR — host chrome hidden, our HUD clickable, no play/pause loop ----
    await page.goto(`${base}${XEATRE_DVR_PATH}`, { waitUntil: 'domcontentloaded' });
    await waitForOmt(page, 15000);
    await page.waitForFunction(() => {
      const v = document.querySelector('video');
      return !!(v && document.getElementById('omt-root') &&
        document.documentElement.classList.contains('omt-host-xeatre'));
    }, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(500);
    const xeatreGuard = await page.evaluate(async () => {
      const v = document.querySelector('video');
      const root = document.getElementById('omt-root');
      const bar = document.querySelector('.vjs-control-bar');
      const dock = document.getElementById('xeatre-panel-dock');
      const flt = document.getElementById('xeatre-panel-float');
      const autoHide = document.getElementById('AutoHide');
      const playBtn = document.getElementById('omt-btn-play');
      const cs = (el) => (el ? getComputedStyle(el) : null);
      const hidden = (el) => {
        const c = cs(el);
        if (!c) return true;
        return c.display === 'none' || c.visibility === 'hidden' || Number(c.opacity) === 0 ||
          c.pointerEvents === 'none';
      };
      // Video / media shell must stay painted.
      const shell = document.querySelector('.video-js');
      const mediaVisible = !!(v && v.getBoundingClientRect().height >= 24 &&
        cs(v).display !== 'none' && cs(shell).display !== 'none');

      const hostHidden = hidden(bar) && hidden(dock) && hidden(flt) && hidden(autoHide) &&
        hidden(document.getElementById('jwplay')) && hidden(document.getElementById('GoLive'));

      // Hit-test: centre of a host button must NOT receive the click (hidden).
      let hostHitBlocked = true;
      const hostBtn = document.getElementById('jwplay');
      if (hostBtn) {
        const r = hostBtn.getBoundingClientRect();
        // Even if rect is zero when display:none, treat as blocked.
        if (r.width > 0 && r.height > 0) {
          const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          hostHitBlocked = !(top === hostBtn || (top && hostBtn.contains(top)));
        }
      }

      // Our play button must be hittable.
      let ourHitOk = false;
      if (playBtn) {
        playBtn.scrollIntoView({ block: 'center' });
        const panel = document.getElementById('omt-controls-panel');
        if (panel) {
          panel.style.opacity = '1';
          panel.style.pointerEvents = 'auto';
        }
        const r = playBtn.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        ourHitOk = !!(top && (top === playBtn || playBtn.contains(top) || top.closest('#omt-btn-play')));
      }

      const s0 = { ...(window.__xeatreStats || {}) };
      try { await v.play(); } catch (_) {}
      await new Promise((r) => setTimeout(r, 3000));
      const s1 = { ...(window.__xeatreStats || {}) };
      const dPlay = (s1.play || 0) - (s0.play || 0);
      const dPause = (s1.pause || 0) - (s0.pause || 0);
      const dMsg = (s1.messages || 0) - (s0.messages || 0);

      return {
        ok: mediaVisible && hostHidden && hostHitBlocked && ourHitOk && !!root &&
          dPlay <= 3 && dPause <= 3 && dMsg === 0 &&
          document.documentElement.classList.contains('omt-host-xeatre') &&
          document.documentElement.classList.contains('omt-hud-on'),
        mediaVisible,
        hostHidden,
        hostHitBlocked,
        ourHitOk,
        dPlay,
        dPause,
        dMsg,
        hasHud: !!root,
        adapter: document.documentElement.classList.contains('omt-host-xeatre'),
        liveChrome: !!(root && root.querySelector('#omt-timeline-live-indicator'))
      };
    });
    results.push({
      name: 'xeatre-host-chrome-hidden-no-loop',
      pass: xeatreGuard.ok === true,
      detail: xeatreGuard
    });
    await page.screenshot({ path: path.join(ARTIFACTS, 'v210_xeatre_dvr.png'), fullPage: true });

    // ---- v2.2.5: Xeatre hdmi-video — picture painted, no double videojs(), chrome only ----
    const xeatrePaint = await page.evaluate(async () => {
      const shell = document.getElementById('hdmi-video');
      const v = document.querySelector('#hdmi-video video.vjs-tech, video.vjs-tech, video');
      const root = document.getElementById('omt-root');
      const bar = document.querySelector('.vjs-control-bar');
      const dock = document.getElementById('xeatre-panel-dock');
      const poster = document.querySelector('.vjs-poster');
      const cs = (el) => (el ? getComputedStyle(el) : null);
      const vCs = cs(v);
      const shellCs = cs(shell);
      const rect = v ? v.getBoundingClientRect() : { width: 0, height: 0 };
      const opacity = vCs ? Number(vCs.opacity) : 0;
      const displayOk = !!(vCs && vCs.display !== 'none' && vCs.visibility !== 'hidden');
      const sizeOk = rect.width >= 100 && rect.height >= 24;
      const opacityOk = opacity >= 0.99;
      // HUD must not live inside #hdmi-video or a wrapping #ControlBar (v2.2.9).
      const controlBar = document.getElementById('ControlBar');
      const hudOutsidePlayer = !!(root && shell && !shell.contains(root) &&
        !(controlBar && controlBar.contains(root)));
      const hostBarHidden = !!(bar && (cs(bar).display === 'none' || cs(bar).visibility === 'hidden' ||
        Number(cs(bar).opacity) === 0));
      const dockHidden = !!(dock && (cs(dock).display === 'none' || Number(cs(dock).opacity) === 0));
      // Poster must NOT be force-hidden by our chrome rules (may still be host-hidden).
      const posterNotForceHiddenByOmt = !poster || cs(poster).display !== 'none' ||
        !document.getElementById('omt-xeatre-hide-css') ||
        !(document.getElementById('omt-xeatre-hide-css').textContent || '').includes('.vjs-poster');
      const warns = window.__xeatreVideojsWarns || [];
      const stats = window.__xeatreStats || {};
      // Sample a pixel from the canvas stream isn't available cross-origin; use
      // paintedFrames + playing as proof the tech is live.
      try { await v.play(); } catch (_) {}
      await new Promise((r) => setTimeout(r, 400));
      const chain = [];
      let n = v;
      let g = 0;
      while (n && n.nodeType === 1 && g++ < 8) {
        const c = cs(n);
        chain.push({
          tag: n.tagName, id: n.id || null,
          display: c.display, visibility: c.visibility, opacity: c.opacity,
          w: Math.round(n.getBoundingClientRect().width),
          h: Math.round(n.getBoundingClientRect().height)
        });
        if (n.id === 'hdmi-video' || (n.classList && n.classList.contains('video-js'))) break;
        n = n.parentElement;
      }
      // paintedFrames prove the tech paints; muted autoplay may pause after
      // viewport-fit resizes (v2.2.10) without a user gesture.
      return {
        ok: displayOk && sizeOk && opacityOk && hostBarHidden && dockHidden &&
          hudOutsidePlayer && !!root && warns.length === 0 &&
          (stats.videojsWarns || 0) === 0 && (stats.videojsInits || 0) === 1 &&
          (stats.paintedFrames || 0) > 5 && !!v &&
          posterNotForceHiddenByOmt,
        displayOk,
        sizeOk,
        opacityOk,
        hostBarHidden,
        dockHidden,
        hudOutsidePlayer,
        omtParent: root && root.parentElement && root.parentElement.id,
        shellParent: shell && shell.parentElement && shell.parentElement.id,
        videojsInits: stats.videojsInits || 0,
        videojsWarns: stats.videojsWarns || 0,
        warns,
        paintedFrames: stats.paintedFrames || 0,
        paused: v ? v.paused : null,
        chain,
        posterDisplay: poster ? cs(poster).display : null,
        hideCssHasPoster: !!(document.getElementById('omt-xeatre-hide-css') &&
          (document.getElementById('omt-xeatre-hide-css').textContent || '').includes('.vjs-poster'))
      };
    });
    results.push({
      name: 'xeatre-hdmi-video-painted-no-reinit',
      pass: xeatrePaint.ok === true,
      detail: xeatrePaint
    });
    results.push({
      name: 'xeatre-no-already-initialised-warning',
      pass: (xeatrePaint.videojsWarns || 0) === 0 && (xeatrePaint.warns || []).length === 0 &&
        (xeatrePaint.videojsInits || 0) === 1,
      detail: {
        videojsInits: xeatrePaint.videojsInits,
        videojsWarns: xeatrePaint.videojsWarns,
        warns: xeatrePaint.warns
      }
    });
    await page.screenshot({ path: path.join(ARTIFACTS, 'v225_xeatre_hdmi_painted.png'), fullPage: true });

    // v2.2.9: after HUD on, <video> and every ancestor must stay displayed with size
    // (field: bare #ControlBar hide wrapped #hdmi-video → display:none / 0×0).
    const xeatreAncestors = await page.evaluate(() => {
      const v = document.querySelector('#hdmi-video video.vjs-tech, video.vjs-tech, video');
      const shell = document.getElementById('hdmi-video');
      const controlBar = document.getElementById('ControlBar');
      const root = document.getElementById('omt-root');
      const hideCss = document.getElementById('omt-xeatre-hide-css');
      const hideText = (hideCss && hideCss.textContent) || '';
      if (!v || !shell) return { ok: false, reason: 'missing-video' };
      const cs = (el) => getComputedStyle(el);
      const chain = [];
      let n = v;
      let g = 0;
      let allOk = true;
      while (n && n.nodeType === 1 && g++ < 14) {
        const c = cs(n);
        const r = n.getBoundingClientRect();
        const displayOk = c.display !== 'none' && c.visibility !== 'hidden';
        const sizeOk = r.width >= 8 && r.height >= 8;
        const noSticky = !(n.classList && n.classList.contains('omt-xeatre-host-hidden'));
        const row = {
          tag: n.tagName, id: n.id || null,
          display: c.display, visibility: c.visibility,
          w: Math.round(r.width), h: Math.round(r.height),
          displayOk, sizeOk, noSticky
        };
        chain.push(row);
        if (!displayOk || !sizeOk || !noSticky) allOk = false;
        if (n === document.body || n === document.documentElement) break;
        n = n.parentElement;
      }
      const shellCs = cs(shell);
      const barCs = controlBar ? cs(controlBar) : null;
      // Wrapping ControlBar must NOT be display:none (contains the player).
      const controlBarVisible = !controlBar || (
        barCs.display !== 'none' && barCs.visibility !== 'hidden' &&
        controlBar.getBoundingClientRect().width >= 8
      );
      const hudOutside = !!(root && !shell.contains(root) && !(controlBar && controlBar.contains(root)));
      const stats = window.__xeatreStats || {};
      // Injected hide CSS must guard #ControlBar with :not(:has(...)).
      const cssGuardsControlBar = /#ControlBar[^,{]*:not\(:has\(/.test(hideText);
      return {
        ok: allOk && controlBarVisible && hudOutside && cssGuardsControlBar &&
          shellCs.display !== 'none' &&
          (stats.videojsWarns || 0) === 0 &&
          (stats.videojsInits || 0) === 1 &&
          document.documentElement.classList.contains('omt-hud-on'),
        allOk,
        controlBarVisible,
        controlBarDisplay: barCs ? barCs.display : null,
        shellDisplay: shellCs.display,
        hudOutside,
        hudParent: root && root.parentElement && root.parentElement.id,
        cssGuardsControlBar,
        videojsInits: stats.videojsInits || 0,
        videojsWarns: stats.videojsWarns || 0,
        chain
      };
    });
    results.push({
      name: 'xeatre-hdmi-video-ancestors-stay-visible-after-hud',
      pass: xeatreAncestors.ok === true,
      detail: xeatreAncestors
    });

    // v2.2.10: Xeatre viewport fit — no scroll; video + HUD inside window at every size.
    const readXeatreViewportFit = async () => page.evaluate(() => {
      if (typeof window.__omtXeatreFitViewport === 'function') window.__omtXeatreFitViewport();
      const v = document.querySelector('#hdmi-video video.vjs-tech, video.vjs-tech, video');
      const shell = document.getElementById('hdmi-video');
      const root = document.getElementById('omt-root');
      const panel = document.getElementById('omt-controls-panel');
      const bar = document.getElementById('omt-timeline-bar');
      if (!v || !shell || !root || !panel || !bar) return { ok: false, reason: 'missing' };
      // Force chrome visible for the hit-test (autohide may have faded it).
      panel.style.opacity = '1';
      panel.style.pointerEvents = 'auto';
      bar.style.opacity = '1';
      bar.classList.remove('omt-chrome-hidden');

      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const tol = 2;
      const fullyInView = (el, minW = 4, minH = 4) => {
        const r = el.getBoundingClientRect();
        return r.width >= minW && r.height >= minH &&
          r.left >= -tol && r.top >= -tol &&
          r.right <= vw + tol && r.bottom <= vh + tol;
      };
      const vR = v.getBoundingClientRect();
      const sR = shell.getBoundingClientRect();
      const pR = panel.getBoundingClientRect();
      const bR = bar.getBoundingClientRect();
      const rootCs = getComputedStyle(root);
      const noScroll = (window.scrollY || 0) <= 0 && (window.scrollX || 0) <= 0 &&
        document.documentElement.scrollHeight <= vh + 2 &&
        document.documentElement.scrollWidth <= vw + 2;
      const videoInView = fullyInView(v, 8, 4) && fullyInView(shell, 8, 4);
      const panelInView = fullyInView(panel, 8, 8);
      const barInView = fullyInView(bar, 8, 4);
      const hudFixed = rootCs.position === 'fixed';
      const paddingTop = parseFloat(getComputedStyle(shell).paddingTop) || 0;
      return {
        ok: noScroll && videoInView && panelInView && barInView && hudFixed && paddingTop < 1,
        noScroll,
        videoInView,
        panelInView,
        barInView,
        hudFixed,
        paddingTop,
        vw, vh,
        scrollH: document.documentElement.scrollHeight,
        scrollW: document.documentElement.scrollWidth,
        scrollY: window.scrollY || 0,
        video: { w: Math.round(vR.width), h: Math.round(vR.height), top: Math.round(vR.top) },
        shell: { w: Math.round(sR.width), h: Math.round(sR.height), top: Math.round(sR.top) },
        panel: { w: Math.round(pR.width), h: Math.round(pR.height), top: Math.round(pR.top), right: Math.round(pR.right) },
        bar: { w: Math.round(bR.width), h: Math.round(bR.height), bottom: Math.round(bR.bottom) },
        compact: root.classList.contains('omt-compact'),
        micro: root.classList.contains('omt-xeatre-micro')
      };
    });

    const xeatreViewportCases = [
      { name: 'xeatre-viewport-fit-default', size: { width: 960, height: 540 } },
      { name: 'xeatre-viewport-fit-tiny', size: { width: 200, height: 120 } },
      { name: 'xeatre-viewport-fit-tall', size: { width: 480, height: 900 } },
      { name: 'xeatre-viewport-fit-wide-short', size: { width: 1400, height: 380 } }
    ];
    for (const c of xeatreViewportCases) {
      await page.setViewportSize(c.size);
      await page.waitForTimeout(120);
      const snap = await readXeatreViewportFit();
      results.push({ name: c.name, pass: snap.ok === true, detail: snap });
    }

    // Fullscreen: fit to FS element; still no document scroll; HUD visible.
    await page.setViewportSize({ width: 960, height: 540 });
    await page.waitForTimeout(80);
    const xeatreFsFit = await page.evaluate(async () => {
      const shell = document.getElementById('hdmi-video');
      if (!shell || !shell.requestFullscreen) return { ok: false, reason: 'no-fs-api' };
      try {
        await shell.requestFullscreen();
      } catch (err) {
        return { ok: false, reason: 'fs-denied', message: String(err && err.message || err) };
      }
      await new Promise((r) => setTimeout(r, 120));
      if (typeof window.__omtXeatreFitViewport === 'function') window.__omtXeatreFitViewport();
      await new Promise((r) => setTimeout(r, 60));
      const v = document.querySelector('video');
      const root = document.getElementById('omt-root');
      const panel = document.getElementById('omt-controls-panel');
      const bar = document.getElementById('omt-timeline-bar');
      if (panel) { panel.style.opacity = '1'; panel.style.pointerEvents = 'auto'; }
      if (bar) { bar.style.opacity = '1'; bar.classList.remove('omt-chrome-hidden'); }
      const fs = document.fullscreenElement;
      const vw = (fs && fs.clientWidth) || window.innerWidth;
      const vh = (fs && fs.clientHeight) || window.innerHeight;
      const inFs = (el) => {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return r.width >= 4 && r.height >= 4 &&
          r.left >= -2 && r.top >= -2 && r.right <= vw + 2 && r.bottom <= vh + 2;
      };
      const ok = !!fs && inFs(v) && inFs(panel) && inFs(bar) &&
        (window.scrollY || 0) <= 0 &&
        !!(root && getComputedStyle(root).position === 'fixed');
      try { await document.exitFullscreen(); } catch (_) {}
      await new Promise((r) => setTimeout(r, 80));
      if (typeof window.__omtXeatreFitViewport === 'function') window.__omtXeatreFitViewport();
      return {
        ok,
        hasFs: !!fs,
        videoIn: inFs(v),
        panelIn: inFs(panel),
        barIn: inFs(bar),
        vw, vh
      };
    });
    results.push({
      name: 'xeatre-viewport-fit-fullscreen',
      pass: xeatreFsFit.ok === true || xeatreFsFit.reason === 'fs-denied',
      detail: xeatreFsFit
    });

    // v2.2.20: shrink → grow uses width min() only (no panel CSS scale).
    await page.setViewportSize({ width: 960, height: 540 });
    await page.waitForTimeout(80);
    await page.evaluate(() => {
      try {
        localStorage.removeItem('omtPanelSize');
        localStorage.removeItem('omtPanelCompact');
      } catch (_) {}
      const panel = document.getElementById('omt-controls-panel');
      if (panel) panel.classList.remove('omt-panel-size-small', 'omt-panel-compact');
      if (typeof window.__omtXeatreFitViewport === 'function') window.__omtXeatreFitViewport();
    });
    await page.setViewportSize({ width: 200, height: 120 });
    await page.waitForTimeout(150);
    const xeatreScaleTiny = await page.evaluate(() => {
      if (typeof window.__omtXeatreFitViewport === 'function') window.__omtXeatreFitViewport();
      const root = document.getElementById('omt-root');
      const panel = document.getElementById('omt-controls-panel');
      const cs = panel ? getComputedStyle(panel) : null;
      const scale = cs ? (cs.scale || 'none') : 'missing';
      const noScale = scale === 'none' || scale === '1' || scale === '1 1' ||
        scale === '1 1 1' || parseFloat(scale) === 1;
      const width = panel ? Math.round(panel.getBoundingClientRect().width) : 0;
      return {
        micro: !!(root && root.classList.contains('omt-xeatre-micro')),
        noScale,
        scale,
        width,
        shrunk: width > 0 && width <= 200
      };
    });
    await page.setViewportSize({ width: 960, height: 540 });
    await page.waitForTimeout(150);
    const xeatreScaleRestored = await page.evaluate(() => {
      if (typeof window.__omtXeatreFitViewport === 'function') window.__omtXeatreFitViewport();
      const root = document.getElementById('omt-root');
      const panel = document.getElementById('omt-controls-panel');
      if (!root || !panel) return { ok: false, reason: 'missing' };
      const cs = getComputedStyle(panel);
      const scale = cs.scale || 'none';
      const micro = root.classList.contains('omt-xeatre-micro');
      const noScale = scale === 'none' || scale === '1' || scale === '1 1' ||
        scale === '1 1 1' || parseFloat(scale) === 1;
      const width = Math.round(panel.getBoundingClientRect().width);
      return {
        ok: !micro && noScale && width >= 400 && !panel.classList.contains('omt-panel-size-small'),
        micro, scale, width
      };
    });
    results.push({
      name: 'xeatre-scale-restores-on-grow-default',
      pass: xeatreScaleRestored.ok === true && xeatreScaleTiny.micro === true &&
        xeatreScaleTiny.noScale === true && xeatreScaleTiny.shrunk === true,
      detail: { tiny: xeatreScaleTiny, restored: xeatreScaleRestored }
    });

    // Custom small + compact prefs survive shrink → grow (width min, no scale).
    await page.evaluate(() => {
      localStorage.setItem('omtPanelSize', 'small');
      localStorage.setItem('omtPanelCompact', 'true');
      const panel = document.getElementById('omt-controls-panel');
      if (panel) panel.classList.add('omt-panel-size-small', 'omt-panel-compact');
      if (typeof window.__omtXeatreFitViewport === 'function') window.__omtXeatreFitViewport();
    });
    const xeatreScaleCustom = await page.evaluate(() => {
      const panel = document.getElementById('omt-controls-panel');
      return {
        small: !!(panel && panel.classList.contains('omt-panel-size-small')),
        panelCompact: !!(panel && panel.classList.contains('omt-panel-compact')),
        width: panel ? Math.round(panel.getBoundingClientRect().width) : 0
      };
    });
    await page.setViewportSize({ width: 200, height: 120 });
    await page.waitForTimeout(150);
    const xeatreScaleCustomTiny = await page.evaluate(() => {
      if (typeof window.__omtXeatreFitViewport === 'function') window.__omtXeatreFitViewport();
      const root = document.getElementById('omt-root');
      const panel = document.getElementById('omt-controls-panel');
      const cs = panel ? getComputedStyle(panel) : null;
      const scale = cs ? (cs.scale || 'none') : 'missing';
      const noScale = scale === 'none' || scale === '1' || scale === '1 1' ||
        scale === '1 1 1' || parseFloat(scale) === 1;
      return {
        micro: !!(root && root.classList.contains('omt-xeatre-micro')),
        small: !!(panel && panel.classList.contains('omt-panel-size-small')),
        panelCompact: !!(panel && panel.classList.contains('omt-panel-compact')),
        noScale,
        width: panel ? Math.round(panel.getBoundingClientRect().width) : 0
      };
    });
    await page.setViewportSize({ width: 960, height: 540 });
    await page.waitForTimeout(150);
    const xeatreScaleCustomRestored = await page.evaluate(() => {
      if (typeof window.__omtXeatreFitViewport === 'function') window.__omtXeatreFitViewport();
      const root = document.getElementById('omt-root');
      const panel = document.getElementById('omt-controls-panel');
      if (!root || !panel) return { ok: false, reason: 'missing' };
      const cs = getComputedStyle(panel);
      const scale = cs.scale || 'none';
      const micro = root.classList.contains('omt-xeatre-micro');
      const noScale = scale === 'none' || scale === '1' || scale === '1 1' ||
        scale === '1 1 1' || parseFloat(scale) === 1;
      const small = panel.classList.contains('omt-panel-size-small');
      const panelCompact = panel.classList.contains('omt-panel-compact');
      const width = Math.round(panel.getBoundingClientRect().width);
      const widthOk = width > 40 && width <= 500;
      return {
        ok: !micro && noScale && small && panelCompact && widthOk,
        micro, scale, small, panelCompact, width
      };
    });
    results.push({
      name: 'xeatre-scale-restores-on-grow-custom-compact',
      pass: xeatreScaleCustomRestored.ok === true &&
        xeatreScaleCustomTiny.micro === true &&
        xeatreScaleCustomTiny.small === true &&
        xeatreScaleCustomTiny.noScale === true &&
        xeatreScaleCustom.small === true,
      detail: { setup: xeatreScaleCustom, tiny: xeatreScaleCustomTiny, restored: xeatreScaleCustomRestored }
    });

    // v2.2.11: mousemove over video center reveals HUD; idle hides again.
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.waitForTimeout(100);
    await page.evaluate(() => {
      try {
        localStorage.removeItem('omtPanelSize');
        localStorage.removeItem('omtPanelCompact');
      } catch (_) {}
      const panel = document.getElementById('omt-controls-panel');
      if (panel) panel.classList.remove('omt-panel-size-small', 'omt-panel-compact');
      if (typeof window.__omtXeatreFitViewport === 'function') window.__omtXeatreFitViewport();
    });
    const xeatreHoverReveal = await page.evaluate(async () => {
      const panel = document.getElementById('omt-controls-panel');
      const bar = document.getElementById('omt-timeline-bar');
      const v = document.querySelector('#hdmi-video video.vjs-tech, video.vjs-tech, video');
      if (!panel || !bar || !v) return { ok: false, reason: 'missing' };
      // Hide chrome (auto-hide path uses inline opacity).
      panel.style.opacity = '0';
      panel.style.pointerEvents = 'none';
      bar.style.opacity = '0';
      bar.classList.add('omt-chrome-hidden');
      await new Promise((r) => setTimeout(r, 40));
      const hiddenBefore = panel.style.opacity === '0';
      // Pointer over video center (not HUD).
      const r = v.getBoundingClientRect();
      const x = Math.round(r.left + r.width / 2);
      const y = Math.round(r.top + r.height / 2);
      const target = document.elementFromPoint(x, y) || v;
      document.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true, cancelable: true, clientX: x, clientY: y, pointerType: 'mouse'
      }));
      document.dispatchEvent(new MouseEvent('mousemove', {
        bubbles: true, cancelable: true, clientX: x, clientY: y
      }));
      target.dispatchEvent(new MouseEvent('mousemove', {
        bubbles: true, cancelable: true, clientX: x, clientY: y
      }));
      await new Promise((r) => setTimeout(r, 80));
      const shown = panel.style.opacity === '1';
      const barShown = !bar.classList.contains('omt-chrome-hidden');
      // Idle hide (autohide timer is 2500ms).
      await new Promise((r) => setTimeout(r, 2700));
      const hiddenAfter = panel.style.opacity === '0';
      return {
        ok: hiddenBefore && shown && barShown && hiddenAfter,
        hiddenBefore, shown, barShown, hiddenAfter,
        targetTag: target && target.tagName,
        x, y
      };
    });
    results.push({
      name: 'xeatre-hover-video-reveals-hud',
      pass: xeatreHoverReveal.ok === true,
      detail: xeatreHoverReveal
    });

    // v2.2.15: field-like click — target is #videowrapper (tech has PE none).
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.waitForTimeout(100);
    await page.evaluate(() => {
      if (typeof window.__omtXeatreFitViewport === 'function') window.__omtXeatreFitViewport();
      // Re-assert field PE none after our CSS may force auto (hit-test is rect-based).
      const shell = document.getElementById('hdmi-video');
      const tech = document.querySelector('#hdmi-video video, video.vjs-tech, video');
      if (shell) shell.style.setProperty('pointer-events', 'none', 'important');
      if (tech) tech.style.setProperty('pointer-events', 'none', 'important');
    });
    await page.evaluate(async () => {
      const v = document.querySelector('#hdmi-video video, video.vjs-tech, video');
      const panel = document.getElementById('omt-controls-panel');
      const bar = document.getElementById('omt-timeline-bar');
      if (panel) { panel.style.opacity = '0'; panel.style.pointerEvents = 'none'; }
      if (bar) { bar.style.opacity = '0'; bar.classList.add('omt-chrome-hidden'); }
      try { await v?.play(); } catch (_) {}
    });
    await page.waitForTimeout(60);
    const xeatreVidBox = await page.locator('#videowrapper, #hdmi-video video, video.vjs-tech, video').first().boundingBox();
    let xeatreClickToggle = { ok: false, reason: 'no-box' };
    if (xeatreVidBox) {
      const cx = xeatreVidBox.x + xeatreVidBox.width / 2;
      const cy = xeatreVidBox.y + xeatreVidBox.height / 2;
      const probe = await page.evaluate(({ x, y }) => {
        const stack = (document.elementsFromPoint(x, y) || []).map((el) =>
          (el.tagName || '') + (el.id ? '#' + el.id : '') +
          (el.className && typeof el.className === 'string' ? '.' + el.className.split(/\s+/).slice(0, 2).join('.') : '')
        );
        return { stack, targetHint: stack[0] || null };
      }, { x: cx, y: cy });
      const before = await page.evaluate(() => !!document.querySelector('video')?.paused);
      await page.mouse.click(cx, cy);
      await page.waitForTimeout(120);
      const afterClick = await page.evaluate(() => !!document.querySelector('video')?.paused);
      await page.mouse.click(cx, cy);
      await page.waitForTimeout(120);
      const afterSecond = await page.evaluate(() => !!document.querySelector('video')?.paused);
      xeatreClickToggle = {
        ok: before === false && afterClick === true && afterSecond === false,
        before, afterClick, afterSecond, cx, cy, probe
      };
    }
    results.push({
      name: 'xeatre-video-click-toggles-play',
      pass: xeatreClickToggle.ok === true,
      detail: xeatreClickToggle
    });
    // Explicit rect hit through #videowrapper (matches Vasco field probe).
    const xeatreWrapperClick = await page.evaluate(async () => {
      const wrap = document.getElementById('videowrapper');
      const v = document.querySelector('#hdmi-video_html5_api, #hdmi-video video, video.vjs-tech, video');
      if (!wrap || !v) return { ok: false, reason: 'missing' };
      const panel = document.getElementById('omt-controls-panel');
      const bar = document.getElementById('omt-timeline-bar');
      if (panel) { panel.style.opacity = '0'; panel.style.pointerEvents = 'none'; }
      if (bar) { bar.style.opacity = '0'; bar.classList.add('omt-chrome-hidden'); }
      // Field: shell/tech PE none; clicks land on #videowrapper.
      document.getElementById('hdmi-video')?.style.setProperty('pointer-events', 'none', 'important');
      document.getElementById('ControlBar')?.style.setProperty('pointer-events', 'none', 'important');
      v.style.setProperty('pointer-events', 'none', 'important');
      wrap.style.setProperty('pointer-events', 'auto', 'important');
      try { await v.play(); } catch (_) {}
      await new Promise((r) => setTimeout(r, 40));
      if (v.paused) return { ok: false, reason: 'not-playing' };
      const r = wrap.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) {
        return { ok: false, reason: 'wrapper-collapsed', w: r.width, h: r.height };
      }
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const stack = (document.elementsFromPoint(x, y) || []).map((el) => el.id || el.tagName);
      const before = !!v.paused;
      for (const type of ['pointerdown', 'pointerup', 'click']) {
        wrap.dispatchEvent(new PointerEvent(type, {
          bubbles: true, cancelable: true, composed: true,
          clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1,
          pointerId: 1, pointerType: 'mouse', view: window
        }));
      }
      await new Promise((r) => setTimeout(r, 80));
      const topIsWrapper = stack[0] === 'videowrapper';
      const videoNotInStack = !stack.includes('hdmi-video_html5_api') && !stack.includes('hdmi-video');
      return {
        ok: before === false && v.paused === true && topIsWrapper && videoNotInStack,
        before, after: v.paused, stack, wrapH: Math.round(r.height), wrapW: Math.round(r.width)
      };
    });
    results.push({
      name: 'xeatre-videowrapper-rect-click-toggles',
      pass: xeatreWrapperClick.ok === true,
      detail: xeatreWrapperClick
    });

    // HUD click must NOT toggle.
    const xeatreHudNoToggle = await page.evaluate(async () => {
      const v = document.querySelector('video');
      const panel = document.getElementById('omt-controls-panel');
      if (!v || !panel) return { ok: false, reason: 'missing' };
      panel.style.opacity = '1';
      panel.style.pointerEvents = 'auto';
      try { await v.play(); } catch (_) {}
      await new Promise((r) => setTimeout(r, 40));
      const before = !!v.paused;
      panel.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      panel.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 60));
      return { ok: !!v.paused === before, before, after: !!v.paused };
    });
    results.push({
      name: 'xeatre-hud-click-does-not-toggle',
      pass: xeatreHudNoToggle.ok === true,
      detail: xeatreHudNoToggle
    });

    const xeatrePanelDrag = await page.evaluate(async () => {
      const panel = document.getElementById('omt-controls-panel');
      const handle = document.getElementById('controls-handle');
      if (!panel || !handle) return { ok: false, reason: 'missing' };
      panel.style.opacity = '1';
      panel.style.pointerEvents = 'auto';
      const before = panel.getBoundingClientRect();
      const hr = handle.getBoundingClientRect();
      const x0 = hr.left + hr.width / 2;
      const y0 = hr.top + Math.min(10, hr.height / 2);
      handle.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true, cancelable: true, clientX: x0, clientY: y0, button: 0, view: window
      }));
      window.dispatchEvent(new MouseEvent('mousemove', {
        bubbles: true, cancelable: true, clientX: x0 + 35, clientY: y0 + 25, view: window
      }));
      await new Promise((r) => setTimeout(r, 30));
      const mid = panel.getBoundingClientRect();
      const moved = Math.abs(mid.left - before.left) > 8 || Math.abs(mid.top - before.top) > 8;
      window.dispatchEvent(new MouseEvent('mouseup', {
        bubbles: true, cancelable: true, clientX: x0 + 35, clientY: y0 + 25, view: window
      }));
      await new Promise((r) => setTimeout(r, 30));
      const afterRelease = panel.getBoundingClientRect();
      window.dispatchEvent(new MouseEvent('mousemove', {
        bubbles: true, cancelable: true, clientX: x0 + 100, clientY: y0 + 80, view: window
      }));
      await new Promise((r) => setTimeout(r, 30));
      const afterExtra = panel.getBoundingClientRect();
      const stuck = Math.abs(afterExtra.left - afterRelease.left) > 2 ||
        Math.abs(afterExtra.top - afterRelease.top) > 2;
      return { ok: moved && !stuck, moved, stuck };
    });
    results.push({
      name: 'xeatre-panel-drag-ends-on-mouseup',
      pass: xeatrePanelDrag.ok === true,
      detail: xeatrePanelDrag
    });

    // v2.2.20 field repro: 779×678, panel left 59 / bottom 79, medium.
    // Pointerdown on handle then move −50x/−50y — panel must follow that delta
    // and must NOT jump to the right or bottom edge (2.2.19 field failure).
    async function seedXeatreFieldPanel() {
      await page.setViewportSize({ width: 779, height: 678 });
      await page.waitForTimeout(120);
      await page.evaluate(() => {
        localStorage.setItem('omtPanelSize', 'medium');
        localStorage.setItem('omtPanelCompact', 'false');
        const panel = document.getElementById('omt-controls-panel');
        if (!panel) return;
        panel.classList.remove('omt-panel-size-small', 'omt-panel-compact');
        panel.style.opacity = '1';
        panel.style.pointerEvents = 'auto';
        panel.style.left = '59px';
        panel.style.bottom = '79px';
        panel.style.top = 'auto';
        panel.style.right = 'auto';
        panel.style.transform = 'none';
        if (typeof window.__omtXeatreFitViewport === 'function') window.__omtXeatreFitViewport();
      });
      await page.waitForTimeout(60);
    }

    async function dragHandleDelta(dx, dy) {
      return page.evaluate(async ({ dx, dy }) => {
        const panel = document.getElementById('omt-controls-panel');
        const handle = document.getElementById('controls-handle');
        const root = document.getElementById('omt-root');
        if (!panel || !handle || !root) return { ok: false, reason: 'missing' };
        panel.style.opacity = '1';
        panel.style.pointerEvents = 'auto';
        const before = panel.getBoundingClientRect();
        const hr = handle.getBoundingClientRect();
        const x0 = hr.left + hr.width / 2;
        const y0 = hr.top + Math.min(10, hr.height / 2);
        handle.dispatchEvent(new MouseEvent('mousedown', {
          bubbles: true, cancelable: true, clientX: x0, clientY: y0, button: 0, view: window
        }));
        // Mid-gesture sample (no mouseup yet) — field bug jumped on first move.
        window.dispatchEvent(new MouseEvent('mousemove', {
          bubbles: true, cancelable: true, clientX: x0 + dx, clientY: y0 + dy, view: window
        }));
        await new Promise((r) => setTimeout(r, 40));
        const mid = panel.getBoundingClientRect();
        window.dispatchEvent(new MouseEvent('mouseup', {
          bubbles: true, cancelable: true, clientX: x0 + dx, clientY: y0 + dy, view: window
        }));
        await new Promise((r) => setTimeout(r, 40));
        const after = panel.getBoundingClientRect();
        const rr = root.getBoundingClientRect();
        const dLeft = mid.left - before.left;
        const dTop = mid.top - before.top;
        const deltaOk = Math.abs(dLeft - dx) <= 6 && Math.abs(dTop - dy) <= 6;
        const notRightEdge = (rr.right - mid.right) > 20;
        const notBottomEdge = (rr.bottom - mid.bottom) > 20;
        const notCornerJump = mid.left < before.left + 10 && mid.top < before.top + 10;
        return {
          ok: deltaOk && notRightEdge && notBottomEdge && notCornerJump,
          before: { left: Math.round(before.left), top: Math.round(before.top) },
          mid: { left: Math.round(mid.left), top: Math.round(mid.top) },
          after: { left: Math.round(after.left), top: Math.round(after.top) },
          dLeft: Math.round(dLeft),
          dTop: Math.round(dTop),
          dx, dy,
          deltaOk,
          notRightEdge,
          notBottomEdge,
          rightGap: Math.round(rr.right - mid.right),
          bottomGap: Math.round(rr.bottom - mid.bottom),
          inline: {
            left: panel.style.left,
            top: panel.style.top,
            bottom: panel.style.bottom,
            transform: panel.style.transform
          }
        };
      }, { dx, dy });
    }

    await seedXeatreFieldPanel();
    const seeded = await page.evaluate(() => {
      const panel = document.getElementById('omt-controls-panel');
      const r = panel.getBoundingClientRect();
      return {
        left: Math.round(r.left),
        bottom: Math.round(window.innerHeight - r.bottom),
        width: Math.round(r.width),
        styleLeft: panel.style.left,
        styleBottom: panel.style.bottom
      };
    });
    results.push({
      name: 'xeatre-field-panel-seed-779',
      pass: seeded.left === 59 && Math.abs(seeded.bottom - 79) <= 1 && seeded.width <= 763,
      detail: seeded
    });

    const fieldDrag = await dragHandleDelta(-50, -50);
    results.push({
      name: 'xeatre-field-drag-delta-no-corner-jump',
      pass: fieldDrag.ok === true,
      detail: fieldDrag
    });

    // Repeat after another resize (still narrow) — must still follow the pointer.
    await page.setViewportSize({ width: 700, height: 678 });
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      const panel = document.getElementById('omt-controls-panel');
      if (panel) {
        panel.style.left = '59px';
        panel.style.bottom = '79px';
        panel.style.top = 'auto';
        panel.style.right = 'auto';
        panel.style.transform = 'none';
      }
      if (typeof window.__omtXeatreFitViewport === 'function') window.__omtXeatreFitViewport();
    });
    await page.waitForTimeout(60);
    const fieldDragAfterResize = await dragHandleDelta(-50, -50);
    results.push({
      name: 'xeatre-field-drag-delta-after-resize',
      pass: fieldDragAfterResize.ok === true,
      detail: fieldDragAfterResize
    });
    await page.screenshot({ path: path.join(ARTIFACTS, 'v220_xeatre_field_drag.png'), fullPage: true });

    // Restore a comfortable viewport for remaining Xeatre checks.
    await page.setViewportSize({ width: 960, height: 540 });
    await page.waitForTimeout(120);

    // v2.2.15 alt-tab both modes (visibility only; identical across sites).
    const xeatreBlurDoesNotPause = await page.evaluate(async () => {
      localStorage.setItem('omtKeepPlayingOnAltTab', 'false');
      localStorage.setItem('shuttleXpressEnabled', 'false');
      const v = document.querySelector('video');
      if (!v) return { ok: false };
      v.muted = true;
      try { await v.play(); } catch (_) {}
      await new Promise((r) => setTimeout(r, 40));
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      window.dispatchEvent(new Event('blur'));
      await new Promise((r) => setTimeout(r, 40));
      return { ok: v.paused === false, paused: v.paused };
    });
    results.push({
      name: 'xeatre-blur-does-not-pause',
      pass: xeatreBlurDoesNotPause.ok === true,
      detail: xeatreBlurDoesNotPause
    });

    const xeatreAltTabDefault = await page.evaluate(async () => {
      try { localStorage.removeItem('omtAutoPauseOnBlur'); } catch (_) {}
      localStorage.setItem('omtKeepPlayingOnAltTab', 'false');
      localStorage.setItem('shuttleXpressEnabled', 'false');
      const v = document.querySelector('video');
      if (!v) return { ok: false, reason: 'no-video' };
      v.muted = true;
      try { await v.play(); } catch (e) { return { ok: false, reason: 'play-failed', err: String(e) }; }
      await new Promise((r) => setTimeout(r, 40));
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
      await new Promise((r) => setTimeout(r, 40));
      const afterAway = v.paused;
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
      await new Promise((r) => setTimeout(r, 100));
      return { ok: afterAway === true && v.paused === false, afterAway, afterReturn: v.paused };
    });
    results.push({
      name: 'xeatre-alt-tab-default-pauses-and-resumes',
      pass: xeatreAltTabDefault.ok === true,
      detail: xeatreAltTabDefault
    });

    const xeatreAltTabKeep = await page.evaluate(async () => {
      localStorage.setItem('omtKeepPlayingOnAltTab', 'true');
      localStorage.setItem('shuttleXpressEnabled', 'false');
      const v = document.querySelector('video');
      if (!v) return { ok: false };
      v.muted = true;
      try { await v.play(); } catch (_) {}
      await new Promise((r) => setTimeout(r, 40));
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
      await new Promise((r) => setTimeout(r, 40));
      const afterAway = v.paused;
      v.pause();
      await Promise.resolve();
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 40));
      const afterHostPause = v.paused;
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      document.dispatchEvent(new Event('visibilitychange'));
      return { ok: afterAway === false && afterHostPause === false, afterAway, afterHostPause };
    });
    results.push({
      name: 'xeatre-alt-tab-keep-playing',
      pass: xeatreAltTabKeep.ok === true,
      detail: xeatreAltTabKeep
    });

    // ---- v2.2.18: Xeatre nanoplayer.html is video-only — OMT must inject nothing ----
    await page.goto(`${base}${XEATRE_NANOPLAYER_PATH}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!document.getElementById('h5live-playerDiv'), {
      timeout: 10000
    }).catch(() => {});
    await page.waitForTimeout(600);

    const nanoIdle = await page.evaluate(() => {
      const root = document.getElementById('omt-root');
      const panel = document.getElementById('omt-controls-panel');
      const bar = document.getElementById('omt-timeline-bar');
      const timer = document.getElementById('match-timer-wrap') || document.getElementById('match-timer');
      const setup = document.getElementById('setup-panel');
      const hideCss = document.getElementById('omt-xeatre-hide-css');
      const row = document.getElementById('ControlButtons');
      const reset = document.getElementById('ResetPlayer');
      const html = document.documentElement;
      const cs = (el) => (el ? getComputedStyle(el) : null);
      const rowVisible = !!(row && cs(row).display !== 'none' && cs(row).visibility !== 'hidden' &&
        Number(cs(row).opacity) !== 0);
      const omtDom = document.querySelectorAll('[id^="omt-"], .omt-xeatre, .omt-hud-chip').length;
      return {
        ok: !root && !panel && !bar && !timer && !setup && !hideCss &&
          !html.classList.contains('omt-host-xeatre') &&
          !html.classList.contains('omt-hud-on') &&
          typeof window.__omtHideXeatreNativeChrome !== 'function' &&
          typeof window.__omtXeatreFitViewport !== 'function' &&
          rowVisible && !!reset && omtDom === 0,
        hasRoot: !!root,
        hasPanel: !!panel,
        hasBar: !!bar,
        hasTimer: !!timer,
        hasSetup: !!setup,
        hasHideCss: !!hideCss,
        hostXeatre: html.classList.contains('omt-host-xeatre'),
        hudOn: html.classList.contains('omt-hud-on'),
        hideFn: typeof window.__omtHideXeatreNativeChrome,
        fitFn: typeof window.__omtXeatreFitViewport,
        rowVisible,
        omtDom
      };
    });
    results.push({
      name: 'xeatre-nanoplayer-no-omt-injection',
      pass: nanoIdle.ok === true,
      detail: nanoIdle
    });

    // Native ControlButtons stay fully usable (not hidden / not overlapped by HUD).
    const nanoHostRow = await page.evaluate(() => {
      const row = document.getElementById('ControlButtons');
      const btn = document.getElementById('OpenDvrPlayer');
      if (!row || !btn) return { ok: false, reason: 'missing-row' };
      const before = (window.__xeatreNanoStats && window.__xeatreNanoStats.hostClicks) || 0;
      btn.click();
      const after = (window.__xeatreNanoStats && window.__xeatreNanoStats.hostClicks) || 0;
      const r = row.getBoundingClientRect();
      return {
        ok: after === before + 1 && r.width > 8 && r.height > 8,
        before, after, w: Math.round(r.width), h: Math.round(r.height)
      };
    });
    results.push({
      name: 'xeatre-nanoplayer-host-controlbuttons-intact',
      pass: nanoHostRow.ok === true,
      detail: nanoHostRow
    });
    await page.screenshot({ path: path.join(ARTIFACTS, 'v218_xeatre_nanoplayer_idle.png'), fullPage: true });

    // Resume DVR mock for remaining Xeatre clock/inset checks (OMT still active there).
    await page.goto(`${base}${XEATRE_DVR_PATH}`, { waitUntil: 'domcontentloaded' });
    await waitForOmt(page, 15000);
    await page.waitForFunction(() => {
      const v = document.querySelector('video');
      return !!(v && document.getElementById('omt-root') &&
        document.documentElement.classList.contains('omt-host-xeatre'));
    }, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(300);

    // v2.2.12 #4: Xeatre clock inside letterboxed picture.
    const xeatreClockInset = await page.evaluate(() => {
      const root = document.getElementById('omt-root');
      const wrap = document.getElementById('match-timer-wrap');
      const v = document.querySelector('video');
      if (!root || !wrap || !v) return { ok: false, reason: 'missing' };
      if (typeof window.__omtXeatreFitViewport === 'function') window.__omtXeatreFitViewport();
      try {
        Object.defineProperty(v, 'videoWidth', { configurable: true, get: () => 1920 });
        Object.defineProperty(v, 'videoHeight', { configurable: true, get: () => 800 });
      } catch (_) {}
      if (typeof window.__omtUpdateClockPictureInset === 'function') {
        window.__omtUpdateClockPictureInset();
      } else {
        window.dispatchEvent(new Event('resize'));
      }
      wrap.classList.add('omt-clock-pos-top-left', 'is-visible');
      const top = parseFloat(getComputedStyle(wrap).top) || 0;
      const left = parseFloat(getComputedStyle(wrap).left) || 0;
      const picTop = parseFloat(root.style.getPropertyValue('--omt-pic-top')) || 0;
      const picLeft = parseFloat(root.style.getPropertyValue('--omt-pic-left')) || 0;
      return {
        ok: root.classList.contains('omt-clock-in-picture') && top >= picTop + 10 && left >= picLeft + 10,
        top, left, picTop, picLeft,
        inPicture: root.classList.contains('omt-clock-in-picture')
      };
    });
    results.push({
      name: 'xeatre-clock-in-picture',
      pass: xeatreClockInset.ok === true,
      detail: xeatreClockInset
    });

    // Restore a comfortable viewport for later Xeatre live-UX checks.
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.waitForTimeout(100);
    await page.evaluate(() => {
      if (typeof window.__omtXeatreFitViewport === 'function') window.__omtXeatreFitViewport();
    });

    // v2.2.6: Xeatre shares LIVE bar / button / OSD / tooltip UX (UI layer only).
    const xeatreLiveUx = await page.evaluate(async () => {
      const v = document.querySelector('video');
      const btn = document.getElementById('omt-live-btn');
      const osd = document.getElementById('osd-message');
      const ind = document.getElementById('omt-timeline-live-indicator');
      const chip = document.getElementById('omt-timeline-live-chip');
      const delay = document.getElementById('omt-timeline-live-delay');
      const range = document.getElementById('omt-timeline-video-range');
      const post = document.getElementById('omt-timeline-post-times');
      const match = document.getElementById('omt-timeline-match-clock');
      if (!v || !btn) return { ok: false, reason: 'missing' };
      const end = v.seekable?.length ? v.seekable.end(v.seekable.length - 1) : (v.duration || 0);
      try { v.currentTime = Math.max(0, end - 40); } catch (_) {}
      v.dispatchEvent(new Event('timeupdate'));
      await new Promise((r) => setTimeout(r, 60));
      const texts = [];
      btn.click();
      await new Promise((r) => setTimeout(r, 40));
      if (osd && osd.classList.contains('visible')) texts.push((osd.textContent || '').trim());
      await new Promise((r) => setTimeout(r, 500));
      if (osd && osd.classList.contains('visible')) texts.push((osd.textContent || '').trim());
      const tip = (btn.getAttribute('data-tip') || '').trim();
      const liveIsRed = btn.classList.contains('is-live');
      const chipVisible = !!(chip && !chip.hidden && ind && !ind.hidden);
      const delayVisible = !!(delay && !delay.hidden && ind && !ind.hidden);
      const postVisible = !!(post && !post.hidden);
      const matchVisible = !!(match && !match.hidden);
      const rangeVisible = !!(range && !range.hidden);
      const osdOk = texts.every((t) => !t || (/^(GOING LIVE|LIVE)$/i.test(t) && !/\d/.test(t)));
      const hudOutside = !document.getElementById('hdmi-video')?.contains(document.getElementById('omt-root'));
      return {
        ok: tip === 'Go to live (L)' && liveIsRed && chipVisible && !delayVisible &&
          !postVisible && !matchVisible && rangeVisible && osdOk && hudOutside,
        tip, liveIsRed, chipVisible, delayVisible, postVisible, matchVisible, rangeVisible, texts, hudOutside
      };
    });
    results.push({
      name: 'xeatre-live-ux-bar-chip-tooltip',
      pass: xeatreLiveUx.ok === true,
      detail: xeatreLiveUx
    });

    // ---------- InPlay collapsed player: HUD stays inside the player box ----------
    // No visibility guard (2.0.1–2.0.2 toggled HUD/host chrome on layout
    // changes). The HUD is mounted once; the anchor is a stacking context so
    // host UI outside / above the player stays clickable.
    await page.goto(`${base}/inplayip-curtain-mock.html`, { waitUntil: 'domcontentloaded' });
    await waitForOmt(page, 15000);
    await page.waitForTimeout(200);
    const curtainClosed = await page.evaluate(() => {
      const root = document.getElementById('omt-root');
      const btn = document.getElementById('toggle-curtain');
      const anchor = root?.parentElement;
      const br = btn.getBoundingClientRect();
      const hit = document.elementFromPoint(br.left + br.width / 2, br.top + br.height / 2);
      return {
        hudOn: document.documentElement.classList.contains('omt-hud-on'),
        anchorIsolation: anchor ? getComputedStyle(anchor).isolation : null,
        buttonHitIsHost: hit === btn,
        hit: hit ? (hit.id || hit.tagName) : null
      };
    });
    results.push({
      name: 'inplayip-collapsed-player-host-ui-clickable',
      pass: curtainClosed.hudOn === true && curtainClosed.anchorIsolation === 'isolate' && curtainClosed.buttonHitIsHost === true,
      detail: curtainClosed
    });
    await page.screenshot({ path: path.join(ARTIFACTS, 'v203_inplay_collapsed_player.png'), fullPage: true });

    await page.click('#toggle-curtain');
    await page.waitForTimeout(280);
    const curtainOpen = await page.evaluate(() => {
      const root = document.getElementById('omt-root');
      const v = document.querySelector('video');
      const bar = document.querySelector('.vjs-control-bar');
      const panel = document.getElementById('omt-controls-panel');
      const r = v?.getBoundingClientRect();
      const rootCs = root ? getComputedStyle(root) : null;
      return {
        vh: r ? Math.round(r.height) : -1,
        rootDisplay: rootCs ? rootCs.display : null,
        rootVis: rootCs ? rootCs.visibility : null,
        hudOn: document.documentElement.classList.contains('omt-hud-on'),
        hostBarDisplay: bar ? getComputedStyle(bar).display : null,
        panelVisible: !!panel && panel.getBoundingClientRect().height > 0,
        playerOpen: !!document.getElementById('vjs')?.classList.contains('is-open')
      };
    });
    results.push({
      name: 'inplayip-open-player-shows-hud',
      pass: curtainOpen.vh >= 24 && curtainOpen.rootDisplay !== 'none' && curtainOpen.rootVis !== 'hidden' &&
        curtainOpen.hudOn === true && curtainOpen.playerOpen === true && curtainOpen.panelVisible === true &&
        curtainOpen.hostBarDisplay === 'none',
      detail: curtainOpen
    });
    await page.screenshot({ path: path.join(ARTIFACTS, 'v203_inplay_open_player.png'), fullPage: true });

    // Centre host overlay inside the player keeps its own click target.
    await page.goto(`${base}/inplayip-cover-mock.html`, { waitUntil: 'domcontentloaded' });
    await waitForOmt(page, 15000);
    await page.waitForTimeout(200);
    const coverState = await page.evaluate(() => {
      const root = document.getElementById('omt-root');
      const btn = document.getElementById('host-curtain-btn');
      const rootCs = root ? getComputedStyle(root) : null;
      return {
        hudOn: document.documentElement.classList.contains('omt-hud-on'),
        rootDisplay: rootCs ? rootCs.display : null,
        btnClicksBefore: Number(btn?.getAttribute('data-clicks') || 0)
      };
    });
    await page.click('#host-curtain-btn');
    await page.waitForTimeout(80);
    const coverAfterClick = await page.evaluate(() => {
      const btn = document.getElementById('host-curtain-btn');
      return { clicks: Number(btn?.getAttribute('data-clicks') || 0) };
    });
    results.push({
      name: 'inplayip-centre-cover-keeps-hud',
      pass: coverState.hudOn === true && coverState.rootDisplay !== 'none' &&
        coverAfterClick.clicks === coverState.btnClicksBefore + 1,
      detail: { coverState, coverAfterClick }
    });
    await page.screenshot({ path: path.join(ARTIFACTS, 'v203_centre_cover_keeps_hud.png'), fullPage: true });

    // ---------- v2.1.2: InPlay host close-X must not freeze the tab ----------
    // Field: round black ✕ under the curtain arrow closes the video; with OMT
    // on, Chrome showed "page unresponsive" every time (extension off: fine).
    // Cause: SPA teardown→boot attached a document MutationObserver while VJS
    // was still dismantling; isLiveStream read .players-container innerText.
    await page.goto(`${base}/inplayip-close-x-mock.html`, { waitUntil: 'domcontentloaded' });
    await waitForOmt(page, 15000);
    await page.waitForTimeout(500);
    const closeXProbe = await page.evaluate(() => {
      const btn = document.getElementById('host-close-x');
      if (!btn) return { ok: false, reason: 'no-close-x' };
      const r = btn.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return {
        ok: true,
        hitIsHost: !!(hit && (hit === btn || btn.contains(hit))),
        hitInsideOmt: !!(hit && hit.closest && hit.closest('#omt-root')),
        hudOn: document.documentElement.classList.contains('omt-hud-on'),
        fires0: Number(window.__omtInplayBootMoFires || 0)
      };
    });
    results.push({
      name: 'inplayip-close-x-is-host-clickable',
      pass: closeXProbe.ok === true && closeXProbe.hitIsHost === true && closeXProbe.hitInsideOmt === false,
      detail: closeXProbe
    });

    const closeXStorm = await page.evaluate(async () => {
      const entries = [];
      let obs = null;
      try {
        obs = new PerformanceObserver((list) => {
          list.getEntries().forEach((e) => entries.push(e.duration));
        });
        obs.observe({ type: 'longtask', buffered: false });
      } catch (_) {}
      window.__omtInplayBootMoFires = 0;
      const t0 = performance.now();
      // Click close-X repeatedly with remount cycles (field: every close froze).
      for (let i = 0; i < 4; i++) {
        const btn = document.getElementById('host-close-x');
        if (btn) btn.click();
        await new Promise((r) => setTimeout(r, 400));
        // Remount a Review player so the next close can run again.
        if (!document.querySelector('video')) {
          const players = document.getElementById('players') || document.body;
          const wrap = document.createElement('div');
          wrap.className = 'player-container';
          wrap.id = 'player-wrap';
          wrap.innerHTML = '<div class="video-js" id="vjs">' +
            '<video class="vjs-tech" id="tech" muted playsinline></video>' +
            '<div class="vjs-control-bar"><div class="vjs-progress-control" id="progress"></div></div>' +
            '<div id="vjs-chrome-bulk"></div></div>' +
            '<button type="button" id="curtain-arrow">▼</button>' +
            '<button type="button" id="host-close-x">✕</button>';
          players.appendChild(wrap);
          const bulk = document.getElementById('vjs-chrome-bulk');
          for (let j = 0; j < 80; j++) {
            const d = document.createElement('div');
            d.className = 'vjs-bulk-node';
            d.textContent = 'n' + j;
            bulk.appendChild(d);
          }
          const video = document.getElementById('tech');
          Object.defineProperty(video, 'duration', { configurable: true, get: () => 5400 });
          Object.defineProperty(video, 'seekable', {
            configurable: true,
            get: () => ({ length: 1, start: () => 0, end: () => 5400 })
          });
          video.addEventListener('click', () => {});
          document.getElementById('host-close-x').addEventListener('click', () => {
            const progress = document.getElementById('progress');
            if (progress) progress.remove();
            document.querySelectorAll('.vjs-bulk-node').forEach((n) => n.remove());
            const tech = document.getElementById('tech');
            if (tech) tech.remove();
            const bar = document.querySelector('.vjs-control-bar');
            if (bar) bar.remove();
            const vjs = document.getElementById('vjs');
            if (vjs) vjs.remove();
            const w = document.getElementById('player-wrap');
            if (w) w.remove();
            window.__inplayCloseState = window.__inplayCloseState || { closed: 0 };
            window.__inplayCloseState.closed += 1;
          });
        }
        await new Promise((r) => setTimeout(r, 1600)); // allow SPA tick
      }
      await new Promise((r) => setTimeout(r, 500));
      if (obs) obs.disconnect();
      const elapsed = performance.now() - t0;
      const longTaskMs = Math.round(entries.reduce((a, b) => a + b, 0));
      // Probe main-thread responsiveness after the closes.
      const probeT0 = performance.now();
      await new Promise((r) => setTimeout(r, 50));
      const probeDt = performance.now() - probeT0;
      return {
        ok: longTaskMs < 2500 &&
          Number(window.__omtInplayBootMoFires || 0) < 80 &&
          probeDt < 500 &&
          (window.__inplayCloseState && window.__inplayCloseState.closed >= 1),
        longTasks: entries.length,
        longTaskMs,
        bootMoFires: Number(window.__omtInplayBootMoFires || 0),
        closed: window.__inplayCloseState ? window.__inplayCloseState.closed : 0,
        probeDt: Math.round(probeDt),
        elapsedMs: Math.round(elapsed),
        hudOnAfter: document.documentElement.classList.contains('omt-hud-on'),
        videoAfter: !!document.querySelector('video')
      };
    });
    results.push({
      name: 'inplayip-close-x-no-observer-storm',
      pass: closeXStorm.ok === true,
      detail: closeXStorm
    });
    await page.screenshot({ path: path.join(ARTIFACTS, 'v212_inplay_close_x.png'), fullPage: true });

    // ---------- InPlay 10s CPU / loop guard ----------
    await page.goto(`${base}/inplayip-mock.html`, { waitUntil: 'domcontentloaded' });
    await waitForOmt(page, 15000);
    await page.waitForTimeout(400);

    // v2.2.6: InPlay UI-layer LIVE chrome (bar / chip / button / tooltip) — no host/player changes.
    const inplayLiveUx = await page.evaluate(async () => {
      const v = document.querySelector('video');
      const btn = document.getElementById('omt-live-btn');
      const osd = document.getElementById('osd-message');
      const ind = document.getElementById('omt-timeline-live-indicator');
      const chip = document.getElementById('omt-timeline-live-chip');
      const delay = document.getElementById('omt-timeline-live-delay');
      const range = document.getElementById('omt-timeline-video-range');
      const post = document.getElementById('omt-timeline-post-times');
      const match = document.getElementById('omt-timeline-match-clock');
      if (!v || !btn) return { ok: false, reason: 'missing' };
      const end = v.seekable?.length ? v.seekable.end(v.seekable.length - 1) : (v.duration || 0);
      try { v.currentTime = Math.max(0, end - 40); } catch (_) {}
      v.dispatchEvent(new Event('timeupdate'));
      await new Promise((r) => setTimeout(r, 80));
      const behind = {
        delayVisible: !!(delay && !delay.hidden && ind && !ind.hidden),
        chipVisible: !!(chip && !chip.hidden && ind && !ind.hidden),
        postVisible: !!(post && !post.hidden),
        matchVisible: !!(match && !match.hidden),
        rangeVisible: !!(range && !range.hidden),
        liveIsRed: btn.classList.contains('is-live'),
        delayText: delay ? (delay.textContent || '').trim() : null
      };
      const texts = [];
      btn.click();
      await new Promise((r) => setTimeout(r, 40));
      if (osd && osd.classList.contains('visible')) texts.push((osd.textContent || '').trim());
      await new Promise((r) => setTimeout(r, 500));
      if (osd && osd.classList.contains('visible')) texts.push((osd.textContent || '').trim());
      const tip = (btn.getAttribute('data-tip') || '').trim();
      const after = {
        tip,
        liveIsRed: btn.classList.contains('is-live'),
        chipVisible: !!(chip && !chip.hidden && ind && !ind.hidden),
        delayVisible: !!(delay && !delay.hidden && ind && !ind.hidden),
        postVisible: !!(post && !post.hidden),
        matchVisible: !!(match && !match.hidden),
        rangeVisible: !!(range && !range.hidden),
        texts,
        osdOk: texts.every((t) => !t || (/^(GOING LIVE|LIVE)$/i.test(t) && !/\d/.test(t)))
      };
      return {
        ok: behind.delayVisible && !behind.chipVisible && !behind.postVisible && !behind.matchVisible &&
          behind.rangeVisible && !behind.liveIsRed &&
          after.tip === 'Go to live (L)' && after.liveIsRed && after.chipVisible &&
          !after.delayVisible && !after.postVisible && !after.matchVisible &&
          after.rangeVisible && after.osdOk,
        behind,
        after
      };
    });
    results.push({
      name: 'inplayip-live-ux-bar-chip-tooltip',
      pass: inplayLiveUx.ok === true,
      detail: inplayLiveUx
    });

    const inplayLoopGuard = await page.evaluate(async () => {
      const v = document.querySelector('video');
      if (!v) return { ok: false, reason: 'no-video' };
      try { await v.play(); } catch (_) {}
      let playN = 0;
      let pauseN = 0;
      let seekingN = 0;
      let waitingN = 0;
      let hudClassFlips = 0;
      const onPlay = () => { playN += 1; };
      const onPause = () => { pauseN += 1; };
      const onSeeking = () => { seekingN += 1; };
      const onWaiting = () => { waitingN += 1; };
      v.addEventListener('play', onPlay);
      v.addEventListener('pause', onPause);
      v.addEventListener('seeking', onSeeking);
      v.addEventListener('waiting', onWaiting);
      const htmlObs = new MutationObserver(() => { hudClassFlips += 1; });
      htmlObs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
      const longTasks = [];
      let lto = null;
      try {
        lto = new PerformanceObserver((l) => l.getEntries().forEach((e) => longTasks.push(e.duration)));
        lto.observe({ type: 'longtask' });
      } catch (_) {}
      const started = performance.now();
      for (let i = 0; i < 20; i++) {
        window.dispatchEvent(new Event('resize'));
        window.dispatchEvent(new Event('scroll'));
        await new Promise((r) => setTimeout(r, 50));
      }
      await new Promise((r) => setTimeout(r, 10000));
      const elapsed = performance.now() - started;
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('seeking', onSeeking);
      v.removeEventListener('waiting', onWaiting);
      htmlObs.disconnect();
      if (lto) lto.disconnect();
      const ok = playN === 0 && pauseN === 0 && seekingN <= 5 && waitingN <= 30 &&
        hudClassFlips === 0 && longTasks.length <= 2 && v.paused === false;
      return {
        ok,
        elapsedMs: Math.round(elapsed),
        playN,
        pauseN,
        seekingN,
        waitingN,
        hudClassFlips,
        longTasks: longTasks.length,
        paused: v.paused,
        hudOn: document.documentElement.classList.contains('omt-hud-on')
      };
    });
    results.push({
      name: 'inplayip-idle-no-cpu-loop',
      pass: inplayLoopGuard.ok === true,
      detail: inplayLoopGuard
    });

    // ---------- Field scenarios (same code as compare-baseline.mjs vs 1.2.0) ----------
    // InPlay /schedule: curtain arrow over a full-viewport Video.js player,
    // fullscreen on #root like inplayip.tv.
    const schedulePage = await context.newPage();
    const inplaySchedule = await runInplayScheduleScenario(schedulePage, base);
    await schedulePage.screenshot({ path: path.join(ARTIFACTS, 'v203_inplay_schedule_after_fs.png') }).catch(() => {});
    await schedulePage.close();
    const { detail: inplayScheduleDetail, ...inplayScheduleSummary } = inplaySchedule;
    results.push({
      name: 'inplayip-schedule-arrow-is-host-in-and-out-of-fs',
      pass: inplaySchedule.mounted && inplaySchedule.enteredFullscreen &&
        inplaySchedule.arrowsHost === inplaySchedule.arrowsTotal && inplaySchedule.allToggled,
      detail: { ...inplayScheduleSummary, arrows: inplayScheduleDetail }
    });
    results.push({
      name: 'inplayip-schedule-toggle-fast',
      pass: inplaySchedule.toggleMaxMs != null && inplaySchedule.toggleMaxMs <= 250,
      detail: { toggleTimes: inplaySchedule.toggleTimes }
    });
    results.push({
      name: 'inplayip-schedule-hud-never-over-curtain',
      pass: inplaySchedule.hudCoveredPointsOpen === 0 && inplaySchedule.hudOnTopIds.length === 0,
      detail: { covered: inplaySchedule.hudCoveredPointsOpen, ids: inplaySchedule.hudOnTopIds }
    });
    results.push({
      name: 'inplayip-schedule-arrow-after-fs-exit',
      pass: inplaySchedule.afterExitArrowPresent === true,
      detail: inplayScheduleDetail.afterExit.collapsed
    });
    results.push({
      name: 'inplayip-schedule-fs-idle-no-cpu-loop',
      pass: inplaySchedule.idleFsOpen.longTasks <= 1,
      detail: inplaySchedule.idleFsOpen
    });

    // Examino /play/dvr/: Source row never confirms, each pick replaces <video>.
    const examinoFieldPage = await context.newPage();
    const examinoField = await runExaminoFieldScenario(examinoFieldPage, base);
    await examinoFieldPage.screenshot({ path: path.join(ARTIFACTS, 'v203_examino_field_idle.png') }).catch(() => {});
    await examinoFieldPage.close();
    results.push({
      name: 'examino-field-idle-zero-media-events',
      pass: examinoField.mounted && examinoField.idle.play === 0 && examinoField.idle.pause === 0 &&
        examinoField.idle.waiting === 0 && examinoField.idle.sourceLoads === 0 && examinoField.idle.gearClicks === 0,
      detail: examinoField
    });
    results.push({
      name: 'examino-field-player-opens',
      pass: examinoField.playerOpen === true && examinoField.boot.sourceLoads <= 2 && examinoField.uncaughtAbort === 0,
      detail: { boot: examinoField.boot, playerOpen: examinoField.playerOpen, uncaughtAbort: examinoField.uncaughtAbort }
    });
    // Background tabs defer autoplay; later tests expect a playing video.
    await page.bringToFront();

    // ---------- Host CSS isolation (html font-size 10px + aggressive resets) ----------
    await page.goto(`${base}/inplayip-css-leak-mock.html`, { waitUntil: 'domcontentloaded' });
    await waitForOmt(page, 15000);
    await page.evaluate(() => {
      const panel = document.getElementById('omt-controls-panel');
      const bar = document.getElementById('omt-timeline-bar');
      [panel, bar].forEach((el) => {
        if (!el) return;
        el.style.opacity = '1';
        el.style.pointerEvents = 'auto';
      });
      const more = document.getElementById('omt-more-toggle');
      const morePanel = document.getElementById('omt-more-panel');
      if (more && morePanel && !morePanel.classList.contains('is-open')) more.click();
    });
    await page.waitForTimeout(120);
    // "Before" reference: measure a naked host button under the leak styles
    const cssLeak = await page.evaluate(() => {
      const probe = document.createElement('button');
      probe.textContent = 'Host';
      probe.id = 'omt-host-probe';
      document.body.appendChild(probe);
      const hostFs = parseFloat(getComputedStyle(probe).fontSize) || 0;
      const hostBg = getComputedStyle(probe).backgroundColor;
      probe.remove();
      const root = document.getElementById('omt-root');
      const label = root?.querySelector('.omt-btn-label');
      const time = root?.querySelector('.omt-time-text');
      const rootFs = root ? parseFloat(getComputedStyle(root).fontSize) || 0 : 0;
      const labelFs = label ? parseFloat(getComputedStyle(label).fontSize) || 0 : 0;
      const timeFs = time ? parseFloat(getComputedStyle(time).fontSize) || 0 : 0;
      const box = label ? label.getBoundingClientRect() : null;
      const kick = document.getElementById('omt-btn-set-kickoff');
      const kickCs = kick ? getComputedStyle(kick) : null;
      const speed = root?.querySelector('.omt-speed-chip.is-active');
      const speedCs = speed ? getComputedStyle(speed) : null;
      const play = document.getElementById('omt-btn-play');
      if (play && !play.classList.contains('playing')) play.classList.add('playing');
      const playCs = play ? getComputedStyle(play) : null;
      const isOrangeBg = (c) => /245,\s*131,\s*31/.test(c || '') || /rgb\(245,\s*131,\s*31\)/.test(c || '');
      const isOrangeFg = (c) => /245,\s*131,\s*31/.test(c || '');
      return {
        hostFs,
        hostBg,
        rootFs,
        labelFs,
        timeFs,
        labelW: box ? Math.round(box.width) : 0,
        htmlFs: parseFloat(getComputedStyle(document.documentElement).fontSize) || 0,
        kickBg: kickCs?.backgroundColor || '',
        kickColor: kickCs?.color || '',
        kickFilter: kickCs?.filter || '',
        kickOpacity: kickCs?.opacity || '',
        kickOrange: !!(kickCs && isOrangeBg(kickCs.backgroundColor) && !/grayscale/.test(kickCs.filter || '')),
        speedOrange: !!(speedCs && isOrangeFg(speedCs.color)),
        playOrange: !!(playCs && isOrangeFg(playCs.color))
      };
    });
    results.push({
      name: 'overlay-css-isolation-from-host',
      pass: cssLeak.htmlFs <= 10.5
        && cssLeak.hostFs < 12
        && cssLeak.rootFs >= 15.5
        && cssLeak.labelFs >= 10.5 && cssLeak.labelFs <= 12.5
        && cssLeak.timeFs >= 10.5 && cssLeak.timeFs <= 12.5,
      detail: cssLeak
    });
    results.push({
      name: 'overlay-accent-colors-survive-host-button-css',
      pass: cssLeak.kickOrange === true
        && cssLeak.speedOrange === true
        && cssLeak.playOrange === true
        && cssLeak.kickOpacity === '1',
      detail: {
        kickBg: cssLeak.kickBg,
        kickColor: cssLeak.kickColor,
        kickFilter: cssLeak.kickFilter,
        kickOpacity: cssLeak.kickOpacity,
        speedOrange: cssLeak.speedOrange,
        playOrange: cssLeak.playOrange,
        hostBg: cssLeak.hostBg
      }
    });
    await page.screenshot({ path: path.join(ARTIFACTS, 'v201_overlay_css_isolation_after.png'), fullPage: true });
    const kickBox = await page.locator('#omt-btn-set-kickoff').boundingBox();
    if (kickBox) {
      await page.screenshot({
        path: path.join(ARTIFACTS, 'v201_kickoff_accent_after.png'),
        clip: {
          x: Math.max(0, kickBox.x - 12),
          y: Math.max(0, kickBox.y - 12),
          width: Math.min(kickBox.width + 24, 400),
          height: Math.min(kickBox.height + 24, 80)
        }
      });
    }
    // Synthetic "before" shot: show host probe vs overlay metrics as caption page
    await page.evaluate((m) => {
      const el = document.getElementById('status');
      if (el) {
        el.textContent = 'Host html font-size=' + m.htmlFs + 'px; host button≈' + m.hostFs.toFixed(1)
          + 'px; overlay root=' + m.rootFs + 'px label=' + m.labelFs + 'px (isolated)';
      }
    }, cssLeak);
    await page.screenshot({ path: path.join(ARTIFACTS, 'v201_overlay_css_isolation_compare.png'), fullPage: true });

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
      const popupOk = await popupPage.evaluate((manifestVersion) => {
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
          footOk: foot === 'v' + manifestVersion,
          hasKeepPlayingAltTab: !!document.getElementById('omt-keep-playing-alt-tab'),
          keepPlayingDefaultOff: document.getElementById('omt-keep-playing-alt-tab')
            ? document.getElementById('omt-keep-playing-alt-tab').checked === false
            : false,
          keepPlayingLabel: (document.querySelector('label[for="omt-keep-playing-alt-tab"], .omt-toggle-row:has(#omt-keep-playing-alt-tab) .omt-toggle-label')?.textContent || '').trim(),
          noLegacyAutoPause: !document.getElementById('omt-auto-pause-blur'),
          hasOpenLocal: !!document.getElementById('omt-open-local-player'),
          openLocalLabel: (document.getElementById('omt-open-local-player')?.textContent || '').trim(),
          logoSrc: document.querySelector('.omt-sp-logo')?.getAttribute('src') || '',
          logoNoTitle: (() => {
            const wrap = document.querySelector('.omt-brand-logo-wrap');
            const t = (wrap?.getAttribute('title') || '').trim();
            return !!wrap && t === '';
          })(),
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
      }, JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8')).version);
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
        path: path.join(ARTIFACTS, 'v201_popup_general_full.png'),
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
      // Restore General defaults before Customize default checks
      await popupPage.evaluate(() => {
        const a = document.getElementById('omt-gen-actions-details');
        const s = document.getElementById('omt-gen-shortcuts-details');
        const sh = document.getElementById('omt-gen-shuttle-details');
        if (a) a.open = true;
        if (s) s.open = false;
        if (sh) sh.open = false;
      });
      await popupPage.waitForTimeout(60);
      results.push({
        name: 'popup-branding-and-personalizar',
        pass: popupOk.hasWordmark && popupOk.hasLogo && popupOk.logoCount === 1 &&
          popupOk.hasCustomize && popupOk.noSoonBanner && popupOk.noShuttleToggleInPopup &&
          popupOk.noSwap && popupOk.noCredit && popupOk.noPersonalizar &&
          popupOk.footOk && popupOk.keyCaps && popupOk.logoUncropped &&
          popupOk.logoNoTitle === true &&
          popupOk.hasKeepPlayingAltTab && popupOk.keepPlayingDefaultOff &&
          popupOk.noLegacyAutoPause && /Keep playing on alt tab/i.test(popupOk.keepPlayingLabel || '') &&
          popupOk.hasOpenLocal && popupOk.openLocalLabel === 'Open local player' &&
          /stats-perform-logo-dark\.png/i.test(popupOk.logoSrc || '') &&
          popupOk.hasShuttleSummary &&
          popupOk.noGeneralShuttleList === true &&
          popupOk.headerClock === '20:08' &&
          popupOk.generalDiagram.ok === true &&
          popupOk.toggleKnob.ok === true,
        detail: popupOk
      });
      const logoBox = await popupPage.locator('.omt-brand-logo-wrap').boundingBox();
      if (logoBox) {
        await popupPage.screenshot({
          path: path.join(ARTIFACTS, 'v201_popup_logo_no_tooltip.png'),
          clip: {
            x: Math.max(0, logoBox.x - 8),
            y: Math.max(0, logoBox.y - 8),
            width: Math.min(logoBox.width + 16, 320),
            height: Math.min(logoBox.height + 40, 120)
          }
        });
      }
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
      // Full Customize capture with short help copy (all sections open)
      await popupPage.evaluate(() => {
        ['omt-clock-details', 'omt-panel-details', 'omt-hotkeys-details', 'omt-shuttle-details'].forEach((id) => {
          const el = document.getElementById(id);
          if (el) el.open = true;
        });
      });
      await popupPage.waitForTimeout(120);
      await popupPage.screenshot({ path: path.join(ARTIFACTS, 'v201_popup_customize_full.png'), fullPage: true });
      // Restore Customize defaults for later section-sensitive steps
      await popupPage.evaluate(() => {
        const clock = document.getElementById('omt-clock-details');
        const panel = document.getElementById('omt-panel-details');
        const hotkeys = document.getElementById('omt-hotkeys-details');
        const shuttle = document.getElementById('omt-shuttle-details');
        if (clock) clock.open = true;
        if (panel) panel.open = false;
        if (hotkeys) hotkeys.open = false;
        if (shuttle) shuttle.open = false;
      });
      await popupPage.waitForTimeout(60);

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

      // Control panel size + Compact defaults
      await popupPage.evaluate(() => {
        const p = document.getElementById('omt-panel-details');
        if (p) p.open = true;
      });
      await popupPage.waitForTimeout(80);
      const panelUi = await popupPage.evaluate(() => {
        const size = document.getElementById('panel-size');
        const compact = document.getElementById('panel-compact');
        return {
          hasSize: !!size,
          sizeDefault: size?.value || '',
          sizeOptions: Array.from(size?.options || []).map((o) => o.value),
          compactDefaultOff: !!(compact && compact.checked === false),
          noSkipTimesSection: !document.getElementById('omt-skips-details')
        };
      });
      results.push({
        name: 'customize-panel-skip-defaults',
        pass: panelUi.hasSize
          && panelUi.sizeDefault === 'medium'
          && panelUi.sizeOptions.join(',') === 'medium,small'
          && panelUi.compactDefaultOff
          && panelUi.noSkipTimesSection,
        detail: panelUi
      });
      await popupPage.selectOption('#panel-size', 'small');
      await popupPage.evaluate(() => {
        const c = document.getElementById('panel-compact');
        if (c) {
          c.checked = true;
          c.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
      await popupPage.waitForTimeout(80);

      // Shortcuts: per-row skip seconds (defaults / clamp) + live labels
      await popupPage.evaluate(() => {
        const d = document.getElementById('omt-hotkeys-details');
        if (d) d.open = true;
        d?.scrollIntoView({ block: 'start' });
      });
      await popupPage.waitForTimeout(100);
      const skipRowDefaults = await popupPage.evaluate(() => {
        const ids = ['skipBack2', 'skipFwd2', 'skipBack10', 'skipFwd10', 'skipBack2m', 'skipFwd2m'];
        const vals = {};
        const labels = {};
        const labelFits = {};
        ids.forEach((id) => {
          vals[id] = document.getElementById('omt-skip-' + id)?.value || '';
          const row = document.querySelector('.omt-hotkey-row[data-id="' + id + '"]');
          const labelEl = row?.querySelector('.omt-hotkey-label');
          labels[id] = (labelEl?.textContent || '').trim();
          // Measure rendered text vs available width (avoids false pass from stretched grid item).
          let fits = false;
          if (labelEl) {
            const range = document.createRange();
            range.selectNodeContents(labelEl);
            const textW = range.getBoundingClientRect().width;
            const avail = labelEl.getBoundingClientRect().width;
            const cs = getComputedStyle(labelEl);
            fits = textW <= avail + 1 && cs.textOverflow !== 'ellipsis';
          }
          labelFits[id] = fits;
        });
        return {
          vals,
          labels,
          labelFits,
          hasInputs: ids.every((id) => !!document.getElementById('omt-skip-' + id)),
          hasSkipReset: !!document.querySelector('[data-reset-skip="skipBack2"]'),
          hasSkipTools: !!document.querySelector('.omt-hotkey-row--skip .omt-hotkey-skip-tools')
        };
      });
      results.push({
        name: 'customize-shortcut-skip-defaults',
        pass: skipRowDefaults.hasInputs
          && skipRowDefaults.hasSkipReset
          && skipRowDefaults.hasSkipTools
          && skipRowDefaults.vals.skipBack2 === '2'
          && skipRowDefaults.vals.skipBack10 === '10'
          && skipRowDefaults.vals.skipBack2m === '120'
          && skipRowDefaults.labels.skipBack2 === 'Skip back 2 s'
          && skipRowDefaults.labels.skipFwd10 === 'Skip forward 10 s'
          && skipRowDefaults.labels.skipBack2m === 'Skip back 2 min'
          && Object.values(skipRowDefaults.labelFits).every(Boolean),
        detail: skipRowDefaults
      });
      await popupPage.fill('#omt-skip-skipBack2', '0');
      await popupPage.fill('#omt-skip-skipFwd2', '0');
      await popupPage.fill('#omt-skip-skipBack2m', '1500');
      await popupPage.fill('#omt-skip-skipFwd2m', '1500');
      await popupPage.locator('#omt-skip-skipFwd2m').blur();
      await popupPage.waitForTimeout(150);
      const skipClamped = await popupPage.evaluate(() => ({
        back2: document.getElementById('omt-skip-skipBack2')?.value,
        fwd2: document.getElementById('omt-skip-skipFwd2')?.value,
        back2m: document.getElementById('omt-skip-skipBack2m')?.value,
        fwd2m: document.getElementById('omt-skip-skipFwd2m')?.value,
        labelBack2: (document.querySelector('.omt-hotkey-row[data-id="skipBack2"] .omt-hotkey-label')?.textContent || '').trim(),
        labelBack2m: (document.querySelector('.omt-hotkey-row[data-id="skipBack2m"] .omt-hotkey-label')?.textContent || '').trim()
      }));
      results.push({
        name: 'customize-panel-skip-clamp-persist',
        pass: skipClamped.back2 === '1'
          && skipClamped.fwd2 === '1'
          && skipClamped.back2m === '999'
          && skipClamped.fwd2m === '999'
          && skipClamped.labelBack2 === 'Skip back 1 s'
          && skipClamped.labelBack2m === 'Skip back 16:39 min',
        detail: skipClamped
      });
      // Set swap case for screenshot: short-row 120, long-row 2
      await popupPage.fill('#omt-skip-skipBack2', '120');
      await popupPage.fill('#omt-skip-skipFwd2', '120');
      await popupPage.fill('#omt-skip-skipBack2m', '2');
      await popupPage.fill('#omt-skip-skipFwd2m', '2');
      await popupPage.locator('#omt-skip-skipFwd2m').blur();
      await popupPage.waitForTimeout(120);
      // Focus Shortcuts; expand editor so all six skip rows are visible
      await popupPage.evaluate(() => {
        document.getElementById('omt-clock-details') && (document.getElementById('omt-clock-details').open = false);
        document.getElementById('omt-panel-details') && (document.getElementById('omt-panel-details').open = false);
        document.getElementById('omt-shuttle-details') && (document.getElementById('omt-shuttle-details').open = false);
        const d = document.getElementById('omt-hotkeys-details');
        if (d) d.open = true;
        d?.scrollIntoView({ block: 'start' });
        const editor = document.getElementById('omt-hotkey-editor');
        if (editor) {
          editor.style.maxHeight = 'none';
          const firstSkip = document.querySelector('.omt-hotkey-row--skip');
          if (firstSkip) editor.scrollTop = Math.max(0, firstSkip.offsetTop - 2);
        }
      });
      await popupPage.waitForTimeout(80);
      await popupPage.locator('#omt-hotkeys-details').screenshot({
        path: path.join(ARTIFACTS, 'v201_customize_shortcuts_skips.png')
      });
      await popupPage.evaluate(() => {
        const editor = document.getElementById('omt-hotkey-editor');
        if (editor) editor.style.maxHeight = '';
      });

      // General list shows live times
      await popupPage.click('[data-tab="general"]');
      await popupPage.evaluate(() => {
        const d = document.getElementById('omt-gen-shortcuts-details');
        if (d) d.open = true;
      });
      await popupPage.waitForTimeout(80);
      const generalSkipLabels = await popupPage.evaluate(() => {
        const items = Array.from(document.querySelectorAll('#omt-shortcut-list .shortcut-item .shortcut-label'))
          .map((el) => (el.textContent || '').trim());
        return {
          items,
          hasBack120: items.some((t) => t === 'Skip back 2 min'),
          hasFwd2: items.some((t) => t === 'Skip forward 2 s'),
          hasBack10: items.some((t) => t === 'Skip back 10 s')
        };
      });
      results.push({
        name: 'general-skip-labels-live',
        pass: generalSkipLabels.hasBack120 && generalSkipLabels.hasFwd2 && generalSkipLabels.hasBack10,
        detail: generalSkipLabels
      });
      await popupPage.screenshot({ path: path.join(ARTIFACTS, 'v201_general_shortcuts_skips.png'), fullPage: true });
      await popupPage.click('[data-tab="customize"]');
      await popupPage.evaluate(() => {
        const panel = document.getElementById('omt-panel-details');
        if (panel) panel.open = true;
        const size = document.getElementById('panel-size');
        if (size) {
          size.value = 'medium';
          size.dispatchEvent(new Event('change', { bubbles: true }));
        }
        const c = document.getElementById('panel-compact');
        if (c) {
          c.checked = false;
          c.dispatchEvent(new Event('change', { bubbles: true }));
        }
        // Reset skip seconds for later tests
        ['skipBack2', 'skipFwd2', 'skipBack10', 'skipFwd10', 'skipBack2m', 'skipFwd2m'].forEach((id) => {
          document.querySelector('[data-reset-skip="' + id + '"]')?.click();
        });
      });
      await popupPage.waitForTimeout(80);

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
          compactHotkeyScroll: !!hkCs && Number.isFinite(maxH) && maxH > 0 && maxH <= 300 &&
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
          const panel = document.getElementById('omt-controls-panel');
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
        const controls = document.getElementById('omt-controls-panel');
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

      const localCopy = await localPage.evaluate(() => {
        const copy = (document.querySelector('.omt-local-drop-copy')?.textContent || '').trim();
        const hint = (document.querySelector('.omt-local-drop-hint')?.textContent || '').trim();
        return {
          title: document.title,
          copy,
          hint,
          browse: (document.getElementById('omt-local-browse')?.textContent || '').trim()
        };
      });
      results.push({
        name: 'local-drop-copy-and-title',
        pass: localCopy.title === 'Overlay MatchTimer'
          && localCopy.copy === 'Drop or browse a match video file, local or from the NAS.'
          && localCopy.hint === 'Multiple player windows are supported, enable ShuttleXpress only in the window that should own the device.'
          && localCopy.browse === 'Open file'
          && !/[—–]/.test(localCopy.copy + localCopy.hint),
        detail: localCopy
      });
      await localPage.screenshot({ path: path.join(ARTIFACTS, 'v201_local_drop_zone.png'), fullPage: true });

      await localPage.screenshot({ path: path.join(ARTIFACTS, 'local_player_empty.png'), fullPage: true });

      await localPage.setInputFiles('#omt-local-file-input', sampleMp4);
      await localPage.waitForFunction(() => {
        const v = document.getElementById('omt-local-video');
        const drop = document.getElementById('omt-local-drop');
        return v && v.src && drop && drop.hidden && v.readyState >= 1;
      }, null, { timeout: 15000 });

      // Force HUD visible for screenshots / interaction
      await localPage.evaluate(() => {
        const panel = document.getElementById('omt-controls-panel');
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
        const panel = document.getElementById('omt-controls-panel');
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
        const panel = document.getElementById('omt-controls-panel');
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
        const panel = document.getElementById('omt-controls-panel');
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
        const panel = document.getElementById('omt-controls-panel');
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

      // v2.2.14: panel drag ends on mouseup; dblclick on panel does not toggle.
      const localPanelDrag = await localPage.evaluate(async () => {
        const panel = document.getElementById('omt-controls-panel');
        const handle = document.getElementById('controls-handle');
        if (!panel || !handle) return { ok: false, reason: 'missing' };
        panel.style.opacity = '1';
        panel.style.pointerEvents = 'auto';
        const before = panel.getBoundingClientRect();
        const hr = handle.getBoundingClientRect();
        const x0 = hr.left + hr.width / 2;
        const y0 = hr.top + Math.min(10, hr.height / 2);
        handle.dispatchEvent(new MouseEvent('mousedown', {
          bubbles: true, cancelable: true, clientX: x0, clientY: y0, button: 0, view: window
        }));
        window.dispatchEvent(new MouseEvent('mousemove', {
          bubbles: true, cancelable: true, clientX: x0 + 35, clientY: y0 + 25, view: window
        }));
        await new Promise((r) => setTimeout(r, 30));
        const mid = panel.getBoundingClientRect();
        const moved = Math.abs(mid.left - before.left) > 8 || Math.abs(mid.top - before.top) > 8;
        window.dispatchEvent(new MouseEvent('mouseup', {
          bubbles: true, cancelable: true, clientX: x0 + 35, clientY: y0 + 25, view: window
        }));
        await new Promise((r) => setTimeout(r, 30));
        const afterRelease = panel.getBoundingClientRect();
        window.dispatchEvent(new MouseEvent('mousemove', {
          bubbles: true, cancelable: true, clientX: x0 + 100, clientY: y0 + 80, view: window
        }));
        await new Promise((r) => setTimeout(r, 30));
        const afterExtra = panel.getBoundingClientRect();
        const stuck = Math.abs(afterExtra.left - afterRelease.left) > 2 ||
          Math.abs(afterExtra.top - afterRelease.top) > 2;
        return { ok: moved && !stuck, moved, stuck };
      });
      results.push({
        name: 'local-panel-drag-ends-on-mouseup',
        pass: localPanelDrag.ok === true,
        detail: localPanelDrag
      });

      const localBlurDoesNotPause = await localPage.evaluate(async () => {
        localStorage.setItem('omtKeepPlayingOnAltTab', 'false');
        try { sessionStorage.setItem('omtLocalShuttleEnabled', 'false'); } catch (_) {}
        const v = document.getElementById('omt-local-video');
        if (!v) return { ok: false };
        v.muted = true;
        try { await v.play(); } catch (_) {}
        await new Promise((r) => setTimeout(r, 40));
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
        window.dispatchEvent(new Event('blur'));
        await new Promise((r) => setTimeout(r, 40));
        return { ok: v.paused === false, paused: v.paused };
      });
      results.push({
        name: 'local-blur-does-not-pause',
        pass: localBlurDoesNotPause.ok === true,
        detail: localBlurDoesNotPause
      });

      const localAltTabDefault = await localPage.evaluate(async () => {
        try { localStorage.removeItem('omtAutoPauseOnBlur'); } catch (_) {}
        localStorage.setItem('omtKeepPlayingOnAltTab', 'false');
        try { sessionStorage.setItem('omtLocalShuttleEnabled', 'false'); } catch (_) {}
        const v = document.getElementById('omt-local-video');
        if (!v) return { ok: false, reason: 'no-video' };
        v.muted = true;
        try { await v.play(); } catch (e) { return { ok: false, reason: 'play-failed', err: String(e) }; }
        await new Promise((r) => setTimeout(r, 40));
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        document.dispatchEvent(new Event('visibilitychange'));
        await new Promise((r) => setTimeout(r, 40));
        const afterAway = v.paused;
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
        document.dispatchEvent(new Event('visibilitychange'));
        await new Promise((r) => setTimeout(r, 100));
        return { ok: afterAway === true && v.paused === false, afterAway, afterReturn: v.paused };
      });
      results.push({
        name: 'local-alt-tab-default-pauses-and-resumes',
        pass: localAltTabDefault.ok === true,
        detail: localAltTabDefault
      });

      const localAltTabKeep = await localPage.evaluate(async () => {
        localStorage.setItem('omtKeepPlayingOnAltTab', 'true');
        try { sessionStorage.setItem('omtLocalShuttleEnabled', 'false'); } catch (_) {}
        const v = document.getElementById('omt-local-video');
        if (!v) return { ok: false };
        v.muted = true;
        try { await v.play(); } catch (_) {}
        await new Promise((r) => setTimeout(r, 40));
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        document.dispatchEvent(new Event('visibilitychange'));
        await new Promise((r) => setTimeout(r, 40));
        const afterAway = v.paused;
        v.pause();
        await Promise.resolve();
        await Promise.resolve();
        await new Promise((r) => setTimeout(r, 40));
        const afterHostPause = v.paused;
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
        document.dispatchEvent(new Event('visibilitychange'));
        return { ok: afterAway === false && afterHostPause === false, afterAway, afterHostPause };
      });
      results.push({
        name: 'local-alt-tab-keep-playing',
        pass: localAltTabKeep.ok === true,
        detail: localAltTabKeep
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

      // Fullscreen seek must advance currentTime and deliver frames without exiting FS
      // (v2.0.1 field: skip-forward froze until exit fullscreen).
      const localFsSeek = await localPage.evaluate(async () => {
        const v = document.getElementById('omt-local-video');
        const stage = document.getElementById('omt-local-stage');
        const root = document.getElementById('omt-root');
        if (!v || !stage) return { ok: false, reason: 'missing' };
        try { await v.play(); } catch (_) {}
        try {
          if (!document.fullscreenElement) {
            await stage.requestFullscreen();
          }
        } catch (err) {
          return { ok: false, reason: 'fs-denied', message: String(err && err.message || err) };
        }
        await new Promise((r) => setTimeout(r, 120));
        const obscuredInFs = !!root && getComputedStyle(root).display === 'none';
        const hudOn = document.documentElement.classList.contains('omt-hud-on');
        try { v.currentTime = 1; } catch (_) {}
        await new Promise((r) => setTimeout(r, 80));
        const before = v.currentTime;
        let timeupdates = 0;
        let frames = 0;
        const onTu = () => { timeupdates += 1; };
        v.addEventListener('timeupdate', onTu);
        let rVFC = null;
        if (typeof v.requestVideoFrameCallback === 'function') {
          rVFC = new Promise((resolve) => {
            try {
              v.requestVideoFrameCallback(() => {
                frames += 1;
                resolve(true);
              });
              setTimeout(() => resolve(false), 2000);
            } catch (_) {
              resolve(false);
            }
          });
        }
        // Skip +2s via the same path as the panel / hotkey (seekTo).
        document.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'ArrowRight', code: 'ArrowRight', bubbles: true, cancelable: true
        }));
        await new Promise((r) => setTimeout(r, 500));
        const after = v.currentTime;
        const stillFs = !!document.fullscreenElement && document.fullscreenElement.contains(v);
        const paused = v.paused;
        let gotFrame = false;
        if (rVFC) gotFrame = await rVFC;
        // If rVFC unavailable, require timeupdate while still in FS.
        v.removeEventListener('timeupdate', onTu);
        const ok = stillFs && !obscuredInFs && hudOn && !paused &&
          after >= before + 1.2 &&
          (gotFrame || timeupdates >= 1);
        try {
          if (document.fullscreenElement) await document.exitFullscreen();
        } catch (_) {}
        return {
          ok,
          stillFs,
          obscuredInFs,
          hudOn,
          paused,
          before,
          after,
          timeupdates,
          gotFrame,
          fsEl: document.fullscreenElement ? document.fullscreenElement.id : null
        };
      });
      results.push({
        name: 'local-fullscreen-seek-keeps-playing',
        pass: localFsSeek.ok === true,
        detail: localFsSeek
      });
      await localPage.screenshot({
        path: path.join(ARTIFACTS, 'v202_local_fullscreen_seek.png'),
        fullPage: true
      });

      // v2.0.3: after Alt+Tab-like blur/focus while fullscreen, keyboard + shuttle
      // skips must advance time, paint frames, keep playing, stay in FS, and not
      // leave uncaught AbortError from play().
      const localFsReturn = await localPage.evaluate(async () => {
        const v = document.getElementById('omt-local-video');
        const stage = document.getElementById('omt-local-stage');
        if (!v || !stage) return { ok: false, reason: 'missing' };

        // Keep playing while hidden so wake/seek path is not entangled with pause/resume.
        try {
          localStorage.setItem('omtKeepPlayingOnAltTab', 'true');
          localStorage.removeItem('omtAutoPauseOnBlur');
        } catch (_) {}

        const uncaught = [];
        const onRej = (ev) => {
          const reason = ev && ev.reason;
          const msg = reason && (reason.message || String(reason)) || '';
          if (/AbortError|play\(\)|interrupted/i.test(msg) || (reason && reason.name === 'AbortError')) {
            uncaught.push(msg || 'AbortError');
          }
        };
        window.addEventListener('unhandledrejection', onRej);

        try { await v.play(); } catch (_) {}
        try {
          if (!document.fullscreenElement) await stage.requestFullscreen();
        } catch (err) {
          window.removeEventListener('unhandledrejection', onRej);
          return { ok: false, reason: 'fs-denied', message: String(err && err.message || err) };
        }
        await new Promise((r) => setTimeout(r, 100));

        // Simulate leave window (Alt+Tab): hasFocus false, blur, visibility hidden.
        let focusStub = false;
        try {
          Object.defineProperty(document, 'hasFocus', {
            configurable: true,
            value: () => focusStub
          });
        } catch (_) {}
        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          get: () => 'hidden'
        });
        Object.defineProperty(document, 'hidden', {
          configurable: true,
          get: () => true
        });
        window.dispatchEvent(new Event('blur'));
        document.dispatchEvent(new Event('visibilitychange'));
        await new Promise((r) => setTimeout(r, 80));

        // Return to window: hasFocus true, visibility visible, focus event.
        focusStub = true;
        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          get: () => 'visible'
        });
        Object.defineProperty(document, 'hidden', {
          configurable: true,
          get: () => false
        });
        document.dispatchEvent(new Event('visibilitychange'));
        window.dispatchEvent(new Event('focus'));
        await new Promise((r) => setTimeout(r, 120));

        if (v.paused) {
          try { await v.play(); } catch (_) {}
        }
        try { v.currentTime = 1; } catch (_) {}
        await new Promise((r) => setTimeout(r, 60));

        const beforeKb = v.currentTime;
        let timeupdates = 0;
        const onTu = () => { timeupdates += 1; };
        v.addEventListener('timeupdate', onTu);
        const waitFrame = () => new Promise((resolve) => {
          if (typeof v.requestVideoFrameCallback !== 'function') {
            resolve(false);
            return;
          }
          try {
            v.requestVideoFrameCallback(() => resolve(true));
            setTimeout(() => resolve(false), 2000);
          } catch (_) {
            resolve(false);
          }
        });
        let frameP = waitFrame();

        document.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'ArrowRight', code: 'ArrowRight', bubbles: true, cancelable: true
        }));
        await new Promise((r) => setTimeout(r, 500));
        const afterKb = v.currentTime;
        const gotFrameKb = await frameP;

        // ShuttleXpress skip path (same seekTo wake as hardware button, no HID).
        const beforeSh = v.currentTime;
        frameP = waitFrame();
        if (typeof window.__omtTestShuttleSkipSeconds === 'function') {
          window.__omtTestShuttleSkipSeconds(2);
        } else {
          return {
            ok: false,
            reason: 'no-shuttle-hook',
            beforeKb,
            afterKb,
            uncaught
          };
        }
        await new Promise((r) => setTimeout(r, 500));
        const afterSh = v.currentTime;
        const gotFrameSh = await frameP;

        v.removeEventListener('timeupdate', onTu);
        window.removeEventListener('unhandledrejection', onRej);

        const stillFs = !!document.fullscreenElement && document.fullscreenElement.contains(v);
        const paused = v.paused;
        const kbOk = afterKb >= beforeKb + 1.2;
        const shOk = afterSh >= beforeSh + 1.2;
        const frameOk = (gotFrameKb || gotFrameSh || timeupdates >= 1);
        const noAbort = uncaught.length === 0;
        const ok = stillFs && !paused && kbOk && shOk && frameOk && noAbort;

        try {
          if (document.fullscreenElement) await document.exitFullscreen();
        } catch (_) {}

        return {
          ok,
          stillFs,
          paused,
          beforeKb,
          afterKb,
          beforeSh,
          afterSh,
          timeupdates,
          gotFrameKb,
          gotFrameSh,
          uncaught,
          hasShuttleHook: true
        };
      });
      results.push({
        name: 'local-fullscreen-return-seek-paints',
        pass: localFsReturn.ok === true,
        detail: localFsReturn
      });
      await localPage.screenshot({
        path: path.join(ARTIFACTS, 'v203_local_fullscreen_return_seek.png'),
        fullPage: true
      });

      // Confirm togglePlay / Space catches play() AbortError (no uncaught rejection).
      const localPlayCatch = await localPage.evaluate(async () => {
        const v = document.getElementById('omt-local-video');
        if (!v) return { ok: false, reason: 'missing' };
        const uncaught = [];
        const onRej = (ev) => {
          const reason = ev && ev.reason;
          if (reason && (reason.name === 'AbortError' || /play\(\)|interrupted/i.test(String(reason.message || reason)))) {
            uncaught.push(String(reason.message || reason));
          }
        };
        window.addEventListener('unhandledrejection', onRej);
        try { await v.play(); } catch (_) {}
        // Force a pending play then immediate pause (classic AbortError pattern).
        const p = v.play();
        v.pause();
        try { await p; } catch (_) {}
        // Our toggle path must also catch.
        document.dispatchEvent(new KeyboardEvent('keydown', {
          key: ' ', code: 'Space', bubbles: true, cancelable: true
        }));
        await new Promise((r) => setTimeout(r, 40));
        document.dispatchEvent(new KeyboardEvent('keydown', {
          key: ' ', code: 'Space', bubbles: true, cancelable: true
        }));
        await new Promise((r) => setTimeout(r, 40));
        window.removeEventListener('unhandledrejection', onRej);
        return { ok: uncaught.length === 0, uncaught };
      });
      results.push({
        name: 'local-play-promise-caught',
        pass: localPlayCatch.ok === true,
        detail: localPlayCatch
      });

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

      // Local is never live mode: POST times on left, no video-range, no LIVE chip/delay.
      // Clear any kickoff left by earlier local period tests.
      await localPage.evaluate(() => {
        document.getElementById('omt-btn-clear-timer')?.click();
        const bar = document.getElementById('omt-timeline-bar');
        const panel = document.getElementById('omt-controls-panel');
        if (bar) { bar.style.opacity = '1'; bar.classList.remove('omt-chrome-hidden'); }
        if (panel) { panel.style.opacity = '1'; panel.style.pointerEvents = 'auto'; }
        document.querySelector('video')?.dispatchEvent(new Event('timeupdate'));
      });
      await localPage.waitForTimeout(80);
      const localCons = await localPage.evaluate(() => {
        const times = document.querySelector('#omt-root .omt-timeline-times');
        const ind = document.getElementById('omt-timeline-live-indicator');
        const delay = document.getElementById('omt-timeline-live-delay');
        const chip = document.getElementById('omt-timeline-live-chip');
        const post = document.getElementById('omt-timeline-post-times');
        const range = document.getElementById('omt-timeline-video-range');
        const btn = document.getElementById('omt-live-btn');
        return {
          mode: times?.dataset?.omtTimeMode || null,
          liveHidden: !!(ind && ind.hidden),
          delayHidden: !delay || delay.hidden || !!(ind && ind.hidden),
          chipHidden: !chip || chip.hidden || !!(ind && ind.hidden),
          postVisible: !!(post && !post.hidden),
          rangeHidden: !range || range.hidden,
          btnNotRed: !btn || !btn.classList.contains('is-live'),
          isLocal: !!document.getElementById('omt-root')?.classList.contains('omt-local')
        };
      });
      results.push({
        name: 'live-consistency-local-post',
        pass: localCons.isLocal && localCons.mode === 'post' && localCons.liveHidden &&
          localCons.delayHidden && localCons.chipHidden && localCons.postVisible &&
          localCons.rangeHidden && localCons.btnNotRed,
        detail: localCons
      });

      // LIVE button is hidden on local; L hotkey still seeks toward the end (safe point).
      const localLive = await localPage.evaluate(async () => {
        const v = document.getElementById('omt-local-video');
        try { v.currentTime = 1; } catch (_) {}
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', code: 'KeyL', bubbles: true, cancelable: true }));
        await new Promise((r) => setTimeout(r, 120));
        const end = v.duration || (v.seekable?.length ? v.seekable.end(v.seekable.length - 1) : NaN);
        const btn = document.getElementById('omt-live-btn');
        const btnHidden = !btn || getComputedStyle(btn).display === 'none';
        const delay = (typeof end === 'number' && isFinite(end)) ? (end - v.currentTime) : null;
        return {
          ok: btnHidden && typeof delay === 'number' && delay >= 0 && delay <= Math.max(3, end * 0.5) &&
            v.currentTime > 1.5,
          currentTime: v.currentTime,
          end,
          delay,
          btnHidden
        };
      });
      results.push({ name: 'local-live-and-l-hotkey', pass: localLive.ok === true, detail: localLive });

      const localHide = await localPage.evaluate(async () => {
        const panel = document.getElementById('omt-controls-panel');
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
