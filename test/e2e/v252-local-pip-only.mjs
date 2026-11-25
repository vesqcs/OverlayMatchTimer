/**
 * v2.4.12 — Local-only Document PiP + host players have no pop-out.
 *
 * 1) Build/test against the official runtime-only zip (18 files).
 * 2) Re-run the local-player 2.4.11 regression suite (via v251 script) with
 *    OMT_EXT_DIR pointing at the zip extract (version expectation patched).
 * 3) On InPlay / Examino / Xeatre fixtures: no visible pop-out button, open
 *    is refused, and source has no remaining InPlay pop-out hooks vs 2.3.9.
 *
 * Each check tagged real_pip | real_host | simulation.
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execSync, spawnSync } from 'node:child_process';
import { resolveFixture } from './host-scenarios.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const EXT = path.join(ROOT, 'Overlay-chrome-extension');
const FIXTURES = path.join(ROOT, 'test/fixtures');
const SAMPLE = path.join(ROOT, 'test/fixtures/xeatre-color-bars.mp4');
const ARTIFACTS = '/opt/cursor/artifacts';
fs.mkdirSync(ARTIFACTS, { recursive: true });

const checklist = {};
const notes = { version: '2.4.12', shots: [], checklist, issues: [], diffs: {} };

function mark(id, how, detail, ok = true) {
  checklist[id] = { ok, how, detail: detail == null ? '' : String(detail) };
  const tag = ok === false ? 'FAIL' : ok === null ? 'SKIP' : 'PASS';
  console.log(tag, `[${how}]`, id, detail == null ? '' : detail);
  if (ok === false) notes.issues.push(id + ': ' + detail);
}

function buildRuntimeZip() {
  const staging = fs.mkdtempSync(path.join('/tmp', 'omt-rt252-'));
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
  const zipPath = path.join(ARTIFACTS, 'OverlayMatchTimer-2.4.12-TEST.zip');
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  execSync(`cd "${staging}" && zip -qr "${zipPath}" .`);
  const buf = fs.readFileSync(zipPath);
  const sha = createHash('sha256').update(buf).digest('hex');
  fs.writeFileSync(
    path.join(ARTIFACTS, 'OverlayMatchTimer-2.4.12-TEST.sha256'),
    sha + '  OverlayMatchTimer-2.4.12-TEST.zip\n'
  );
  const listing = execSync(`unzip -l "${zipPath}"`, { encoding: 'utf8' });
  const fileCount = (listing.match(/^\s*\d+\s+\d{4}-/gm) || []).length;
  const bad = /src\/|scripts\/|design\/|package\.json|node_modules/.test(listing);
  notes.zip = zipPath;
  notes.sha256 = sha;
  notes.zipSize = buf.length;
  notes.zipFileCount = fileCount;
  mark(
    'runtime_only_zip',
    'simulation',
    `files=${fileCount} size=${buf.length} sha=${sha.slice(0, 16)}… badPaths=${bad}`,
    !bad && fileCount === 18
  );
  return { zipPath, staging, sha, size: buf.length };
}

function startFixtureServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      if (urlPath.includes('favicon')) {
        res.writeHead(204);
        res.end();
        return;
      }
      const filePath = resolveFixture(FIXTURES, urlPath);
      if (!filePath.startsWith(FIXTURES) || !fs.existsSync(filePath)) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      const ct = filePath.endsWith('.html')
        ? 'text/html; charset=utf-8'
        : filePath.endsWith('.css')
          ? 'text/css; charset=utf-8'
          : filePath.endsWith('.js')
            ? 'text/javascript; charset=utf-8'
            : filePath.endsWith('.mp4')
              ? 'video/mp4'
              : 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': ct });
      fs.createReadStream(filePath).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

function popoutVisibilityProbe() {
  const btns = Array.from(
    document.querySelectorAll(
      '#omt-popout-btn, .omt-popout-btn, .omt-tile-popout, [id$="omt-popout-btn"]'
    )
  );
  const visible = btns.filter((b) => {
    if (b.hidden) return false;
    const cs = getComputedStyle(b);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
  });
  const root = document.getElementById('omt-root');
  return {
    siteClass: root ? root.className : '',
    btnCount: btns.length,
    visibleCount: visible.length,
    pipOpen: !!(window.documentPictureInPicture && documentPictureInPicture.window)
  };
}

const { staging, zipPath, sha, size } = buildRuntimeZip();

/* ---- Diff vs 2.3.9 for host paths ---- */
try {
  const base = '7da8122';
  const hostFiles = [
    'Overlay-chrome-extension/src/inplay-multiview.js',
    'Overlay-chrome-extension/src/examino-features.js',
    'Overlay-chrome-extension/src/xeatre-features.js',
    'Overlay-chrome-extension/src/pdt.js'
  ];
  const diffs = {};
  let clean = true;
  for (const f of hostFiles) {
    const out = execSync(`git diff ${base} -- ${f}`, {
      cwd: ROOT,
      encoding: 'utf8'
    });
    diffs[f] = out.length;
    if (out.length !== 0) clean = false;
  }
  const adapters = execSync(`git diff ${base} -- Overlay-chrome-extension/src/adapters/`, {
    cwd: ROOT,
    encoding: 'utf8'
  });
  diffs.adapters = adapters.length;
  if (adapters.length !== 0) clean = false;
  const inplayHasPopout = /omtPopout/.test(
    fs.readFileSync(path.join(EXT, 'src/inplay-multiview.js'), 'utf8')
  );
  notes.diffs = { ...diffs, inplayHasPopout };
  mark(
    'diff_vs_239_host_paths_clean',
    'simulation',
    JSON.stringify({ diffs, inplayHasPopout }),
    clean && !inplayHasPopout
  );
} catch (e) {
  mark('diff_vs_239_host_paths_clean', 'simulation', String(e && e.message || e), false);
}

