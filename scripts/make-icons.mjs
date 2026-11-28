// Renders public/favicon.ico, public/favicon.png (32px) and public/og-image.png (1200x630)
// from the existing brand mark. Run: node scripts/make-icons.mjs
import sharp from 'sharp';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const pub = (p) => fileURLToPath(new URL(`../public/${p}`, import.meta.url));
const markSvg = await readFile(pub('brand/spokanewire-mark-square.svg'));

// favicon.png (32px)
const png32 = await sharp(markSvg, { density: 384 }).resize(32, 32).png().toBuffer();
await writeFile(pub('favicon.png'), png32);

// favicon.ico: single-image ICO wrapping the 32px PNG
const header = Buffer.alloc(22);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(1, 4); // image count
header[6] = 32; // width
header[7] = 32; // height
header.writeUInt16LE(1, 10); // planes
header.writeUInt16LE(32, 12); // bpp
header.writeUInt32LE(png32.length, 14);
header.writeUInt32LE(22, 18);
await writeFile(pub('favicon.ico'), Buffer.concat([header, png32]));

// og-image.png 1200x630
const mark = await sharp(markSvg, { density: 384 }).resize(200, 200).png().toBuffer();
const text = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
  <rect width="1200" height="630" fill="#0b0d12"/>
  <text x="300" y="330" fill="#f1f5f9" font-family="Helvetica, Arial, sans-serif" font-size="96" font-weight="800">Wire Local</text>
  <text x="304" y="410" fill="#94a3b8" font-family="Helvetica, Arial, sans-serif" font-size="48" font-weight="500">Your city, live.</text>
</svg>`);
await sharp(text).composite([{ input: mark, left: 70, top: 215 }]).png().toFile(pub('og-image.png'));
console.log('icons written');
