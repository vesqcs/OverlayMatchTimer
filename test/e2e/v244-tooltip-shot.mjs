import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const EXT = path.join(ROOT, 'Overlay-chrome-extension');
const SAMPLE = path.join(ROOT, 'test/fixtures/xeatre-color-bars.mp4');
const ARTIFACTS = '/opt/cursor/artifacts';

const userDataDir = fs.mkdtempSync(path.join('/tmp', 'omt-tip244-'));
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
  let sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 8000 });
  const extId = (sw.url() || '').split('/')[2];
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extId}/player.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!document.getElementById('omt-root'));
  await page.setInputFiles('#omt-local-file-input', SAMPLE);
  await page.waitForTimeout(800);
  await page.evaluate(async () => {
    const host = document.createElement('div');
    host.id = 'omt-pip-shot-host';
    host.style.cssText =
      'position:fixed;inset:0;z-index:2147483647;background:#111;display:flex;align-items:center;justify-content:center;';
    const frame = document.createElement('div');
    frame.id = 'omt-pip-shot-frame';
    frame.style.cssText =
      'width:640px;height:400px;position:relative;overflow:visible;box-shadow:0 8px 28px rgba(0,0,0,0.55);';
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
    const fakePip = {
      document: fakeWin.document,
      innerWidth: 640,
      innerHeight: 400,
      addEventListener: (...a) => fakeWin.addEventListener(...a),
      removeEventListener: (...a) => fakeWin.removeEventListener(...a),
      focus() {},
      close() {
        host.remove();
      }
    };
    documentPictureInPicture.requestWindow = async () => fakePip;
    const btn = document.getElementById('omt-popout-btn');
    btn.hidden = false;
    btn.style.display = '';
    btn.click();
    await new Promise((r) => setTimeout(r, 900));
    const idoc = fakeWin.document;
    const root = idoc.querySelector('.omt-pip-root');
    const chrome = idoc.querySelector('.omt-pip-chrome');
    root.classList.add('omt-pip-chrome-on');
    chrome.style.opacity = '1';
    chrome.style.pointerEvents = 'auto';
    chrome.style.transform = 'none';
    const tipBtn = idoc.querySelector('.omt-pip-icons button[data-tip="Play / Pause"]');
    tipBtn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    let tip = idoc.querySelector('.omt-pip-icon-tip');
    if (!tip) {
      tip = idoc.createElement('div');
      tip.className = 'omt-pip-icon-tip';
      idoc.body.appendChild(tip);
    }
    tip.hidden = false;
    tip.textContent = 'Play / Pause';
    const br = tipBtn.getBoundingClientRect();
    tip.style.left = Math.round(br.left + br.width / 2 - 36) + 'px';
    tip.style.top = Math.round(Math.max(6, br.top - 28)) + 'px';
  });
  await page.waitForTimeout(120);
  await page.locator('#omt-pip-shot-frame').screenshot({
    path: path.join(ARTIFACTS, 'v244_pip_local_medium_tooltip.png')
  });
  const box = await page.locator('#omt-pip-shot-frame').boundingBox();
  if (box) {
    await page.screenshot({
      path: path.join(ARTIFACTS, 'v244_pip_local_medium_tooltip_crop.png'),
      clip: { x: box.x, y: box.y + box.height - 100, width: box.width, height: 100 }
    });
  }
  console.log('tooltip shots ok');
} finally {
  await context.close().catch(() => {});
}
