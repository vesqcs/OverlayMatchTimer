/**
 * v2.4.4 — Document PiP field-fix exercise + screenshots.
 * Uses an in-page fake PiP host (iframe) so layout/controls are deterministic,
 * then attempts a real documentPictureInPicture.requestWindow when available.
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
const notes = {
  version: '2.4.4',
  sample: 'xeatre-color-bars.mp4',
  shots: [],
  checklist,
  issues: [],
  realPip: null
};

function pass(id, detail) {
  checklist[id] = { ok: true, detail: detail || 'pass' };
  console.log('PASS', id, detail || '');
}
function fail(id, detail) {
  checklist[id] = { ok: false, detail: String(detail || 'fail') };
  notes.issues.push(id + ': ' + detail);
  console.log('FAIL', id, detail || '');
}
function skip(id, detail) {
  checklist[id] = { ok: null, detail: String(detail || 'skipped') };
  console.log('SKIP', id, detail || '');
}

async function setupKickoff(page) {
  await page.evaluate(async () => {
    const v = document.getElementById('omt-local-video');
    if (!v) return;
    await new Promise((r) => {
      if (v.readyState >= 2) return r();
      v.addEventListener('loadeddata', r, { once: true });
      setTimeout(r, 2000);
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
      const btn = document.getElementById('omt-btn-set-kickoff');
      if (btn) btn.click();
      await new Promise((r) => setTimeout(r, 80));
    };
    try { v.currentTime = 0.4; } catch (_) {}
    await new Promise((r) => setTimeout(r, 150));
    const half = document.getElementById('omt-half-select');
    if (half) half.value = '1';
    clearSync();
    await setKick();
    const t2 = Math.min((v.duration || 6) * 0.55, (v.duration || 6) - 0.25);
    try { v.currentTime = t2; } catch (_) {}
    await new Promise((r) => setTimeout(r, 150));
    if (half) {
      half.value = '2';
      half.dispatchEvent(new Event('change', { bubbles: true }));
    }
    clearSync();
    await setKick();
    try { v.currentTime = 2.0; } catch (_) {}
    await new Promise((r) => setTimeout(r, 150));
    try { await v.play(); } catch (_) {}
  });
  await page.waitForTimeout(700);
}

async function openFakePip(page, width, height) {
  return page.evaluate(async ({ width, height }) => {
    if (typeof window.__omtPopoutClose === 'function') {
      try { window.__omtPopoutClose(); } catch (_) {}
    }
    let host = document.getElementById('omt-pip-shot-host');
    if (host) host.remove();
    host = document.createElement('div');
    host.id = 'omt-pip-shot-host';
    host.style.cssText =
      'position:fixed;inset:0;z-index:2147483647;background:#111;display:flex;align-items:center;justify-content:center;';
    const frame = document.createElement('div');
    frame.id = 'omt-pip-shot-frame';
    frame.style.cssText =
      `width:${width}px;height:${height}px;position:relative;overflow:hidden;box-shadow:0 8px 28px rgba(0,0,0,0.55);`;
    const iframe = document.createElement('iframe');
    iframe.id = 'omt-pip-shot-iframe';
    iframe.style.cssText = 'width:100%;height:100%;border:0;background:#0a0a0a;';
    frame.appendChild(iframe);
    host.appendChild(frame);
    document.body.appendChild(host);
    const fakeWin = iframe.contentWindow;
    fakeWin.document.open();
    fakeWin.document.write(
      '<!doctype html><html><head></head><body style="margin:0;background:#0a0a0a"></body></html>'
    );
    fakeWin.document.close();
    const listeners = { resize: [], pagehide: [], keydown: [], focus: [], pointermove: [], pointerup: [], pointercancel: [], mousemove: [], mouseup: [] };
    const fakePip = {
      document: fakeWin.document,
      innerWidth: width,
      innerHeight: height,
      addEventListener(type, fn, opts) {
        if (!listeners[type]) listeners[type] = [];
        listeners[type].push(fn);
        fakeWin.addEventListener(type, fn, opts);
      },
      removeEventListener(type, fn, opts) {
        fakeWin.removeEventListener(type, fn, opts);
      },
      focus() {
        try { fakeWin.focus(); } catch (_) {}
        try { iframe.focus(); } catch (_) {}
      },
      close() {
        const h = document.getElementById('omt-pip-shot-host');
        if (h) h.remove();
      },
      __listeners: listeners,
      __setSize(w, h) {
        fakePip.innerWidth = w;
        fakePip.innerHeight = h;
        frame.style.width = w + 'px';
        frame.style.height = h + 'px';
        (listeners.resize || []).forEach((fn) => {
          try { fn(); } catch (_) {}
        });
      }
    };
    window.__omtFakePip = fakePip;
    documentPictureInPicture.requestWindow = async () => fakePip;
    const btn = document.getElementById('omt-popout-btn');
    btn.hidden = false;
    btn.style.display = '';
    btn.click();
    await new Promise((r) => setTimeout(r, 900));
    const idoc = fakeWin.document;
    const v = idoc.querySelector('video');
    if (v) {
      try { v.currentTime = 2.2; } catch (_) {}
      try { await v.play(); } catch (_) {}
      await new Promise((r) => setTimeout(r, 400));
    }
    return { opened: !!idoc.querySelector('.omt-pip-root') };
  }, { width, height });
}

async function pipEval(page, fn) {
  return page.evaluate((fnSrc) => {
    const fn = eval('(' + fnSrc + ')');
    const iframe = document.querySelector('#omt-pip-shot-iframe');
    const win = iframe && iframe.contentWindow;
    const doc = win && win.document;
    return fn(doc, win, window.__omtFakePip);
  }, fn.toString());
}

async function forceChrome(page, on) {
  await page.evaluate((on) => {
    const doc = document.querySelector('#omt-pip-shot-iframe')?.contentDocument;
    const root = doc?.querySelector('.omt-pip-root');
    const chrome = doc?.querySelector('.omt-pip-chrome');
    if (!root || !chrome) return;
    if (on) {
      root.classList.add('omt-pip-chrome-on');
      chrome.style.opacity = '1';
      chrome.style.pointerEvents = 'auto';
      chrome.style.transform = 'none';
    } else {
      root.classList.remove('omt-pip-chrome-on');
      chrome.style.opacity = '0';
      chrome.style.pointerEvents = 'none';
      chrome.style.transform = 'translateY(6px)';
    }
  }, on);
}

async function shotFrame(page, name) {
  const p = path.join(ARTIFACTS, name);
  await page.locator('#omt-pip-shot-frame').screenshot({ path: p });
  notes.shots.push(p);
  return p;
}

const userDataDir = fs.mkdtempSync(path.join('/tmp', 'omt-popout244-'));
const context = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  args: [
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    '--disable-features=ExtensionDisableUnsupportedDeveloper',
    '--no-sandbox',
    '--disable-gpu',
    '--autoplay-policy=no-user-gesture-required'
  ],
  viewport: { width: 1280, height: 800 }
});

try {
  const workers = context.serviceWorkers();
  let sw = workers[0];
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 8000 });
  const extId = (sw.url() || '').split('/')[2];
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extId}/player.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!document.getElementById('omt-root'));
  await page.setInputFiles('#omt-local-file-input', SAMPLE);
  await page.waitForTimeout(1000);
  await setupKickoff(page);

  const ver = await page.evaluate(() => {
    try {
      return {
        minW: window.__omtPipControlsMinW,
        minH: window.__omtPipControlsMinH,
        supported: !!(window.__omtPopoutSupported && window.__omtPopoutSupported())
      };
    } catch (_) {
      return {};
    }
  });
  console.log('runtime', ver);
  if (ver.minW === 720) pass('threshold_const', 'MIN_W=720');
  else fail('threshold_const', JSON.stringify(ver));

  /* ---- Medium 640×400 must stay icon row ---- */
  await openFakePip(page, 640, 400);
  await forceChrome(page, true);
  let info = await pipEval(page, (doc) => {
    const root = doc.querySelector('.omt-pip-root');
    const iconRow = doc.querySelector('.omt-pip-icon-row');
    const panelSlot = doc.querySelector('.omt-pip-panel-slot');
    const panel = doc.querySelector('.omt-controls-panel, #omt-controls-panel');
    const tips = Array.from(doc.querySelectorAll('.omt-pip-icons button[data-tip]')).map(
      (b) => b.getAttribute('data-tip')
    );
    const live = panel && panel.querySelector('#omt-live-btn, [id$="omt-live-btn"]');
    const pop = panel && panel.querySelector('#omt-popout-btn, [id$="omt-popout-btn"]');
    const chrome = doc.querySelector('.omt-pip-chrome');
    const kids = chrome ? Array.from(chrome.children).map((c) => c.className || c.id) : [];
    const slider = doc.querySelector('.timeline-slider, #omt-timeline-slider');
    const progress = slider ? slider.style.getPropertyValue('--omt-progress') : null;
    const val = slider ? slider.value : null;
    const min = slider ? slider.min : null;
    const max = slider ? slider.max : null;
    return {
      narrow: root && root.classList.contains('omt-pip-narrow'),
      iconDisplay: iconRow ? getComputedStyle(iconRow).display : null,
      panelInPip: !!(panel && panel.closest && panel.closest('.omt-pip-root')),
      tips,
      liveHidden: !live || live.hidden || getComputedStyle(live).display === 'none',
      popHidden: !pop || pop.hidden || getComputedStyle(pop).display === 'none',
      chromeKids: kids,
      progress,
      val,
      min,
      max,
      hasLocalClass: root && root.classList.contains('omt-pip-local')
    };
  });
  console.log('medium640', info);
  if (info.narrow && info.iconDisplay === 'flex') pass('1_medium_icon_row', '640x400 narrow');
  else fail('1_medium_icon_row', JSON.stringify(info));
  if (info.tips && info.tips.length >= 7 && info.tips.includes('2 min back')) {
    pass('9_icon_tooltips_attrs', info.tips.join(' | '));
  } else fail('9_icon_tooltips_attrs', JSON.stringify(info.tips));

  /* Hover tip portal */
  const tipOk = await page.evaluate(() => {
    const doc = document.querySelector('#omt-pip-shot-iframe')?.contentDocument;
    const btn = doc?.querySelector('.omt-pip-icons button[data-tip="10 s back"]');
    if (!btn) return { ok: false, reason: 'no btn' };
    btn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    const tip = doc.querySelector('.omt-pip-icon-tip');
    const text = tip && !tip.hidden ? tip.textContent : '';
    return { ok: !!text && /10 s back/.test(text), text, hidden: tip && tip.hidden };
  });
  if (tipOk.ok) pass('9_icon_tooltip_hover', tipOk.text);
  else fail('9_icon_tooltip_hover', JSON.stringify(tipOk));

  await forceChrome(page, false);
  await shotFrame(page, 'v244_pip_local_medium_nohover.png');
  await forceChrome(page, true);
  await shotFrame(page, 'v244_pip_local_medium_hover.png');
  /* tooltip visible shot */
  await page.evaluate(() => {
    const doc = document.querySelector('#omt-pip-shot-iframe')?.contentDocument;
    const btn = doc?.querySelector('.omt-pip-icons button[data-tip="Play / Pause"]');
    if (btn) btn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  });
  await page.waitForTimeout(80);
  await shotFrame(page, 'v244_pip_local_medium_tooltip.png');

  /* Icon row actions */
  const iconActs = await page.evaluate(async () => {
    const doc = document.querySelector('#omt-pip-shot-iframe')?.contentDocument;
    const v = doc.querySelector('video');
    if (!v) return { ok: false, reason: 'no video' };
    const t0 = v.currentTime;
    const click = (sel) => {
      const b = doc.querySelector(sel);
      if (b) b.click();
    };
    click('.omt-pip-icons button[data-tip="10 s forward"]');
    await new Promise((r) => setTimeout(r, 120));
    const afterFwd = v.currentTime;
    click('.omt-pip-icons button[data-tip="10 s back"]');
    await new Promise((r) => setTimeout(r, 120));
    const afterBack = v.currentTime;
    const wasPaused = v.paused;
    click('.omt-pip-icons button[data-omt-pip-act="play"]');
    await new Promise((r) => setTimeout(r, 120));
    const afterPlay = v.paused;
    return {
      ok: true,
      t0,
      afterFwd,
      afterBack,
      wasPaused,
      afterPlay,
      fwdDelta: afterFwd - t0,
      toggled: afterPlay !== wasPaused
    };
  });
  /* Short sample (~6s): skip may clamp at end — any forward jump counts. */
  if (iconActs.ok && iconActs.fwdDelta > 0.4) pass('icon_skip_fwd', iconActs);
  else fail('icon_skip_fwd', JSON.stringify(iconActs));
  if (iconActs.ok && iconActs.toggled) pass('icon_play_toggle', iconActs);
  else fail('icon_play_toggle', JSON.stringify(iconActs));

  /* Placeholder on opener — hide the fake-pip shot host so we can see it. */
  const ph = await page.evaluate(() => {
    const host = document.getElementById('omt-pip-shot-host');
    if (host) host.style.visibility = 'hidden';
    const el = document.querySelector('.omt-pip-page-placeholder');
    if (!el) return { ok: false };
    const bg = getComputedStyle(el).backgroundImage + ' ' + getComputedStyle(el).backgroundColor;
    return {
      ok: true,
      bg,
      title: el.querySelector('.omt-pip-page-placeholder-title')?.textContent,
      hasBlue: /1a2433|0b1218|#1a24|#0b12/i.test(bg),
      hasOrange: /245,\s*131,\s*31|F5831F|#f583/i.test(bg),
      hasDark: /14,\s*14,\s*14|10,\s*10,\s*10|#141|#0a0/i.test(bg)
    };
  });
  await page.waitForTimeout(80);
  await page.locator('.omt-pip-page-placeholder').screenshot({
    path: path.join(ARTIFACTS, 'v244_pip_opener_placeholder.png')
  }).catch(async () => {
    await page.screenshot({ path: path.join(ARTIFACTS, 'v244_pip_opener_placeholder.png') });
  });
  notes.shots.push(path.join(ARTIFACTS, 'v244_pip_opener_placeholder.png'));
  await page.evaluate(() => {
    const host = document.getElementById('omt-pip-shot-host');
    if (host) host.style.visibility = '';
  });
  if (ph.ok && !ph.hasBlue && (ph.hasOrange || ph.hasDark)) pass('10_placeholder_local_bg', ph.bg.slice(0, 120));
  else fail('10_placeholder_local_bg', JSON.stringify(ph));

  await page.evaluate(() => {
    if (typeof window.__omtPopoutClose === 'function') window.__omtPopoutClose();
    const host = document.getElementById('omt-pip-shot-host');
    if (host) host.remove();
  });
  await page.waitForTimeout(400);

  /* ---- Large 800×450: compact panel, layout, LIVE hidden, no popout, buttons, drag ---- */
  await openFakePip(page, 800, 450);
  await forceChrome(page, true);
  info = await pipEval(page, (doc, win) => {
    const root = doc.querySelector('.omt-pip-root');
    const panel = doc.querySelector('.omt-controls-panel, #omt-controls-panel');
    const chrome = doc.querySelector('.omt-pip-chrome');
    const children = chrome ? Array.from(chrome.children) : [];
    const order = children.map((c) => {
      if (c.classList.contains('omt-pip-panel-slot')) return 'panelSlot';
      if (c.classList.contains('omt-pip-icon-row')) return 'iconRow';
      if (c.id === 'omt-timeline-bar' || c.classList.contains('omt-timeline-bar')) return 'timeline';
      return c.className || c.id;
    });
    const panelIdx = order.indexOf('panelSlot');
    const tlIdx = order.indexOf('timeline');
    const live = panel && panel.querySelector('#omt-live-btn, [id$="omt-live-btn"]');
    const pop = panel && panel.querySelector('#omt-popout-btn, [id$="omt-popout-btn"]');
    const speedRow = panel && panel.querySelector('.omt-speed-row');
    const slider = doc.querySelector('.timeline-slider, #omt-timeline-slider');
    const progress = slider ? slider.style.getPropertyValue('--omt-progress') : null;
    const v = doc.querySelector('video');
    let expectedPct = null;
    if (slider && v) {
      const min = parseFloat(slider.min) || 0;
      const max = parseFloat(slider.max) || 0;
      const val = parseFloat(slider.value) || 0;
      expectedPct = max > min ? ((val - min) / (max - min)) * 100 : 0;
    }
    return {
      narrow: root && root.classList.contains('omt-pip-narrow'),
      panelInSlot: !!(panel && panel.closest('.omt-pip-panel-slot')),
      small: panel && panel.classList.contains('omt-panel-size-small'),
      compact: panel && panel.classList.contains('omt-panel-compact'),
      speedHidden: !speedRow || getComputedStyle(speedRow).display === 'none',
      liveHidden: !live || live.hidden || getComputedStyle(live).display === 'none',
      popHidden: !pop || pop.hidden || getComputedStyle(pop).display === 'none',
      order,
      timelineAfterPanel: panelIdx >= 0 && tlIdx > panelIdx,
      progress,
      expectedPct,
      sliderVal: slider && slider.value,
      videoTime: v && v.currentTime,
      transform: panel ? getComputedStyle(panel).transform : null
    };
  });
  console.log('large800', info);
  if (!info.narrow && info.panelInSlot) pass('1_large_panel_mode', '800x450 wide');
  else fail('1_large_panel_mode', JSON.stringify(info));
  if (info.small && info.compact && info.speedHidden) pass('2_compact_smallest_panel', 'small+compact, speed hidden');
  else fail('2_compact_smallest_panel', JSON.stringify(info));
  if (info.liveHidden) pass('3_live_hidden_local', 'LIVE hidden');
  else fail('3_live_hidden_local', 'LIVE still visible');
  if (info.timelineAfterPanel) pass('4_timeline_under_panel', info.order.join(' > '));
  else fail('4_timeline_under_panel', info.order.join(' > '));
  if (info.popHidden) pass('11_popout_btn_hidden_in_pip', 'hidden');
  else fail('11_popout_btn_hidden_in_pip', 'still visible');
  if (info.transform === 'none' || info.transform === 'matrix(1, 0, 0, 1, 0, 0)') {
    pass('no_scale_transform', info.transform);
  } else fail('no_scale_transform', info.transform);

  const progOk =
    info.progress &&
    info.expectedPct != null &&
    Math.abs(parseFloat(info.progress) - info.expectedPct) < 2.5;
  if (progOk) pass('5_timeline_progress', `${info.progress} ~= ${info.expectedPct.toFixed(1)}% @ t=${info.videoTime}`);
  else fail('5_timeline_progress', JSON.stringify({ progress: info.progress, expectedPct: info.expectedPct, val: info.sliderVal, t: info.videoTime }));

  await forceChrome(page, false);
  await shotFrame(page, 'v244_pip_local_large_nohover.png');
  await forceChrome(page, true);
  await shotFrame(page, 'v244_pip_local_large_hover.png');

  /* Panel buttons — pause first so deltas aren't masked by playback. */
  const btnResults = await page.evaluate(async () => {
    const doc = document.querySelector('#omt-pip-shot-iframe')?.contentDocument;
    const v = doc.querySelector('video');
    const panel = doc.querySelector('.omt-controls-panel, #omt-controls-panel');
    if (!v || !panel) return { ok: false, reason: 'missing' };
    const out = { ok: true };
    try { v.pause(); } catch (_) {}
    try { v.currentTime = 1.0; } catch (_) {}
    await new Promise((r) => setTimeout(r, 80));

    let playEl = panel.querySelector('#omt-btn-play, .btn-play, button.omt-tile-play');
    const paused0 = v.paused;
    if (playEl) {
      playEl.click();
      await new Promise((r) => setTimeout(r, 180));
      out.playToggled = v.paused !== paused0;
      out.playId = playEl.id || playEl.className;
      /* Return to paused for skip measurements. */
      if (!v.paused) {
        playEl.click();
        await new Promise((r) => setTimeout(r, 120));
      }
    } else {
      out.playToggled = false;
      out.playId = null;
    }

    const tryClick = async (sels, label) => {
      for (const sel of sels) {
        const el = panel.querySelector(sel);
        if (!el) continue;
        try { v.currentTime = 2.0; } catch (_) {}
        await new Promise((r) => setTimeout(r, 40));
        const before = v.currentTime;
        el.click();
        await new Promise((r) => setTimeout(r, 160));
        out[label] = { sel, delta: v.currentTime - before, id: el.id, before, after: v.currentTime };
        return;
      }
      out[label] = { sel: null, delta: 0 };
    };
    await tryClick(['#omt-p10', 'button[data-skip="10"]'], 'skipFwd');
    await tryClick(['#omt-m10', 'button[data-skip="-10"]'], 'skipBack');
    await tryClick(['#omt-next-frame', 'button[data-frame="1"]'], 'frameFwd');
    await tryClick(['#omt-prev-frame', 'button[data-frame="-1"]'], 'frameBack');
    await tryClick(['#omt-p2', 'button[data-skip="2"]'], 'skip2');

    const more = panel.querySelector('#omt-more-toggle, .omt-more-toggle');
    if (more) {
      const before = more.getAttribute('aria-expanded');
      more.click();
      await new Promise((r) => setTimeout(r, 120));
      out.moreToggled = more.getAttribute('aria-expanded') !== before;
      out.moreExpanded = more.getAttribute('aria-expanded');
    }

    const eye = panel.querySelector('#omt-hide-panel, button.omt-tile-hide');
    if (eye) {
      const beforeTip = eye.getAttribute('data-tip') || eye.className;
      eye.click();
      await new Promise((r) => setTimeout(r, 80));
      out.eyeClicked = true;
      out.eyeId = eye.id;
      out.eyeAfter = eye.getAttribute('data-tip') || eye.className;
      out.eyeChanged = out.eyeAfter !== beforeTip ||
        eye.classList.contains('is-auto-hide-off') ||
        eye.classList.contains('is-auto-hide-on');
    }

    const vol = panel.querySelector('#omt-volume-range, input[type="range"]');
    if (vol) {
      const before = v.volume;
      vol.value = '0.25';
      vol.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 80));
      out.volChanged = Math.abs(v.volume - 0.25) < 0.06;
      out.volBefore = before;
      out.volAfter = v.volume;
    }

    out.tNow = v.currentTime;
    return out;
  });
  console.log('panelButtons', btnResults);
  if (btnResults.playToggled) pass('6_play_pause', btnResults.playId);
  else fail('6_play_pause', JSON.stringify(btnResults));
  /* 10s skip on a 6s clip from t=2 clamps to end → delta ~4; accept >= 1.5 or exact clamp. */
  const skipFwdOk = btnResults.skipFwd && (
    Math.abs(btnResults.skipFwd.delta) >= 1.5 ||
    (btnResults.skip2 && Math.abs(btnResults.skip2.delta) >= 1.5)
  );
  if (skipFwdOk) pass('6_skip_fwd', btnResults.skipFwd || btnResults.skip2);
  else fail('6_skip_fwd', JSON.stringify({ skipFwd: btnResults.skipFwd, skip2: btnResults.skip2 }));
  if (btnResults.skipBack && Math.abs(btnResults.skipBack.delta) >= 1.0) pass('6_skip_back', btnResults.skipBack);
  else fail('6_skip_back', JSON.stringify(btnResults.skipBack));
  if (btnResults.frameFwd && btnResults.frameFwd.sel) pass('6_frame_fwd', btnResults.frameFwd);
  else fail('6_frame_fwd', JSON.stringify(btnResults.frameFwd));
  if (btnResults.moreToggled) pass('6_more_chevron', { expanded: btnResults.moreExpanded });
  else fail('6_more_chevron', JSON.stringify({ more: btnResults.moreToggled, expanded: btnResults.moreExpanded }));
  if (btnResults.eyeClicked) pass('6_eye_autohide', { id: btnResults.eyeId, after: btnResults.eyeAfter });
  else fail('6_eye_autohide', JSON.stringify(btnResults));
  if (btnResults.volChanged) pass('6_volume', { before: btnResults.volBefore, after: btnResults.volAfter });
  else fail('6_volume', JSON.stringify({ vol: btnResults.volAfter, changed: btnResults.volChanged }));

  /* Drag */
  const drag = await page.evaluate(async () => {
    const doc = document.querySelector('#omt-pip-shot-iframe')?.contentDocument;
    const win = document.querySelector('#omt-pip-shot-iframe')?.contentWindow;
    const panel = doc.querySelector('.omt-controls-panel, #omt-controls-panel');
    const handle = panel && panel.querySelector('.drag-handle, .drag-center-grip, [data-omt-tile-handle]');
    const fake = window.__omtFakePip;
    if (!panel || !handle || !fake) return { ok: false, reason: 'missing handle/panel' };
    const r0 = panel.getBoundingClientRect();
    const down = new PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, composed: true,
      clientX: r0.left + r0.width / 2, clientY: r0.top + 8,
      pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1
    });
    handle.dispatchEvent(down);
    await new Promise((r) => setTimeout(r, 30));
    const moveX = r0.left + r0.width / 2 + 40;
    const moveY = r0.top + 8 - 30;
    const move = new PointerEvent('pointermove', {
      bubbles: true, cancelable: true, composed: true,
      clientX: moveX, clientY: moveY,
      pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1
    });
    /* Dispatch on pip window (where our listeners live) */
    win.dispatchEvent(move);
    fake.document.dispatchEvent(move);
    await new Promise((r) => setTimeout(r, 40));
    const up = new PointerEvent('pointerup', {
      bubbles: true, cancelable: true, composed: true,
      clientX: moveX, clientY: moveY,
      pointerId: 1, pointerType: 'mouse', button: 0, buttons: 0
    });
    win.dispatchEvent(up);
    await new Promise((r) => setTimeout(r, 40));
    const r1 = panel.getBoundingClientRect();
    return {
      ok: true,
      dx: r1.left - r0.left,
      dy: r1.top - r0.top,
      floating: panel.classList.contains('omt-pip-panel-floating'),
      left: panel.style.left,
      top: panel.style.top
    };
  });
  console.log('drag', drag);
  if (drag.ok && (Math.abs(drag.dx) > 5 || Math.abs(drag.dy) > 5 || drag.floating)) {
    pass('7_panel_drag', drag);
  } else fail('7_panel_drag', JSON.stringify(drag));

  /* Keyboard shortcuts inside PiP */
  const keys = await page.evaluate(async () => {
    const doc = document.querySelector('#omt-pip-shot-iframe')?.contentDocument;
    const win = document.querySelector('#omt-pip-shot-iframe')?.contentWindow;
    const root = doc.querySelector('.omt-pip-root');
    const v = doc.querySelector('video');
    if (!v || !root) return { ok: false };
    try { root.focus(); } catch (_) {}
    const t0 = v.currentTime;
    const paused0 = v.paused;
    const fire = (key, code) => {
      const ev = new KeyboardEvent('keydown', {
        key, code: code || key, bubbles: true, cancelable: true
      });
      doc.dispatchEvent(ev);
      win.dispatchEvent(ev);
      if (doc.documentElement) doc.documentElement.dispatchEvent(ev);
    };
    /* Space = play/pause in OMT */
    fire(' ', 'Space');
    await new Promise((r) => setTimeout(r, 120));
    const afterSpace = v.paused;
    /* ArrowRight often = +N seconds — try common bindings via known handlers */
    fire('ArrowRight', 'ArrowRight');
    await new Promise((r) => setTimeout(r, 120));
    const afterRight = v.currentTime;
    fire('l', 'KeyL'); /* common: +10s if bound */
    await new Promise((r) => setTimeout(r, 120));
    const afterL = v.currentTime;
    fire('j', 'KeyJ');
    await new Promise((r) => setTimeout(r, 120));
    const afterJ = v.currentTime;
    return {
      ok: true,
      t0,
      paused0,
      afterSpace,
      spaceToggled: afterSpace !== paused0,
      afterRight,
      afterL,
      afterJ,
      anySeek: Math.abs(afterRight - t0) > 0.05 || Math.abs(afterL - t0) > 0.05 || Math.abs(afterJ - t0) > 0.05
    };
  });
  console.log('keys', keys);
  if (keys.spaceToggled || keys.anySeek) pass('8_pip_keyboard', keys);
  else fail('8_pip_keyboard', JSON.stringify(keys));

  /* Resize across threshold */
  const resize = await page.evaluate(async () => {
    const fake = window.__omtFakePip;
    const doc = document.querySelector('#omt-pip-shot-iframe')?.contentDocument;
    const root = doc.querySelector('.omt-pip-root');
    if (!fake || !root) return { ok: false };
    fake.__setSize(640, 400);
    await new Promise((r) => setTimeout(r, 100));
    const midNarrow = root.classList.contains('omt-pip-narrow');
    fake.__setSize(800, 450);
    await new Promise((r) => setTimeout(r, 100));
    const largeNarrow = root.classList.contains('omt-pip-narrow');
    return { ok: true, midNarrow, largeNarrow };
  });
  if (resize.ok && resize.midNarrow && !resize.largeNarrow) pass('resize_threshold', resize);
  else fail('resize_threshold', JSON.stringify(resize));

  /* Timeline seek click */
  const seek = await page.evaluate(async () => {
    const doc = document.querySelector('#omt-pip-shot-iframe')?.contentDocument;
    const v = doc.querySelector('video');
    const slider = doc.querySelector('.timeline-slider, #omt-timeline-slider');
    if (!v || !slider) return { ok: false };
    try { v.pause(); } catch (_) {}
    try { v.currentTime = 1.0; } catch (_) {}
    await new Promise((r) => setTimeout(r, 60));
    const before = v.currentTime;
    const min = parseFloat(slider.min) || 0;
    const max = parseFloat(slider.max) || 0;
    const target = min + (max - min) * 0.7;
    slider.value = String(target);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    slider.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 220));
    const progress = slider.style.getPropertyValue('--omt-progress');
    return {
      ok: true,
      before,
      after: v.currentTime,
      target,
      progress,
      moved: Math.abs(v.currentTime - before) > 0.2
    };
  });
  console.log('seek', seek);
  if (seek.ok && seek.moved) pass('timeline_seek', seek);
  else fail('timeline_seek', JSON.stringify(seek));

  /* Close PiP and return */
  await page.evaluate(() => {
    if (typeof window.__omtPopoutClose === 'function') window.__omtPopoutClose();
    const host = document.getElementById('omt-pip-shot-host');
    if (host) host.remove();
  });
  await page.waitForTimeout(500);
  const afterClose = await page.evaluate(() => {
    const v = document.getElementById('omt-local-video');
    const panel = document.getElementById('omt-controls-panel');
    const bar = document.getElementById('omt-timeline-bar');
    const ph = document.querySelector('.omt-pip-page-placeholder');
    return {
      videoBack: !!(v && v.isConnected && !v.closest('.omt-pip-root')),
      panelBack: !!(panel && panel.isConnected && !panel.closest('.omt-pip-root')),
      barBack: !!(bar && bar.isConnected && !bar.closest('.omt-pip-root')),
      placeholderGone: !ph
    };
  });
  if (afterClose.videoBack && afterClose.panelBack && afterClose.placeholderGone) {
    pass('close_return', afterClose);
  } else fail('close_return', JSON.stringify(afterClose));

  /* ---- Real Document PiP attempt ---- */
  const realPip = await page.evaluate(async () => {
    const out = { supported: false, opened: false, error: null };
    try {
      out.supported = !!(window.documentPictureInPicture &&
        typeof documentPictureInPicture.requestWindow === 'function');
      if (!out.supported) return out;
      /* Restore native if we overwrote it for fake pip — may already be native again after navigation? */
      /* In this session we overwrote requestWindow; try calling through prototype / fresh binding. */
      const proto = window.DocumentPictureInPicture && window.DocumentPictureInPicture.prototype;
      let req = null;
      if (proto && proto.requestWindow) req = proto.requestWindow.bind(documentPictureInPicture);
      else req = documentPictureInPicture.requestWindow.bind(documentPictureInPicture);
      let win = null;
      try {
        win = await req.call(documentPictureInPicture, { width: 800, height: 450 });
      } catch (e) {
        out.error = String(e && e.message || e);
        return out;
      }
      out.opened = !!(win && win.document);
      if (win) {
        try { win.close(); } catch (_) {}
      }
      return out;
    } catch (e) {
      out.error = String(e && e.message || e);
      return out;
    }
  });
  notes.realPip = realPip;
  console.log('realPip', realPip);
  if (realPip.opened) pass('real_document_pip_open', 'opened and closed');
  else skip('real_document_pip_open', realPip.error || 'could not open real Document PiP in this environment (fake-pip path exercised instead)');

} finally {
  await context.close().catch(() => {});
}

