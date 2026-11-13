/**
 * Overlay MatchTimer — performance audit harness (v1.7.2)
 * Measures InPlay / Examino / local fixtures with extension ON vs OFF.
 * Writes JSON to /opt/cursor/artifacts/perf-audit-*.json
 *
 * Usage:
 *   xvfb-run -a node e2e/perf-audit.mjs              # full (includes 5‑min memory)
 *   PERF_QUICK=1 xvfb-run -a node e2e/perf-audit.mjs # 60s metrics only (no 5‑min)
 *   PERF_PHASE=before|after node ...                 # tag output files
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const EXT = path.join(ROOT, 'Overlay-chrome-extension');
const FIXTURES = path.join(ROOT, 'test/fixtures');
const ARTIFACTS = '/opt/cursor/artifacts';
const PHASE = process.env.PERF_PHASE || 'run';
const QUICK = process.env.PERF_QUICK === '1';
const PLAY_MS = Number(process.env.PERF_PLAY_MS || 60_000);
const MEMORY_MS = QUICK ? 0 : Number(process.env.PERF_MEMORY_MS || 300_000);

function contentType(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.mp4')) return 'video/mp4';
  return 'application/octet-stream';
}

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      if (urlPath.includes('favicon')) {
        res.writeHead(204);
        res.end();
        return;
      }
      const safe = urlPath.replace(/\.\./g, '');
      const filePath = path.join(FIXTURES, safe === '/' ? 'examino-mock.html' : safe.replace(/^\//, ''));
      if (!filePath.startsWith(FIXTURES) || !fs.existsSync(filePath)) {
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

const INIT_PROBE = () => {
  if (window.__omtPerfInstalled) return;
  window.__omtPerfInstalled = true;
  window.__omtPerf = {
    moCallbacks: 0,
    timeupdates: 0,
    rafTicks: 0,
    longTasks: 0,
    longTaskMs: 0,
    listenerAdds: 0,
    startedAt: performance.now()
  };

  const OrigMO = window.MutationObserver;
  window.MutationObserver = class extends OrigMO {
    constructor(cb) {
      super(function wrapped(mutations, obs) {
        try { window.__omtPerf.moCallbacks++; } catch (_) {}
        return cb.call(this, mutations, obs);
      });
    }
  };

  const origAdd = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, listener, options) {
    try { window.__omtPerf.listenerAdds++; } catch (_) {}
    return origAdd.call(this, type, listener, options);
  };

  try {
    const po = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        window.__omtPerf.longTasks++;
        window.__omtPerf.longTaskMs += e.duration || 0;
      }
    });
    po.observe({ entryTypes: ['longtask'] });
    window.__omtPerfLongPo = po;
  } catch (_) {}

  const origRaf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => origRaf((t) => {
    try { window.__omtPerf.rafTicks++; } catch (_) {}
    return cb(t);
  });

  document.addEventListener('DOMContentLoaded', () => {
    const hookVideo = (v) => {
      if (!v || v.__omtPerfHooked) return;
      v.__omtPerfHooked = true;
      v.addEventListener('timeupdate', () => {
        try { window.__omtPerf.timeupdates++; } catch (_) {}
      });
    };
    document.querySelectorAll('video').forEach(hookVideo);
    new OrigMO(() => {
      document.querySelectorAll('video').forEach(hookVideo);
    }).observe(document.documentElement, { childList: true, subtree: true });
  }, { once: true });
};

async function launch({ withExt }) {
  const userDataDir = fs.mkdtempSync(path.join('/tmp', withExt ? 'omt-perf-on-' : 'omt-perf-off-'));
  const args = [
    '--no-sandbox',
    '--disable-gpu',
    '--disable-features=ExtensionDisableUnsupportedDeveloper'
  ];
  if (withExt) {
    args.push(`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`);
  } else {
    args.push('--disable-extensions');
  }
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args,
    viewport: { width: 1100, height: 900 }
  });
  await context.addInitScript(INIT_PROBE);
  return context;
}

async function waitForVideo(page, timeout = 20000) {
  await page.waitForFunction(() => {
    const v = document.querySelector('video');
    return v && v.readyState >= 2;
  }, null, { timeout });
}

async function ensurePlaying(page) {
  await page.evaluate(async () => {
    const v = document.querySelector('video');
    if (!v) return;
    v.muted = true;
    try { await v.play(); } catch (_) {}
  });
  await page.waitForTimeout(500);
}

async function sampleMetrics(page, label) {
  return page.evaluate((labelInner) => {
    const p = window.__omtPerf || {};
    const elapsedSec = Math.max(0.001, (performance.now() - (p.startedAt || 0)) / 1000);
    const mem = performance.memory
      ? {
          usedJSHeapBytes: performance.memory.usedJSHeapSize,
          totalJSHeapBytes: performance.memory.totalJSHeapSize
        }
      : null;
    const hasOmt = !!document.getElementById('omt-root');
    const timerText = document.getElementById('match-timer')?.textContent || null;
    return {
      label: labelInner,
      elapsedSec,
      hasOmt,
      timerText,
      moCallbacks: p.moCallbacks || 0,
      moPerSec: (p.moCallbacks || 0) / elapsedSec,
      timeupdates: p.timeupdates || 0,
      timeupdatesPerSec: (p.timeupdates || 0) / elapsedSec,
      rafTicks: p.rafTicks || 0,
      rafPerSec: (p.rafTicks || 0) / elapsedSec,
      longTasks: p.longTasks || 0,
      longTaskMs: p.longTaskMs || 0,
      longTaskMsPerSec: (p.longTaskMs || 0) / elapsedSec,
      listenerAdds: p.listenerAdds || 0,
      memory: mem
    };
  }, label);
}

async function resetProbe(page) {
  await page.evaluate(() => {
    if (!window.__omtPerf) return;
    window.__omtPerf.moCallbacks = 0;
    window.__omtPerf.timeupdates = 0;
    window.__omtPerf.rafTicks = 0;
    window.__omtPerf.longTasks = 0;
    window.__omtPerf.longTaskMs = 0;
    // Keep listenerAdds cumulative from page start (init + content script wiring).
    window.__omtPerf.startedAt = performance.now();
  });
}

/** CDP Performance.getMetrics — keep one session for the whole window. */
async function metricsCpuWindow(page, durationMs) {
  const client = await page.context().newCDPSession(page);
  try {
    await client.send('Performance.enable');
    // timeDomain: 'timeTicks' is default; also try collecting JS samples via Profiler
    // as a cross-check when ScriptDuration stays near zero in headless.
    const toMap = (metrics) => {
      const map = {};
      for (const m of metrics || []) map[m.name] = m.value;
      return map;
    };
    const beforeRaw = await client.send('Performance.getMetrics');
    const before = toMap(beforeRaw.metrics);

    let profiler = null;
    try {
      await client.send('Profiler.enable');
      await client.send('Profiler.setSamplingInterval', { interval: 250 });
      await client.send('Profiler.start');
      profiler = true;
    } catch (_) {
      profiler = false;
    }

    const t0 = Date.now();
    await page.waitForTimeout(durationMs);
    const wallSec = Math.max(0.001, (Date.now() - t0) / 1000);

    const afterRaw = await client.send('Performance.getMetrics');
    const after = toMap(afterRaw.metrics);

    let profileSummary = null;
    if (profiler) {
      try {
        const { profile } = await client.send('Profiler.stop');
        const nodes = (profile && profile.nodes) || [];
        const samples = (profile && profile.samples) || [];
        const idToNode = new Map(nodes.map((n) => [n.id, n]));
        let idle = 0;
        let program = 0;
        let other = 0;
        let extish = 0;
        for (const id of samples) {
          const n = idToNode.get(id);
          const name = (n && n.callFrame && n.callFrame.functionName) || '';
          const url = (n && n.callFrame && n.callFrame.url) || '';
          if (name === '(idle)' || (!name && !url)) idle++;
          else if (name === '(program)' || name === '(garbage collector)') program++;
          else {
            other++;
            if (/chrome-extension:|content\.js|omt|Overlay|atualizar|hideExamino/i.test(url + ' ' + name)) {
              extish++;
            }
          }
        }
        const total = Math.max(1, samples.length);
        // Approximate ms/s of non-idle JS from sample share × wall clock.
        profileSummary = {
          samples: total,
          idleShare: idle / total,
          programShare: program / total,
          jsShare: other / total,
          extensionishShare: extish / total,
          approxJsMsPerSec: (other / total) * 1000,
          approxExtensionishMsPerSec: (extish / total) * 1000,
          note: 'Sampling profiler (250µs); approxJsMsPerSec = jsShare × 1000 wall ms/s'
        };
      } catch (err) {
        profileSummary = { error: String(err && err.message || err) };
      }
      try { await client.send('Profiler.disable'); } catch (_) {}
    }

    const dt = Math.max(0.001, durationMs / 1000);
    const scriptSec = Math.max(0, (after.ScriptDuration || 0) - (before.ScriptDuration || 0));
    const taskSec = Math.max(0, (after.TaskDuration || 0) - (before.TaskDuration || 0));
    const layoutSec = Math.max(0, (after.LayoutDuration || 0) - (before.LayoutDuration || 0));
    const recalcSec = Math.max(0, (after.RecalcStyleDuration || 0) - (before.RecalcStyleDuration || 0));

    // Also sample performance.now() busy work via Long Tasks + measure entries if any.
    const longTaskProbe = await page.evaluate(() => ({
      longTasks: (window.__omtPerf && window.__omtPerf.longTasks) || 0,
      longTaskMs: (window.__omtPerf && window.__omtPerf.longTaskMs) || 0
    }));

    return {
      durationMs,
      wallSec,
      scriptDurationSec: scriptSec,
      taskDurationSec: taskSec,
      layoutDurationSec: layoutSec,
      recalcStyleDurationSec: recalcSec,
      scriptMsPerSec: (scriptSec / dt) * 1000,
      taskMsPerSec: (taskSec / dt) * 1000,
      layoutCountDelta: (after.LayoutCount || 0) - (before.LayoutCount || 0),
      recalcStyleCountDelta: (after.RecalcStyleCount || 0) - (before.RecalcStyleCount || 0),
      jsEventListenersEnd: after.JSEventListeners || null,
      nodesEnd: after.Nodes || null,
      jsHeapUsedSizeEnd: after.JSHeapUsedSize || null,
      profiler: profileSummary,
      longTaskProbe,
      beforeScriptDuration: before.ScriptDuration || 0,
      afterScriptDuration: after.ScriptDuration || 0,
      note: 'CDP Performance.getMetrics (same session) + optional Profiler sampling'
    };
  } catch (err) {
    return { error: String(err && err.message || err), durationMs };
  } finally {
    try { await client.detach(); } catch (_) {}
  }
}

