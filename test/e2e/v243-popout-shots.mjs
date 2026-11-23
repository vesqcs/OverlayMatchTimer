/**
 * v2.4.3 — Local PiP screenshots: color bars, real kickoff clock, period ticks,
 * small icon row + large real panel, ± hover, icon-row crop.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const EXT = path.join(ROOT, 'Overlay-chrome-extension');
const SAMPLE = path.join(ROOT, 'test/fixtures/xeatre-color-bars.mp4');
const ARTIFACTS = '/opt/cursor/artifacts';
fs.mkdirSync(ARTIFACTS, { recursive: true });

const userDataDir = fs.mkdtempSync(path.join('/tmp', 'omt-popout243-'));
const context = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  args: [
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    '--disable-features=ExtensionDisableUnsupportedDeveloper',
    '--no-sandbox',
    '--disable-gpu'
  ],
  viewport: { width: 1280, height: 800 }
});

const notes = { version: '2.4.3', sample: 'xeatre-color-bars.mp4', shots: [], issues: [] };

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

  // Kickoff via UI (iniciarTimer is closed inside the content IIFE).
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
    // 1st half kickoff near start
    try { v.currentTime = 0.4; } catch (_) {}
    await new Promise((r) => setTimeout(r, 150));
    const half = document.getElementById('omt-half-select');
    if (half) half.value = '1';
    clearSync();
    await setKick();
    // 2nd half kickoff mid-clip → period ticks
    const t2 = Math.min((v.duration || 6) * 0.55, (v.duration || 6) - 0.25);
    try { v.currentTime = t2; } catch (_) {}
    await new Promise((r) => setTimeout(r, 150));
    if (half) {
      half.value = '2';
      half.dispatchEvent(new Event('change', { bubbles: true }));
    }
    clearSync();
    await setKick();
    // Play in 1st-half region so clock advances as MM:SS
    try { v.currentTime = 2.0; } catch (_) {}
    await new Promise((r) => setTimeout(r, 150));
    try { await v.play(); } catch (_) {}
  });
  await page.waitForTimeout(700);

  const clockText = await page.evaluate(() => {
    const el = document.getElementById('match-timer');
    return el ? (el.innerText || el.textContent || '') : '';
  });
  notes.pageClockBeforePip = clockText;
  console.log('pageClock', clockText);

  const sizes = [
    { key: 'small', width: 400, height: 260 },
    { key: 'large', width: 800, height: 450 }
  ];

  for (const sz of sizes) {
    const info = await page.evaluate(async ({ width, height }) => {
      if (typeof window.__omtPopoutClose === 'function') {
        try { window.__omtPopoutClose(); } catch (_) {}
      }
      let host = document.getElementById('omt-pip-shot-host');
      if (host) host.remove();
      host = document.createElement('div');
      host.id = 'omt-pip-shot-host';
      host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#1a1a1a;display:flex;align-items:center;justify-content:center;';
      const frame = document.createElement('div');
      frame.id = 'omt-pip-shot-frame';
      frame.style.cssText = `width:${width}px;height:${height}px;position:relative;overflow:hidden;box-shadow:0 8px 28px rgba(0,0,0,0.55);`;
      const iframe = document.createElement('iframe');
      iframe.id = 'omt-pip-shot-iframe';
      iframe.style.cssText = 'width:100%;height:100%;border:0;background:#0a0a0a;';
      frame.appendChild(iframe);
      host.appendChild(frame);
      document.body.appendChild(host);
      const fakeWin = iframe.contentWindow;
      fakeWin.document.open();
      fakeWin.document.write('<!doctype html><html><head></head><body style="margin:0;background:#0a0a0a"></body></html>');
      fakeWin.document.close();
      const fakePip = {
        document: fakeWin.document,
        innerWidth: width,
        innerHeight: height,
        addEventListener: (...a) => fakeWin.addEventListener(...a),
        removeEventListener: (...a) => fakeWin.removeEventListener(...a),
        focus() {},
        close() {
          const h = document.getElementById('omt-pip-shot-host');
          if (h) h.remove();
        }
      };
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
        await new Promise((r) => setTimeout(r, 450));
      }
      const timerHostEl = idoc.querySelector('.omt-pip-timer-host');
      const clock = timerHostEl && timerHostEl.querySelector('#match-timer, .omt-match-timer, [id$="match-timer"]');
      const clockTxt = clock ? (clock.innerText || clock.textContent || '').trim() : '';
      const hostKids = timerHostEl ? timerHostEl.children.length : 0;
      const iconRow = idoc.querySelector('.omt-pip-icon-row');
      const panelSlot = idoc.querySelector('.omt-pip-panel-slot');
      const panelInSlot = panelSlot && panelSlot.querySelector('.omt-controls-panel, #omt-controls-panel');
      const labels = Array.from(idoc.querySelectorAll('.omt-pip-icon-row .omt-btn-label'));
      const ticks = idoc.querySelectorAll('.omt-period-tick').length;
      return {
        hasVideo: !!v,
        hostKids,
        clock: clockTxt,
        clockLooksAbbreviated: /'\s*$/.test(clockTxt) && !/^\d{2}:\d{2}/.test(clockTxt),
        narrow: !!idoc.querySelector('.omt-pip-root.omt-pip-narrow'),
        iconRowDisplay: iconRow ? fakeWin.getComputedStyle(iconRow).display : null,
        panelInSlot: !!panelInSlot,
        hasTextLabels: labels.length > 0,
        btnCount: iconRow ? iconRow.querySelectorAll('button').length : 0,
        hasVideotime: !!(iconRow && iconRow.querySelector('.omt-pip-videotime')),
        videotime: iconRow && iconRow.querySelector('.omt-pip-videotime')
          ? iconRow.querySelector('.omt-pip-videotime').textContent
          : null,
        ticks,
        hasTimeline: !!idoc.querySelector('.omt-timeline-bar, #omt-timeline-bar'),
        hasReturn: !!idoc.querySelector('.omt-pip-return')
      };
    }, sz);
    console.log(sz.key, info);
    notes[sz.key] = info;
    await page.waitForTimeout(300);

    // no hover
    await page.evaluate(() => {
      const doc = document.querySelector('#omt-pip-shot-iframe')?.contentDocument;
      const root = doc?.querySelector('.omt-pip-root');
      const chrome = doc?.querySelector('.omt-pip-chrome');
      if (root) root.classList.remove('omt-pip-chrome-on');
      if (chrome) {
        chrome.style.opacity = '0';
        chrome.style.pointerEvents = 'none';
        chrome.style.transform = 'translateY(6px)';
      }
    });
    await page.waitForTimeout(80);
    const p1 = path.join(ARTIFACTS, `v243_pip_local_${sz.key}_nohover.png`);
    await page.locator('#omt-pip-shot-frame').screenshot({ path: p1 });
    notes.shots.push(p1);

    // hover
    await page.evaluate(() => {
      const doc = document.querySelector('#omt-pip-shot-iframe')?.contentDocument;
      const root = doc?.querySelector('.omt-pip-root');
      const chrome = doc?.querySelector('.omt-pip-chrome');
      if (root) root.classList.add('omt-pip-chrome-on');
      if (chrome) {
        chrome.style.opacity = '1';
        chrome.style.pointerEvents = 'auto';
        chrome.style.transform = 'none';
      }
    });
    await page.waitForTimeout(200);
    const p2 = path.join(ARTIFACTS, `v243_pip_local_${sz.key}_hover.png`);
    await page.locator('#omt-pip-shot-frame').screenshot({ path: p2 });
    notes.shots.push(p2);

    if (sz.key === 'small') {
      // Close-up of icon row
      const cropPath = path.join(ARTIFACTS, 'v243_pip_local_small_icons_crop.png');
      const box = await page.locator('#omt-pip-shot-iframe').evaluate((iframe) => {
        const row = iframe.contentDocument?.querySelector('.omt-pip-icon-row');
        if (!row) return null;
        const r = row.getBoundingClientRect();
        const fr = document.getElementById('omt-pip-shot-frame').getBoundingClientRect();
        return {
          x: fr.x + r.x - 8,
          y: fr.y + r.y - 8,
          width: Math.min(fr.width, r.width + 16),
          height: r.height + 16
        };
      });
      if (box && box.width > 0) {
        await page.screenshot({
          path: cropPath,
          clip: {
            x: Math.max(0, box.x),
            y: Math.max(0, box.y),
            width: Math.max(40, box.width),
            height: Math.max(24, box.height)
          }
        });
        notes.shots.push(cropPath);
      } else {
        notes.issues.push('icon-row crop failed');
      }
    }

    await page.evaluate(() => {
      if (typeof window.__omtPopoutClose === 'function') window.__omtPopoutClose();
      const host = document.getElementById('omt-pip-shot-host');
      if (host) host.remove();
    });
    await page.waitForTimeout(350);
  }
} finally {
  await context.close().catch(() => {});
}

fs.writeFileSync(path.join(ARTIFACTS, 'v243_pip_notes.json'), JSON.stringify(notes, null, 2));
console.log(JSON.stringify(notes, null, 2));
