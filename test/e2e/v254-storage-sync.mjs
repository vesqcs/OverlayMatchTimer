/**
 * v2.4.14 — chrome.storage.sync prefs + local fallback + migration.
 *
 * Tests against the official runtime zip (prefs-storage.js at root).
 * Tags: real_ext | simulation
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
const ARTIFACTS = '/opt/cursor/artifacts';
fs.mkdirSync(ARTIFACTS, { recursive: true });

const checklist = {};
const notes = { version: '2.4.14', issues: [], checklist };

function mark(id, how, detail, ok = true) {
  checklist[id] = { ok, how, detail: detail == null ? '' : String(detail) };
  console.log(ok === false ? 'FAIL' : 'PASS', `[${how}]`, id, detail == null ? '' : detail);
  if (ok === false) notes.issues.push(id + ': ' + detail);
}

function buildRuntimeZip() {
  const staging = fs.mkdtempSync(path.join('/tmp', 'omt-rt254-'));
  const files = [
    'manifest.json', 'player.html', 'player.css', 'sync-feature-flag.js',
    'prefs-storage.js',
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
  const zipPath = path.join(ARTIFACTS, 'OverlayMatchTimer-2.4.14.zip');
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  execSync(`cd "${staging}" && zip -qr "${zipPath}" .`);
  const buf = fs.readFileSync(zipPath);
  const sha = createHash('sha256').update(buf).digest('hex');
  fs.writeFileSync(path.join(ARTIFACTS, 'OverlayMatchTimer-2.4.14.sha256'), sha + '  OverlayMatchTimer-2.4.14.zip\n');
  const listing = execSync(`unzip -l "${zipPath}"`, { encoding: 'utf8' });
  const fileCount = (listing.match(/^\s*\d+\s+\d{4}-/gm) || []).length;
  const bad = /src\/|scripts\/|design\/|package\.json|node_modules/.test(listing);
  const hasPrefs = listing.includes('prefs-storage.js');
  const hasManifest = listing.includes('manifest.json');
  notes.zip = zipPath;
  notes.sha256 = sha;
  notes.zipSize = buf.length;
  notes.zipFileCount = fileCount;
  notes.listing = listing;
  mark(
    'runtime_only_zip',
    'simulation',
    `files=${fileCount} size=${buf.length} sha=${sha} bad=${bad} prefs=${hasPrefs} manifestRoot=${hasManifest}`,
    !bad && hasPrefs && hasManifest && fileCount === 19
  );
  return { zipPath, staging, sha, size: buf.length, listing };
}

/* Static audit */
{
  const man = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
  const descOk = (man.description || '').length <= 132 && man.version === '2.4.14';
  const hasStorage = (man.permissions || []).includes('storage');
  const isoJs = (man.content_scripts || []).flatMap((c) => c.js || []);
  const prefsInManifest = isoJs.includes('prefs-storage.js');
  mark(
    'manifest_version_desc_storage',
    'simulation',
    JSON.stringify({
      version: man.version,
      descLen: (man.description || '').length,
      hasStorage,
      prefsInManifest,
      permissions: man.permissions
    }),
    descOk && hasStorage && prefsInManifest
  );

  const prefsSrc = fs.readFileSync(path.join(EXT, 'prefs-storage.js'), 'utf8');
  const bridgeSrc = fs.readFileSync(path.join(EXT, 'bridge.js'), 'utf8');
  const popupSrc = fs.readFileSync(path.join(EXT, 'popup.js'), 'utf8');
  mark(
    'code_uses_omt_prefs',
    'simulation',
    JSON.stringify({
      prefsHasSync: /chrome\.storage\.sync/.test(prefsSrc),
      prefsDebounce: /DEBOUNCE_MS/.test(prefsSrc),
      prefsMigrate: /migrateLocalToSyncIfNeeded|omtPrefsSyncMigrated_v1/.test(prefsSrc),
      bridgeUsesPrefs: /OMT_PREFS/.test(bridgeSrc),
      popupUsesPrefs: /prefsSet\(|prefsGet\(/.test(popupSrc),
      popupDirectLocalSetCount: (popupSrc.match(/chrome\.storage\.local\.set/g) || []).length
    }),
    /chrome\.storage\.sync/.test(prefsSrc) &&
      /OMT_PREFS/.test(bridgeSrc) &&
      /prefsSet\(/.test(popupSrc) &&
      (popupSrc.match(/chrome\.storage\.local\.set/g) || []).length <= 1 // helper fallback only
  );

  // Host paths unchanged vs 2.4.13 tip parent for seek/adapters — vs 7da8122 still clean for those modules
  try {
    const base = '7da8122';
    const paths = [
      'Overlay-chrome-extension/src/inplay-multiview.js',
      'Overlay-chrome-extension/src/examino-features.js',
      'Overlay-chrome-extension/src/xeatre-features.js',
      'Overlay-chrome-extension/src/pdt.js'
    ];
    let clean = true;
    const diffs = {};
    for (const p of paths) {
      const out = execSync(`git -C "${ROOT}" diff ${base} -- "${p}"`, { encoding: 'utf8' });
      diffs[p] = out.length;
      if (out.length) clean = false;
    }
    mark('host_paths_frozen_vs_239', 'simulation', JSON.stringify(diffs), clean);
  } catch (e) {
    mark('host_paths_frozen_vs_239', 'simulation', String(e && e.message || e), false);
  }
}

const { zipPath, staging, sha, size, listing } = buildRuntimeZip();

const userDataDir = fs.mkdtempSync(path.join('/tmp', 'omt-prefs254-'));
const context = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  args: [
    `--disable-extensions-except=${staging}`,
    `--load-extension=${staging}`,
    '--disable-features=ExtensionDisableUnsupportedDeveloper',
    '--no-sandbox'
  ],
  viewport: { width: 900, height: 700 }
});

async function getExtId() {
  const workers = context.serviceWorkers();
  let sw = workers[0];
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15000 });
  return (sw.url() || '').split('/')[2];
}

