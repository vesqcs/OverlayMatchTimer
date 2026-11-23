/**
 * v2.4.1 — Local-player Document PiP UI screenshots:
 * small (~400) / large (~800), each with and without hover chrome.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const EXT = path.join(ROOT, 'Overlay-chrome-extension');
const FIXTURES = path.join(ROOT, 'test/fixtures');
const ARTIFACTS = '/opt/cursor/artifacts';
const SAMPLE = path.join(FIXTURES, 'sample-match.mp4');

async function waitForOmt(page, timeout = 20000) {
  await page.waitForFunction(() => !!document.getElementById('omt-root'), null, { timeout });
}

async function getExtId(context) {
  const workers = context.serviceWorkers();
  let sw = workers[0];
  if (!sw) {
    try { sw = await context.waitForEvent('serviceworker', { timeout: 8000 }); } catch (_) {}
  }
  if (!sw) return null;
  return (sw.url() || '').split('/')[2] || null;
}

async function run() {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const userDataDir = fs.mkdtempSync(path.join('/tmp', 'omt-popout241-'));
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

  const notes = { version: '2.4.1', shots: [], issues: [] };

  try {
    const extId = await getExtId(context);
    if (!extId) throw new Error('no extension id');
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extId}/player.html`, { waitUntil: 'domcontentloaded' });
    await waitForOmt(page);
    if (fs.existsSync(SAMPLE)) {
      await page.setInputFiles('#omt-local-file-input', SAMPLE);
      await page.waitForTimeout(800);
      await page.evaluate(() => {
        const v = document.getElementById('omt-local-video');
        if (v) { try { v.currentTime = 2; v.play().catch(() => {}); } catch (_) {} }
      });
      await page.waitForTimeout(400);
    }

    // Mock Document PiP → controllable popup sized per shot.
    await page.exposeFunction('__omtPipShotReady', () => {});
    const sizes = [
      { key: 'small', width: 400, height: 260 },
      { key: 'large', width: 800, height: 450 }
    ];

    for (const sz of sizes) {
      await page.evaluate(async ({ width, height }) => {
        if (typeof window.__omtPopoutClose === 'function') {
          try { window.__omtPopoutClose(); } catch (_) {}
        }
        const orig = documentPictureInPicture.requestWindow.bind(documentPictureInPicture);
        documentPictureInPicture.requestWindow = async () => {
          // Prefer real API when available; fall back to named popup for screenshots.
          try {
            return await orig({ width, height, disallowReturnToOpener: false });
          } catch (_) {
            const w = window.open('about:blank', 'omtPipShot', `popup=yes,width=${width},height=${height}`);
            if (!w) throw new Error('popup blocked');
            // Mimic Document PiP window surface.
            try {
              Object.defineProperty(w, 'documentPictureInPicture', { value: true });
            } catch (_) {}
            return w;
          }
        };
        const btn = document.getElementById('omt-popout-btn');
        if (!btn) throw new Error('no popout btn');
        btn.hidden = false;
        btn.style.display = '';
        btn.click();
        await new Promise((r) => setTimeout(r, 700));
      }, sz);

      // Find the PiP / popup page
      await page.waitForTimeout(500);
      const pipPage = context.pages().find((p) => {
        try {
          return p !== page && (p.url() === 'about:blank' || p.url().startsWith('about:blank'));
        } catch (_) { return false; }
      }) || context.pages().find((p) => p !== page);

      if (!pipPage) {
        notes.issues.push(`No PiP page for ${sz.key} — Document PiP may have opened off-page without a Playwright handle.`);
        // Fallback: render inline mock using same CSS builder in the opener.
        const shotBase = path.join(ARTIFACTS, `v241_pip_local_${sz.key}`);
        await page.evaluate(({ width, height }) => {
          let host = document.getElementById('omt-pip-shot-host');
          if (host) host.remove();
          host = document.createElement('div');
          host.id = 'omt-pip-shot-host';
          host.style.cssText = `position:fixed;inset:0;z-index:2147483647;background:#111;display:flex;align-items:center;justify-content:center;`;
          const frame = document.createElement('div');
          frame.style.cssText = `width:${width}px;height:${height}px;position:relative;overflow:hidden;box-shadow:0 0 0 1px #333;`;
          // Clone live PiP CSS + structure if present via reopen into iframe
          const iframe = document.createElement('iframe');
          iframe.style.cssText = 'width:100%;height:100%;border:0;background:#0a0a0a;';
          frame.appendChild(iframe);
          host.appendChild(frame);
          document.body.appendChild(host);
          const idoc = iframe.contentDocument;
          idoc.open();
          idoc.write('<!doctype html><html><head></head><body style="margin:0"></body></html>');
          idoc.close();
          // Pull CSS text by calling into content script scope is unavailable; rebuild minimal from DOM if omtPipState
        }, sz);
        notes.issues.push(`Used fallback note for ${sz.key}; see inline if any.`);
        continue;
      }

      // Ensure chrome hidden first
      await pipPage.evaluate(() => {
        const root = document.querySelector('.omt-pip-root');
        if (root) root.classList.remove('omt-pip-chrome-on');
      }).catch(() => {});
      await pipPage.setViewportSize({ width: sz.width, height: sz.height }).catch(() => {});
      await pipPage.waitForTimeout(200);
      const noHover = path.join(ARTIFACTS, `v241_pip_local_${sz.key}_nohover.png`);
      await pipPage.screenshot({ path: noHover });
      notes.shots.push(noHover);

      await pipPage.evaluate(() => {
        const root = document.querySelector('.omt-pip-root');
        if (root) root.classList.add('omt-pip-chrome-on');
      }).catch(() => {});
      await pipPage.waitForTimeout(150);
      const hover = path.join(ARTIFACTS, `v241_pip_local_${sz.key}_hover.png`);
      await pipPage.screenshot({ path: hover });
      notes.shots.push(hover);

      // Close for next size
      await page.evaluate(() => {
        if (typeof window.__omtPopoutClose === 'function') window.__omtPopoutClose();
      });
      await page.waitForTimeout(300);
    }

    // Dedicated rendered mock screenshots (guaranteed) using injected PiP CSS from the page.
    for (const sz of sizes) {
      const rendered = await page.evaluate(async ({ width, height }) => {
        // Close any live pip
        if (typeof window.__omtPopoutClose === 'function') {
          try { window.__omtPopoutClose(); } catch (_) {}
        }
        // Build a fixed-size mock using the same CSS string path by opening PiP into an iframe via fake window.
        const iframeWin = (() => {
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
          return iframe.contentWindow;
        })();

        const fakeWin = iframeWin;
        // Minimal Document-like surface
        const fakePip = {
          document: fakeWin.document,
          innerWidth: width,
          innerHeight: height,
          addEventListener: (...a) => fakeWin.addEventListener(...a),
          removeEventListener: (...a) => fakeWin.removeEventListener(...a),
          focus: () => {},
          close: () => {
            const host = document.getElementById('omt-pip-shot-host');
            if (host) host.remove();
          }
        };
        fakeWin.document.open();
        fakeWin.document.write('<!doctype html><html><head></head><body style="margin:0;background:#0a0a0a"></body></html>');
        fakeWin.document.close();

        documentPictureInPicture.requestWindow = async () => fakePip;
        const btn = document.getElementById('omt-popout-btn');
        btn.hidden = false;
        btn.style.display = '';
        btn.click();
        await new Promise((r) => setTimeout(r, 500));
        return {
          hasRoot: !!fakeWin.document.querySelector('.omt-pip-root'),
          narrow: !!fakeWin.document.querySelector('.omt-pip-root.omt-pip-narrow'),
          hasChrome: !!fakeWin.document.querySelector('.omt-pip-chrome'),
          hasReturn: !!fakeWin.document.querySelector('.omt-pip-return'),
          videoInPip: !!fakeWin.document.querySelector('video')
        };
      }, sz);

      notes[`render_${sz.key}`] = rendered;

      // Screenshot the frame element (no hover)
      const frame = page.locator('#omt-pip-shot-frame');
      await page.evaluate(() => {
        const root = document.querySelector('#omt-pip-shot-iframe')?.contentDocument?.querySelector('.omt-pip-root');
        if (root) root.classList.remove('omt-pip-chrome-on');
      });
      const p1 = path.join(ARTIFACTS, `v241_pip_local_${sz.key}_nohover.png`);
      await frame.screenshot({ path: p1 });
      notes.shots.push(p1);

      await page.evaluate(() => {
        const root = document.querySelector('#omt-pip-shot-iframe')?.contentDocument?.querySelector('.omt-pip-root');
        if (root) root.classList.add('omt-pip-chrome-on');
      });
      await page.waitForTimeout(100);
      const p2 = path.join(ARTIFACTS, `v241_pip_local_${sz.key}_hover.png`);
      await frame.screenshot({ path: p2 });
      notes.shots.push(p2);

      await page.evaluate(() => {
        if (typeof window.__omtPopoutClose === 'function') window.__omtPopoutClose();
        const host = document.getElementById('omt-pip-shot-host');
        if (host) host.remove();
      });
    }

    fs.writeFileSync(path.join(ARTIFACTS, 'v241_pip_notes.json'), JSON.stringify(notes, null, 2));
    console.log(JSON.stringify(notes, null, 2));
  } finally {
    await context.close().catch(() => {});
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
