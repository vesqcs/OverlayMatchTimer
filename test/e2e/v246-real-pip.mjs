/**
 * v2.4.6 — Real Document Picture-in-Picture exercises via CDP / Playwright pages.
 * Marks each checklist item: real_pip | simulation | not_verified.
 * Also builds the runtime-only zip (manifest-referenced files only).
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
const notes = { version: '2.4.6', shots: [], checklist, issues: [], realPip: {} };

function mark(id, how, detail, ok = true) {
  checklist[id] = { ok, how, detail: detail == null ? '' : String(detail) };
  const tag = ok === false ? 'FAIL' : ok === null ? 'SKIP' : 'PASS';
  console.log(tag, `[${how}]`, id, detail == null ? '' : detail);
  if (ok === false) notes.issues.push(id + ': ' + detail);
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
    try { v.currentTime = 2.5; } catch (_) {}
    await new Promise((r) => setTimeout(r, 150));
    try { await v.play(); } catch (_) {}
  });
  await page.waitForTimeout(500);
}

/** Runtime-only zip matching 2.4.3 packaging. */
function buildRuntimeZip() {
  const staging = fs.mkdtempSync(path.join('/tmp', 'omt-rt246-'));
  const files = [
    'manifest.json',
    'player.html',
    'player.css',
    'sync-feature-flag.js',
    'popup.js',
    'popup.html',
    'popup.css',
    'popup-sync-section.html',
    'background.js',
    'bridge.js',
    'content.js',
    'content.css'
  ];
  for (const f of files) {
    const src = path.join(EXT, f);
    if (!fs.existsSync(src)) throw new Error('missing ' + f);
    fs.copyFileSync(src, path.join(staging, f));
  }
  fs.mkdirSync(path.join(staging, 'assets'));
  for (const f of fs.readdirSync(path.join(EXT, 'assets'))) {
    fs.copyFileSync(path.join(EXT, 'assets', f), path.join(staging, 'assets', f));
  }
  const zipPath = path.join(ARTIFACTS, 'OverlayMatchTimer-2.4.6-TEST.zip');
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  execSync(`cd "${staging}" && zip -r "${zipPath}" .`, { stdio: 'inherit' });
  const buf = fs.readFileSync(zipPath);
  const sha = createHash('sha256').update(buf).digest('hex');
  const size = buf.length;
  fs.writeFileSync(
    path.join(ARTIFACTS, 'OverlayMatchTimer-2.4.6-TEST.sha256'),
    `${sha}  OverlayMatchTimer-2.4.6-TEST.zip\n`
  );
  const listing = execSync(`unzip -l "${zipPath}"`, { encoding: 'utf8' });
  const bad = /src\/|scripts\/|design\/|package\.json|node_modules/.test(listing);
  notes.zip = zipPath;
  notes.sha256 = sha;
  notes.zipSize = size;
  notes.zipListingOk = !bad;
  mark('runtime_only_zip', 'simulation', `size=${size} sha=${sha.slice(0, 12)}… badPaths=${bad}`, !bad);
  return { zipPath, sha, size, staging };
}

const { zipPath, staging } = buildRuntimeZip();