const extId = await getExtId();

async function evalExt(fn, arg) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extId}/popup.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  const result = await page.evaluate(fn, arg);
  await page.close();
  return result;
}

/* --- Migration: seed local-only, clear sync, reload prefs --- */
{
  const seeded = await evalExt(async () => {
    await new Promise((r) => chrome.storage.sync.clear(r));
    await new Promise((r) => chrome.storage.local.clear(r));
    await new Promise((r) =>
      chrome.storage.local.set({
        omtClockPosition: 'bottom-right',
        omtPanelCompact: true,
        omtHotkeys: { playPause: { key: 'p' } },
        omtKeepPlayingOnAltTab: true
      }, r)
    );
    // Clear migrate flag so migration runs
    await new Promise((r) => chrome.storage.local.remove('omtPrefsSyncMigrated_v1', r));
    return true;
  });

  const after = await evalExt(async () => {
    // Load prefs module path already on popup
    const prefs = globalThis.OMT_PREFS;
    const result = await new Promise((resolve) => {
      prefs.get({
        omtClockPosition: 'top-left',
        omtPanelCompact: false,
        omtKeepPlayingOnAltTab: false
      }, resolve);
    });
    // flush debounced sync
    prefs._flushSyncForTests();
    await new Promise((r) => setTimeout(r, 600));
    const syncAll = await new Promise((resolve) => chrome.storage.sync.get(null, resolve));
    const localAll = await new Promise((resolve) => chrome.storage.local.get(null, resolve));
    return {
      result,
      syncClock: syncAll.omtClockPosition,
      syncCompact: syncAll.omtPanelCompact,
      syncKeep: syncAll.omtKeepPlayingOnAltTab,
      localStillHas: localAll.omtClockPosition,
      migrated: !!localAll.omtPrefsSyncMigrated_v1
    };
  });

  mark(
    'migration_local_to_sync',
    'real_ext',
    JSON.stringify(after),
    seeded &&
      after.result.omtClockPosition === 'bottom-right' &&
      after.syncClock === 'bottom-right' &&
      after.syncCompact === true &&
      after.localStillHas === 'bottom-right' &&
      after.migrated === true
  );
}

