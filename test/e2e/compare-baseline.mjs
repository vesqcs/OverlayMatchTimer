// Side-by-side host field scenarios: v1.2.0 (reference), v2.0.2 (field
// failure) and the working tree. Writes JSON + markdown to the artifacts
// folder and exits non-zero if the current build misses acceptance or is
// worse than 1.2.0.
//
//   cd test && npm run test:compare
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startFixtureServer, runExaminoFieldScenario, runInplayScheduleScenario } from './host-scenarios.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const FIXTURES = path.join(ROOT, 'test/fixtures');
const ARTIFACTS = process.env.OMT_ARTIFACTS || '/opt/cursor/artifacts';

const BUILDS = [
  { label: '1.2.0', ref: '811be7b' },
  { label: '2.0.2', ref: '047898c' },
  { label: 'current', ref: null }
];

function extractBuild(ref, label) {
  if (!ref) return path.join(ROOT, 'Overlay-chrome-extension');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `omt-${label}-`));
  const tar = execFileSync('git', ['-C', ROOT, 'archive', ref, 'Overlay-chrome-extension'], { maxBuffer: 256 * 1024 * 1024 });
  execFileSync('tar', ['-x', '-C', dir], { input: tar });
  return path.join(dir, 'Overlay-chrome-extension');
}

function manifestVersion(extDir) {
  try { return JSON.parse(fs.readFileSync(path.join(extDir, 'manifest.json'), 'utf8')).version; } catch (_) { return '?'; }
}

async function runBuild(extDir, base) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omt-cmp-profile-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: 1280, height: 720 },
    args: [
      `--disable-extensions-except=${extDir}`,
      `--load-extension=${extDir}`,
      '--disable-features=ExtensionDisableUnsupportedDeveloper',
      '--no-sandbox',
      '--disable-gpu'
    ]
  });
  try {
    const examPage = await context.newPage();
    const examino = await runExaminoFieldScenario(examPage, base);
    await examPage.close();
    const inplayPage = await context.newPage();
    const inplay = await runInplayScheduleScenario(inplayPage, base);
    await inplayPage.close();
    return { examino, inplay };
  } finally {
    await context.close();
  }
}

function fmt(v) {
  if (v === null || v === undefined) return 'n/a';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  return String(v);
}

function markdown(rows) {
  const cols = rows.map((r) => r.label);
  const line = (name, pick) => `| ${name} | ${rows.map((r) => fmt(pick(r.result))).join(' | ')} |`;
  return [
    `| Metric | ${cols.join(' | ')} |`,
    `|---|${cols.map(() => '---').join('|')}|`,
    line('Examino: HUD mounted', (r) => r.examino.mounted),
    line('Examino: Source reloads during boot', (r) => r.examino.boot.sourceLoads),
    line('Examino: idle 10 s play events', (r) => r.examino.idle.play),
    line('Examino: idle 10 s pause events', (r) => r.examino.idle.pause),
    line('Examino: idle 10 s waiting events', (r) => r.examino.idle.waiting),
    line('Examino: idle 10 s Source reloads', (r) => r.examino.idle.sourceLoads),
    line('Examino: idle 10 s settings-menu clicks', (r) => r.examino.idle.gearClicks),
    line('Examino: player open (playing, visible)', (r) => r.examino.playerOpen),
    line('Examino: uncaught AbortError', (r) => r.examino.uncaughtAbort),
    line('InPlay: HUD mounted', (r) => r.inplay.mounted),
    line('InPlay: arrow hit-test is host (of 6)', (r) => r.inplay.arrowsHost),
    line('InPlay: arrow covered by our HUD (of 6)', (r) => r.inplay.arrowsCoveredByOmt),
    line('InPlay: all 6 arrow clicks toggled', (r) => r.inplay.allToggled),
    line('InPlay: slowest toggle (ms, click→2 frames)', (r) => r.inplay.toggleMaxMs),
    line('InPlay: grid points where HUD is over open curtain', (r) => r.inplay.hudCoveredPointsOpen),
    line('InPlay: arrow present after leaving fullscreen', (r) => r.inplay.afterExitArrowPresent),
    line('InPlay: long tasks, 4 s idle, curtain open in FS', (r) => r.inplay.idleFsOpen.longTasks),
    line('InPlay: rAF fps, 4 s idle, curtain open in FS', (r) => r.inplay.idleFsOpen.fps)
  ].join('\n');
}

