/**
 * Genera los iconos de la aplicación a partir de un SVG:
 *  - src-tauri/icons/32x32.png, 128x128.png, 128x128@2x.png, icon.png (512)
 *  - src-tauri/icons/icon.ico (PNGs embebidos) e icon.icns (PNGs embebidos)
 *  - public/favicon.svg
 *
 * Uso: node scripts/gen-icons.mjs   (requiere Playwright/Chromium disponible)
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const iconsDir = path.join(root, 'src-tauri', 'icons');
const publicDir = path.join(root, 'public');
fs.mkdirSync(iconsDir, { recursive: true });
fs.mkdirSync(publicDir, { recursive: true });

/** Vela: hoja de papel plegada + trazo de vela, en degradado sobrio. */
const svg = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2f6fe4"/>
      <stop offset="1" stop-color="#0b57d0"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#g)"/>
  <path d="M168 132h120l56 56v192a20 20 0 0 1-20 20H168a20 20 0 0 1-20-20V152a20 20 0 0 1 20-20z"
        fill="#ffffff" opacity="0.95"/>
  <path d="M288 132v56h56" fill="#cfe0ff" opacity="0.9"/>
  <path d="M256 236c22 14 34 34 34 56 0 22-14 40-34 52-20-12-34-30-34-52 0-22 12-42 34-56z"
        fill="#0b57d0"/>
  <rect x="240" y="336" width="32" height="34" rx="8" fill="#0b57d0"/>
</svg>`;

fs.writeFileSync(path.join(publicDir, 'favicon.svg'), svg(512));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 512, height: 512 } });

async function shot(size, file) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0">${svg(size).replace(/width="512" height="512"/, `width="${size}" height="${size}"`)}</body></html>`,
  );
  const buf = await page.screenshot({ omitBackground: true });
  fs.writeFileSync(file, buf);
  return buf;
}

const sizes = {
  '32x32.png': 32,
  '128x128.png': 128,
  '128x128@2x.png': 256,
  'icon.png': 512,
};
const buffers = {};
for (const [name, size] of Object.entries(sizes)) {
  buffers[name] = await shot(size, path.join(iconsDir, name));
}

/** ICO con entradas PNG (válido desde Windows Vista). */
function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  const dirEntries = [];
  let offset = 6 + entries.length * 16;
  for (const { size, data } of entries) {
    const dir = Buffer.alloc(16);
    dir.writeUInt8(size >= 256 ? 0 : size, 0);
    dir.writeUInt8(size >= 256 ? 0 : size, 1);
    dir.writeUInt8(0, 2);
    dir.writeUInt8(0, 3);
    dir.writeUInt16LE(1, 4);
    dir.writeUInt16LE(32, 6);
    dir.writeUInt32LE(data.length, 8);
    dir.writeUInt32LE(offset, 12);
    offset += data.length;
    dirEntries.push(dir);
  }
  return Buffer.concat([header, ...dirEntries, ...entries.map((e) => e.data)]);
}

fs.writeFileSync(
  path.join(iconsDir, 'icon.ico'),
  buildIco([
    { size: 32, data: buffers['32x32.png'] },
    { size: 128, data: buffers['128x128.png'] },
    { size: 256, data: buffers['128x128@2x.png'] },
  ]),
);

/** ICNS con entradas PNG (ic07/ic08/ic09/ic10). */
function buildIcns(entries) {
  const chunks = entries.map(({ type, data }) => {
    const head = Buffer.alloc(8);
    head.write(type, 0, 'ascii');
    head.writeUInt32BE(data.length + 8, 4);
    return Buffer.concat([head, data]);
  });
  const total = 8 + chunks.reduce((n, c) => n + c.length, 0);
  const header = Buffer.alloc(8);
  header.write('icns', 0, 'ascii');
  header.writeUInt32BE(total, 4);
  return Buffer.concat([header, ...chunks]);
}

fs.writeFileSync(
  path.join(iconsDir, 'icon.icns'),
  buildIcns([
    { type: 'ic07', data: buffers['128x128.png'] },
    { type: 'ic08', data: buffers['128x128@2x.png'] },
    { type: 'ic09', data: buffers['icon.png'] },
    { type: 'ic10', data: buffers['icon.png'] },
  ]),
);

await browser.close();
console.log('Iconos generados en', iconsDir);