/* --- Sync write path + local mirror --- */
{
  const wrote = await evalExt(async () => {
    const prefs = globalThis.OMT_PREFS;
    await new Promise((r) => prefs.set({ omtClockSize: 'large', omtClockShape: 'square' }, r));
    prefs._flushSyncForTests();
    await new Promise((r) => setTimeout(r, 500));
    const syncAll = await new Promise((resolve) => chrome.storage.sync.get(null, resolve));
    const localAll = await new Promise((resolve) => chrome.storage.local.get(null, resolve));
    return {
      syncSize: syncAll.omtClockSize,
      syncShape: syncAll.omtClockShape,
      localSize: localAll.omtClockSize,
      localShape: localAll.omtClockShape
    };
  });
  mark(
    'sync_write_and_local_mirror',
    'real_ext',
    JSON.stringify(wrote),
    wrote.syncSize === 'large' &&
      wrote.localSize === 'large' &&
      wrote.syncShape === 'square' &&
      wrote.localShape === 'square'
  );
}

/* --- Fallback when sync is disabled --- */
{
  const fallback = await evalExt(async () => {
    const prefs = globalThis.OMT_PREFS;
    prefs._setSyncUsableForTests(false);
    await new Promise((r) => prefs.set({ omtPanelSize: 'small' }, r));
    prefs._flushSyncForTests();
    await new Promise((r) => setTimeout(r, 300));
    const localAll = await new Promise((resolve) => chrome.storage.local.get(null, resolve));
    // Re-enable and confirm get still returns local value
    prefs._setSyncUsableForTests(true);
    const result = await new Promise((resolve) => {
      prefs.get({ omtPanelSize: 'medium' }, resolve);
    });
    return {
      localPanel: localAll.omtPanelSize,
      getPanel: result.omtPanelSize
    };
  });
  mark(
    'local_fallback_when_sync_off',
    'real_ext',
    JSON.stringify(fallback),
    fallback.localPanel === 'small' && fallback.getPanel === 'small'
  );
}

/* --- onChanged from sync applies to local --- */
{
  const remote = await evalExt(async () => {
    // Simulate remote device writing sync
    await new Promise((r) =>
      chrome.storage.sync.set({ omtClockPosition: 'top-right' }, r)
    );
    await new Promise((r) => setTimeout(r, 400));
    const localAll = await new Promise((resolve) => chrome.storage.local.get(null, resolve));
    return { localPos: localAll.omtClockPosition };
  });
  mark(
    'sync_onChanged_mirrors_local',
    'real_ext',
    JSON.stringify(remote),
    remote.localPos === 'top-right'
  );
}

/* --- Persist across popup reload (local+sync) --- */
{
  await evalExt(async () => {
    const prefs = globalThis.OMT_PREFS;
    await new Promise((r) =>
      prefs.set({
        omtClockPosition: 'bottom-left',
        omtKeepPlayingOnAltTab: false
      }, r)
    );
    prefs._flushSyncForTests();
    await new Promise((r) => setTimeout(r, 500));
    return true;
  });
  const reloaded = await evalExt(async () => {
    const prefs = globalThis.OMT_PREFS;
    const result = await new Promise((resolve) => {
      prefs.get({
        omtClockPosition: 'top-left',
        omtKeepPlayingOnAltTab: true
      }, resolve);
    });
    return result;
  });
  mark(
    'prefs_persist_across_reload',
    'real_ext',
    JSON.stringify(reloaded),
    reloaded.omtClockPosition === 'bottom-left' &&
      reloaded.omtKeepPlayingOnAltTab === false
  );
}

