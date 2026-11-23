/**
 * Capture pop-out concept mockups (docs only — no extension build).
 * Writes PNGs into this folder and /opt/cursor/artifacts/.
 */
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(__dirname, '../../../test/package.json'));
const { chromium } = require('playwright');
const ARTIFACTS = '/opt/cursor/artifacts';
const W = 1920;
const H = 1080;

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const file = path.join(__dirname, 'index.html');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, base: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

async function run() {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  fs.mkdirSync(__dirname, { recursive: true });
  const { server, base } = await startServer();
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(120);

  const stages = await page.$$eval('.stage', (els) =>
    els.map((el) => ({ id: el.id, out: el.getAttribute('data-out') }))
  );

  const written = [];
  for (const s of stages) {
    // Hide all stages, show one
    await page.evaluate((id) => {
      document.querySelectorAll('.stage').forEach((el) => {
        el.style.display = el.id === id ? 'block' : 'none';
      });
      // Reposition tooltip if present
      const btn = document.getElementById('pop-btn');
      const tip = document.getElementById('tip-popout');
      const stage = document.getElementById('s1b');
      if (btn && tip && stage && id === 's1b') {
        const r = btn.getBoundingClientRect();
        const sr = stage.getBoundingClientRect();
        tip.style.left = (r.left - sr.left + r.width / 2 - tip.offsetWidth / 2) + 'px';
        tip.style.top = (r.top - sr.top - tip.offsetHeight - 10) + 'px';
      }
    }, s.id);
    await page.waitForTimeout(80);
    const clip = await page.evaluate((id) => {
      const el = document.getElementById(id);
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    }, s.id);
    const name = 'omt_popout_mockup_' + s.out;
    const destDocs = path.join(__dirname, name);
    const destArt = path.join(ARTIFACTS, name);
    await page.screenshot({ path: destDocs, clip, type: 'png' });
    fs.copyFileSync(destDocs, destArt);
    written.push(destDocs);
    console.log('[ok]', name);
  }

  fs.writeFileSync(
    path.join(__dirname, 'INDEX.txt'),
    written.map((p, i) => `${i + 1}. ${path.basename(p)}`).join('\n') + '\n'
  );
  await browser.close();
  server.close();
  console.log('[done]', written.length);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
