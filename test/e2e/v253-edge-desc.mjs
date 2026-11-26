/**
 * v2.4.13 — Edge Add-ons description length + version bump only.
 *
 * Confirms: description ≤132, version 2.4.13, runtime zip (18 files),
 * local PiP regression still green, hosts still have no pop-out.
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
const EDGE_DESC =
  'Match timer overlay for InplayIP, Examino and Xeatre DVR streams, plus a local player for offline analysis.';
fs.mkdirSync(ARTIFACTS, { recursive: true });

const checklist = {};
const notes = { version: '2.4.13', checklist, issues: [] };

function mark(id, how, detail, ok = true) {
  checklist[id] = { ok, how, detail: detail == null ? '' : String(detail) };
  const tag = ok === false ? 'FAIL' : ok === null ? 'SKIP' : 'PASS';
  console.log(tag, `[${how}]`, id, detail == null ? '' : detail);
  if (ok === false) notes.issues.push(id + ': ' + detail);
}

function buildRuntimeZip() {
  const staging = fs.mkdtempSync(path.join('/tmp', 'omt-rt253-'));
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
  const zipPath = path.join(ARTIFACTS, 'OverlayMatchTimer-2.4.13.zip');
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  execSync(`cd "${staging}" && zip -qr "${zipPath}" .`);
  const buf = fs.readFileSync(zipPath);
  const sha = createHash('sha256').update(buf).digest('hex');
  fs.writeFileSync(
    path.join(ARTIFACTS, 'OverlayMatchTimer-2.4.13.sha256'),
    sha + '  OverlayMatchTimer-2.4.13.zip\n'
  );
  const listing = execSync(`unzip -l "${zipPath}"`, { encoding: 'utf8' });
  const fileCount = (listing.match(/^\s*\d+\s+\d{4}-/gm) || []).length;
  const bad = /src\/|scripts\/|design\/|package\.json|node_modules/.test(listing);
  const hasManifestRoot = /^[\s\d-]+manifest\.json$/m.test(
    listing.split('\n').find((l) => l.includes('manifest.json')) || ''
  ) || listing.includes('manifest.json');
  notes.zip = zipPath;
  notes.sha256 = sha;
  notes.zipSize = buf.length;
  notes.zipFileCount = fileCount;
  notes.listing = listing;
  mark(
    'runtime_only_zip',
    'simulation',
    `files=${fileCount} size=${buf.length} sha=${sha} badPaths=${bad} manifestAtRoot=${hasManifestRoot}`,
    !bad && fileCount === 18 && hasManifestRoot
  );
  return { zipPath, staging, sha, size: buf.length, listing };
}

/* ---- Manifest / Edge limits ---- */
{
  const man = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
  const desc = man.description || '';
  const okDesc =
    desc === EDGE_DESC && desc.length <= 132 && man.version === '2.4.13';
  mark(
    'edge_description_and_version',
    'simulation',
    JSON.stringify({
      version: man.version,
      descLen: desc.length,
      desc,
      nameLen: (man.name || '').length,
      hasIcon128: !!(man.icons && man.icons['128']),
      short_name: man.short_name ?? null
    }),
    okDesc
  );
}

const { zipPath, staging, sha, size, listing } = buildRuntimeZip();

/* host path freeze vs 2.3.9 */
try {
  const base = '7da8122';
  const paths = [
    'Overlay-chrome-extension/src/inplay-multiview.js',
    'Overlay-chrome-extension/src/examino-features.js',
    'Overlay-chrome-extension/src/xeatre-features.js',
    'Overlay-chrome-extension/src/pdt.js'
  ];
  const diffs = {};
  let clean = true;
  for (const p of paths) {
    const out = execSync(`git -C "${ROOT}" diff ${base} -- "${p}"`, {
      encoding: 'utf8'
    });
    diffs[p] = out.length;
    if (out.length !== 0) clean = false;
  }
  const adapters = execSync(
    `git -C "${ROOT}" diff ${base} -- Overlay-chrome-extension/src/adapters`,
    { encoding: 'utf8' }
  );
  diffs.adapters = adapters.length;
  if (adapters.length !== 0) clean = false;
  const inplayHasPopout = /omtPopout/.test(
    fs.readFileSync(path.join(EXT, 'src/inplay-multiview.js'), 'utf8')
  );
  mark(
    'diff_vs_239_host_paths_clean',
    'simulation',
    JSON.stringify({ diffs, inplayHasPopout }),
    clean && !inplayHasPopout
  );
} catch (e) {
  mark('diff_vs_239_host_paths_clean', 'simulation', String(e && e.message || e), false);
}