async function measureSurface({ context, withExt, base, pathRel, name, playMs }) {
  const page = await context.newPage();
  const url = `${base}${pathRel}`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  try {
    await waitForVideo(page, 25000);
  } catch (_) {}
  if (withExt && name === 'examino') {
    try {
      await page.waitForFunction(() => !!document.getElementById('omt-root'), null, { timeout: 15000 });
    } catch (_) {}
  }
  if (withExt && name === 'inplayip') {
    try {
      await page.waitForFunction(() => !!document.getElementById('omt-root'), null, { timeout: 15000 });
    } catch (_) {}
  }
  if (withExt && name === 'local') {
    // local player is extension page — open via chrome-extension if possible
  }
  await ensurePlaying(page);
  // Set a kickoff so clock path runs (extension on)
  if (withExt) {
    await page.evaluate(() => {
      const btn = document.getElementById('omt-btn-set-kickoff');
      if (btn) btn.click();
    }).catch(() => {});
  }
  await page.waitForTimeout(800);
  const listenersAtStart = await page.evaluate(() => (window.__omtPerf && window.__omtPerf.listenerAdds) || 0);
  await resetProbe(page);

  // Primary CPU window: full playMs via CDP Performance.getMetrics
  const cpu = await metricsCpuWindow(page, playMs);

  const metrics = await sampleMetrics(page, `${name}:${withExt ? 'on' : 'off'}`);
  metrics.cpu = cpu;
  metrics.listenersAtStart = listenersAtStart;
  metrics.url = url;
  metrics.withExt = withExt;
  await page.close();
  return metrics;
}