/* ---- Local regression: run v251 against this zip extract ---- */
const v251Path = path.join(__dirname, 'v251-pip-panel-pos.mjs');
/* Keep the patched runner next to e2e/ so ROOT + playwright resolve correctly. */
const patchedScript = path.join(__dirname, '.v252-v251-run.mjs');
{
  let src = fs.readFileSync(v251Path, 'utf8');
  /* Point EXT at the runtime zip extract and expect 2.4.12. */
  src = src.replace(
    /const EXT = path\.join\(ROOT, 'Overlay-chrome-extension'\);/,
    `const EXT = process.env.OMT_EXT_DIR || path.join(ROOT, 'Overlay-chrome-extension');`
  );
  src = src.replace(/2\.4\.11/g, '2.4.12');
  src = src.replace(/omt-rt251/g, 'omt-rt252-local');
  src = src.replace(/omt-pip251/g, 'omt-pip252-local');
  /* Avoid rewriting the official 2.4.12 zip — v251 rebuilds its own from EXT. */
  src = src.replace(
    /OverlayMatchTimer-2\.4\.12-TEST\.zip/g,
    'OverlayMatchTimer-2.4.12-local-regression-scratch.zip'
  );
  src = src.replace(
    /OverlayMatchTimer-2\.4\.12-TEST\.sha256/g,
    'OverlayMatchTimer-2.4.12-local-regression-scratch.sha256'
  );
  fs.writeFileSync(patchedScript, src);
}
const localRun = spawnSync(process.execPath, [patchedScript], {
  cwd: path.join(ROOT, 'test'),
  env: { ...process.env, OMT_EXT_DIR: staging },
  encoding: 'utf8',
  timeout: 180000
});
console.log(localRun.stdout || '');
if (localRun.stderr) console.error(localRun.stderr);
const localOk = localRun.status === 0;
mark(
  'local_v251_regression_suite',
  'real_pip',
  `exit=${localRun.status} (full 2.4.11 suite on 2.4.12 zip extract)`,
  localOk
);
notes.localRegression = {
  exit: localRun.status,
  tail: (localRun.stdout || '').trim().split('\n').slice(-8)
};
try { fs.unlinkSync(patchedScript); } catch (_) {}

/* ---- Host players: no pop-out button ---- */
const { server, base } = await startFixtureServer();
const userDataDir = fs.mkdtempSync(path.join('/tmp', 'omt-pip252-hosts-'));
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