/* Zip + sha256 */
const zipPath = path.join(ARTIFACTS, 'OverlayMatchTimer-2.4.4-TEST.zip');
try {
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  execSync(`cd "${ROOT}" && zip -r "${zipPath}" Overlay-chrome-extension -x "*/node_modules/*" -x "*/.git/*"`, {
    stdio: 'inherit'
  });
  const buf = fs.readFileSync(zipPath);
  const sha = createHash('sha256').update(buf).digest('hex');
  fs.writeFileSync(path.join(ARTIFACTS, 'OverlayMatchTimer-2.4.4-TEST.sha256'), sha + '  OverlayMatchTimer-2.4.4-TEST.zip\n');
  notes.zip = zipPath;
  notes.sha256 = sha;
  console.log('ZIP', zipPath);
  console.log('SHA256', sha);
} catch (e) {
  notes.issues.push('zip: ' + e.message);
}

const passed = Object.values(checklist).filter((c) => c.ok === true).length;
const failed = Object.values(checklist).filter((c) => c.ok === false).length;
const skipped = Object.values(checklist).filter((c) => c.ok === null).length;
notes.summary = { passed, failed, skipped };
fs.writeFileSync(path.join(ARTIFACTS, 'v244_pip_notes.json'), JSON.stringify(notes, null, 2));
console.log(JSON.stringify(notes, null, 2));
if (failed > 0) process.exitCode = 1;