async function measureLocal({ withExt, playMs }) {
  if (!withExt) {
    return {
      label: 'local:off',
      skipped: true,
      reason: 'local player is extension-only (player.html)'
    };
  }
  const userDataDir = fs.mkdtempSync(path.join('/tmp', 'omt-perf-local-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${EXT}`,
      `--load-extension=${EXT}`,
      '--disable-features=ExtensionDisableUnsupportedDeveloper',
      '--no-sandbox',
      '--disable-gpu'
    ],
    viewport: { width: 1100, height: 900 }
  });
  await context.addInitScript(INIT_PROBE);
  let extId = null;
  const extUrlRe = /chrome-extension:\/\/([a-p]{32})\//;
  for (const b of context.backgroundPages()) {
    const m = String(b.url()).match(extUrlRe);
    if (m) extId = m[1];
  }
  if (!extId) {
    for (const sw of context.serviceWorkers()) {
      const m = String(sw.url()).match(extUrlRe);
      if (m) extId = m[1];
    }
  }
  if (!extId) {
    try {
      const sw = await context.waitForEvent('serviceworker', { timeout: 8000 });
      const m = String(sw.url()).match(extUrlRe);
      if (m) extId = m[1];
    } catch (_) {}
  }
  if (!extId) {
    await context.close();
    return { label: 'local:on', error: 'no-extension-id' };
  }
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extId}/player.html`);
  await page.waitForTimeout(1000);
  // Load fixture video via file input if present
  const sample = path.join(FIXTURES, 'sample-match.mp4');
  const input = page.locator('#omt-local-file-input, input[type=file]').first();
  if (fs.existsSync(sample) && await input.count()) {
    await input.setInputFiles(sample);
    await page.waitForTimeout(1500);
  }
  await ensurePlaying(page);
  await page.evaluate(() => {
    document.getElementById('omt-btn-set-kickoff')?.click();
  }).catch(() => {});
  await page.waitForTimeout(500);
  const listenersAtStart = await page.evaluate(() => (window.__omtPerf && window.__omtPerf.listenerAdds) || 0);
  await resetProbe(page);
  const cpu = await metricsCpuWindow(page, playMs);
  const metrics = await sampleMetrics(page, 'local:on');
  metrics.cpu = cpu;
  metrics.listenersAtStart = listenersAtStart;
  metrics.withExt = true;
  await context.close();
  return metrics;
}

async function memorySeries({ base, pathRel, withExt, durationMs, name }) {
  if (durationMs <= 0) return { skipped: true };
  const context = await launch({ withExt });
  const page = await context.newPage();
  await page.goto(`${base}${pathRel}`, { waitUntil: 'domcontentloaded' });
  try { await waitForVideo(page, 25000); } catch (_) {}
  if (withExt) {
    try {
      await page.waitForFunction(() => !!document.getElementById('omt-root'), null, { timeout: 15000 });
    } catch (_) {}
    await page.evaluate(() => document.getElementById('omt-btn-set-kickoff')?.click()).catch(() => {});
  }
  await ensurePlaying(page);
  const samples = [];
  const start = Date.now();
  const step = 60_000;
  samples.push(await page.evaluate(() => ({
    tSec: 0,
    usedJSHeapBytes: performance.memory ? performance.memory.usedJSHeapSize : null
  })));
  while (Date.now() - start < durationMs) {
    const wait = Math.min(step, durationMs - (Date.now() - start));
    if (wait <= 0) break;
    await page.waitForTimeout(wait);
    // keep playing
    await ensurePlaying(page);
    const tSec = Math.round((Date.now() - start) / 1000);
    samples.push(await page.evaluate((t) => ({
      tSec: t,
      usedJSHeapBytes: performance.memory ? performance.memory.usedJSHeapSize : null
    }), tSec));
  }
  await context.close();
  return { name, withExt, durationMs, samples };
}

async function run() {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const { server, base } = await startServer();
  const report = {
    phase: PHASE,
    createdAt: new Date().toISOString(),
    playMs: PLAY_MS,
    memoryMs: MEMORY_MS,
    surfaces: {},
    memory: {}
  };

  try {
    for (const withExt of [false, true]) {
      const context = await launch({ withExt });
      try {
        report.surfaces[`examino_${withExt ? 'on' : 'off'}`] = await measureSurface({
          context, withExt, base, pathRel: '/examino-mock.html', name: 'examino', playMs: PLAY_MS
        });
        report.surfaces[`inplayip_${withExt ? 'on' : 'off'}`] = await measureSurface({
          context, withExt, base, pathRel: '/inplayip-mock.html', name: 'inplayip', playMs: PLAY_MS
        });
      } finally {
        await context.close();
      }
    }
    report.surfaces.local_on = await measureLocal({ withExt: true, playMs: PLAY_MS });
    report.surfaces.local_off = { label: 'local:off', skipped: true, reason: 'extension-only page' };

    if (MEMORY_MS > 0) {
      report.memory.inplayip_on = await memorySeries({
        base, pathRel: '/inplayip-mock.html', withExt: true, durationMs: MEMORY_MS, name: 'inplayip'
      });
      report.memory.inplayip_off = await memorySeries({
        base, pathRel: '/inplayip-mock.html', withExt: false, durationMs: MEMORY_MS, name: 'inplayip'
      });
    }
  } finally {
    server.close();
  }

  const out = path.join(ARTIFACTS, `perf-audit-${PHASE}.json`);
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ wrote: out, phase: PHASE, playMs: PLAY_MS, memoryMs: MEMORY_MS }, null, 2));
  console.log(JSON.stringify(report.surfaces, null, 2));
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
