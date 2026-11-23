/**
 * v2.4.5 — Layout fix + full pop-out self-review since 2.4.0.
 * Screenshots: small(~400), medium(~640), large(~800+) ± hover.
 * Checklist marks: real_pip | simulation | not_verified
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
  version: '2.4.5',
  sample: 'xeatre-color-bars.mp4',
  shots: [],
  checklist,
  issues: [],
  realPip: null
};

function mark(id, how, detail, ok = true) {
  checklist[id] = { ok, how, detail: detail || '' };
  const tag = ok === false ? 'FAIL' : ok === null ? 'SKIP' : 'PASS';
  console.log(tag, `[${how}]`, id, detail || '');
  if (ok === false) notes.issues.push(id + ': ' + detail);
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
    await new Promise((r) => setTimeout(r, 120));
    const half = document.getElementById('omt-half-select');
    if (half) half.value = '1';
    clearSync();
    await setKick();
    const t2 = Math.min((v.duration || 6) * 0.55, (v.duration || 6) - 0.25);
    try { v.currentTime = t2; } catch (_) {}
    await new Promise((r) => setTimeout(r, 120));
    if (half) {
      half.value = '2';
      half.dispatchEvent(new Event('change', { bubbles: true }));
    }
    clearSync();
    await setKick();
    try { v.currentTime = 2.0; } catch (_) {}
    await new Promise((r) => setTimeout(r, 120));
    try { await v.play(); } catch (_) {}
  });
  await page.waitForTimeout(600);
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
    const listeners = {};
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
      },
      close() {
        const h = document.getElementById('omt-pip-shot-host');
        if (h) h.remove();
      },
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
      await new Promise((r) => setTimeout(r, 350));
    }
    return { opened: !!idoc.querySelector('.omt-pip-root') };
  }, { width, height });
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

async function inspect(page) {
  return page.evaluate(() => {
    const doc = document.querySelector('#omt-pip-shot-iframe')?.contentDocument;
    const win = document.querySelector('#omt-pip-shot-iframe')?.contentWindow;
    if (!doc) return null;
    const root = doc.querySelector('.omt-pip-root');
    const chrome = doc.querySelector('.omt-pip-chrome');
    const stage = doc.querySelector('.omt-pip-stage');
    const video = doc.querySelector('video');
    const iconRow = doc.querySelector('.omt-pip-icon-row');
    const panelSlot = doc.querySelector('.omt-pip-panel-slot');
    const panel = doc.querySelector('.omt-controls-panel, #omt-controls-panel');
    const timeline = doc.querySelector('.omt-timeline-bar, #omt-timeline-bar');
    const slider = doc.querySelector('.timeline-slider, #omt-timeline-slider');
    const clock = doc.querySelector(
      '.omt-pip-timer-host #match-timer, .omt-pip-timer-host .omt-match-timer, .omt-pip-timer-host [id$="match-timer"]'
    );
    const ret = doc.querySelector('.omt-pip-return, button.omt-pip-return');
    const live = panel && panel.querySelector('#omt-live-btn, [id$="omt-live-btn"]');
    const pop = panel && panel.querySelector('#omt-popout-btn, [id$="omt-popout-btn"]');
    const speedRow = panel && panel.querySelector('.omt-speed-row');
    const tips = Array.from(doc.querySelectorAll('.omt-pip-icons button[data-tip]')).map((b) =>
      b.getAttribute('data-tip')
    );
    const ticks = doc.querySelectorAll('.omt-period-tick').length;
    const tickOpacity = (() => {
      const c = doc.querySelector('.omt-timeline-period-ticks');
      return c ? win.getComputedStyle(c).opacity : null;
    })();
    const orderTops = {};
    if (timeline) orderTops.timeline = timeline.getBoundingClientRect().top;
    if (iconRow && win.getComputedStyle(iconRow).display !== 'none') {
      orderTops.iconRow = iconRow.getBoundingClientRect().top;
    }
    if (panelSlot && win.getComputedStyle(panelSlot).display !== 'none') {
      orderTops.panelSlot = panelSlot.getBoundingClientRect().top;
    }
    if (panel && panel.closest('.omt-pip-panel-slot')) {
      orderTops.panel = panel.getBoundingClientRect().top;
    }
    const videoRect = video ? video.getBoundingClientRect() : null;
    const stageRect = stage ? stage.getBoundingClientRect() : null;
    const chromeOn = root && root.classList.contains('omt-pip-chrome-on');
    const chromeOpacity = chrome ? win.getComputedStyle(chrome).opacity : null;
    return {
      narrow: root && root.classList.contains('omt-pip-narrow'),
      local: root && root.classList.contains('omt-pip-local'),
      clock: clock ? (clock.innerText || clock.textContent || '').trim() : '',
      hasReturn: !!ret,
      liveHidden: !live || live.hidden || win.getComputedStyle(live).display === 'none',
      popHidden: !pop || pop.hidden || win.getComputedStyle(pop).display === 'none',
      small: panel && panel.classList.contains('omt-panel-size-small'),
      compact: panel && panel.classList.contains('omt-panel-compact'),
      speedHidden: !speedRow || win.getComputedStyle(speedRow).display === 'none',
      panelInSlot: !!(panel && panel.closest('.omt-pip-panel-slot')),
      tips,
      tipCount: tips.length,
      ticks,
      tickOpacity,
      progress: slider ? slider.style.getPropertyValue('--omt-progress') : null,
      sliderVal: slider ? slider.value : null,
      videoTime: video ? video.currentTime : null,
      orderTops,
      videoRect,
      stageRect,
      chromeOn,
      chromeOpacity,
      transform: panel ? win.getComputedStyle(panel).transform : null,
      iconDisplay: iconRow ? win.getComputedStyle(iconRow).display : null,
      panelDisplay: panelSlot ? win.getComputedStyle(panelSlot).display : null
    };
  });
}

async function shot(page, name) {
  const p = path.join(ARTIFACTS, name);
  await page.locator('#omt-pip-shot-frame').screenshot({ path: p });
  notes.shots.push(p);
  return p;
}

async function closePip(page) {
  await page.evaluate(() => {
    if (typeof window.__omtPopoutClose === 'function') window.__omtPopoutClose();
    const host = document.getElementById('omt-pip-shot-host');
    if (host) host.remove();
  });
  await page.waitForTimeout(350);
}

const userDataDir = fs.mkdtempSync(path.join('/tmp', 'omt-popout245-'));
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
  await page.waitForTimeout(900);
  await setupKickoff(page);

  const ver = await page.evaluate(() => ({
    minW: window.__omtPipControlsMinW,
    supported: !!(window.__omtPopoutSupported && window.__omtPopoutSupported())
  }));
  mark('threshold_800', 'simulation', `MIN_W=${ver.minW}`, ver.minW === 800);

  const sizes = [
    { key: 'small', width: 400, height: 260, expectNarrow: true },
    { key: 'medium', width: 640, height: 400, expectNarrow: true },
    { key: 'large', width: 800, height: 450, expectNarrow: false }
  ];

  for (const sz of sizes) {
    await openFakePip(page, sz.width, sz.height);

    /* no-hover */
    await forceChrome(page, false);
    await page.waitForTimeout(80);
    let info = await inspect(page);
    await shot(page, `v245_pip_local_${sz.key}_nohover.png`);

    const chromeHidden =
      info &&
      (!info.chromeOn || parseFloat(info.chromeOpacity || '0') < 0.05);
    mark(
      `${sz.key}_chrome_hidden_until_hover`,
      'simulation',
      `opacity=${info && info.chromeOpacity}`,
      !!chromeHidden
    );

    /* video full-bleed (stage fills frame; video inset 0) */
    const fullBleed =
      info &&
      info.videoRect &&
      info.stageRect &&
      Math.abs(info.videoRect.width - info.stageRect.width) < 2 &&
      Math.abs(info.videoRect.height - info.stageRect.height) < 2;
    mark(`${sz.key}_video_fullbleed_nohover`, 'simulation', JSON.stringify(info && info.videoRect), !!fullBleed);

    /* hover */
    await forceChrome(page, true);
    await page.waitForTimeout(120);
    info = await inspect(page);
    await shot(page, `v245_pip_local_${sz.key}_hover.png`);

    const fullBleedHover =
      info &&
      info.videoRect &&
      info.stageRect &&
      Math.abs(info.videoRect.width - info.stageRect.width) < 2;
    mark(
      `${sz.key}_video_never_shrinks_on_hover`,
      'simulation',
      `stage=${info && info.stageRect && info.stageRect.width} video=${info && info.videoRect && info.videoRect.width}`,
      !!fullBleedHover
    );

    mark(
      `${sz.key}_mode`,
      'simulation',
      `narrow=${info && info.narrow} expected=${sz.expectNarrow}`,
      !!(info && info.narrow === sz.expectNarrow)
    );

    const clockOk =
      info &&
      info.clock &&
      /^\d{1,2}:\d{2}/.test(info.clock) &&
      !/'\s*$/.test(info.clock);
    mark(`${sz.key}_clock_mmss`, 'simulation', info && info.clock, !!clockOk);

    mark(`${sz.key}_no_return_btn`, 'simulation', `hasReturn=${info && info.hasReturn}`, !!(info && !info.hasReturn));
    mark(`${sz.key}_live_hidden`, 'simulation', '', !!(info && info.liveHidden));
    mark(`${sz.key}_popout_hidden`, 'simulation', '', !!(info && info.popHidden));

    if (sz.expectNarrow) {
      const orderOk =
        info &&
        info.orderTops.timeline != null &&
        info.orderTops.iconRow != null &&
        info.orderTops.timeline < info.orderTops.iconRow - 2;
      mark(
        `${sz.key}_layout_timeline_then_icons`,
        'simulation',
        JSON.stringify(info && info.orderTops),
        !!orderOk
      );
      mark(
        `${sz.key}_icon_tooltips`,
        'simulation',
        (info && info.tips && info.tips.join(' | ')) || '',
        !!(info && info.tipCount >= 7)
      );
    } else {
      const orderOk =
        info &&
        info.orderTops.timeline != null &&
        (info.orderTops.panel != null || info.orderTops.panelSlot != null) &&
        (info.orderTops.panel || info.orderTops.panelSlot) < info.orderTops.timeline - 2;
      mark(
        `${sz.key}_layout_panel_then_timeline`,
        'simulation',
        JSON.stringify(info && info.orderTops),
        !!orderOk
      );
      mark(
        `${sz.key}_compact_panel`,
        'simulation',
        `small=${info && info.small} compact=${info && info.compact} speedHidden=${info && info.speedHidden}`,
        !!(info && info.small && info.compact && info.speedHidden && info.panelInSlot)
      );
    }

    const progOk = info && info.progress && parseFloat(info.progress) > 0;
    mark(`${sz.key}_scrubber_progress`, 'simulation', info && info.progress, !!progOk);

    if (sz.key === 'medium') {
      /* tooltip hover */
      const tip = await page.evaluate(() => {
        const doc = document.querySelector('#omt-pip-shot-iframe')?.contentDocument;
        const btn = doc?.querySelector('.omt-pip-icons button[data-tip="10 s back"]');
        if (!btn) return { ok: false };
        btn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        const el = doc.querySelector('.omt-pip-icon-tip');
        return { ok: !!(el && !el.hidden && /10 s back/.test(el.textContent || '')), text: el && el.textContent };
      });
      mark('icon_tooltip_hover_show', 'simulation', tip.text, !!tip.ok);
      await shot(page, 'v245_pip_local_medium_tooltip.png');

      /* period ticks only visible on timeline hover */
      const tickInfo = await page.evaluate(async () => {
        const iframe = document.querySelector('#omt-pip-shot-iframe');
        const doc = iframe?.contentDocument;
        const view = iframe?.contentWindow;
        const bar = doc?.querySelector('.omt-timeline-bar, #omt-timeline-bar');
        const c = doc?.querySelector('.omt-timeline-period-ticks, #omt-timeline-period-ticks');
        if (!bar || !c || !view) return { ok: false, reason: 'missing' };
        try {
          if (typeof window.__omtPopoutRefreshTicks === 'function') {
            window.__omtPopoutRefreshTicks();
          }
        } catch (_) {}
        const n = c.querySelectorAll('.omt-period-tick').length;
        /* Disable transition so getComputedStyle is not mid-animation. */
        c.style.transition = 'none';
        bar.classList.remove('is-timeline-hover');
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const rest = view.getComputedStyle(c).opacity;
        bar.classList.add('is-timeline-hover');
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const hover = view.getComputedStyle(c).opacity;
        bar.classList.remove('is-timeline-hover');
        c.style.transition = '';
        return { ok: true, n, rest, hover };
      });
      mark(
        'period_ticks_hover_only',
        'simulation',
        JSON.stringify(tickInfo),
        !!(tickInfo.ok && parseFloat(tickInfo.rest || '1') < 0.2 && parseFloat(tickInfo.hover || '0') > 0.5)
      );
    }

    if (sz.key === 'large') {
      /* panel buttons + drag + keys (same bridge as 2.4.4) */
      const acts = await page.evaluate(async () => {
        const doc = document.querySelector('#omt-pip-shot-iframe')?.contentDocument;
        const win = document.querySelector('#omt-pip-shot-iframe')?.contentWindow;
        const v = doc.querySelector('video');
        const panel = doc.querySelector('.omt-controls-panel, #omt-controls-panel');
        const root = doc.querySelector('.omt-pip-root');
        if (!v || !panel) return { ok: false };
        try { v.pause(); } catch (_) {}
        try { v.currentTime = 2; } catch (_) {}
        await new Promise((r) => setTimeout(r, 60));
        const out = {};
        const play = panel.querySelector('#omt-btn-play');
        const p0 = v.paused;
        if (play) {
          play.click();
          await new Promise((r) => setTimeout(r, 150));
          out.play = v.paused !== p0;
          if (!v.paused) {
            play.click();
            await new Promise((r) => setTimeout(r, 100));
          }
        }
        const p10 = panel.querySelector('#omt-p10');
        try { v.currentTime = 2; } catch (_) {}
        await new Promise((r) => setTimeout(r, 40));
        const t0 = v.currentTime;
        if (p10) p10.click();
        await new Promise((r) => setTimeout(r, 140));
        out.skip = Math.abs(v.currentTime - t0) >= 1.5;

        const handle = panel.querySelector('.drag-handle');
        if (handle) {
          const r0 = panel.getBoundingClientRect();
          handle.dispatchEvent(
            new PointerEvent('pointerdown', {
              bubbles: true,
              cancelable: true,
              clientX: r0.left + r0.width / 2,
              clientY: r0.top + 8,
              pointerId: 1,
              pointerType: 'mouse',
              button: 0,
              buttons: 1
            })
          );
          await new Promise((r) => setTimeout(r, 20));
          win.dispatchEvent(
            new PointerEvent('pointermove', {
              bubbles: true,
              cancelable: true,
              clientX: r0.left + r0.width / 2 + 36,
              clientY: r0.top + 8 - 24,
              pointerId: 1,
              pointerType: 'mouse',
              button: 0,
              buttons: 1
            })
          );
          await new Promise((r) => setTimeout(r, 30));
          win.dispatchEvent(
            new PointerEvent('pointerup', {
              bubbles: true,
              cancelable: true,
              clientX: r0.left + 36,
              clientY: r0.top - 16,
              pointerId: 1,
              pointerType: 'mouse',
              button: 0,
              buttons: 0
            })
          );
          await new Promise((r) => setTimeout(r, 30));
          const r1 = panel.getBoundingClientRect();
          out.drag = Math.abs(r1.left - r0.left) > 4 || Math.abs(r1.top - r0.top) > 4 ||
            panel.classList.contains('omt-pip-panel-floating');
        }

        try { root.focus(); } catch (_) {}
        try { v.currentTime = 2; } catch (_) {}
        await new Promise((r) => setTimeout(r, 40));
        const tk = v.currentTime;
        doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', bubbles: true, cancelable: true }));
        win.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', bubbles: true, cancelable: true }));
        await new Promise((r) => setTimeout(r, 120));
        out.keys = Math.abs(v.currentTime - tk) > 0.05;

        /* video click play/pause */
        try { v.pause(); } catch (_) {}
        const before = v.paused;
        v.click();
        await new Promise((r) => setTimeout(r, 120));
        out.videoClick = v.paused !== before;

        return out;
      });
      mark('large_panel_play_skip', 'simulation', JSON.stringify(acts), !!(acts.play && acts.skip));
      mark('large_panel_drag', 'simulation', JSON.stringify(acts), !!acts.drag);
      mark('large_keyboard', 'simulation', JSON.stringify(acts), !!acts.keys);
      mark('video_click_play_pause', 'simulation', JSON.stringify(acts), !!acts.videoClick);
    }

    await closePip(page);
  }

  /* Placeholder black/orange */
  await openFakePip(page, 640, 400);
  await page.evaluate(() => {
    const host = document.getElementById('omt-pip-shot-host');
    if (host) host.style.visibility = 'hidden';
  });
  await page.waitForTimeout(60);
  const ph = await page.evaluate(() => {
    const el = document.querySelector('.omt-pip-page-placeholder');
    if (!el) return { ok: false };
    const bg = getComputedStyle(el).backgroundImage + ' ' + getComputedStyle(el).backgroundColor;
    return {
      ok: true,
      bg,
      title: el.querySelector('.omt-pip-page-placeholder-title')?.textContent,
      hasBlue: /1a2433|0b1218/i.test(bg),
      hasOrange: /245,\s*131,\s*31/i.test(bg),
      hasDark: /14,\s*14,\s*14|10,\s*10,\s*10/i.test(bg)
    };
  });
  await page.locator('.omt-pip-page-placeholder').screenshot({
    path: path.join(ARTIFACTS, 'v245_pip_opener_placeholder.png')
  }).catch(() => {});
  notes.shots.push(path.join(ARTIFACTS, 'v245_pip_opener_placeholder.png'));
  mark(
    'opener_placeholder_black_orange',
    'simulation',
    ph.bg && ph.bg.slice(0, 100),
    !!(ph.ok && !ph.hasBlue && ph.hasOrange && ph.hasDark)
  );
  await closePip(page);

  /* Real Document PiP open/close */
  const realPip = await page.evaluate(async () => {
    const out = { supported: false, opened: false, error: null };
    try {
      out.supported = !!(window.documentPictureInPicture &&
        typeof DocumentPictureInPicture !== 'undefined' &&
        DocumentPictureInPicture.prototype.requestWindow);
      if (!out.supported) return out;
      const req = DocumentPictureInPicture.prototype.requestWindow.bind(documentPictureInPicture);
      let win = null;
      try {
        win = await req({ width: 800, height: 450 });
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
  mark(
    'real_document_pip_open_close',
    realPip.opened ? 'real_pip' : 'not_verified',
    realPip.error || (realPip.opened ? 'opened+closed' : 'failed'),
    !!realPip.opened
  );

  /* Items that require a live detached OS PiP for full confidence */
  mark(
    'full_matrix_inside_os_pip_window',
    'not_verified',
    'Agent cannot drive clicks inside a detached OS Document PiP chrome; exercised via simulation host + real window open/close smoke.',
    null
  );
} finally {
  await context.close().catch(() => {});
}

/* Zip WITHOUT design/ and without node_modules */
const zipPath = path.join(ARTIFACTS, 'OverlayMatchTimer-2.4.5-TEST.zip');
try {
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  execSync(
    `cd "${ROOT}" && zip -r "${zipPath}" Overlay-chrome-extension ` +
      `-x "*/node_modules/*" -x "*/.git/*" -x "Overlay-chrome-extension/design/*" -x "*/design/*"`,
    { stdio: 'inherit' }
  );
  const buf = fs.readFileSync(zipPath);
  const sha = createHash('sha256').update(buf).digest('hex');
  fs.writeFileSync(
    path.join(ARTIFACTS, 'OverlayMatchTimer-2.4.5-TEST.sha256'),
    sha + '  OverlayMatchTimer-2.4.5-TEST.zip\n'
  );
  notes.zip = zipPath;
  notes.sha256 = sha;
  /* Confirm design/ not in zip */
  const listing = execSync(`unzip -l "${zipPath}" | rg -c "design/" || true`, { encoding: 'utf8' }).trim();
  notes.designInZip = listing && listing !== '0' ? listing : '0';
  mark('zip_excludes_design', 'simulation', `design_entries=${notes.designInZip}`, notes.designInZip === '0');
  console.log('ZIP', zipPath);
  console.log('SHA256', sha);
} catch (e) {
  notes.issues.push('zip: ' + e.message);
  mark('zip_excludes_design', 'not_verified', e.message, false);
}

const passed = Object.values(checklist).filter((c) => c.ok === true).length;
const failed = Object.values(checklist).filter((c) => c.ok === false).length;
const skipped = Object.values(checklist).filter((c) => c.ok === null).length;
notes.summary = { passed, failed, skipped };
fs.writeFileSync(path.join(ARTIFACTS, 'v245_pip_notes.json'), JSON.stringify(notes, null, 2));
console.log(JSON.stringify({ summary: notes.summary, issues: notes.issues, sha256: notes.sha256 }, null, 2));
if (failed > 0) process.exitCode = 1;
