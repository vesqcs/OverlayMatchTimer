/**
 * v2.4.2 — Local PiP screenshots with a non-black sample (color bars).
 * small (~400) / large (~800), ± hover.
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

const userDataDir = fs.mkdtempSync(path.join('/tmp', 'omt-popout242-'));
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

const notes = { version: '2.4.2', sample: 'xeatre-color-bars.mp4', shots: [], issues: [] };

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
  await page.evaluate(async () => {
    const v = document.getElementById('omt-local-video');
    if (!v) return;
    await new Promise((r) => {
      if (v.readyState >= 2) return r();
      v.addEventListener('loadeddata', r, { once: true });
      setTimeout(r, 2000);
    });
    try { v.currentTime = 1.2; } catch (_) {}
    try { await v.play(); } catch (_) {}
    if (typeof iniciarTimer === 'function') iniciarTimer();
    const root = document.getElementById('omt-root');
    if (root) root.classList.add('omt-timer-on');
    const chip = document.getElementById('match-timer');
    if (chip) { chip.style.display = 'block'; chip.textContent = "12'"; }
  });
  await page.waitForTimeout(400);

  const sizes = [
    { key: 'small', width: 400, height: 260 },
    { key: 'large', width: 800, height: 450 }
  ];

  for (const sz of sizes) {
    await page.evaluate(() => {
      if (typeof iniciarTimer === 'function') iniciarTimer();
      const root = document.getElementById('omt-root');
      if (root) root.classList.add('omt-timer-on');
      const chip = document.getElementById('match-timer');
      if (chip) { chip.style.display = 'block'; chip.textContent = "12'"; }
    });

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
      await new Promise((r) => setTimeout(r, 800));
      const idoc = fakeWin.document;
      const v = idoc.querySelector('video');
      if (v) {
        try { v.currentTime = 1.5; } catch (_) {}
        try { await v.play(); } catch (_) {}
        await new Promise((r) => setTimeout(r, 300));
      }
      const transport = idoc.querySelector('.omt-pip-transport');
      const timeline = idoc.querySelector('.omt-timeline-bar, #omt-timeline-bar');
      const speed = idoc.querySelector('.omt-pip-speed, .omt-speed-chip, [data-omt-pip-act="speed"]');
      const skip2 = Array.from(idoc.querySelectorAll('.omt-pip-transport .omt-btn-label'))
        .some((el) => (el.textContent || '').trim() === '2s');
      return {
        hasVideo: !!v,
        vw: v ? v.videoWidth : 0,
        vh: v ? v.videoHeight : 0,
        paused: v ? v.paused : null,
        timer: !!(idoc.querySelector('.omt-pip-timer-host .omt-match-timer, .omt-pip-timer-host [id$="match-timer"]')),
        hasTimeline: !!timeline,
        hasTransport: !!transport,
        hasReturn: !!idoc.querySelector('.omt-pip-return'),
        hasSpeed: !!speed,
        has2s: skip2,
        narrow: !!idoc.querySelector('.omt-pip-root.omt-pip-narrow'),
        btnCount: transport ? transport.querySelectorAll('button').length : 0,
        chromeRowHidden: timeline
          ? getComputedStyle(timeline.querySelector('.omt-timeline-chrome-row') || document.createElement('div')).display === 'none'
          : null
      };
    }, sz);
    console.log(sz.key, info);
    notes[sz.key] = info;
    await page.waitForTimeout(400);

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
    await page.waitForTimeout(100);
    const p1 = path.join(ARTIFACTS, `v242_pip_local_${sz.key}_nohover.png`);
    await page.locator('#omt-pip-shot-frame').screenshot({ path: p1 });
    notes.shots.push(p1);

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
    await page.waitForTimeout(150);
    const p2 = path.join(ARTIFACTS, `v242_pip_local_${sz.key}_hover.png`);
    await page.locator('#omt-pip-shot-frame').screenshot({ path: p2 });
    notes.shots.push(p2);

    await page.evaluate(() => {
      if (typeof window.__omtPopoutClose === 'function') window.__omtPopoutClose();
      const host = document.getElementById('omt-pip-shot-host');
      if (host) host.remove();
    });
    await page.waitForTimeout(300);
  }
} finally {
  await context.close().catch(() => {});
}

fs.writeFileSync(path.join(ARTIFACTS, 'v242_pip_notes.json'), JSON.stringify(notes, null, 2));
console.log(JSON.stringify(notes, null, 2));
