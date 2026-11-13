#!/usr/bin/env node
/**
 * Regenerate toolbar / store icons (v2: slash + 20:08 Box badge).
 *
 * Inputs:
 *   design/icon-exploration/slash_source.png  — SP slash artwork
 * Outputs (overwrite):
 *   assets/icon-{16,32,48,128}.png
 *
 * Also mirrors copies into design/icon-exploration/v2_clock_badge/ for comparison.
 *
 * Requires: npm install sharp (devDependency) OR system: node with sharp available.
 * Header chip in the popup is CSS (popup.css .omt-header-clock), not generated here —
 * keep left: -6px aligned with the 128px badge placement.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

let sharp;
try {
  sharp = require('sharp');
} catch {
  console.error('[icons] Missing sharp. From Overlay-chrome-extension/: npm install --no-save sharp');
  process.exit(1);
}

const BG = { r: 17, g: 17, b: 17, alpha: 1 };
const SIZES = [16, 32, 48, 128];

/** Pixel badge geometry tuned so 128 matches popup CSS left:-6px feel. */
function badgeSvg(size) {
  // Approximate: badge slightly left of slash, Box style, mono digits
  const pad = Math.max(1, Math.round(size * 0.04));
  const bw = Math.max(10, Math.round(size * 0.42));
  const bh = Math.max(6, Math.round(size * 0.18));
  const bx = Math.max(0, Math.round(size * 0.06) - Math.round(size * 0.05)); // pull left
  const by = Math.max(1, Math.round(size * 0.06));
  const fontSize = Math.max(5, Math.round(bh * 0.72));
  const radius = Math.max(1, Math.round(size * 0.02));
  return Buffer.from(`<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="${radius}" ry="${radius}"
        fill="rgba(0,0,0,0.72)" stroke="rgba(255,255,255,0.14)" stroke-width="1"/>
  <text x="${bx + bw / 2}" y="${by + bh / 2 + fontSize * 0.35}"
        text-anchor="middle" font-family="ui-monospace, Menlo, Consolas, monospace"
        font-size="${fontSize}" font-weight="650" fill="#f3f3f3">20:08</text>
</svg>`);
}

async function renderSize(size, slashPath, outPath) {
  const slashPad = Math.round(size * 0.14);
  const slashSize = size - slashPad * 2;
  const slash = await sharp(slashPath)
    .resize(slashSize, slashSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  const base = await sharp({
    create: { width: size, height: size, channels: 4, background: BG }
  })
    .composite([
      { input: slash, left: slashPad, top: slashPad },
      { input: await sharp(badgeSvg(size)).png().toBuffer(), left: 0, top: 0 }
    ])
    .png()
    .toBuffer();

  await sharp(base).png().toFile(outPath);
  console.log('[icons] wrote', path.relative(root, outPath));
}

async function main() {
  const slashPath = path.join(root, 'design/icon-exploration/slash_source.png');
  if (!fs.existsSync(slashPath)) {
    console.error('Missing', slashPath);
    process.exit(1);
  }
  const v2Dir = path.join(root, 'design/icon-exploration/v2_clock_badge');
  fs.mkdirSync(v2Dir, { recursive: true });
  for (const size of SIZES) {
    const name = `icon-${size}.png`;
    const assetsOut = path.join(root, 'assets', name);
    await renderSize(size, slashPath, assetsOut);
    fs.copyFileSync(assetsOut, path.join(v2Dir, name));
  }
  console.log('[icons] Header chip: edit Overlay-chrome-extension/popup.css (.omt-header-clock), not this script.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