/* --- Shuttle connected is per-instance; opening B/C must not steal A's device --- */
const SAMPLE = path.join(ROOT, 'test/fixtures/xeatre-color-bars.mp4');
{
  // Patch HID before any player page runs: count getDevices/requestDevice/open.
  await context.addInitScript(() => {
    window.__omtHidLog = [];
    const install = () => {
      if (!navigator.hid || navigator.hid.__omtPatched) return;
      navigator.hid.__omtPatched = true;
      const gd = navigator.hid.getDevices.bind(navigator.hid);
      navigator.hid.getDevices = async (...args) => {
        window.__omtHidLog.push('getDevices');
        const list = await gd(...args);
        for (const d of list || []) {
          if (d && !d.__omtOpenPatched && typeof d.open === 'function') {
            d.__omtOpenPatched = true;
            const op = d.open.bind(d);
            d.open = async (...a) => {
              window.__omtHidLog.push('open');
              return op(...a);
            };
          }
        }
        return list;
      };
      if (typeof navigator.hid.requestDevice === 'function') {
        const rd = navigator.hid.requestDevice.bind(navigator.hid);
        navigator.hid.requestDevice = async (...args) => {
          window.__omtHidLog.push('requestDevice');
          return rd(...args);
        };
      }
    };
    install();
  });

  const pageA = await context.newPage();
  const pageB = await context.newPage();
  const pageC = await context.newPage();
  const playerUrl = `chrome-extension://${extId}/player.html`;

  async function bootPlayer(page) {
    await page.goto(playerUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!document.getElementById('omt-root'), null, {
      timeout: 15000
    });
    await page.setInputFiles('#omt-local-file-input', SAMPLE).catch(() => {});
    await page.waitForTimeout(700);
  }

  await bootPlayer(pageA);
  // Mark A connected without WebHID (no open/close of a real device).
  const aConn = await pageA.evaluate(() => {
    const r = window.__omtTestMarkShuttleConnected && window.__omtTestMarkShuttleConnected(true);
    const toggle = document.getElementById('omt-shuttle-enable-toggle');
    return {
      connected: !!(window.__omtIsShuttleConnected && window.__omtIsShuttleConnected()),
      markResult: r,
      toggleOn: !!(toggle && toggle.checked),
      hidLog: (window.__omtHidLog || []).slice()
    };
  });

  await bootPlayer(pageB);
  await bootPlayer(pageC);

  const bState = await pageB.evaluate(() => {
    const toggle = document.getElementById('omt-shuttle-enable-toggle');
    return {
      connected: !!(window.__omtIsShuttleConnected && window.__omtIsShuttleConnected()),
      toggleOn: !!(toggle && toggle.checked),
      hidLog: (window.__omtHidLog || []).slice()
    };
  });
  const cState = await pageC.evaluate(() => {
    const toggle = document.getElementById('omt-shuttle-enable-toggle');
    return {
      connected: !!(window.__omtIsShuttleConnected && window.__omtIsShuttleConnected()),
      toggleOn: !!(toggle && toggle.checked),
      hidLog: (window.__omtHidLog || []).slice()
    };
  });
  const aAfter = await pageA.evaluate(() => {
    const toggle = document.getElementById('omt-shuttle-enable-toggle');
    return {
      connected: !!(window.__omtIsShuttleConnected && window.__omtIsShuttleConnected()),
      toggleOn: !!(toggle && toggle.checked),
      fakeClosed: !!window.__omtTestShuttleClosed,
      hidLog: (window.__omtHidLog || []).slice()
    };
  });

  // Seed legacy shared flag; B must still stay disconnected and not HID-open.
  await pageB.evaluate(() => {
    try { localStorage.setItem('shuttleXpressEnabled', 'true'); } catch (_) {}
  });
  await pageB.reload({ waitUntil: 'domcontentloaded' });
  await pageB.waitForFunction(() => !!document.getElementById('omt-root'), null, { timeout: 15000 });
  await pageB.waitForTimeout(700);
  const bAfterLegacy = await pageB.evaluate(() => {
    const toggle = document.getElementById('omt-shuttle-enable-toggle');
    return {
      connected: !!(window.__omtIsShuttleConnected && window.__omtIsShuttleConnected()),
      toggleOn: !!(toggle && toggle.checked),
      lsFlag: localStorage.getItem('shuttleXpressEnabled'),
      hidLog: (window.__omtHidLog || []).slice()
    };
  });
  const aStill = await pageA.evaluate(() => ({
    connected: !!(window.__omtIsShuttleConnected && window.__omtIsShuttleConnected()),
    fakeClosed: !!window.__omtTestShuttleClosed
  }));

  const noSteal =
    aConn.connected &&
    aConn.toggleOn &&
    !bState.connected &&
    !bState.toggleOn &&
    !cState.connected &&
    !cState.toggleOn &&
    aAfter.connected &&
    aAfter.toggleOn &&
    !aAfter.fakeClosed &&
    !bState.hidLog.includes('getDevices') &&
    !bState.hidLog.includes('open') &&
    !bState.hidLog.includes('requestDevice') &&
    !cState.hidLog.includes('getDevices') &&
    !cState.hidLog.includes('open') &&
    !bAfterLegacy.connected &&
    !bAfterLegacy.toggleOn &&
    !bAfterLegacy.hidLog.includes('open') &&
    aStill.connected &&
    !aStill.fakeClosed;

  mark(
    'shuttle_per_instance_no_steal',
    'real_ext',
    JSON.stringify({ aConn, bState, cState, aAfter, bAfterLegacy, aStill }),
    noSteal
  );

  await pageA.close().catch(() => {});
  await pageB.close().catch(() => {});
  await pageC.close().catch(() => {});
}

