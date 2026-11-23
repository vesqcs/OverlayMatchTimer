/**
 * v2.4.7 — Fixed-period kickoff hotkeys (1 / 2) + popup Customize.
 * Local player exercises are marked real_test; popup DOM shots are simulation
 * (extension popup page loaded directly). Runtime-only zip packaging.
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
  version: '2.4.7',
  shots: [],
  checklist,
  issues: [],
  defaultConflicts: null
};

function mark(id, how, detail, ok = true) {
  checklist[id] = { ok, how, detail: detail == null ? '' : String(detail) };
  const tag = ok === false ? 'FAIL' : ok === null ? 'SKIP' : 'PASS';
  console.log(tag, `[${how}]`, id, detail == null ? '' : detail);
  if (ok === false) notes.issues.push(id + ': ' + detail);
}

function buildRuntimeZip() {
  const staging = fs.mkdtempSync(path.join('/tmp', 'omt-rt247-'));
  const files = [
    'manifest.json', 'player.html', 'player.css', 'sync-feature-flag.js',
    'popup.js', 'popup.html', 'popup.css', 'popup-sync-section.html',
    'background.js', 'bridge.js', 'content.js', 'content.css'
  ];
  for (const f of files) {
    const src = path.join(EXT, f);
    if (!fs.existsSync(src)) throw new Error('missing ' + f);
    fs.copyFileSync(src, path.join(staging, f));
  }
  const assetsSrc = path.join(EXT, 'assets');
  const assetsDst = path.join(staging, 'assets');
  fs.mkdirSync(assetsDst, { recursive: true });
  for (const name of fs.readdirSync(assetsSrc)) {
    if (!/\.(png|jpg|jpeg|svg|webp)$/i.test(name)) continue;
    fs.copyFileSync(path.join(assetsSrc, name), path.join(assetsDst, name));
  }
  const zipPath = path.join(ARTIFACTS, 'OverlayMatchTimer-2.4.7-TEST.zip');
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  execSync(`cd "${staging}" && zip -qr "${zipPath}" .`);
  const buf = fs.readFileSync(zipPath);
  const sha = createHash('sha256').update(buf).digest('hex');
  fs.writeFileSync(path.join(ARTIFACTS, 'OverlayMatchTimer-2.4.7-TEST.sha256'), sha + '  OverlayMatchTimer-2.4.7-TEST.zip\n');
  const listing = execSync(`unzip -l "${zipPath}"`).toString();
  const bad = /(?:^|\s)(src\/|scripts\/|design\/|package\.json|node_modules\/)/i.test(listing);
  notes.zip = zipPath;
  notes.sha256 = sha;
  notes.zipSize = buf.length;
  notes.zipListingOk = !bad;
  mark('runtime_only_zip', 'simulation', `size=${buf.length} sha=${sha.slice(0, 12)}… badPaths=${bad}`, !bad);
  try { fs.rmSync(staging, { recursive: true, force: true }); } catch (_) {}
  return { zipPath, sha, size: buf.length };
}

async function waitVideo(page) {
  await page.evaluate(async () => {
    const v = document.getElementById('omt-local-video');
    if (!v) return;
    await new Promise((r) => {
      if (v.readyState >= 2) return r();
      v.addEventListener('loadeddata', r, { once: true });
      setTimeout(r, 3000);
    });
  });
}

async function readKickState(page) {
  return page.evaluate(() => {
    const half = document.getElementById('omt-half-select');
    const timer = document.getElementById('match-timer') || document.querySelector('.omt-match-timer, #omt-match-timer');
    const ticks = Array.from(document.querySelectorAll('.omt-period-tick')).map((el) => ({
      half: el.getAttribute('data-half'),
      left: el.style.left || ''
    }));
    return {
      half: half ? half.value : null,
      kickoff1: localStorage.getItem('matchTimerKickoff1'),
      kickoff2: localStorage.getItem('matchTimerKickoff2'),
      matchHalf: localStorage.getItem('matchTimerHalf'),
      ativo: localStorage.getItem('matchTimerAtivo'),
      timerText: timer ? (timer.innerText || timer.textContent || '').trim() : '',
      tickHalves: ticks.map((t) => t.half),
      videoTime: (document.getElementById('omt-local-video') || {}).currentTime || 0
    };
  });
}

async function main() {
  buildRuntimeZip();

  // Default conflict report (no overlap with existing defaults).
  const defaults = {
    playPause: ' ', skipBack2: 'arrowleft', skipFwd2: 'arrowright',
    skipBack10: 'arrowleft+shift', skipFwd10: 'arrowright+shift',
    skipBack2m: 'arrowleft+ctrl', skipFwd2m: 'arrowright+ctrl',
    frameBack: 'arrowdown', frameFwd: 'arrowup',
    speedDown: 'z', speedUp: 'c', speedReset: 'x',
    kickoff: 'k', kickoff1: '1', kickoff2: '2', live: 'l', hide: 'h'
  };
  const used = {};
  const conflicts = [];
  for (const [id, key] of Object.entries(defaults)) {
    if (used[key]) conflicts.push(`${id} vs ${used[key]} (${key})`);
    else used[key] = id;
  }
  notes.defaultConflicts = conflicts;
  mark('default_key_conflicts', 'simulation',
    conflicts.length ? conflicts.join('; ') : 'none — 1 and 2 free vs existing defaults',
    conflicts.length === 0);

  const userData = fs.mkdtempSync(path.join('/tmp', 'omt-v247-'));
  const context = await chromium.launchPersistentContext(userData, {
    headless: false,
    args: [
      `--disable-extensions-except=${EXT}`,
      `--load-extension=${EXT}`,
      '--autoplay-policy=no-user-gesture-required',
      '--no-sandbox'
    ]
  });

  let extId = null;
  for (let i = 0; i < 40 && !extId; i++) {
    const sw = context.serviceWorkers();
    if (sw.length) {
      const m = sw[0].url().match(/chrome-extension:\/\/([^/]+)/);
      if (m) extId = m[1];
    }
    if (!extId) await new Promise((r) => setTimeout(r, 250));
  }
  if (!extId) {
    mark('extension_load', 'real_test', 'no extension id', false);
    await context.close();
    throw new Error('extension failed to load');
  }
  mark('version_runtime_load', 'real_test', extId, true);

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extId}/player.html`, { waitUntil: 'domcontentloaded' });
  await page.setInputFiles('#omt-local-file-input', SAMPLE);
  await waitVideo(page);
  await page.waitForTimeout(400);

  // Clear any prior kickoffs
  await page.evaluate(() => {
    ['matchTimerKickoff1', 'matchTimerKickoff2', 'matchTimerKickoffC1', 'matchTimerKickoffC2',
      'matchTimerAtivo', 'matchTimerOffset', 'matchTimerHalf'].forEach((k) => localStorage.removeItem(k));
    const half = document.getElementById('omt-half-select');
    if (half) {
      half.value = '2'; // dropdown on 2nd Half — keys 1/2 must ignore this
      half.dispatchEvent(new Event('change', { bubbles: true }));
    }
    ['omt-sync-hr', 'omt-sync-min', 'omt-sync-sec'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
  });

  // Seek then press 1 → 1st Half kickoff at ~1.0s despite dropdown=2
  await page.evaluate(() => {
    const v = document.getElementById('omt-local-video');
    try { v.currentTime = 1.0; } catch (_) {}
  });
  await page.waitForTimeout(200);
  await page.keyboard.press('1');
  await page.waitForTimeout(350);
  const after1 = await readKickState(page);
  const k1 = after1.kickoff1 != null ? parseFloat(after1.kickoff1) : NaN;
  const ok1 = after1.ativo === 'true' && after1.matchHalf === '1' && after1.half === '1' &&
    Number.isFinite(k1) && Math.abs(k1 - 1.0) < 1.5 && after1.tickHalves.includes('1');
  mark('key1_sets_1st_half', 'real_test', JSON.stringify(after1), ok1);

  // Seek further, leave dropdown (now 1), press 2 → 2nd Half at ~3.0s
  await page.evaluate(() => {
    const v = document.getElementById('omt-local-video');
    try { v.currentTime = 3.0; } catch (_) {}
    const half = document.getElementById('omt-half-select');
    if (half) {
      half.value = '1';
      half.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  await page.waitForTimeout(200);
  await page.keyboard.press('2');
  await page.waitForTimeout(350);
  const after2 = await readKickState(page);
  const k2 = after2.kickoff2 != null ? parseFloat(after2.kickoff2) : NaN;
  const ok2 = after2.matchHalf === '2' && after2.half === '2' &&
    Number.isFinite(k2) && Math.abs(k2 - 3.0) < 1.5 &&
    after2.tickHalves.includes('1') && after2.tickHalves.includes('2') &&
    after2.kickoff1 != null;
  mark('key2_sets_2nd_half', 'real_test', JSON.stringify(after2), ok2);

  // Timer / period marks visible after both
  const timerOk = !!(after2.timerText && /^\d{1,2}:\d{2}/.test(after2.timerText));
  mark('timer_and_period_marks', 'real_test',
    `timer=${after2.timerText} ticks=${after2.tickHalves.join(',')}`,
    timerOk && after2.tickHalves.includes('1') && after2.tickHalves.includes('2'));

  // K still uses dropdown selection (set dropdown to custom1 path? use '1' with K)
  await page.evaluate(() => {
    const v = document.getElementById('omt-local-video');
    try { v.currentTime = 4.0; } catch (_) {}
    const half = document.getElementById('omt-half-select');
    if (half) {
      half.value = '1';
      half.dispatchEvent(new Event('change', { bubbles: true }));
    }
    ['omt-sync-hr', 'omt-sync-min', 'omt-sync-sec'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
  });
  await page.waitForTimeout(150);
  await page.keyboard.press('k');
  await page.waitForTimeout(350);
  const afterK = await readKickState(page);
  const kK = afterK.kickoff1 != null ? parseFloat(afterK.kickoff1) : NaN;
  const okK = afterK.matchHalf === '1' && afterK.half === '1' &&
    Number.isFinite(kK) && Math.abs(kK - 4.0) < 1.5;
  mark('k_still_uses_dropdown', 'real_test', JSON.stringify(afterK), okK);

  // Typing in inputs must not fire 1/2 (shared isEditableKeyTarget gate).
  // Whistle sync fields are hidden; probe with a focused <input> plus the
  // visible custom-minute field in More.
  await page.evaluate(() => {
    const more = document.getElementById('omt-more-toggle');
    if (more && more.getAttribute('aria-expanded') !== 'true') more.click();
    const half = document.getElementById('omt-half-select');
    if (half) {
      half.value = 'custom1';
      half.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  await page.waitForTimeout(150);
  await page.locator('#omt-custom-minute-c1').click({ force: true });
  await page.locator('#omt-custom-minute-c1').fill('');
  let focused = await page.evaluate(() => {
    const el = document.getElementById('omt-custom-minute-c1');
    return !!(el && document.activeElement === el);
  });
  if (!focused) {
    await page.evaluate(() => {
      let inp = document.getElementById('omt-v247-type-probe');
      if (!inp) {
        inp = document.createElement('input');
        inp.id = 'omt-v247-type-probe';
        inp.style.cssText = 'position:fixed;top:8px;left:8px;z-index:2147483647;';
        document.body.appendChild(inp);
      }
      inp.value = '';
      inp.focus();
    });
    focused = await page.evaluate(() => {
      const el = document.getElementById('omt-custom-minute-c1') ||
        document.getElementById('omt-v247-type-probe');
      return !!(el && document.activeElement === el);
    });
  }
  const beforeType = await readKickState(page);
  await page.keyboard.press('2');
  await page.waitForTimeout(250);
  const afterType = await readKickState(page);
  const typedInInput = await page.evaluate(() => {
    const a = document.getElementById('omt-custom-minute-c1');
    const b = document.getElementById('omt-v247-type-probe');
    if (a && document.activeElement === a) return String(a.value);
    if (b && document.activeElement === b) return String(b.value);
    return a ? String(a.value) : (b ? String(b.value) : null);
  });
  await page.evaluate(() => {
    const probe = document.getElementById('omt-v247-type-probe');
    if (probe) probe.remove();
    try { document.activeElement && document.activeElement.blur(); } catch (_) {}
  });
  mark('no_fire_while_typing', 'real_test',
    `focused=${focused} typed=${typedInInput} kick2_before=${beforeType.kickoff2} after=${afterType.kickoff2}`,
    focused && typedInInput === '2' && beforeType.kickoff2 === afterType.kickoff2);

  // Screenshot local player with both period ticks
  const shotPlayer = path.join(ARTIFACTS, 'v247_local_kickoff_keys.png');
  await page.evaluate(() => {
    const more = document.getElementById('omt-more-toggle');
    if (more && more.getAttribute('aria-expanded') !== 'true') more.click();
    document.body && document.body.focus();
  });
  await page.waitForTimeout(200);
  await page.screenshot({ path: shotPlayer, fullPage: true });
  notes.shots.push(shotPlayer);

  // Popup: shortcuts list + Customize rebind
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html`, { waitUntil: 'domcontentloaded' });
  await popup.waitForTimeout(400);

  // Open General → Shortcuts
  await popup.evaluate(() => {
    const d = document.getElementById('omt-gen-shortcuts-details');
    if (d) d.open = true;
  });
  await popup.waitForTimeout(150);
  const listText = await popup.evaluate(() => {
    const host = document.getElementById('omt-shortcut-list');
    return host ? host.innerText : '';
  });
  const listOk = /Kick-off 1st Half/i.test(listText) && /Kick-off 2nd Half/i.test(listText) &&
    /\b1\b/.test(listText) && /\b2\b/.test(listText);
  mark('popup_shortcuts_list', 'simulation', listText.replace(/\s+/g, ' ').slice(0, 240), listOk);
  const shotList = path.join(ARTIFACTS, 'v247_popup_shortcuts_list.png');
  await popup.screenshot({ path: shotList, fullPage: true });
  notes.shots.push(shotList);

  // Customize → Shortcuts editor
  await popup.evaluate(() => {
    const tab = document.querySelector('.omt-tab[data-tab="customize"]');
    if (tab) tab.click();
    document.querySelectorAll('.omt-pane').forEach((p) => {
      p.classList.toggle('is-active', p.getAttribute('data-pane') === 'customize');
    });
    document.querySelectorAll('.omt-tab').forEach((t) => {
      t.classList.toggle('is-active', t.getAttribute('data-tab') === 'customize');
    });
    const hot = document.getElementById('omt-hotkeys-details');
    if (hot) hot.open = true;
  });
  await popup.waitForTimeout(250);

  const editorText = await popup.evaluate(() => {
    const host = document.getElementById('omt-hotkey-editor');
    return host ? host.innerText : '';
  });
  const editorOk = /Kick-off 1st Half/i.test(editorText) && /Kick-off 2nd Half/i.test(editorText);
  mark('popup_customize_editor', 'simulation', editorText.replace(/\s+/g, ' ').slice(0, 240), editorOk);
  const shotEdit = path.join(ARTIFACTS, 'v247_popup_customize_shortcuts.png');
  await popup.screenshot({ path: shotEdit, fullPage: true });
  notes.shots.push(shotEdit);

  // Rebind kickoff1 to '9', verify persistence + player respects it
  const rebound = await popup.evaluate(async () => {
    const host = document.getElementById('omt-hotkey-editor');
    if (!host) return { ok: false, reason: 'no editor' };
    const btn = host.querySelector('[data-bind="kickoff1"]');
    if (!btn) return { ok: false, reason: 'no bind btn' };
    btn.click();
    return { ok: true, listening: true };
  });
  if (rebound.ok) {
    await popup.keyboard.press('9');
    await popup.waitForTimeout(400);
    const stored = await popup.evaluate(() => new Promise((resolve) => {
      chrome.storage.local.get(['omtHotkeys'], (v) => resolve(v.omtHotkeys || null));
    }));
    const key1 = stored && stored.kickoff1 && stored.kickoff1.key;
    mark('customize_rebind_persist', 'simulation', JSON.stringify(stored && stored.kickoff1), key1 === '9');

    // Player should pick up rebind via storage sync — reload player and test 9
    await page.bringToFront();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.setInputFiles('#omt-local-file-input', SAMPLE);
    await waitVideo(page);
    await page.waitForTimeout(600);
    await page.evaluate(() => {
      const v = document.getElementById('omt-local-video');
      try { v.currentTime = 2.2; } catch (_) {}
      const half = document.getElementById('omt-half-select');
      if (half) half.value = '2';
      ['omt-sync-hr', 'omt-sync-min', 'omt-sync-sec'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
    });
    await page.waitForTimeout(200);
    // '1' should no longer set 1st half; '9' should
    const before = await readKickState(page);
    await page.keyboard.press('1');
    await page.waitForTimeout(250);
    const mid = await readKickState(page);
    await page.keyboard.press('9');
    await page.waitForTimeout(350);
    const after = await readKickState(page);
    const k9 = after.kickoff1 != null ? parseFloat(after.kickoff1) : NaN;
    mark('customize_rebind_player', 'real_test',
      JSON.stringify({ beforeKick1: before.kickoff1, after1: mid.kickoff1, after9: after.kickoff1, half: after.half }),
      mid.kickoff1 === before.kickoff1 && after.half === '1' && Number.isFinite(k9) && Math.abs(k9 - 2.2) < 1.5);
  } else {
    mark('customize_rebind_persist', 'simulation', rebound.reason, false);
    mark('customize_rebind_player', 'real_test', 'skipped — rebind UI missing', false);
  }

  const summary = {
    passed: Object.values(checklist).filter((c) => c.ok === true).length,
    failed: Object.values(checklist).filter((c) => c.ok === false).length,
    skipped: Object.values(checklist).filter((c) => c.ok === null).length
  };
  notes.summary = summary;
  fs.writeFileSync(path.join(ARTIFACTS, 'v247_kickoff_notes.json'), JSON.stringify(notes, null, 2));
  console.log(JSON.stringify({ summary, issues: notes.issues, sha: notes.sha256, size: notes.zipSize }, null, 2));

  await context.close();
  try { fs.rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  if (summary.failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