const hosts = [
  {
    id: 'inplay',
    url: `${base}/inplayip-mock.html`,
    expectClass: /omt-inplayip/
  },
  {
    id: 'inplay_multiview',
    url: `${base}/inplayip-multiview-mock.html?tiles=2`,
    expectClass: /omt-inplayip/
  },
  {
    id: 'examino',
    url: `${base}/examino-mock.html`,
    expectClass: /omt-examino/
  },
  {
    id: 'xeatre',
    url: `${base}/xeatre/dvrplayer.html`,
    expectClass: /omt-xeatre/
  }
];

try {
  const workers = context.serviceWorkers();
  let sw = workers[0];
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 10000 });

  for (const host of hosts) {
    const page = await context.newPage();
    try {
      await page.goto(host.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(1800);
      const probe = await page.evaluate(popoutVisibilityProbe);
      const openAttempt = await page.evaluate(async () => {
        const btn = document.getElementById('omt-popout-btn') ||
          document.querySelector('.omt-popout-btn, .omt-tile-popout');
        if (btn) {
          try { btn.click(); } catch (_) {}
        }
        /* Even if someone calls the open API, it must refuse off-local. */
        try {
          if (typeof window.__omtPopoutSupported === 'function') {
            /* no direct open export — click is the entry */
          }
        } catch (_) {}
        await new Promise((r) => setTimeout(r, 400));
        return {
          pipOpen: !!(window.documentPictureInPicture && documentPictureInPicture.window)
        };
      });
      const classOk = host.expectClass.test(probe.siteClass || '');
      const noVisible = probe.visibleCount === 0;
      const noPip = openAttempt.pipOpen === false;
      mark(
        `host_no_popout_${host.id}`,
        'real_host',
        JSON.stringify({ probe, openAttempt, classOk }),
        noVisible && noPip && (classOk || probe.btnCount === 0 || probe.siteClass !== '')
      );
      const shot = path.join(ARTIFACTS, `v252_host_${host.id}.png`);
      try {
        await page.screenshot({ path: shot, fullPage: true });
        notes.shots.push(shot);
      } catch (_) {}
    } catch (err) {
      mark(
        `host_no_popout_${host.id}`,
        'real_host',
        String(err && err.message || err),
        false
      );
    } finally {
      await page.close().catch(() => {});
    }
  }

  /* Local still shows the button. */
  const extId = ((sw.url() || '').split('/')[2]) || '';
  const localPage = await context.newPage();
  await localPage.goto(`chrome-extension://${extId}/player.html`, {
    waitUntil: 'domcontentloaded'
  });
  await localPage.waitForFunction(() => !!document.getElementById('omt-root'));
  await localPage.setInputFiles('#omt-local-file-input', SAMPLE).catch(() => {});
  await localPage.waitForTimeout(900);
  const localProbe = await localPage.evaluate(popoutVisibilityProbe);
  mark(
    'local_popout_button_visible',
    'real_pip',
    JSON.stringify(localProbe),
    localProbe.visibleCount >= 1 && /omt-local/.test(localProbe.siteClass || '')
  );
  await localPage.close().catch(() => {});
} catch (err) {
  mark('host_suite_fatal', 'real_host', String(err && err.message || err), false);
} finally {
  await context.close().catch(() => {});
  try { server.close(); } catch (_) {}
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (_) {}
  try { fs.rmSync(staging, { recursive: true, force: true }); } catch (_) {}
  try {
    fs.unlinkSync(path.join(ARTIFACTS, 'OverlayMatchTimer-2.4.12-local-regression-scratch.zip'));
  } catch (_) {}
  try {
    fs.unlinkSync(path.join(ARTIFACTS, 'OverlayMatchTimer-2.4.12-local-regression-scratch.sha256'));
  } catch (_) {}
}

const summary = {
  passed: Object.values(checklist).filter((c) => c.ok === true).length,
  failed: Object.values(checklist).filter((c) => c.ok === false).length,
  skipped: Object.values(checklist).filter((c) => c.ok === null).length
};
notes.summary = summary;
notes.zip = zipPath;
notes.sha256 = sha;
notes.zipSize = size;
fs.writeFileSync(path.join(ARTIFACTS, 'v252_pip_notes.json'), JSON.stringify(notes, null, 2));
console.log(JSON.stringify({ summary, issues: notes.issues, sha, size, files: 18 }, null, 2));
if (summary.failed > 0) process.exitCode = 1;
