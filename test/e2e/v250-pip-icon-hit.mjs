/**
 * v2.4.10 — Full Document PiP regression (v249 suite) + SVG centre-click hits.
 *
 * New (Vasco 2.4.10): clicks on the exact centre of icon SVGs (icon row +
 * large panel) must activate the button — pointer-events:none on glyphs and
 * closest('button') delegation.
 *
 * Includes all v2.4.9 checks: kickoff-inside-PiP, resize single panel,
 * icon-row play/pause, drag, mute/vol/eye, speed, skips/frame, timeline,
 * keys 1/2/K, chip live, panel play orange.
 *
 * Each check tagged real_pip | simulation. Runtime-only zip (18 files).
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const EXT = path.join(ROOT, 'Overlay-chrome-extension');
const SAMPLE = path.join(ROOT, 'test/fixtures/xeatre-color-bars.mp4');
const ARTIFACTS = '/opt/cursor/artifacts';
fs.mkdirSync(ARTIFACTS, { recursive: true });

const checklist = {};
const notes = { version: '2.4.10', shots: [], checklist, issues: [], realPip: {} };

function mark(id, how, detail, ok = true) {
  checklist[id] = { ok, how, detail: detail == null ? '' : String(detail) };
  const tag = ok === false ? 'FAIL' : ok === null ? 'SKIP' : 'PASS';
  console.log(tag, `[${how}]`, id, detail == null ? '' : detail);
  if (ok === false) notes.issues.push(id + ': ' + detail);
}

function iconKind(html) {
  if (!html) return 'unknown';
  if (html.includes('<rect')) return 'pause';
  if (html.includes('<polygon')) return 'play';
  return 'unknown';
}

function buildRuntimeZip() {
  const staging = fs.mkdtempSync(path.join('/tmp', 'omt-rt250-'));
  const files = [
    'manifest.json', 'player.html', 'player.css', 'sync-feature-flag.js',
    'popup.js', 'popup.html', 'popup.css', 'popup-sync-section.html',
    'background.js', 'bridge.js', 'content.js', 'content.css'
  ];
  for (const f of files) {
    fs.copyFileSync(path.join(EXT, f), path.join(staging, f));
  }
  const assetsSrc = path.join(EXT, 'assets');
  const assetsDst = path.join(staging, 'assets');
  fs.mkdirSync(assetsDst, { recursive: true });
  for (const name of fs.readdirSync(assetsSrc)) {
    if (!/\.(png|jpg|jpeg|svg|webp)$/i.test(name)) continue;
    fs.copyFileSync(path.join(assetsSrc, name), path.join(assetsDst, name));
  }
  const zipPath = path.join(ARTIFACTS, 'OverlayMatchTimer-2.4.10-TEST.zip');
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  execSync(`cd "${staging}" && zip -qr "${zipPath}" .`);
  const buf = fs.readFileSync(zipPath);
  const sha = createHash('sha256').update(buf).digest('hex');
  fs.writeFileSync(
    path.join(ARTIFACTS, 'OverlayMatchTimer-2.4.10-TEST.sha256'),
    sha + '  OverlayMatchTimer-2.4.10-TEST.zip\n'
  );
  const listing = execSync(`unzip -l "${zipPath}"`, { encoding: 'utf8' });
  const fileCount = (listing.match(/^\s*\d+\s+\d{4}-/gm) || []).length;
  const bad = /src\/|scripts\/|design\/|package\.json|node_modules/.test(listing);
  notes.zip = zipPath;
  notes.sha256 = sha;
  notes.zipSize = buf.length;
  notes.zipFileCount = fileCount;
  notes.zipListingOk = !bad && fileCount === 18;
  mark(
    'runtime_only_zip',
    'simulation',
    `files=${fileCount} size=${buf.length} sha=${sha.slice(0, 16)}… badPaths=${bad}`,
    !bad && fileCount === 18
  );
  return { zipPath, staging, sha, size: buf.length };
}

async function waitVideoReady(page) {
  await page.evaluate(async () => {
    const v = document.getElementById('omt-local-video');
    if (!v) return;
    await new Promise((r) => {
      if (v.readyState >= 2) return r();
      v.addEventListener('loadeddata', r, { once: true });
      setTimeout(r, 2500);
    });
  });
}

async function clearKickoffState(page) {
  await page.evaluate(() => {
    /* Prefer the Clear control (IIFE helpers are not on window). */
    const clearBtn =
      document.getElementById('omt-btn-clear-timer') ||
      document.querySelector('.omt-tile-clear-timer, .btn-clear-timer');
    try { clearBtn?.click(); } catch (_) {}
    [
      'matchTimerAtivo', 'matchTimerOffset', 'matchTimerTempoBase',
      'matchTimerSyncHr', 'matchTimerSyncMin', 'matchTimerSyncSec',
      'matchTimerHalf', 'matchTimerKickoff1', 'matchTimerKickoff2',
      'matchTimerKickoffC1', 'matchTimerKickoffC2'
    ].forEach((k) => localStorage.removeItem(k));
    ['omt-sync-hr', 'omt-sync-min', 'omt-sync-sec'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    const wrap = document.getElementById('match-timer-wrap');
    if (wrap) {
      wrap.classList.remove('is-visible');
      wrap.style.display = 'none';
    }
    document.getElementById('omt-root')?.classList.remove('omt-timer-on');
    const pip = window.documentPictureInPicture && documentPictureInPicture.window;
    if (pip && pip.document) {
      const pw = pip.document.querySelector(
        '.omt-pip-timer-host #match-timer-wrap, .omt-pip-timer-host [id$="match-timer-wrap"]'
      );
      if (pw) {
        pw.classList.remove('is-visible');
        pw.style.display = 'none';
      }
      pip.document.querySelector('.omt-pip-root')?.classList.remove('omt-timer-on');
    }
  });
}

const { staging } = buildRuntimeZip();

const userDataDir = fs.mkdtempSync(path.join('/tmp', 'omt-pip250-'));
const context = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  args: [
    `--disable-extensions-except=${staging}`,
    `--load-extension=${staging}`,
    '--disable-features=ExtensionDisableUnsupportedDeveloper',
    '--no-sandbox',
    '--autoplay-policy=no-user-gesture-required'
  ],
  viewport: { width: 1280, height: 800 }
});

let realPipPage = null;

