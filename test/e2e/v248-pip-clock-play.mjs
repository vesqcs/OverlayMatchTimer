/**
 * v2.4.8 — Real Document PiP: live timer chip + play/pause UI (panel + icon row).
 * Also re-checks keys 1/2 inside PiP when attachable. Runtime-only zip.
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
const notes = { version: '2.4.8', shots: [], checklist, issues: [], realPip: {} };

function mark(id, how, detail, ok = true) {
  checklist[id] = { ok, how, detail: detail == null ? '' : String(detail) };
  const tag = ok === false ? 'FAIL' : ok === null ? 'SKIP' : 'PASS';
  console.log(tag, `[${how}]`, id, detail == null ? '' : detail);
  if (ok === false) notes.issues.push(id + ': ' + detail);
}

function buildRuntimeZip() {
  const staging = fs.mkdtempSync(path.join('/tmp', 'omt-rt248-'));
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
  const zipPath = path.join(ARTIFACTS, 'OverlayMatchTimer-2.4.8-TEST.zip');
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  execSync(`cd "${staging}" && zip -qr "${zipPath}" .`);
  const buf = fs.readFileSync(zipPath);
  const sha = createHash('sha256').update(buf).digest('hex');
  fs.writeFileSync(
    path.join(ARTIFACTS, 'OverlayMatchTimer-2.4.8-TEST.sha256'),
    sha + '  OverlayMatchTimer-2.4.8-TEST.zip\n'
  );
  const listing = execSync(`unzip -l "${zipPath}"`, { encoding: 'utf8' });
  const bad = /src\/|scripts\/|design\/|package\.json|node_modules/.test(listing);
  notes.zip = zipPath;
  notes.sha256 = sha;
  notes.zipSize = buf.length;
  notes.zipListingOk = !bad;
  mark('runtime_only_zip', 'simulation', `size=${buf.length} sha=${sha.slice(0, 12)}… badPaths=${bad}`, !bad);
  return { zipPath, staging, sha, size: buf.length };
}

async function setupKickoff(page) {
  await page.evaluate(async () => {
    const v = document.getElementById('omt-local-video');
    if (!v) return;
    await new Promise((r) => {
      if (v.readyState >= 2) return r();
      v.addEventListener('loadeddata', r, { once: true });
      setTimeout(r, 2500);
    });
    const clearSync = () => {
      ['omt-sync-hr', 'omt-sync-min', 'omt-sync-sec'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
    };
    const setKick = async () => {
      const more = document.getElementById('omt-more-toggle');
      if (more && more.getAttribute('aria-expanded') !== 'true') more.click();
      await new Promise((r) => setTimeout(r, 80));
      document.getElementById('omt-btn-set-kickoff')?.click();
      await new Promise((r) => setTimeout(r, 80));
    };
    try { v.currentTime = 0.5; } catch (_) {}
    await new Promise((r) => setTimeout(r, 150));
    const half = document.getElementById('omt-half-select');
    if (half) half.value = '1';
    clearSync();
    await setKick();
    try { v.currentTime = 1.5; } catch (_) {}
    await new Promise((r) => setTimeout(r, 100));
    try { await v.play(); } catch (_) {}
  });
  await page.waitForTimeout(400);
}

async function readPipViaOpener(page, fnBody) {
  return page.evaluate(async (body) => {
    const pipWin = window.documentPictureInPicture && documentPictureInPicture.window;
    if (!pipWin || !pipWin.document) return { ok: false, reason: 'no pipWin' };
    // eslint-disable-next-line no-new-func
    const fn = new Function('pipWin', 'doc', 'root', 'video', body);
    const doc = pipWin.document;
    const root = doc.querySelector('.omt-pip-root');
    const video = doc.querySelector('video');
    return fn(pipWin, doc, root, video);
  }, fnBody);
}

const { staging } = buildRuntimeZip();

const userDataDir = fs.mkdtempSync(path.join('/tmp', 'omt-pip248-'));
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
  await setupKickoff(page);

  const ver = await page.evaluate(() => ({
    version: document.querySelector('footer, .omt-popup-foot') ? null : null,
    minW: window.__omtPipControlsMinW,
    supported: !!(window.documentPictureInPicture && documentPictureInPicture.requestWindow),
    manifestHint: (chrome && chrome.runtime && chrome.runtime.getManifest)
      ? chrome.runtime.getManifest().version : null
  }));
  mark('version_runtime_load', 'real_pip', JSON.stringify(ver),
    ver.supported === true && ver.manifestHint === '2.4.8');

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
  mark('real_pip_window_attach',
    realPipPage || hasPip ? 'real_pip' : 'not_verified',
    realPipPage ? (realPipPage.url() || 'page') : (hasPip ? 'opener→pipWin' : 'none'),
    !!(realPipPage || hasPip)
  );

  if (!hasPip && !realPipPage) {
    throw new Error('Document PiP window did not open');
  }

  /* Background the opener so we exercise the non-throttled PiP paint path. */
  try {
    if (realPipPage) await realPipPage.bringToFront();
  } catch (_) {}
  await page.evaluate(() => {
    try { window.blur(); } catch (_) {}
  });
  await page.waitForTimeout(400);

  /* ---- 1. Timer chip keeps updating while video plays ---- */
  const clocks = await page.evaluate(async () => {
    const pipWin = documentPictureInPicture.window;
    const doc = pipWin.document;
    const v = doc.querySelector('video');
    try { await v.play(); } catch (_) {}
    const read = () => {
      const chip = doc.querySelector(
        '.omt-pip-timer-host #match-timer, .omt-pip-timer-host .omt-match-timer, .omt-pip-timer-host [id$="match-timer"]'
      );
      return {
        text: chip ? (chip.textContent || '').trim() : '',
        t: v ? v.currentTime : null,
        paused: v ? v.paused : null
      };
    };
    const samples = [];
    samples.push(read());
    await new Promise((r) => setTimeout(r, 1200));
    samples.push(read());
    await new Promise((r) => setTimeout(r, 1200));
    samples.push(read());
    await new Promise((r) => setTimeout(r, 1200));
    samples.push(read());
    return samples;
  });
  const texts = clocks.map((s) => s.text);
  const distinct = new Set(texts.filter(Boolean));
  const videoAdvanced = clocks.some((s, i) => i > 0 && s.t != null && clocks[0].t != null && s.t > clocks[0].t + 0.3);
  const chipMoved = distinct.size >= 2;
  mark('1_timer_chip_live', 'real_pip',
    JSON.stringify({ texts, videoAdvanced, paused: clocks.map((s) => s.paused) }),
    chipMoved && videoAdvanced);

  /* Screenshot mid-play for evidence */
  const shotA = path.join(ARTIFACTS, 'v248_pip_clock_a.png');
  if (realPipPage) {
    try { await realPipPage.screenshot({ path: shotA }); notes.shots.push(shotA); } catch (_) {}
  } else {
    /* Capture via CDP screenshot of pip is hard; store opener placeholder + note clocks */
    await page.screenshot({ path: path.join(ARTIFACTS, 'v248_opener_while_pip.png'), fullPage: true });
    notes.shots.push(path.join(ARTIFACTS, 'v248_opener_while_pip.png'));
  }

  await page.waitForTimeout(1300);
  const clocks2 = await page.evaluate(() => {
    const chip = documentPictureInPicture.window.document.querySelector(
      '.omt-pip-timer-host #match-timer, .omt-pip-timer-host .omt-match-timer'
    );
    return chip ? (chip.textContent || '').trim() : '';
  });
  notes.clockEvidence = { samples: texts, later: clocks2 };
  if (realPipPage) {
    const shotB = path.join(ARTIFACTS, 'v248_pip_clock_b.png');
    try { await realPipPage.screenshot({ path: shotB }); notes.shots.push(shotB); } catch (_) {}
  }
  mark('1_timer_chip_evidence', 'real_pip',
    `first=${texts[0]} lastSample=${texts[texts.length - 1]} later=${clocks2}`,
    texts[0] !== clocks2 || chipMoved);

  /* ---- 2. Large panel play/pause orange + icon switch ---- */
  const panelPlay = await page.evaluate(async () => {
    const iconKind = (btn) => {
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
    if (chrome) { chrome.style.opacity = '1'; chrome.style.pointerEvents = 'auto'; }
    const v = doc.querySelector('video');
    const panel = doc.querySelector('.omt-controls-panel, #omt-controls-panel');
    const btn = panel && panel.querySelector('#omt-btn-play, .btn-play');
    if (!v || !btn) return { ok: false, reason: 'missing' };
    try { v.pause(); } catch (_) {}
    await new Promise((r) => setTimeout(r, 300));
    const paused = {
      label: btn.getAttribute('aria-label') || '',
      icon: iconKind(btn),
      playingClass: btn.classList.contains('playing'),
      color: pipWin.getComputedStyle(btn).color
    };

    btn.click();
    await new Promise((r) => setTimeout(r, 400));
    const playing = {
      label: btn.getAttribute('aria-label') || '',
      icon: iconKind(btn),
      playingClass: btn.classList.contains('playing'),
      color: pipWin.getComputedStyle(btn).color,
      videoPlaying: !v.paused
    };

    btn.click();
    await new Promise((r) => setTimeout(r, 400));
    const again = {
      icon: iconKind(btn),
      playingClass: btn.classList.contains('playing'),
      videoPaused: v.paused
    };

    return { ok: true, paused, playing, again };
  });
  const orangeOk = panelPlay.ok &&
    panelPlay.paused.icon === 'play' && panelPlay.paused.playingClass === false &&
    panelPlay.playing.icon === 'pause' && panelPlay.playing.playingClass === true &&
    panelPlay.playing.videoPlaying === true &&
    /245,\s*131,\s*31/.test(panelPlay.playing.color) &&
    panelPlay.again.icon === 'play' && panelPlay.again.playingClass === false &&
    panelPlay.again.videoPaused === true;
  mark('2_panel_play_icon_orange', 'real_pip', JSON.stringify(panelPlay), orangeOk);

  if (realPipPage) {
    await page.evaluate(() => {
      const root = documentPictureInPicture.window.document.querySelector('.omt-pip-root');
      root?.classList.add('omt-pip-chrome-on');
      try { documentPictureInPicture.window.document.querySelector('video')?.play(); } catch (_) {}
    });
    await page.waitForTimeout(300);
    const shotPlay = path.join(ARTIFACTS, 'v248_pip_panel_playing.png');
    try { await realPipPage.screenshot({ path: shotPlay }); notes.shots.push(shotPlay); } catch (_) {}
    await page.evaluate(() => {
      try { documentPictureInPicture.window.document.querySelector('video')?.pause(); } catch (_) {}
    });
    await page.waitForTimeout(300);
    const shotPause = path.join(ARTIFACTS, 'v248_pip_panel_paused.png');
    try { await realPipPage.screenshot({ path: shotPause }); notes.shots.push(shotPause); } catch (_) {}
  }

  /* ---- 3. Narrow icon-row play AND pause ---- */
  const iconRow = await page.evaluate(async () => {
    const iconKind = (btn) => {
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
    if (chrome) { chrome.style.opacity = '1'; chrome.style.pointerEvents = 'auto'; }
    const v = doc.querySelector('video');
    const btn = doc.querySelector('[data-omt-pip-act="play"]');
    if (!v || !btn) return { ok: false, reason: 'missing' };

    try { v.pause(); } catch (_) {}
    await new Promise((r) => setTimeout(r, 250));
    const before = { paused: v.paused, icon: iconKind(btn) };

    btn.click();
    await new Promise((r) => setTimeout(r, 450));
    const afterPlay = { paused: v.paused, icon: iconKind(btn) };

    btn.click();
    await new Promise((r) => setTimeout(r, 450));
    const afterPause = { paused: v.paused, icon: iconKind(btn) };

    return { ok: true, before, afterPlay, afterPause };
  });
  const iconOk = iconRow.ok &&
    iconRow.before.paused === true && iconRow.before.icon === 'play' &&
    iconRow.afterPlay.paused === false && iconRow.afterPlay.icon === 'pause' &&
    iconRow.afterPause.paused === true && iconRow.afterPause.icon === 'play';
  mark('3_icon_row_play_pause', 'real_pip', JSON.stringify(iconRow), iconOk);

  if (realPipPage) {
    const shotIcon = path.join(ARTIFACTS, 'v248_pip_icon_row.png');
    try { await realPipPage.screenshot({ path: shotIcon }); notes.shots.push(shotIcon); } catch (_) {}
  }

  /* ---- Keys 1 / 2 while Document PiP is open ----
   * Hotkeys are handled in the opener MAIN world (PiP forwards into the same
   * handleKeydown). Press Digits on the opener page with PiP still open and the
   * video living in the PiP document. */
  await page.bringToFront();
  await page.locator('body').click({ position: { x: 8, y: 8 } }).catch(() => {});
  const fireDigit = async (digit) => {
    /* Dispatch in the opener document where handleKeydown is installed. */
    return page.evaluate((key) => {
      const ev = new KeyboardEvent('keydown', {
        key,
        code: 'Digit' + key,
        keyCode: 48 + Number(key),
        which: 48 + Number(key),
        bubbles: true,
        cancelable: true,
        view: window
      });
      const ok = document.dispatchEvent(ev);
      return { ok, key };
    }, digit);
  };
  await page.evaluate(() => {
    const half = document.getElementById('omt-half-select');
    if (half) {
      half.value = '2';
      half.dispatchEvent(new Event('change', { bubbles: true }));
    }
    ['omt-sync-hr', 'omt-sync-min', 'omt-sync-sec'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    const v = (documentPictureInPicture.window &&
      documentPictureInPicture.window.document.querySelector('video')) ||
      document.getElementById('omt-local-video');
    try { if (v) v.currentTime = 2.0; } catch (_) {}
    try { document.activeElement && document.activeElement.blur(); } catch (_) {}
  });
  await page.waitForTimeout(150);
  const fire1 = await fireDigit('1');
  await page.waitForTimeout(400);
  const after1 = await page.evaluate(() => {
    const v = (documentPictureInPicture.window &&
      documentPictureInPicture.window.document.querySelector('video')) ||
      document.getElementById('omt-local-video');
    return {
      k1: localStorage.getItem('matchTimerKickoff1'),
      half: localStorage.getItem('matchTimerHalf'),
      videoT: v ? v.currentTime : null,
      pipOpen: !!(documentPictureInPicture && documentPictureInPicture.window),
      hotkeys: (() => {
        try { return JSON.parse(localStorage.getItem('omtHotkeys') || 'null'); } catch (_) { return null; }
      })()
    };
  });
  await page.evaluate(() => {
    const half = document.getElementById('omt-half-select');
    if (half) half.value = '1';
    ['omt-sync-hr', 'omt-sync-min', 'omt-sync-sec'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    const v = (documentPictureInPicture.window &&
      documentPictureInPicture.window.document.querySelector('video')) ||
      document.getElementById('omt-local-video');
    try { if (v) v.currentTime = 3.5; } catch (_) {}
    try { document.activeElement && document.activeElement.blur(); } catch (_) {}
  });
  await page.waitForTimeout(150);
  const fire2 = await fireDigit('2');
  await page.waitForTimeout(400);
  const after2 = await page.evaluate(() => {
    const v = (documentPictureInPicture.window &&
      documentPictureInPicture.window.document.querySelector('video')) ||
      document.getElementById('omt-local-video');
    return {
      k2: localStorage.getItem('matchTimerKickoff2'),
      half: localStorage.getItem('matchTimerHalf'),
      videoT: v ? v.currentTime : null,
      pipOpen: !!(documentPictureInPicture && documentPictureInPicture.window)
    };
  });
  const keys = { method: 'opener_dispatchEvent_while_pip_open', fire1, fire2, after1, after2 };
  const k1n = after1.k1 != null ? parseFloat(after1.k1) : NaN;
  const k2n = after2.k2 != null ? parseFloat(after2.k2) : NaN;
  mark('keys_1_2_in_pip', 'real_pip', JSON.stringify(keys),
    after1.pipOpen && after1.half === '1' && Number.isFinite(k1n) && Math.abs(k1n - 2) < 1.5 &&
    after2.pipOpen && after2.half === '2' && Number.isFinite(k2n) && Math.abs(k2n - 3.5) < 1.5);

  const summary = {
    passed: Object.values(checklist).filter((c) => c.ok === true).length,
    failed: Object.values(checklist).filter((c) => c.ok === false).length,
    skipped: Object.values(checklist).filter((c) => c.ok === null).length
  };
  notes.summary = summary;
  fs.writeFileSync(path.join(ARTIFACTS, 'v248_pip_notes.json'), JSON.stringify(notes, null, 2));
  console.log(JSON.stringify({ summary, issues: notes.issues, sha: notes.sha256, size: notes.zipSize }, null, 2));

  try {
    await page.evaluate(() => {
      if (typeof window.__omtPopoutClose === 'function') window.__omtPopoutClose();
    });
  } catch (_) {}
} catch (err) {
  console.error(err);
  mark('fatal', 'real_pip', String(err && err.message || err), false);
  notes.summary = {
    passed: Object.values(checklist).filter((c) => c.ok === true).length,
    failed: Object.values(checklist).filter((c) => c.ok === false).length,
    skipped: Object.values(checklist).filter((c) => c.ok === null).length
  };
  fs.writeFileSync(path.join(ARTIFACTS, 'v248_pip_notes.json'), JSON.stringify(notes, null, 2));
  process.exitCode = 1;
} finally {
  await context.close().catch(() => {});
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (_) {}
  try { fs.rmSync(staging, { recursive: true, force: true }); } catch (_) {}
}

if (notes.summary && notes.summary.failed > 0) process.exitCode = 1;
