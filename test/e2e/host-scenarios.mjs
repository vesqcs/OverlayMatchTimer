// Host field scenarios shared by extension.spec.mjs (current build) and
// compare-baseline.mjs (1.2.0 / 2.0.2 / current side by side).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

// Field-shaped URLs: Examino DVR popup path and InPlay /schedule.
const ROUTES = [
  // More-specific bus mock before the generic field DVR route.
  { re: /^\/examino\/play\/dvr\/bus-mock/, file: 'examino-ovenplayer-bus-mock.html' },
  { re: /^\/examino\/play\/dvr\//, file: 'examino-field-mock.html' },
  { re: /^\/xeatre\/dvrplayer\.html/, file: 'xeatre-dvr-mock.html' },
  // Field live ULL: nanoplayer.html?StreamID=… (nanoStream H5Live, not Video.js).
  { re: /^\/xeatre\/nanoplayer\.html/, file: 'xeatre-nanoplayer-mock.html' },
  { re: /^\/inplay\/schedule\/?$/, file: 'inplayip-schedule-mock.html' }
];

export const EXAMINO_FIELD_PATH = '/examino/play/dvr/match-123';
export const EXAMINO_BUS_MOCK_PATH = '/examino/play/dvr/bus-mock';
export const XEATRE_DVR_PATH = '/xeatre/dvrplayer.html';
export const XEATRE_NANOPLAYER_PATH =
  '/xeatre/nanoplayer.html?StreamID=mock&StreamEnd=1&TimerId=1&WStart=0';
export const INPLAY_SCHEDULE_PATH = '/inplay/schedule';

function contentType(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.mp4')) return 'video/mp4';
  return 'application/octet-stream';
}

export function resolveFixture(fixturesDir, urlPath, fallback = 'examino-mock.html') {
  const route = ROUTES.find((r) => r.re.test(urlPath));
  if (route) return path.join(fixturesDir, route.file);
  const safe = urlPath.replace(/\.\./g, '');
  return path.join(fixturesDir, safe === '/' ? fallback : safe.replace(/^\//, ''));
}

export function startFixtureServer(fixturesDir) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      if (urlPath.includes('favicon')) {
        res.writeHead(204);
        res.end();
        return;
      }
      const filePath = resolveFixture(fixturesDir, urlPath);
      if (!filePath.startsWith(fixturesDir) || !fs.existsSync(filePath)) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': contentType(filePath) });
      fs.createReadStream(filePath).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

function watchPageErrors(page) {
  const out = { uncaughtAbort: 0, uncaughtOther: 0, samples: [] };
  const note = (text) => {
    if (/AbortError|play\(\) request was interrupted/i.test(text)) out.uncaughtAbort += 1;
    else out.uncaughtOther += 1;
    if (out.samples.length < 5) out.samples.push(text.slice(0, 200));
  };
  const onPageError = (err) => note(String(err && (err.message || err)));
  const onConsole = (msg) => {
    if (msg.type() === 'error' && /Uncaught \(in promise\)/.test(msg.text())) note(msg.text());
  };
  page.on('pageerror', onPageError);
  page.on('console', onConsole);
  return {
    stats: out,
    stop() {
      page.off('pageerror', onPageError);
      page.off('console', onConsole);
    }
  };
}

/**
 * Examino DVR popup: Source row never confirms DVR/VOD, every Source pick
 * replaces the <video>. Measures boot work, then a 10 s idle window.
 */
export async function runExaminoFieldScenario(page, base, { settleMs = 5000, idleMs = 10000 } = {}) {
  const errors = watchPageErrors(page);
  await page.goto(`${base}${EXAMINO_FIELD_PATH}`, { waitUntil: 'domcontentloaded' });
  let mounted = true;
  try {
    await page.waitForFunction(() => !!document.getElementById('omt-root'), null, { timeout: 20000 });
  } catch (_) {
    mounted = false;
  }
  await page.waitForTimeout(settleMs);
  const snap = () => page.evaluate(() => {
    const s = window.__fieldStats || {};
    return {
      sourceLoads: s.sourceLoads || 0,
      sourcePicks: s.sourcePicks || 0,
      gearClicks: s.gearClicks || 0,
      play: s.play || 0,
      pause: s.pause || 0,
      waiting: s.waiting || 0
    };
  });
  const atSettle = await snap();
  await page.waitForTimeout(idleMs);
  const atEnd = await snap();
  const final = await page.evaluate(() => {
    const v = document.querySelector('#media-host video');
    const r = v ? v.getBoundingClientRect() : null;
    return {
      playerOpen: typeof window.__fieldPlayerOpen === 'function' ? window.__fieldPlayerOpen() : false,
      paused: v ? v.paused : null,
      readyState: v ? v.readyState : null,
      videoHeight: r ? Math.round(r.height) : 0,
      hudMounted: !!document.getElementById('omt-root')
    };
  });
  errors.stop();
  const idle = {
    play: atEnd.play - atSettle.play,
    pause: atEnd.pause - atSettle.pause,
    waiting: atEnd.waiting - atSettle.waiting,
    sourceLoads: atEnd.sourceLoads - atSettle.sourceLoads,
    gearClicks: atEnd.gearClicks - atSettle.gearClicks
  };
  return {
    mounted,
    boot: atSettle,
    idle,
    totals: atEnd,
    ...final,
    uncaughtAbort: errors.stats.uncaughtAbort,
    errorSamples: errors.stats.samples
  };
}

/** Visible-centre hit test for the curtain arrow. */
async function probeArrow(page) {
  return page.evaluate(() => {
    const arrow = document.getElementById('curtain-arrow');
    if (!arrow) return { present: false };
    const r = arrow.getBoundingClientRect();
    const top = Math.max(0, r.top);
    const bottom = Math.min(window.innerHeight, r.bottom);
    const x = Math.round(r.left + r.width / 2);
    const y = Math.round(top + (bottom - top) / 2);
    const visible = r.width > 0 && bottom - top >= 8 && getComputedStyle(arrow).visibility !== 'hidden' &&
      getComputedStyle(arrow).display !== 'none';
    const el = document.elementFromPoint(x, y);
    const describe = (n) => n ? (n.id ? '#' + n.id : n.tagName.toLowerCase() + (n.className && typeof n.className === 'string' ? '.' + n.className.trim().split(/\s+/).join('.') : '')) : null;
    return {
      present: true,
      visible,
      x,
      y,
      hitIsHost: !!(el && arrow.contains(el)),
      hitInsideOmt: !!(el && el.closest && el.closest('#omt-root')),
      hit: describe(el),
      className: arrow.className
    };
  });
}

/** Real mouse click at the arrow's visible centre; time until two frames painted after the toggle. */
async function clickArrowTimed(page, probe) {
  await page.evaluate(() => {
    window.__omtArrowPd = 0;
    window.__omtArrowToggles0 = window.__inplayState ? window.__inplayState.toggles : 0;
    if (!window.__omtArrowPdHooked) {
      window.__omtArrowPdHooked = true;
      window.addEventListener('pointerdown', () => { window.__omtArrowPd = performance.now(); }, true);
    }
  });
  await page.mouse.click(probe.x, probe.y);
  return page.evaluate(async () => {
    const deadline = performance.now() + 3000;
    while (performance.now() < deadline) {
      if (window.__inplayState && window.__inplayState.toggles !== window.__omtArrowToggles0) break;
      await new Promise((r) => setTimeout(r, 5));
    }
    const toggled = !!(window.__inplayState && window.__inplayState.toggles !== window.__omtArrowToggles0);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return {
      toggled,
      ms: toggled && window.__omtArrowPd ? Math.round(performance.now() - window.__omtArrowPd) : null,
      expanded: !!(window.__inplayState && window.__inplayState.expanded)
    };
  });
}

/** Points where our HUD is the top-most element while the schedule curtain is open. */
async function hudCoverageWhileCurtainOpen(page) {
  return page.evaluate(() => {
    let covered = 0;
    let total = 0;
    const cols = 16;
    const rows = 10;
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const x = Math.round((i + 0.5) * window.innerWidth / cols);
        const y = Math.round((j + 0.5) * window.innerHeight / rows);
        const el = document.elementFromPoint(x, y);
        total += 1;
        if (el && el.closest && el.closest('#omt-root')) covered += 1;
      }
    }
    // Our bar/panel centres specifically (where the field report saw them).
    const ids = ['omt-controls-panel', 'omt-timeline-bar', 'match-timer-wrap'];
    const hudOnTop = [];
    ids.forEach((id) => {
      const n = document.getElementById(id);
      if (!n) return;
      const r = n.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (el && el.closest && el.closest('#omt-root')) hudOnTop.push(id);
    });
    return { covered, total, hudOnTop };
  });
}

async function longTaskWindow(page, ms) {
  return page.evaluate(async (windowMs) => {
    const entries = [];
    let obs = null;
    try {
      obs = new PerformanceObserver((list) => { list.getEntries().forEach((e) => entries.push(e.duration)); });
      obs.observe({ type: 'longtask', buffered: false });
    } catch (_) {}
    let frames = 0;
    let rafOn = true;
    const tick = () => { if (!rafOn) return; frames += 1; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    const t0 = performance.now();
    await new Promise((r) => setTimeout(r, windowMs));
    rafOn = false;
    const elapsed = performance.now() - t0;
    if (obs) obs.disconnect();
    return {
      longTasks: entries.length,
      longTaskMs: Math.round(entries.reduce((a, b) => a + b, 0)),
      fps: Math.round(frames / (elapsed / 1000))
    };
  }, ms);
}

async function curtainCycle(page) {
  const collapsed = await probeArrow(page);
  const open = collapsed.visible ? await clickArrowTimed(page, collapsed) : { toggled: false, ms: null };
  await page.mouse.move(5, Math.round((await page.evaluate(() => window.innerHeight)) / 2));
  await page.waitForTimeout(150);
  const expandedArrow = await probeArrow(page);
  const coverage = await hudCoverageWhileCurtainOpen(page);
  const close = expandedArrow.visible ? await clickArrowTimed(page, expandedArrow) : { toggled: false, ms: null };
  await page.mouse.move(5, 300);
  await page.waitForTimeout(150);
  return { collapsed, open, expandedArrow, coverage, close };
}

/**
 * InPlay /schedule: curtain arrow clickable + toggle time, in and out of
 * fullscreen (#root, like InPlay), still present after exit; no HUD over the
 * open curtain; long tasks while idle with the curtain open.
 */
export async function runInplayScheduleScenario(page, base) {
  const errors = watchPageErrors(page);
  await page.goto(`${base}${INPLAY_SCHEDULE_PATH}`, { waitUntil: 'domcontentloaded' });
  let mounted = true;
  try {
    await page.waitForFunction(() => !!document.getElementById('omt-root'), null, { timeout: 20000 });
  } catch (_) {
    mounted = false;
  }
  await page.waitForTimeout(1200);
  await page.mouse.move(5, 300);

  const windowed = await curtainCycle(page);

  await page.evaluate(() => document.getElementById('root').requestFullscreen().catch(() => {}));
  await page.waitForTimeout(700);
  const inFs = await page.evaluate(() => document.fullscreenElement && document.fullscreenElement.id);
  const fullscreen = await curtainCycle(page);

  // Idle with the curtain open in fullscreen (field: "super slow").
  const fsOpenProbe = await probeArrow(page);
  if (fsOpenProbe.visible) await clickArrowTimed(page, fsOpenProbe);
  await page.mouse.move(5, 300);
  const idleFsOpen = await longTaskWindow(page, 4000);
  const fsCloseProbe = await probeArrow(page);
  if (fsCloseProbe.visible) await clickArrowTimed(page, fsCloseProbe);

  await page.evaluate(() => document.exitFullscreen().catch(() => {}));
  await page.waitForTimeout(700);
  const afterExit = await curtainCycle(page);

  errors.stop();
  const toggleTimes = [windowed.open, windowed.close, fullscreen.open, fullscreen.close, afterExit.open, afterExit.close]
    .map((t) => t.ms);
  const allToggled = [windowed.open, windowed.close, fullscreen.open, fullscreen.close, afterExit.open, afterExit.close]
    .every((t) => t.toggled);
  const arrows = [windowed.collapsed, windowed.expandedArrow, fullscreen.collapsed, fullscreen.expandedArrow,
    afterExit.collapsed, afterExit.expandedArrow];
  return {
    mounted,
    enteredFullscreen: inFs === 'root',
    arrowsHost: arrows.filter((a) => a.hitIsHost).length,
    arrowsTotal: arrows.length,
    arrowsCoveredByOmt: arrows.filter((a) => a.hitInsideOmt).length,
    allToggled,
    toggleMaxMs: toggleTimes.some((t) => t == null) ? null : Math.max(...toggleTimes),
    toggleTimes,
    hudCoveredPointsOpen: windowed.coverage.covered + fullscreen.coverage.covered + afterExit.coverage.covered,
    hudOnTopIds: [...new Set([...windowed.coverage.hudOnTop, ...fullscreen.coverage.hudOnTop, ...afterExit.coverage.hudOnTop])],
    idleFsOpen,
    afterExitArrowPresent: afterExit.collapsed.present && afterExit.collapsed.visible,
    uncaughtAbort: errors.stats.uncaughtAbort,
    detail: { windowed, fullscreen, afterExit }
  };
}