function verdict(cur, ref) {
  const fails = [];
  const e = cur.examino;
  const i = cur.inplay;
  if (!e.mounted) fails.push('examino-not-mounted');
  if (e.idle.play || e.idle.pause || e.idle.waiting) fails.push('examino-idle-events');
  if (e.idle.sourceLoads) fails.push('examino-idle-reloads');
  if (!e.playerOpen) fails.push('examino-player-not-open');
  if (e.boot.sourceLoads > 2) fails.push('examino-boot-reload-storm');
  if (e.uncaughtAbort) fails.push('examino-uncaught-abort');
  if (!i.mounted) fails.push('inplay-not-mounted');
  if (!i.enteredFullscreen) fails.push('inplay-no-fullscreen');
  if (i.arrowsHost !== i.arrowsTotal) fails.push('inplay-arrow-not-host');
  if (!i.allToggled) fails.push('inplay-arrow-click-missed');
  if (i.hudCoveredPointsOpen) fails.push('inplay-hud-over-curtain');
  if (!i.afterExitArrowPresent) fails.push('inplay-arrow-gone-after-fs');
  if (i.toggleMaxMs == null || i.toggleMaxMs > 500) fails.push('inplay-toggle-slow');
  // Never worse than the 1.2.0 reference.
  if (ref) {
    const re = ref.examino;
    const ri = ref.inplay;
    const idleCur = e.idle.play + e.idle.pause + e.idle.waiting;
    const idleRef = re.idle.play + re.idle.pause + re.idle.waiting;
    if (idleCur > idleRef) fails.push('examino-idle-worse-than-1.2.0');
    if (i.arrowsHost < ri.arrowsHost) fails.push('inplay-arrow-worse-than-1.2.0');
    if (ri.toggleMaxMs != null && i.toggleMaxMs != null && i.toggleMaxMs > ri.toggleMaxMs + 50) {
      fails.push('inplay-toggle-slower-than-1.2.0');
    }
    if (i.idleFsOpen.longTasks > ri.idleFsOpen.longTasks + 1) fails.push('inplay-cpu-worse-than-1.2.0');
  }
  return fails;
}

async function main() {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const { server, base } = await startFixtureServer(FIXTURES);
  const rows = [];
  try {
    for (const b of BUILDS) {
      const extDir = extractBuild(b.ref, b.label);
      const version = manifestVersion(extDir);
      console.log(`[compare] ${b.label} (manifest ${version}) from ${extDir}`);
      const result = await runBuild(extDir, base);
      rows.push({ label: b.label === 'current' ? `current (${version})` : b.label, ref: b.ref, version, result });
    }
  } finally {
    server.close();
  }
  const ref = rows.find((r) => r.version === '1.2.0');
  const cur = rows[rows.length - 1];
  const fails = verdict(cur.result, ref && ref.result);
  const md = `# OverlayMatchTimer host field scenarios — side by side\n\n${markdown(rows)}\n\nCurrent build verdict: ${fails.length ? 'FAIL — ' + fails.join(', ') : 'PASS'}\n`;
  fs.writeFileSync(path.join(ARTIFACTS, 'compare-baseline.json'), JSON.stringify({ rows, fails }, null, 2));
  fs.writeFileSync(path.join(ARTIFACTS, 'compare-baseline.md'), md);
  console.log(md);
  if (fails.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