/* --- Alt+Tab pause: legacy shuttle flag must NOT skip pause (Xeatre/all sites) --- */
{
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extId}/player.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!document.getElementById('omt-root'), null, { timeout: 15000 });
  await page.setInputFiles('#omt-local-file-input', SAMPLE).catch(() => {});
  await page.waitForTimeout(800);

  const pauseCheck = await page.evaluate(async () => {
    const v = document.querySelector('video');
    if (!v) return { ok: false, reason: 'no-video' };
    try { await v.play(); } catch (_) {}
    await new Promise((r) => setTimeout(r, 200));
    // Poison: old shared flag that used to skip Alt+Tab pause everywhere.
    try { localStorage.setItem('shuttleXpressEnabled', 'true'); } catch (_) {}
    try { localStorage.setItem('omtKeepPlayingOnAltTab', 'false'); } catch (_) {}
    const beforePaused = v.paused;
    const beforeConn = !!(window.__omtIsShuttleConnected && window.__omtIsShuttleConnected());
    // Simulate Alt+Tab away
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 100));
    const afterPaused = v.paused;
    // Restore
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
    return {
      ok: !beforePaused && !beforeConn && afterPaused,
      beforePaused,
      afterPaused,
      beforeConn
    };
  });

  mark(
    'alt_tab_pauses_despite_legacy_shuttle_flag',
    'real_ext',
    JSON.stringify(pauseCheck),
    !!pauseCheck.ok
  );

  // When THIS instance is actually connected, hide-pause is skipped (by design).
  const skipWhenConnected = await page.evaluate(async () => {
    const v = document.querySelector('video');
    try { await v.play(); } catch (_) {}
    await new Promise((r) => setTimeout(r, 150));
    window.__omtTestMarkShuttleConnected(true);
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 100));
    const paused = v.paused;
    window.__omtTestMarkShuttleConnected(false);
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    return { pausedWhileConnected: paused };
  });
  mark(
    'alt_tab_skips_pause_only_when_instance_connected',
    'real_ext',
    JSON.stringify(skipWhenConnected),
    skipWhenConnected.pausedWhileConnected === false
  );

  await page.close().catch(() => {});
}

/* --- shuttleXpressEnabled must not be a syncable pref --- */
{
  const prefsSrc = fs.readFileSync(path.join(EXT, 'prefs-storage.js'), 'utf8');
  // Only count string entries inside SYNCABLE_KEYS — ignore comments.
  const m = prefsSrc.match(/const SYNCABLE_KEYS\s*=\s*\[([\s\S]*?)\];/);
  const syncableBody = m ? m[1] : '';
  const syncableHasShuttle = /['"]shuttleXpressEnabled['"]/.test(syncableBody);
  mark(
    'shuttle_enabled_not_in_syncable_keys',
    'simulation',
    `syncableHasShuttle=${syncableHasShuttle}`,
    !syncableHasShuttle
  );
}

await context.close();
try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (_) {}
try { fs.rmSync(staging, { recursive: true, force: true }); } catch (_) {}

const summary = {
  passed: Object.values(checklist).filter((c) => c.ok === true).length,
  failed: Object.values(checklist).filter((c) => c.ok === false).length
};
notes.summary = summary;
fs.writeFileSync(path.join(ARTIFACTS, 'v254_storage_sync_notes.json'), JSON.stringify(notes, null, 2));
console.log(JSON.stringify({
  summary,
  issues: notes.issues,
  sha,
  size,
  files: notes.zipFileCount,
  zip: zipPath,
  listing: listing.trim().split('\n').slice(0, 30)
}, null, 2));
process.exit(summary.failed ? 1 : 0);