try {
  const workers = context.serviceWorkers();
  let sw = workers[0];
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 10000 });
  const extId = (sw.url() || '').split('/')[2];
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extId}/player.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!document.getElementById('omt-root'));
  await page.setInputFiles('#omt-local-file-input', SAMPLE);
  await page.waitForTimeout(900);
  await waitVideoReady(page);
  await clearKickoffState(page);

  const ver = await page.evaluate(() => ({
    supported: !!(window.documentPictureInPicture && documentPictureInPicture.requestWindow),
    manifestHint: (chrome && chrome.runtime && chrome.runtime.getManifest)
      ? chrome.runtime.getManifest().version : null
  }));
  mark(
    'version_runtime_load',
    'real_pip',
    JSON.stringify(ver),
    ver.supported === true && ver.manifestHint === '2.4.10'
  );

  /* Open real Document PiP WITHOUT kickoff set first (exercises kickoff-inside). */
  const pagePromise = context.waitForEvent('page', { timeout: 8000 }).catch(() => null);
  await page.evaluate(async () => {
    const btn = document.getElementById('omt-popout-btn');
    if (!btn) throw new Error('no popout btn');
    btn.hidden = false;
    btn.style.display = '';
    const native = DocumentPictureInPicture.prototype.requestWindow.bind(documentPictureInPicture);
    documentPictureInPicture.requestWindow = (opts) =>
      native({ width: 900, height: 520, ...(opts || {}) });
    btn.click();
  });
  realPipPage = await pagePromise;
  if (!realPipPage) {
    await page.waitForTimeout(1200);
    for (const p of context.pages()) {
      if (p === page) continue;
      try {
        if (await p.evaluate(() => !!document.querySelector('.omt-pip-root'))) {
          realPipPage = p;
          break;
        }
      } catch (_) {}
    }
  }

  const hasPip = await page.evaluate(() =>
    !!(window.documentPictureInPicture && documentPictureInPicture.window)
  );
  mark(
    'real_pip_window_attach',
    realPipPage || hasPip ? 'real_pip' : 'not_verified',
    realPipPage ? (realPipPage.url() || 'page') : (hasPip ? 'opener→pipWin' : 'none'),
    !!(realPipPage || hasPip)
  );
  if (!hasPip && !realPipPage) throw new Error('Document PiP window did not open');

  try {
    if (realPipPage) await realPipPage.bringToFront();
  } catch (_) {}
  await page.waitForTimeout(300);

  /* ========================================================================
   * NEW: kickoff from INSIDE PiP via keyboard (1 / 2 / K)
   * ======================================================================== */
  const kickKeys = await page.evaluate(async () => {
    const pipWin = documentPictureInPicture.window;
    const doc = pipWin.document;
    const root = doc.querySelector('.omt-pip-root');
    const v = doc.querySelector('video');
    try { root?.focus({ preventScroll: true }); } catch (_) {}
    try { pipWin.focus(); } catch (_) {}

    const fire = (key, code, keyCode) => {
      const opts = {
        key, code, keyCode, which: keyCode,
        bubbles: true, cancelable: true, view: pipWin
      };
      root?.dispatchEvent(new KeyboardEvent('keydown', opts));
      doc.dispatchEvent(new KeyboardEvent('keydown', opts));
      pipWin.dispatchEvent(new KeyboardEvent('keydown', opts));
    };

    const readChip = () => {
      const wrap = doc.querySelector('.omt-pip-timer-host #match-timer-wrap, .omt-pip-timer-host [id$="match-timer-wrap"]');
      const chip = doc.querySelector(
        '.omt-pip-timer-host #match-timer, .omt-pip-timer-host .omt-match-timer, .omt-pip-timer-host [id$="match-timer"]'
      );
      const cs = wrap ? pipWin.getComputedStyle(wrap) : null;
      return {
        text: chip ? (chip.textContent || '').trim() : '',
        visible: !!(wrap && wrap.classList.contains('is-visible') &&
          cs && cs.display !== 'none' && cs.visibility !== 'hidden'),
        inPip: !!(wrap && wrap.closest && wrap.closest('.omt-pip-timer-host')),
        openerGhost: !!document.querySelector(
          '#omt-root #match-timer-wrap.is-visible, #omt-root.omt-timer-on #match-timer-wrap'
        )
      };
    };

    try {
      const clearBtn =
        doc.getElementById('omt-btn-clear-timer') ||
        document.getElementById('omt-btn-clear-timer');
      clearBtn?.click();
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 120));
    const before = readChip();
    void before;

    try { if (v) v.currentTime = 1.2; } catch (_) {}
    await new Promise((r) => setTimeout(r, 80));
    fire('1', 'Digit1', 49);
    await new Promise((r) => setTimeout(r, 450));
    const after1 = {
      ...readChip(),
      half: localStorage.getItem('matchTimerHalf'),
      k1: localStorage.getItem('matchTimerKickoff1'),
      ativo: localStorage.getItem('matchTimerAtivo')
    };

    try { if (v) v.currentTime = 2.4; } catch (_) {}
    await new Promise((r) => setTimeout(r, 80));
    fire('2', 'Digit2', 50);
    await new Promise((r) => setTimeout(r, 450));
    const after2 = {
      ...readChip(),
      half: localStorage.getItem('matchTimerHalf'),
      k2: localStorage.getItem('matchTimerKickoff2')
    };

    try { if (v) v.currentTime = 3.1; } catch (_) {}
    await new Promise((r) => setTimeout(r, 80));
    fire('k', 'KeyK', 75);
    await new Promise((r) => setTimeout(r, 450));
    const afterK = readChip();

    /* Live samples with opener conceptually backgrounded */
    try { await v.play(); } catch (_) {}
    const samples = [];
    samples.push(readChip().text);
    await new Promise((r) => setTimeout(r, 1100));
    samples.push(readChip().text);
    await new Promise((r) => setTimeout(r, 1100));
    samples.push(readChip().text);

    return { before, after1, after2, afterK, samples };
  });

  const k1n = kickKeys.after1.k1 != null ? parseFloat(kickKeys.after1.k1) : NaN;
  mark(
    'new_kickoff_key_1_chip_in_pip',
    'real_pip',
    JSON.stringify(kickKeys.after1),
    kickKeys.after1.visible === true &&
      kickKeys.after1.inPip === true &&
      kickKeys.after1.half === '1' &&
      Number.isFinite(k1n) &&
      Math.abs(k1n - 1.2) < 1.5 &&
      !!kickKeys.after1.text
  );
  const k2n = kickKeys.after2.k2 != null ? parseFloat(kickKeys.after2.k2) : NaN;
  mark(
    'new_kickoff_key_2_chip_in_pip',
    'real_pip',
    JSON.stringify(kickKeys.after2),
    kickKeys.after2.visible === true &&
      kickKeys.after2.inPip === true &&
      kickKeys.after2.half === '2' &&
      Number.isFinite(k2n) &&
      Math.abs(k2n - 2.4) < 1.5
  );
  mark(
    'new_kickoff_key_K_chip_in_pip',
    'real_pip',
    JSON.stringify(kickKeys.afterK),
    kickKeys.afterK.visible === true && kickKeys.afterK.inPip === true && !!kickKeys.afterK.text
  );
  const chipLiveDistinct = new Set(kickKeys.samples.filter(Boolean)).size;
  mark(
    'new_chip_live_after_kickoff_in_pip',
    'real_pip',
    JSON.stringify(kickKeys.samples),
    chipLiveDistinct >= 2
  );

  if (realPipPage) {
    const shot = path.join(ARTIFACTS, 'v250_kickoff_inside_pip.png');
    try {
      await realPipPage.screenshot({ path: shot });
      notes.shots.push(shot);
    } catch (_) {}
  }

  /* ========================================================================
   * NEW: kickoff from panel Kick-off button while panel is in PiP
   * ======================================================================== */
  await clearKickoffState(page);
  await page.waitForTimeout(200);
  const panelKick = await page.evaluate(async () => {
    const pipWin = documentPictureInPicture.window;
    const doc = pipWin.document;
    const root = doc.querySelector('.omt-pip-root');
    root?.classList.remove('omt-pip-narrow');
    root?.classList.add('omt-pip-chrome-on');
    const chrome = doc.querySelector('.omt-pip-chrome');
    if (chrome) {
      chrome.style.opacity = '1';
      chrome.style.pointerEvents = 'auto';
    }
    const panel = doc.querySelector('.omt-controls-panel, #omt-controls-panel');
    const v = doc.querySelector('video');
    if (!panel || !v) return { ok: false, reason: 'missing' };

    /* Force More visible long enough to click Kick-off (CSS normally hides it). */
    const style = doc.createElement('style');
    style.textContent = `
      .omt-pip-root #omt-more-toggle, .omt-pip-root .omt-more-toggle,
      .omt-pip-root #omt-more-panel, .omt-pip-root .omt-more-panel {
        display:block!important; visibility:visible!important; opacity:1!important;
      }
    `;
    doc.head.appendChild(style);
    const more = panel.querySelector('#omt-more-toggle, .omt-more-toggle');
    const morePanel = panel.querySelector('#omt-more-panel, .omt-more-panel');
    if (more && more.getAttribute('aria-expanded') !== 'true') more.click();
    if (morePanel) {
      morePanel.classList.add('is-open');
      morePanel.style.display = 'block';
    }
    await new Promise((r) => setTimeout(r, 100));

    ['omt-sync-hr', 'omt-sync-min', 'omt-sync-sec'].forEach((id) => {
      const el = panel.querySelector('#' + id) || doc.getElementById(id) ||
        document.getElementById(id);
      if (el) el.value = '';
    });
    const half = panel.querySelector('#omt-half-select') || document.getElementById('omt-half-select');
    if (half) half.value = '1';
    try { v.currentTime = 1.8; } catch (_) {}
    await new Promise((r) => setTimeout(r, 80));

    const btn = panel.querySelector('#omt-btn-set-kickoff');
    if (!btn) return { ok: false, reason: 'no kickoff btn', panelInPip: !!panel.closest('.omt-pip-root') };
    btn.click();
    await new Promise((r) => setTimeout(r, 500));

    const wrap = doc.querySelector('.omt-pip-timer-host #match-timer-wrap, .omt-pip-timer-host [id$="match-timer-wrap"]');
    const chip = doc.querySelector(
      '.omt-pip-timer-host #match-timer, .omt-pip-timer-host .omt-match-timer'
    );
    const cs = wrap ? pipWin.getComputedStyle(wrap) : null;
    const openerPanels = document.querySelectorAll('#omt-controls-panel, .omt-controls-panel');
    let openerVisiblePanel = 0;
    openerPanels.forEach((p) => {
      if (p.ownerDocument === document && p.isConnected) {
        const pcs = getComputedStyle(p);
        if (pcs.display !== 'none' && pcs.visibility !== 'hidden' && pcs.opacity !== '0') {
          openerVisiblePanel += 1;
        }
      }
    });

    try { style.remove(); } catch (_) {}
    return {
      ok: true,
      text: chip ? (chip.textContent || '').trim() : '',
      visible: !!(wrap && wrap.classList.contains('is-visible') &&
        cs && cs.display !== 'none'),
      inPip: !!(wrap && wrap.closest('.omt-pip-timer-host')),
      panelInPip: !!panel.closest('.omt-pip-root'),
      ativo: localStorage.getItem('matchTimerAtivo'),
      half: localStorage.getItem('matchTimerHalf'),
      openerVisiblePanel
    };
  });
  mark(
    'new_kickoff_panel_chip_in_pip',
    'real_pip',
    JSON.stringify(panelKick),
    !!(panelKick.ok && panelKick.visible && panelKick.inPip && panelKick.text &&
      panelKick.ativo === 'true' && panelKick.panelInPip)
  );

  /* ========================================================================
   * NEW: resize across ~800px threshold several times — single panel in PiP
   * ======================================================================== */
  const resizeProbe = await page.evaluate(async () => {
    const pipWin = documentPictureInPicture.window;
    const doc = pipWin.document;
    const root = doc.querySelector('.omt-pip-root');
    const results = [];

    const snapshot = (label) => {
      const panels = Array.from(doc.querySelectorAll('.omt-controls-panel, #omt-controls-panel'));
      const openerPanels = Array.from(
        document.querySelectorAll('#omt-controls-panel, .omt-controls-panel')
      ).filter((p) => p.ownerDocument === document);
      const panel = panels[0] || null;
      const slot = doc.querySelector('.omt-pip-panel-slot');
      const iconRow = doc.querySelector('.omt-pip-icon-row');
      const iconCs = iconRow ? pipWin.getComputedStyle(iconRow) : null;
      const slotCs = slot ? pipWin.getComputedStyle(slot) : null;
      return {
        label,
        w: pipWin.innerWidth,
        h: pipWin.innerHeight,
        narrow: !!(root && root.classList.contains('omt-pip-narrow')),
        pipPanelCount: panels.length,
        openerPanelCount: openerPanels.length,
        panelInPip: !!(panel && panel.closest && panel.closest('.omt-pip-root')),
        panelOwnerIsPip: !!(panel && panel.ownerDocument === doc),
        floating: !!(panel && panel.classList.contains('omt-pip-panel-floating')),
        slotDisplay: slotCs ? slotCs.display : null,
        iconDisplay: iconCs ? iconCs.display : null
      };
    };

    const resizeTo = async (w, h) => {
      try {
        if (typeof pipWin.resizeTo === 'function') pipWin.resizeTo(w, h);
      } catch (_) {}
      /* Stub geometry so updateLayout/SyncPanelMode see the threshold even when
       * the host clamps Document PiP window size under Playwright. */
      try {
        Object.defineProperty(pipWin, 'innerWidth', {
          configurable: true,
          get: () => w
        });
        Object.defineProperty(pipWin, 'innerHeight', {
          configurable: true,
          get: () => h
        });
      } catch (_) {
        try {
          if (w < 800) root?.classList.add('omt-pip-narrow');
          else root?.classList.remove('omt-pip-narrow');
        } catch (_) {}
      }
      try { pipWin.dispatchEvent(new Event('resize')); } catch (_) {}
      await new Promise((r) => setTimeout(r, 220));
      try { root?.classList.add('omt-pip-chrome-on'); } catch (_) {}
    };

    results.push(snapshot('start_wide'));
    await resizeTo(640, 400);
    results.push(snapshot('narrow_640'));
    await resizeTo(920, 520);
    results.push(snapshot('wide_920'));
    await resizeTo(700, 420);
    results.push(snapshot('narrow_700'));
    await resizeTo(880, 500);
    results.push(snapshot('wide_880'));
    await resizeTo(600, 380);
    results.push(snapshot('narrow_600'));
    await resizeTo(900, 520);
    results.push(snapshot('wide_900_final'));

    const bad = results.filter(
      (r) =>
        r.pipPanelCount !== 1 ||
        r.openerPanelCount !== 0 ||
        r.panelInPip !== true ||
        r.panelOwnerIsPip !== true
    );
    const modeOk = results.every((r) => {
      if (r.label.includes('narrow')) {
        return r.narrow === true && r.iconDisplay === 'flex' &&
          (r.slotDisplay === 'none' || r.slotDisplay === '');
      }
      if (r.label.includes('wide') || r.label === 'start_wide') {
        return r.narrow === false && (r.slotDisplay === 'flex' || r.slotDisplay === 'block');
      }
      return true;
    });

    return { results, bad, modeOk };
  });

  mark(
    'new_resize_single_panel_always_in_pip',
    'real_pip',
    JSON.stringify({
      bad: resizeProbe.bad,
      counts: resizeProbe.results.map((r) => ({
        label: r.label,
        pip: r.pipPanelCount,
        opener: r.openerPanelCount,
        narrow: r.narrow,
        slot: r.slotDisplay,
        icon: r.iconDisplay
      }))
    }),
    resizeProbe.bad.length === 0 && resizeProbe.modeOk === true
  );

  if (realPipPage) {
    const shotN = path.join(ARTIFACTS, 'v250_resize_narrow.png');
    const shotW = path.join(ARTIFACTS, 'v250_resize_wide.png');
    await page.evaluate(() => {
      const root = documentPictureInPicture.window.document.querySelector('.omt-pip-root');
      root?.classList.add('omt-pip-narrow', 'omt-pip-chrome-on');
    });
    await page.waitForTimeout(200);
    try {
      await realPipPage.screenshot({ path: shotN });
      notes.shots.push(shotN);
    } catch (_) {}
    await page.evaluate(() => {
      const root = documentPictureInPicture.window.document.querySelector('.omt-pip-root');
      root?.classList.remove('omt-pip-narrow');
      root?.classList.add('omt-pip-chrome-on');
    });
    await page.waitForTimeout(200);
    try {
      await realPipPage.screenshot({ path: shotW });
      notes.shots.push(shotW);
    } catch (_) {}
  }

  /* ========================================================================
   * NEW + prior: icon-row play AND pause (both directions, icon follows)
   * ======================================================================== */
  const iconRow = await page.evaluate(async () => {
    const kind = (btn) => {
      const html = btn.innerHTML || '';
      if (html.includes('<rect')) return 'pause';
      if (html.includes('<polygon')) return 'play';
      return 'unknown';
    };
    const pipWin = documentPictureInPicture.window;
    const doc = pipWin.document;
    const root = doc.querySelector('.omt-pip-root');
    root?.classList.add('omt-pip-narrow', 'omt-pip-chrome-on');
    const chrome = doc.querySelector('.omt-pip-chrome');
    if (chrome) {
      chrome.style.opacity = '1';
      chrome.style.pointerEvents = 'auto';
    }
    /* Ensure floating panel is not covering the icon row */
    const panel = doc.querySelector('.omt-controls-panel, #omt-controls-panel');
    const slot = doc.querySelector('.omt-pip-panel-slot');
    if (panel && slot) {
      try {
        panel.classList.remove('omt-pip-panel-floating');
        slot.appendChild(panel);
      } catch (_) {}
    }
    pipWin.dispatchEvent(new Event('resize'));
    await new Promise((r) => setTimeout(r, 150));

    const v = doc.querySelector('video');
    const btn = doc.querySelector('[data-omt-pip-act="play"]');
    if (!v || !btn) return { ok: false, reason: 'missing' };

    try { v.pause(); } catch (_) {}
    await new Promise((r) => setTimeout(r, 280));
    const before = { paused: v.paused, icon: kind(btn) };

    btn.click();
    await new Promise((r) => setTimeout(r, 500));
    const afterPlay = { paused: v.paused, icon: kind(btn) };

    btn.click();
    await new Promise((r) => setTimeout(r, 500));
    const afterPause = { paused: v.paused, icon: kind(btn) };

    return { ok: true, before, afterPlay, afterPause };
  });
  const iconOk =
    iconRow.ok &&
    iconRow.before.paused === true &&
    iconRow.before.icon === 'play' &&
    iconRow.afterPlay.paused === false &&
    iconRow.afterPlay.icon === 'pause' &&
    iconRow.afterPause.paused === true &&
    iconRow.afterPause.icon === 'play';
  mark('new_icon_row_play_pause_both', 'real_pip', JSON.stringify(iconRow), iconOk);

  if (realPipPage) {
    const shot = path.join(ARTIFACTS, 'v250_icon_row_play.png');
    try {
      await realPipPage.screenshot({ path: shot });
      notes.shots.push(shot);
    } catch (_) {}
  }

  /* ========================================================================
   * PRIOR 2.4.8: panel play orange + icon; chip live with opener backgrounded
   * ======================================================================== */
  await page.evaluate(() => {
    /* Ensure kickoff active for live chip tests via key 1 (IIFE helpers not on window). */
    const half = document.getElementById('omt-half-select');
    if (half) half.value = '1';
    ['omt-sync-hr', 'omt-sync-min', 'omt-sync-sec'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    const v = documentPictureInPicture.window?.document?.querySelector('video');
    try { if (v) v.currentTime = 0.8; } catch (_) {}
    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: '1', code: 'Digit1', keyCode: 49, which: 49,
        bubbles: true, cancelable: true, view: window
      })
    );
  });
  await page.waitForTimeout(400);

  try {
    if (realPipPage) await realPipPage.bringToFront();
  } catch (_) {}
  await page.evaluate(() => {
    try { window.blur(); } catch (_) {}
  });
  await page.waitForTimeout(200);

  const clocks = await page.evaluate(async () => {
    const pipWin = documentPictureInPicture.window;
    const doc = pipWin.document;
    const v = doc.querySelector('video');
    try { await v.play(); } catch (_) {}
    const read = () => {
      const chip = doc.querySelector(
        '.omt-pip-timer-host #match-timer, .omt-pip-timer-host .omt-match-timer'
      );
      return {
        text: chip ? (chip.textContent || '').trim() : '',
        t: v ? v.currentTime : null,
        paused: v ? v.paused : null
      };
    };
    const samples = [];
    samples.push(read());
    await new Promise((r) => setTimeout(r, 1100));
    samples.push(read());
    await new Promise((r) => setTimeout(r, 1100));
    samples.push(read());
    return samples;
  });
  const texts = clocks.map((s) => s.text);
  const distinct = new Set(texts.filter(Boolean));
  const videoAdvanced = clocks.some(
    (s, i) => i > 0 && s.t != null && clocks[0].t != null && s.t > clocks[0].t + 0.3
  );
  mark(
    'prior_chip_live_opener_backgrounded',
    'real_pip',
    JSON.stringify({ texts, videoAdvanced }),
    distinct.size >= 2 && videoAdvanced
  );

  const panelPlay = await page.evaluate(async () => {
    const kind = (btn) => {
      const html = btn.innerHTML || '';
      if (html.includes('<rect')) return 'pause';
      if (html.includes('<polygon')) return 'play';
      return 'unknown';
    };
    const pipWin = documentPictureInPicture.window;
    const doc = pipWin.document;
    const root = doc.querySelector('.omt-pip-root');
    root?.classList.remove('omt-pip-narrow');
    root?.classList.add('omt-pip-chrome-on');
    const chrome = doc.querySelector('.omt-pip-chrome');
    if (chrome) {
      chrome.style.opacity = '1';
      chrome.style.pointerEvents = 'auto';
    }
    const v = doc.querySelector('video');
    const panel = doc.querySelector('.omt-controls-panel, #omt-controls-panel');
    const btn = panel && panel.querySelector('#omt-btn-play, .btn-play');
    if (!v || !btn) return { ok: false, reason: 'missing' };
    try { v.pause(); } catch (_) {}
    await new Promise((r) => setTimeout(r, 280));
    const paused = {
      icon: kind(btn),
      playingClass: btn.classList.contains('playing'),
      color: pipWin.getComputedStyle(btn).color
    };
    btn.click();
    await new Promise((r) => setTimeout(r, 450));
    const playing = {
      icon: kind(btn),
      playingClass: btn.classList.contains('playing'),
      color: pipWin.getComputedStyle(btn).color,
      videoPlaying: !v.paused
    };
    btn.click();
    await new Promise((r) => setTimeout(r, 450));
    const again = {
      icon: kind(btn),
      playingClass: btn.classList.contains('playing'),
      videoPaused: v.paused
    };
    return { ok: true, paused, playing, again };
  });
  const orangeOk =
    panelPlay.ok &&
    panelPlay.paused.icon === 'play' &&
    panelPlay.paused.playingClass === false &&
    panelPlay.playing.icon === 'pause' &&
    panelPlay.playing.playingClass === true &&
    panelPlay.playing.videoPlaying === true &&
    /245,\s*131,\s*31/.test(panelPlay.playing.color) &&
    panelPlay.again.icon === 'play' &&
    panelPlay.again.playingClass === false &&
    panelPlay.again.videoPaused === true;
  mark('prior_panel_play_icon_orange', 'real_pip', JSON.stringify(panelPlay), orangeOk);

  if (realPipPage) {
    const shot = path.join(ARTIFACTS, 'v250_panel_playing.png');
    try {
      await realPipPage.screenshot({ path: shot });
      notes.shots.push(shot);
    } catch (_) {}
  }

  /* ========================================================================
   * PRIOR 2.4.4–2.4.6: drag, mute/vol/eye, speed, skips/frame, timeline
   * ======================================================================== */
  const transport = await page.evaluate(async () => {
    const pipWin = documentPictureInPicture.window;
    const doc = pipWin.document;
    const root = doc.querySelector('.omt-pip-root');
    root?.classList.remove('omt-pip-narrow');
    root?.classList.add('omt-pip-chrome-on');
    const chrome = doc.querySelector('.omt-pip-chrome');
    if (chrome) {
      chrome.style.opacity = '1';
      chrome.style.pointerEvents = 'auto';
    }
    const v = doc.querySelector('video');
    const panel = doc.querySelector('.omt-controls-panel, #omt-controls-panel');
    if (!v || !panel) return { ok: false, reason: 'missing' };
    try { v.pause(); } catch (_) {}
    try { v.currentTime = 1.5; } catch (_) {}
    await new Promise((r) => setTimeout(r, 80));
    const out = { ok: true };

    /* Skip +10 (short fixture ~6s — start early so skip can move). */
    try { v.currentTime = 1.0; } catch (_) {}
    await new Promise((r) => setTimeout(r, 60));
    const t0 = v.currentTime;
    panel.querySelector('#omt-p10')?.click();
    await new Promise((r) => setTimeout(r, 180));
    out.skipDelta = v.currentTime - t0;

    /* Frame — reset away from EOF so +1 frame can stick. */
    try { v.pause(); v.currentTime = 2.0; } catch (_) {}
    await new Promise((r) => setTimeout(r, 80));
    const t1 = v.currentTime;
    const frameBtn =
      panel.querySelector('#omt-next-frame') ||
      panel.querySelector('[data-frame="1"]') ||
      panel.querySelector('.btn-frame[data-frame="1"]');
    out.frameBtn = !!frameBtn;
    frameBtn?.click();
    await new Promise((r) => setTimeout(r, 160));
    out.frameDelta = v.currentTime - t1;

    /* Mute */
    const mute = panel.querySelector('#omt-volume-icon-btn');
    const muted0 = v.muted || v.volume === 0;
    mute?.click();
    await new Promise((r) => setTimeout(r, 180));
    out.muteToggled = (v.muted || v.volume === 0) !== muted0;

    /* Volume slider */
    const vol = panel.querySelector('#omt-volume-range');
    if (vol) {
      vol.value = '0.35';
      vol.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 120));
      out.volAfter = v.volume;
      out.volOk = Math.abs(v.volume - 0.35) < 0.1;
    }

    /* Eye */
    const eye = panel.querySelector('#omt-hide-panel');
    const tip0 = eye ? eye.getAttribute('data-tip') : '';
    eye?.click();
    await new Promise((r) => setTimeout(r, 180));
    const tip1 = eye ? eye.getAttribute('data-tip') : '';
    out.eyeTipChanged = tip0 !== tip1;

    /* Speed */
    const speed = panel.querySelector('#omt-speed-select, .omt-tile-speed-select');
    if (speed) {
      speed.value = '1.5';
      speed.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 150));
      out.speed = v.playbackRate;
      out.speedOk = Math.abs(v.playbackRate - 1.5) < 0.05;
      speed.value = '1.0';
      speed.dispatchEvent(new Event('change', { bubbles: true }));
    }

    /* Timeline scrub */
    try { v.pause(); v.currentTime = 1.0; } catch (_) {}
    await new Promise((r) => setTimeout(r, 60));
    const slider = doc.querySelector(
      '.omt-pip-chrome .timeline-slider, .omt-pip-chrome #omt-timeline-slider'
    );
    if (slider && v.duration && isFinite(v.duration) && v.duration > 1) {
      /* Slider value is absolute seconds (PiP seek wire → seekTo(value)). */
      const min = parseFloat(slider.min) || 0;
      const max = parseFloat(slider.max) || v.duration;
      const target = Math.max(min, Math.min(max - 0.2, 3.0));
      slider.value = String(target);
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      slider.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 250));
      out.timelineT = v.currentTime;
      out.timelineTarget = target;
      out.timelineMinMax = { min, max };
      out.timelineOk = Math.abs(v.currentTime - target) < 1.2;
    } else {
      out.timelineOk = null;
      out.timelineReason = !slider ? 'no-slider' : 'bad-duration';
    }

    /* Drag */
    const handle = panel.querySelector('.drag-handle, .drag-center-grip');
    if (handle) {
      const r0 = panel.getBoundingClientRect();
      handle.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          cancelable: true,
          composed: true,
          clientX: r0.left + r0.width / 2,
          clientY: r0.top + 10,
          pointerId: 11,
          pointerType: 'mouse',
          button: 0,
          buttons: 1
        })
      );
      await new Promise((r) => setTimeout(r, 30));
      pipWin.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          cancelable: true,
          composed: true,
          clientX: r0.left + r0.width / 2 + 55,
          clientY: r0.top + 10 - 35,
          pointerId: 11,
          pointerType: 'mouse',
          button: 0,
          buttons: 1
        })
      );
      await new Promise((r) => setTimeout(r, 40));
      pipWin.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          cancelable: true,
          composed: true,
          clientX: r0.left + 55,
          clientY: r0.top - 25,
          pointerId: 11,
          pointerType: 'mouse',
          button: 0,
          buttons: 0
        })
      );
      await new Promise((r) => setTimeout(r, 40));
      const r1 = panel.getBoundingClientRect();
      out.drag = {
        dx: r1.left - r0.left,
        dy: r1.top - r0.top,
        floating: panel.classList.contains('omt-pip-panel-floating'),
        jumpedCorner:
          r1.left < 8 &&
          r1.top < 8 &&
          (Math.abs(r1.left - r0.left) > 20 || Math.abs(r1.top - r0.top) > 20)
      };
    }

    /* Still exactly one panel in PiP after drag */
    out.pipPanelCount = doc.querySelectorAll('.omt-controls-panel, #omt-controls-panel').length;
    out.openerPanelCount = Array.from(
      document.querySelectorAll('#omt-controls-panel, .omt-controls-panel')
    ).filter((p) => p.ownerDocument === document).length;

    return out;
  });

  mark(
    'prior_skip',
    'real_pip',
    `delta=${transport.skipDelta}`,
    Math.abs(transport.skipDelta || 0) >= 1.5
  );
  mark(
    'prior_frame',
    'real_pip',
    `delta=${transport.frameDelta}`,
    Math.abs(transport.frameDelta || 0) >= 0.03
  );
  mark('prior_mute', 'real_pip', String(transport.muteToggled), !!transport.muteToggled);
  mark('prior_volume', 'real_pip', `vol=${transport.volAfter}`, !!transport.volOk);
  mark('prior_eye', 'real_pip', String(transport.eyeTipChanged), !!transport.eyeTipChanged);
  mark('prior_speed', 'real_pip', `rate=${transport.speed}`, !!transport.speedOk);
  mark(
    'prior_timeline',
    transport.timelineOk == null ? 'simulation' : 'real_pip',
    JSON.stringify({ t: transport.timelineT, ok: transport.timelineOk }),
    transport.timelineOk == null ? null : !!transport.timelineOk
  );
  mark(
    'prior_drag_no_corner_jump',
    'real_pip',
    JSON.stringify(transport.drag),
    !!(
      transport.drag &&
      !transport.drag.jumpedCorner &&
      (Math.abs(transport.drag.dx) > 5 ||
        Math.abs(transport.drag.dy) > 5 ||
        transport.drag.floating)
    )
  );
  mark(
    'prior_panel_still_single_after_drag',
    'real_pip',
    JSON.stringify({
      pip: transport.pipPanelCount,
      opener: transport.openerPanelCount
    }),
    transport.pipPanelCount === 1 && transport.openerPanelCount === 0
  );

  /* Keys 1/2 while PiP open (opener dispatch path — 2.4.7/2.4.8) */
  await page.bringToFront();
  await page.locator('body').click({ position: { x: 8, y: 8 } }).catch(() => {});
  await page.evaluate(() => {
    ['omt-sync-hr', 'omt-sync-min', 'omt-sync-sec'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    const v =
      (documentPictureInPicture.window &&
        documentPictureInPicture.window.document.querySelector('video')) ||
      document.getElementById('omt-local-video');
    try {
      if (v) v.currentTime = 2.0;
    } catch (_) {}
  });
  await page.waitForTimeout(100);
  await page.evaluate(() => {
    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: '1',
        code: 'Digit1',
        keyCode: 49,
        which: 49,
        bubbles: true,
        cancelable: true,
        view: window
      })
    );
  });
  await page.waitForTimeout(350);
  const afterOpener1 = await page.evaluate(() => ({
    half: localStorage.getItem('matchTimerHalf'),
    k1: localStorage.getItem('matchTimerKickoff1'),
    pipOpen: !!(documentPictureInPicture && documentPictureInPicture.window),
    chip: (() => {
      const chip = documentPictureInPicture.window?.document?.querySelector(
        '.omt-pip-timer-host #match-timer, .omt-pip-timer-host .omt-match-timer'
      );
      return chip ? (chip.textContent || '').trim() : '';
    })()
  }));
  mark(
    'prior_keys_1_2_opener_while_pip',
    'real_pip',
    JSON.stringify(afterOpener1),
    afterOpener1.pipOpen &&
      afterOpener1.half === '1' &&
      !!afterOpener1.chip &&
      Number.isFinite(parseFloat(afterOpener1.k1))
  );

  /* ========================================================================
   * NEW 2.4.10: click the exact centre of each icon SVG (hit-target fix)
   * ======================================================================== */
  const centreHits = await page.evaluate(async () => {
    const pipWin = documentPictureInPicture.window;
    const doc = pipWin.document;
    const root = doc.querySelector('.omt-pip-root');
    const chrome = doc.querySelector('.omt-pip-chrome');
    if (chrome) {
      chrome.style.opacity = '1';
      chrome.style.pointerEvents = 'auto';
    }

    const fireCentre = (btn) => {
      const svg = btn.querySelector('svg, .omt-icon');
      const box = (svg || btn).getBoundingClientRect();
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      const pe = svg ? pipWin.getComputedStyle(svg).pointerEvents : null;
      const hit = doc.elementFromPoint(x, y);
      const hitIsBtn = !!(hit && (hit === btn || (hit.closest && hit.closest('button') === btn)));
      /* Dispatch on the hit element (should be the button under pointer-events:none). */
      const target = hit || btn;
      ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((type) => {
        const Ctor = type.startsWith('pointer') ? PointerEvent : MouseEvent;
        target.dispatchEvent(
          new Ctor(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            clientX: x,
            clientY: y,
            button: 0,
            buttons: type === 'pointerdown' || type === 'mousedown' ? 1 : 0,
            pointerId: 21,
            pointerType: 'mouse',
            view: pipWin
          })
        );
      });
      return {
        pe,
        hitTag: hit ? hit.tagName : null,
        hitIsBtn,
        x,
        y
      };
    };

    const out = { iconRow: {}, panel: {} };

    /* ---- Icon row (narrow) ---- */
    root?.classList.add('omt-pip-narrow', 'omt-pip-chrome-on');
    const panel = doc.querySelector('.omt-controls-panel, #omt-controls-panel');
    const slot = doc.querySelector('.omt-pip-panel-slot');
    if (panel && slot) {
      try {
        panel.classList.remove('omt-pip-panel-floating');
        slot.appendChild(panel);
      } catch (_) {}
    }
    await new Promise((r) => setTimeout(r, 120));

    const v = doc.querySelector('video');
    const play = doc.querySelector('[data-omt-pip-act="play"]');
    const skipFwd = doc.querySelector(
      '[data-omt-pip-act="skip"][data-skip-dir="fwd"][data-skip-slot="1"]'
    );
    const frameFwd = doc.querySelector('[data-omt-pip-act="frame"][data-frame="1"]');

    if (v && play) {
      try { v.pause(); v.currentTime = 1.0; } catch (_) {}
      await new Promise((r) => setTimeout(r, 200));
      const before = v.paused;
      const hit = fireCentre(play);
      await new Promise((r) => setTimeout(r, 450));
      out.iconRow.play = {
        ...hit,
        beforePaused: before,
        afterPaused: v.paused,
        ok: before === true && v.paused === false && hit.hitIsBtn && hit.pe === 'none'
      };
      /* pause via centre again */
      const hit2 = fireCentre(play);
      await new Promise((r) => setTimeout(r, 450));
      out.iconRow.pause = {
        ...hit2,
        afterPaused: v.paused,
        ok: v.paused === true && hit2.hitIsBtn
      };
    }

    if (v && skipFwd) {
      try { v.pause(); v.currentTime = 1.0; } catch (_) {}
      await new Promise((r) => setTimeout(r, 80));
      const t0 = v.currentTime;
      const hit = fireCentre(skipFwd);
      await new Promise((r) => setTimeout(r, 200));
      out.iconRow.skip = {
        ...hit,
        delta: v.currentTime - t0,
        ok: Math.abs(v.currentTime - t0) >= 1.5 && hit.hitIsBtn && hit.pe === 'none'
      };
    }

    if (v && frameFwd) {
      try { v.pause(); v.currentTime = 2.0; } catch (_) {}
      await new Promise((r) => setTimeout(r, 80));
      const t0 = v.currentTime;
      const hit = fireCentre(frameFwd);
      await new Promise((r) => setTimeout(r, 160));
      out.iconRow.frame = {
        ...hit,
        delta: v.currentTime - t0,
        ok: Math.abs(v.currentTime - t0) >= 0.03 && hit.hitIsBtn && hit.pe === 'none'
      };
    }

    /* ---- Large panel ---- */
    root?.classList.remove('omt-pip-narrow');
    root?.classList.add('omt-pip-chrome-on');
    pipWin.dispatchEvent(new Event('resize'));
    await new Promise((r) => setTimeout(r, 200));
    const panel2 = doc.querySelector('.omt-controls-panel, #omt-controls-panel');
    if (panel2 && v) {
      const pPlay = panel2.querySelector('#omt-btn-play, .btn-play');
      const mute = panel2.querySelector('#omt-volume-icon-btn');
      const eye = panel2.querySelector('#omt-hide-panel, .omt-tile-hide');
      const skip10 = panel2.querySelector('#omt-p10');

      if (pPlay) {
        try { v.pause(); } catch (_) {}
        await new Promise((r) => setTimeout(r, 250));
        const before = v.paused;
        const hit = fireCentre(pPlay);
        await new Promise((r) => setTimeout(r, 450));
        out.panel.play = {
          ...hit,
          beforePaused: before,
          afterPaused: v.paused,
          ok: before === true && v.paused === false && hit.hitIsBtn && hit.pe === 'none'
        };
        const hit2 = fireCentre(pPlay);
        await new Promise((r) => setTimeout(r, 450));
        out.panel.pause = {
          ...hit2,
          afterPaused: v.paused,
          ok: v.paused === true && hit2.hitIsBtn
        };
      }

      if (mute) {
        const m0 = v.muted || v.volume === 0;
        const hit = fireCentre(mute);
        await new Promise((r) => setTimeout(r, 200));
        out.panel.mute = {
          ...hit,
          toggled: (v.muted || v.volume === 0) !== m0,
          ok: (v.muted || v.volume === 0) !== m0 && hit.hitIsBtn && hit.pe === 'none'
        };
      }

      if (eye) {
        const tip0 = eye.getAttribute('data-tip') || '';
        const hit = fireCentre(eye);
        await new Promise((r) => setTimeout(r, 200));
        const tip1 = eye.getAttribute('data-tip') || '';
        out.panel.eye = {
          ...hit,
          tip0,
          tip1,
          ok: tip0 !== tip1 && hit.hitIsBtn && hit.pe === 'none'
        };
      }

      if (skip10) {
        try { v.pause(); v.currentTime = 1.0; } catch (_) {}
        await new Promise((r) => setTimeout(r, 60));
        const t0 = v.currentTime;
        const hit = fireCentre(skip10);
        await new Promise((r) => setTimeout(r, 200));
        out.panel.skip = {
          ...hit,
          delta: v.currentTime - t0,
          ok: Math.abs(v.currentTime - t0) >= 1.5 && hit.hitIsBtn && hit.pe === 'none'
        };
      }
    }

    return out;
  });

  mark(
    'new_centre_icon_row_play',
    'real_pip',
    JSON.stringify(centreHits.iconRow.play),
    !!(centreHits.iconRow.play && centreHits.iconRow.play.ok)
  );
  mark(
    'new_centre_icon_row_pause',
    'real_pip',
    JSON.stringify(centreHits.iconRow.pause),
    !!(centreHits.iconRow.pause && centreHits.iconRow.pause.ok)
  );
  mark(
    'new_centre_icon_row_skip',
    'real_pip',
    JSON.stringify(centreHits.iconRow.skip),
    !!(centreHits.iconRow.skip && centreHits.iconRow.skip.ok)
  );
  mark(
    'new_centre_icon_row_frame',
    'real_pip',
    JSON.stringify(centreHits.iconRow.frame),
    !!(centreHits.iconRow.frame && centreHits.iconRow.frame.ok)
  );
  mark(
    'new_centre_panel_play',
    'real_pip',
    JSON.stringify(centreHits.panel.play),
    !!(centreHits.panel.play && centreHits.panel.play.ok)
  );
  mark(
    'new_centre_panel_pause',
    'real_pip',
    JSON.stringify(centreHits.panel.pause),
    !!(centreHits.panel.pause && centreHits.panel.pause.ok)
  );
  mark(
    'new_centre_panel_mute',
    'real_pip',
    JSON.stringify(centreHits.panel.mute),
    !!(centreHits.panel.mute && centreHits.panel.mute.ok)
  );
  mark(
    'new_centre_panel_eye',
    'real_pip',
    JSON.stringify(centreHits.panel.eye),
    !!(centreHits.panel.eye && centreHits.panel.eye.ok)
  );
  mark(
    'new_centre_panel_skip',
    'real_pip',
    JSON.stringify(centreHits.panel.skip),
    !!(centreHits.panel.skip && centreHits.panel.skip.ok)
  );

  if (realPipPage) {
    const shot = path.join(ARTIFACTS, 'v250_centre_icon_hit.png');
    try {
      await realPipPage.screenshot({ path: shot });
      notes.shots.push(shot);
    } catch (_) {}
  }

  const summary = {
    passed: Object.values(checklist).filter((c) => c.ok === true).length,
    failed: Object.values(checklist).filter((c) => c.ok === false).length,
    skipped: Object.values(checklist).filter((c) => c.ok === null).length
  };
  notes.summary = summary;
  notes.centreHits = centreHits;
  fs.writeFileSync(path.join(ARTIFACTS, 'v250_pip_notes.json'), JSON.stringify(notes, null, 2));
  console.log(
    JSON.stringify(
      { summary, issues: notes.issues, sha: notes.sha256, size: notes.zipSize, files: notes.zipFileCount },
      null,
      2
    )
  );

  try {
    await page.evaluate(() => {
      if (typeof window.__omtPopoutClose === 'function') window.__omtPopoutClose();
    });
  } catch (_) {}
} catch (err) {
  console.error(err);
  mark('fatal', 'real_pip', String((err && err.message) || err), false);
  notes.summary = {
    passed: Object.values(checklist).filter((c) => c.ok === true).length,
    failed: Object.values(checklist).filter((c) => c.ok === false).length,
    skipped: Object.values(checklist).filter((c) => c.ok === null).length
  };
  fs.writeFileSync(path.join(ARTIFACTS, 'v250_pip_notes.json'), JSON.stringify(notes, null, 2));
  process.exitCode = 1;
} finally {
  await context.close().catch(() => {});
  try {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  } catch (_) {}
  try {
    fs.rmSync(staging, { recursive: true, force: true });
  } catch (_) {}
}

if (notes.summary && notes.summary.failed > 0) process.exitCode = 1;