/* Load the RUNTIME zip contents as an unpacked extension (exact ship set). */
const userDataDir = fs.mkdtempSync(path.join('/tmp', 'omt-pip246-'));
const context = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  args: [
    `--disable-extensions-except=${staging}`,
    `--load-extension=${staging}`,
    '--disable-features=ExtensionDisableUnsupportedDeveloper',
    '--no-sandbox',
    '--disable-gpu',
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
  await page.waitForTimeout(1000);
  await setupKickoff(page);

  const ver = await page.evaluate(() => ({
    minW: window.__omtPipControlsMinW,
    supported: !!(window.documentPictureInPicture && documentPictureInPicture.requestWindow)
  }));
  mark('version_runtime_load', 'real_pip', JSON.stringify(ver), ver.supported === true);

  /* Discover PiP as a new Playwright page / CDP target. */
  const pagePromise = context.waitForEvent('page', { timeout: 8000 }).catch(() => null);

  await page.evaluate(async () => {
    const btn = document.getElementById('omt-popout-btn');
    if (!btn) throw new Error('no popout btn');
    btn.hidden = false;
    btn.style.display = '';
    /* Prefer a wide PiP so large-mode panel is used. */
    const native = DocumentPictureInPicture.prototype.requestWindow.bind(documentPictureInPicture);
    documentPictureInPicture.requestWindow = (opts) =>
      native({ width: 900, height: 520, ...(opts || {}) });
    btn.click();
  });

  realPipPage = await pagePromise;
  /* Fallback: scan context.pages() for a PiP-looking document. */
  if (!realPipPage) {
    await page.waitForTimeout(1200);
    for (const p of context.pages()) {
      if (p === page) continue;
      try {
        const has = await p.evaluate(() => !!document.querySelector('.omt-pip-root'));
        if (has) {
          realPipPage = p;
          break;
        }
      } catch (_) {}
    }
  }

  /* CDP target discovery fallback */
  if (!realPipPage) {
    try {
      const cdp = await context.newCDPSession(page);
      const { targetInfos } = await cdp.send('Target.getTargets');
      notes.realPip.cdpTargets = (targetInfos || []).map((t) => ({
        type: t.type,
        url: t.url,
        title: t.title
      }));
      const pipTarget = (targetInfos || []).find(
        (t) =>
          t.type === 'page' &&
          t.url &&
          t.url !== page.url() &&
          !/player\.html/.test(t.url)
      );
      if (pipTarget) {
        notes.realPip.cdpPipTargetId = pipTarget.targetId;
      }
    } catch (e) {
      notes.realPip.cdpError = String(e && e.message || e);
    }
  }

  if (!realPipPage) {
    mark(
      'real_pip_window_attach',
      'not_verified',
      'No Playwright page / attachable Document PiP target after requestWindow. CDP targets logged in notes.realPip. Falling back: cannot dispatch input into a live PiP document from this agent.',
      null
    );
    /* Still try opener-side observations after open. */
    await page.waitForTimeout(1500);
    const openerState = await page.evaluate(() => {
      const ph = !!document.querySelector('.omt-pip-page-placeholder');
      const pipWin = window.documentPictureInPicture && documentPictureInPicture.window;
      let clock = '';
      let narrow = null;
      let moreHidden = null;
      if (pipWin && pipWin.document) {
        const chip = pipWin.document.querySelector(
          '.omt-pip-timer-host #match-timer, .omt-pip-timer-host .omt-match-timer'
        );
        clock = chip ? (chip.textContent || '').trim() : '';
        narrow = !!pipWin.document.querySelector('.omt-pip-root.omt-pip-narrow');
        const more = pipWin.document.querySelector('#omt-more-toggle, .omt-more-toggle');
        moreHidden = !more || more.hidden || pipWin.getComputedStyle(more).display === 'none';
      }
      return {
        placeholder: ph,
        hasPipWindow: !!pipWin,
        clock,
        narrow,
        moreHidden,
        pipW: pipWin ? pipWin.innerWidth : null,
        pipH: pipWin ? pipWin.innerHeight : null
      };
    });
    notes.realPip.openerState = openerState;
    mark(
      'real_pip_window_exists',
      openerState.hasPipWindow ? 'real_pip' : 'not_verified',
      JSON.stringify(openerState),
      !!openerState.hasPipWindow
    );

    if (openerState.hasPipWindow) {
      /* Timer freeze test: sample clock twice via opener→pipWin.document */
      const clocks = await page.evaluate(async () => {
        const pipWin = documentPictureInPicture.window;
        const read = () => {
          const chip = pipWin.document.querySelector(
            '.omt-pip-timer-host #match-timer, .omt-pip-timer-host .omt-match-timer, .omt-pip-timer-host [id$="match-timer"]'
          );
          return chip ? (chip.textContent || '').trim() : '';
        };
        const a = read();
        await new Promise((r) => setTimeout(r, 1600));
        const b = read();
        await new Promise((r) => setTimeout(r, 1600));
        const c = read();
        return { a, b, c };
      });
      const moved = clocks.a !== clocks.b || clocks.b !== clocks.c;
      mark('1_timer_keeps_updating', 'real_pip', JSON.stringify(clocks), moved);

      const moreHidden = await page.evaluate(() => {
        const pipWin = documentPictureInPicture.window;
        const more = pipWin.document.querySelector('#omt-more-toggle, .omt-more-toggle');
        if (!more) return true;
        return more.hidden || pipWin.getComputedStyle(more).display === 'none';
      });
      mark('7_more_chevron_removed', 'real_pip', `hidden=${moreHidden}`, !!moreHidden);

      /* Drive clicks via opener-held reference to pipWin.document elements */
      const panelActs = await page.evaluate(async () => {
        const pipWin = documentPictureInPicture.window;
        const doc = pipWin.document;
        const root = doc.querySelector('.omt-pip-root');
        root?.classList.add('omt-pip-chrome-on');
        const chrome = doc.querySelector('.omt-pip-chrome');
        if (chrome) {
          chrome.style.opacity = '1';
          chrome.style.pointerEvents = 'auto';
        }
        const v = doc.querySelector('video');
        const panel = doc.querySelector('.omt-controls-panel, #omt-controls-panel');
        if (!v || !panel) return { ok: false, reason: 'missing video/panel' };
        try { v.pause(); } catch (_) {}
        try { v.currentTime = 2; } catch (_) {}
        await new Promise((r) => setTimeout(r, 80));

        const out = { ok: true };

        const play = panel.querySelector('#omt-btn-play');
        const p0 = v.paused;
        play?.click();
        await new Promise((r) => setTimeout(r, 200));
        out.playToggled = v.paused !== p0;
        if (!v.paused) {
          play?.click();
          await new Promise((r) => setTimeout(r, 120));
        }

        try { v.currentTime = 2; } catch (_) {}
        await new Promise((r) => setTimeout(r, 40));
        const t0 = v.currentTime;
        panel.querySelector('#omt-p10')?.click();
        await new Promise((r) => setTimeout(r, 180));
        out.skipDelta = v.currentTime - t0;

        const mute = panel.querySelector('#omt-volume-icon-btn');
        const muted0 = v.muted || v.volume === 0;
        mute?.click();
        await new Promise((r) => setTimeout(r, 200));
        out.muteToggled = (v.muted || v.volume === 0) !== muted0;
        const muteIcon = mute ? mute.innerHTML : '';
        out.muteIconChanged = /volume-x|volume-1|volume-2/.test(muteIcon);

        const vol = panel.querySelector('#omt-volume-range');
        if (vol) {
          vol.value = '0.3';
          vol.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise((r) => setTimeout(r, 150));
          out.volAfter = v.volume;
          out.volOk = Math.abs(v.volume - 0.3) < 0.08;
        }

        const eye = panel.querySelector('#omt-hide-panel');
        const tip0 = eye ? eye.getAttribute('data-tip') : '';
        eye?.click();
        await new Promise((r) => setTimeout(r, 200));
        const tip1 = eye ? eye.getAttribute('data-tip') : '';
        out.eyeTipChanged = tip0 !== tip1;
        out.eyeTip = tip1;

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
              pointerId: 7,
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
              clientX: r0.left + r0.width / 2 + 50,
              clientY: r0.top + 10 - 40,
              pointerId: 7,
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
              clientX: r0.left + 50,
              clientY: r0.top - 30,
              pointerId: 7,
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
            left: panel.style.left,
            top: panel.style.top,
            floating: panel.classList.contains('omt-pip-panel-floating'),
            jumpedCorner: r1.left < 8 && r1.top < 8 && (Math.abs(r1.left - r0.left) > 20 || Math.abs(r1.top - r0.top) > 20)
          };
        }

        /* Clock still moving after interactions */
        const chip = doc.querySelector(
          '.omt-pip-timer-host #match-timer, .omt-pip-timer-host .omt-match-timer'
        );
        const c1 = chip ? chip.textContent.trim() : '';
        try { await v.play(); } catch (_) {}
        await new Promise((r) => setTimeout(r, 1800));
        const c2 = chip ? chip.textContent.trim() : '';
        out.clockAfter = { c1, c2, moved: c1 !== c2 };

        out.panelInPip = !!panel.closest('.omt-pip-root');
        out.moreHidden = (() => {
          const m = panel.querySelector('#omt-more-toggle');
          return !m || m.hidden || pipWin.getComputedStyle(m).display === 'none';
        })();
        out.popHidden = (() => {
          const m = panel.querySelector('#omt-popout-btn');
          return !m || m.hidden || pipWin.getComputedStyle(m).display === 'none';
        })();
        out.liveHidden = (() => {
          const m = panel.querySelector('#omt-live-btn');
          return !m || m.hidden || pipWin.getComputedStyle(m).display === 'none';
        })();
        return out;
      });

      notes.realPip.panelActs = panelActs;
      mark('8_play_pause', 'real_pip', JSON.stringify(panelActs.playToggled), !!panelActs.playToggled);
      mark('8_skip', 'real_pip', `delta=${panelActs.skipDelta}`, Math.abs(panelActs.skipDelta || 0) >= 1.5);
      mark('3_mute', 'real_pip', JSON.stringify({ toggled: panelActs.muteToggled, icon: panelActs.muteIconChanged }), !!panelActs.muteToggled);
      mark('4_volume_slider', 'real_pip', `vol=${panelActs.volAfter}`, !!panelActs.volOk);
      mark('5_eye_autohide', 'real_pip', panelActs.eyeTip, !!panelActs.eyeTipChanged);
      mark(
        '2_drag_no_corner_jump',
        'real_pip',
        JSON.stringify(panelActs.drag),
        !!(panelActs.drag && !panelActs.drag.jumpedCorner && (Math.abs(panelActs.drag.dx) > 5 || Math.abs(panelActs.drag.dy) > 5 || panelActs.drag.floating))
      );
      mark('1_timer_after_actions', 'real_pip', JSON.stringify(panelActs.clockAfter), !!(panelActs.clockAfter && panelActs.clockAfter.moved));
      mark('7_more_removed_in_panel', 'real_pip', '', !!panelActs.moreHidden);
      mark('popout_hidden', 'real_pip', '', !!panelActs.popHidden);
      mark('live_hidden_local', 'real_pip', '', !!panelActs.liveHidden);

      /* Screenshots via CDP capture on pip window is hard without a Page;
         capture opener placeholder + evaluate screenshot is limited.
         Take opener placeholder shot; attempt pip screenshot through CDP. */
      await page.evaluate(() => {
        /* ensure placeholder visible */
      });
      const ph = page.locator('.omt-pip-page-placeholder');
      if (await ph.count()) {
        await ph.screenshot({ path: path.join(ARTIFACTS, 'v246_pip_opener_placeholder.png') });
        notes.shots.push(path.join(ARTIFACTS, 'v246_pip_opener_placeholder.png'));
      }

      /* Try CDP screencast / captureScreenshot on pip browsing context via target */
      try {
        const cdp = await context.newCDPSession(page);
        const { targetInfos } = await cdp.send('Target.getTargets');
        const pipT = (targetInfos || []).find(
          (t) => t.attached === false || (t.type === 'page' && t.url === '')
        );
        /* Document PiP often has empty url; find by title or recent */
        const candidates = (targetInfos || []).filter(
          (t) => t.type === 'page' && t.targetId && t.url !== page.url()
        );
        notes.realPip.screenshotCandidates = candidates.map((t) => ({
          id: t.targetId,
          url: t.url,
          title: t.title,
          attached: t.attached
        }));
        for (const t of candidates) {
          try {
            const { sessionId } = await cdp.send('Target.attachToTarget', {
              targetId: t.targetId,
              flatten: true
            });
            /* flattened session shares the same CDP connection in Playwright — use new session */
            const pipCdp = await context.newCDPSession(page).catch(() => null);
            void pipCdp;
            void sessionId;
          } catch (e) {
            notes.realPip.attachErr = String(e && e.message || e);
          }
        }
      } catch (e) {
        notes.realPip.shotErr = String(e && e.message || e);
      }

      /* Close PiP */
      await page.evaluate(() => {
        if (typeof window.__omtPopoutClose === 'function') window.__omtPopoutClose();
        else if (documentPictureInPicture.window) documentPictureInPicture.window.close();
      });
      await page.waitForTimeout(600);
      const restored = await page.evaluate(() => ({
        video: !!document.getElementById('omt-local-video')?.isConnected,
        panel: !!document.getElementById('omt-controls-panel')?.isConnected,
        phGone: !document.querySelector('.omt-pip-page-placeholder')
      }));
      mark('close_return', 'real_pip', JSON.stringify(restored), !!(restored.video && restored.panel && restored.phGone));
    }

    mark(
      '6_shuttle',
      'not_verified',
      'Shuttle lives under More panel; More chevron removed from PiP by design — no shuttle control in PiP.',
      null
    );
  } else {
    /* We got a real Playwright page for the PiP — preferred path. */
    mark('real_pip_window_attach', 'real_pip', realPipPage.url(), true);
    await realPipPage.waitForTimeout(500);
    await realPipPage.evaluate(() => {
      const root = document.querySelector('.omt-pip-root');
      root?.classList.add('omt-pip-chrome-on');
    });

    const clocks = await realPipPage.evaluate(async () => {
      const read = () => {
        const chip = document.querySelector(
          '.omt-pip-timer-host #match-timer, .omt-pip-timer-host .omt-match-timer'
        );
        return chip ? (chip.textContent || '').trim() : '';
      };
      const a = read();
      await new Promise((r) => setTimeout(r, 1600));
      const b = read();
      await new Promise((r) => setTimeout(r, 1600));
      const c = read();
      return { a, b, c };
    });
    mark('1_timer_keeps_updating', 'real_pip', JSON.stringify(clocks), clocks.a !== clocks.b || clocks.b !== clocks.c);

    await realPipPage.screenshot({ path: path.join(ARTIFACTS, 'v246_real_pip_large_hover.png') });
    notes.shots.push(path.join(ARTIFACTS, 'v246_real_pip_large_hover.png'));

    const acts = await realPipPage.evaluate(async () => {
      const v = document.querySelector('video');
      const panel = document.querySelector('.omt-controls-panel');
      const out = {};
      try { v.pause(); v.currentTime = 2; } catch (_) {}
      await new Promise((r) => setTimeout(r, 60));
      const play = panel.querySelector('#omt-btn-play');
      const p0 = v.paused;
      play.click();
      await new Promise((r) => setTimeout(r, 180));
      out.play = v.paused !== p0;
      if (!v.paused) play.click();
      await new Promise((r) => setTimeout(r, 100));
      v.currentTime = 2;
      const t0 = v.currentTime;
      panel.querySelector('#omt-p10').click();
      await new Promise((r) => setTimeout(r, 160));
      out.skip = v.currentTime - t0;
      const mute = panel.querySelector('#omt-volume-icon-btn');
      const m0 = v.muted || v.volume === 0;
      mute.click();
      await new Promise((r) => setTimeout(r, 160));
      out.mute = (v.muted || v.volume === 0) !== m0;
      const vol = panel.querySelector('#omt-volume-range');
      vol.value = '0.25';
      vol.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 120));
      out.vol = v.volume;
      const eye = panel.querySelector('#omt-hide-panel');
      const tip0 = eye.getAttribute('data-tip');
      eye.click();
      await new Promise((r) => setTimeout(r, 160));
      out.eye = eye.getAttribute('data-tip') !== tip0;
      out.moreHidden =
        !panel.querySelector('#omt-more-toggle') ||
        getComputedStyle(panel.querySelector('#omt-more-toggle')).display === 'none';
      return out;
    });
    mark('8_play_pause', 'real_pip', acts.play, !!acts.play);
    mark('8_skip', 'real_pip', acts.skip, Math.abs(acts.skip) >= 1.5);
    mark('3_mute', 'real_pip', acts.mute, !!acts.mute);
    mark('4_volume_slider', 'real_pip', acts.vol, Math.abs(acts.vol - 0.25) < 0.08);
    mark('5_eye_autohide', 'real_pip', acts.eye, !!acts.eye);
    mark('7_more_chevron_removed', 'real_pip', acts.moreHidden, !!acts.moreHidden);
    mark('6_shuttle', 'not_verified', 'More removed — no shuttle in PiP', null);

    /* Drag on real page */
    const drag = await realPipPage.evaluate(async () => {
      const panel = document.querySelector('.omt-controls-panel');
      const handle = panel.querySelector('.drag-handle');
      const r0 = panel.getBoundingClientRect();
      handle.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          cancelable: true,
          clientX: r0.left + r0.width / 2,
          clientY: r0.top + 8,
          pointerId: 3,
          pointerType: 'mouse',
          button: 0,
          buttons: 1
        })
      );
      await new Promise((r) => setTimeout(r, 20));
      window.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          cancelable: true,
          clientX: r0.left + 60,
          clientY: r0.top - 30,
          pointerId: 3,
          pointerType: 'mouse',
          button: 0,
          buttons: 1
        })
      );
      await new Promise((r) => setTimeout(r, 30));
      window.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          cancelable: true,
          clientX: r0.left + 60,
          clientY: r0.top - 30,
          pointerId: 3,
          pointerType: 'mouse',
          button: 0,
          buttons: 0
        })
      );
      await new Promise((r) => setTimeout(r, 30));
      const r1 = panel.getBoundingClientRect();
      return {
        dx: r1.left - r0.left,
        dy: r1.top - r0.top,
        jumpedCorner: r1.left < 8 && r1.top < 8 && Math.abs(r1.left - r0.left) > 30,
        floating: panel.classList.contains('omt-pip-panel-floating')
      };
    });
    mark('2_drag_no_corner_jump', 'real_pip', JSON.stringify(drag), !drag.jumpedCorner && (Math.abs(drag.dx) > 5 || Math.abs(drag.dy) > 5 || drag.floating));

    await realPipPage.screenshot({ path: path.join(ARTIFACTS, 'v246_real_pip_after_drag.png') });
    notes.shots.push(path.join(ARTIFACTS, 'v246_real_pip_after_drag.png'));

    await page.evaluate(() => {
      if (typeof window.__omtPopoutClose === 'function') window.__omtPopoutClose();
    });
  }
} catch (e) {
  notes.fatal = String(e && e.stack || e);
  mark('fatal', 'not_verified', notes.fatal, false);
} finally {
  await context.close().catch(() => {});
}

const passed = Object.values(checklist).filter((c) => c.ok === true).length;
const failed = Object.values(checklist).filter((c) => c.ok === false).length;
const skipped = Object.values(checklist).filter((c) => c.ok === null).length;
notes.summary = { passed, failed, skipped };
fs.writeFileSync(path.join(ARTIFACTS, 'v246_pip_notes.json'), JSON.stringify(notes, null, 2));
console.log(JSON.stringify({ summary: notes.summary, issues: notes.issues, sha256: notes.sha256, zipSize: notes.zipSize }, null, 2));
if (failed > 0) process.exitCode = 1;
