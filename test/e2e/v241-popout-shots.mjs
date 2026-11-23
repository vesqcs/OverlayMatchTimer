import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const EXT = path.join(ROOT, 'Overlay-chrome-extension');
const SAMPLE = path.join(ROOT, 'test/fixtures/sample-match.mp4');
const ARTIFACTS = '/opt/cursor/artifacts';
fs.mkdirSync(ARTIFACTS, { recursive: true });

const userDataDir = fs.mkdtempSync(path.join('/tmp', 'omt-popout241c-'));
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
    try { v.currentTime = 2.2; } catch (_) {}
    try { await v.play(); } catch (_) {}
    if (typeof iniciarTimer === 'function') iniciarTimer();
    // Force timer-on if kickoff path is picky in automation
    const root = document.getElementById('omt-root');
    if (root) root.classList.add('omt-timer-on');
    const wrap = document.getElementById('match-timer-wrap');
    const chip = document.getElementById('match-timer');
    if (wrap) wrap.style.display = 'block';
    if (chip) chip.textContent = "12'";
  });
  await page.waitForTimeout(500);

  const sizes = [
    { key: 'small', width: 400, height: 260 },
    { key: 'large', width: 800, height: 450 }
  ];

  for (const sz of sizes) {
    await page.evaluate(() => {
      if (typeof iniciarTimer === 'function') iniciarTimer();
      const root = document.getElementById('omt-root');
      if (root) root.classList.add('omt-timer-on');
      const wrap = document.getElementById('match-timer-wrap');
      const chip = document.getElementById('match-timer');
      if (wrap) { wrap.style.display = 'flex'; }
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
      await new Promise((r) => setTimeout(r, 700));
      const v = fakeWin.document.querySelector('video');
      if (v) {
        try { v.currentTime = 2.5; } catch (_) {}
        try { await v.play(); } catch (_) {}
        await new Promise((r) => setTimeout(r, 250));
      }
      return {
        hasVideo: !!v,
        w: v ? v.videoWidth : 0,
        h: v ? v.videoHeight : 0,
        paused: v ? v.paused : null,
        t: v ? v.currentTime : null,
        timerText: (fakeWin.document.querySelector('.omt-pip-timer-host .omt-match-timer, .omt-pip-timer-host [id$="match-timer"]') || {}).textContent || null,
        narrow: !!fakeWin.document.querySelector('.omt-pip-root.omt-pip-narrow'),
        returnBtn: !!fakeWin.document.querySelector('.omt-pip-return'),
        btnsVisible: (() => {
          const b = fakeWin.document.querySelector('.omt-pip-btns');
          if (!b) return false;
          const cs = fakeWin.getComputedStyle(b);
          return cs.display !== 'none';
        })()
      };
    }, sz);
    console.log(sz.key, info);
    await page.waitForTimeout(400);

    // Force hide without relying on hover class (mousemove during shot re-shows chrome).
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
    await page.locator('#omt-pip-shot-frame').screenshot({
      path: path.join(ARTIFACTS, `v241_pip_local_${sz.key}_nohover.png`)
    });

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
    await page.waitForTimeout(120);
    await page.locator('#omt-pip-shot-frame').screenshot({
      path: path.join(ARTIFACTS, `v241_pip_local_${sz.key}_hover.png`)
    });

    await page.evaluate(() => {
      if (typeof window.__omtPopoutClose === 'function') window.__omtPopoutClose();
      const host = document.getElementById('omt-pip-shot-host');
      if (host) host.remove();
    });
    await page.waitForTimeout(250);
  }
} finally {
  await context.close().catch(() => {});
}
console.log('done');