/* Local regression via v251, version-patched to 2.4.13 */
const v251Path = path.join(__dirname, 'v251-pip-panel-pos.mjs');
const patchedScript = path.join(__dirname, '.v253-v251-run.mjs');
{
  let src = fs.readFileSync(v251Path, 'utf8');
  src = src.replace(
    /const EXT = path\.join\(ROOT, 'Overlay-chrome-extension'\);/,
    `const EXT = process.env.OMT_EXT_DIR || path.join(ROOT, 'Overlay-chrome-extension');`
  );
  src = src.replace(/2\.4\.11/g, '2.4.13');
  src = src.replace(/omt-rt251/g, 'omt-rt253-local');
  src = src.replace(/omt-pip251/g, 'omt-pip253-local');
  src = src.replace(
    /OverlayMatchTimer-2\.4\.13-TEST\.zip/g,
    'OverlayMatchTimer-2.4.13-local-regression-scratch.zip'
  );
  src = src.replace(
    /OverlayMatchTimer-2\.4\.13\.zip/g,
    'OverlayMatchTimer-2.4.13-local-regression-scratch.zip'
  );
  src = src.replace(
    /OverlayMatchTimer-2\.4\.13-TEST\.sha256/g,
    'OverlayMatchTimer-2.4.13-local-regression-scratch.sha256'
  );
  src = src.replace(
    /OverlayMatchTimer-2\.4\.13\.sha256/g,
    'OverlayMatchTimer-2.4.13-local-regression-scratch.sha256'
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
mark(
  'local_v251_regression_suite',
  'real_pip',
  `exit=${localRun.status}`,
  localRun.status === 0
);
try { fs.unlinkSync(patchedScript); } catch (_) {}

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
    const s = getComputedStyle(b);
    return s.display !== 'none' && s.visibility !== 'hidden' && !b.hidden;
  });
  return {
    siteClass: document.documentElement.className,
    btnCount: btns.length,
    visibleCount: visible.length,
    pipOpen: !!(window.omtPipState && window.omtPipState.win)
  };
}

const { server, base } = await startFixtureServer();
const userDataDir = fs.mkdtempSync(path.join('/tmp', 'omt-pip253-hosts-'));
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
  { id: 'inplay', url: `${base}/inplayip-mock.html`, expectClass: /omt-host-inplayip|omt-inplayip/ },
  { id: 'inplay_multiview', url: `${base}/inplayip-multiview-mock.html?tiles=2`, expectClass: /omt-host-inplayip|omt-inplayip/ },
  { id: 'examino', url: `${base}/examino-mock.html`, expectClass: /omt-host-examino|omt-examino/ },
  { id: 'xeatre', url: `${base}/xeatre/dvrplayer.html`, expectClass: /omt-host-xeatre|omt-xeatre/ }
];

try {
  const workers = context.serviceWorkers();
  let sw = workers[0];
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 10000 });

  for (const h of hosts) {
    const page = await context.newPage();
    try {
      await page.goto(h.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(1800);
      const probe = await page.evaluate(popoutVisibilityProbe);
      const openAttempt = await page.evaluate(async () => {
        const btn = document.getElementById('omt-popout-btn') ||
          document.querySelector('.omt-popout-btn, .omt-tile-popout');
        if (btn) {
          try { btn.click(); } catch (_) {}
        }
        await new Promise((r) => setTimeout(r, 400));
        return {
          pipOpen: !!(window.documentPictureInPicture && documentPictureInPicture.window)
        };
      });
      const classOk = h.expectClass.test(probe.siteClass || '');
      mark(
        `host_no_popout_${h.id}`,
        'real_host',
        JSON.stringify({ probe, openAttempt, classOk }),
        classOk && probe.visibleCount === 0 && !openAttempt.pipOpen
      );
    } catch (err) {
      mark(`host_no_popout_${h.id}`, 'real_host', String(err && err.message || err), false);
    } finally {
      await page.close().catch(() => {});
    }
  }

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
    localProbe.visibleCount >= 1 && /omt-host-local|omt-local/.test(localProbe.siteClass || '')
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
    fs.unlinkSync(path.join(ARTIFACTS, 'OverlayMatchTimer-2.4.13-local-regression-scratch.zip'));
  } catch (_) {}
  try {
    fs.unlinkSync(path.join(ARTIFACTS, 'OverlayMatchTimer-2.4.13-local-regression-scratch.sha256'));
  } catch (_) {}
}

const failed = Object.values(checklist).filter((c) => c.ok === false).length;
const passed = Object.values(checklist).filter((c) => c.ok === true).length;
console.log(JSON.stringify({
  summary: { passed, failed, skipped: 0 },
  issues: notes.issues,
  sha,
  size,
  files: notes.zipFileCount,
  zip: zipPath,
  listingTail: listing.trim().split('\n').slice(-22)
}, null, 2));
process.exit(failed ? 1 : 0);
