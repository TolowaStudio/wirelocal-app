#!/usr/bin/env node
// Layout check for the city sections: no horizontal page scroll and nothing
// spilling out of a city card, at each width, in headless Chrome.
//
//   npm run test:layout                 # the site as it is
//   npm run test:layout -- --fixture    # with a fifth city added to cities.ts
//   npm run test:layout -- 360 414      # only these widths
//
// Needs a Chrome or Chromium binary: set CHROME, or have google-chrome /
// chromium on PATH, or a Playwright browser in ~/.cache/ms-playwright.
// Fetches the Google Fonts the site uses with curl so text is measured in
// Inter and JetBrains Mono, not a fallback font; it warns if it cannot.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import path from 'node:path';
import { FIXTURE_LINE, buildSite } from './build-site.mjs';

const args = process.argv.slice(2);
const fixture = args.includes('--fixture');
const widths = args.filter((a) => /^\d+$/.test(a)).map(Number);
if (!widths.length) widths.push(320, 360, 414, 768, 1024, 1280);

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  for (const bin of ['google-chrome', 'chromium', 'chromium-browser']) {
    try {
      return execFileSync('which', [bin], { encoding: 'utf8' }).trim();
    } catch {}
  }
  const cache = path.join(homedir(), '.cache/ms-playwright');
  if (existsSync(cache)) {
    for (const dir of readdirSync(cache).sort().reverse()) {
      for (const rel of ['chrome-headless-shell-linux64/chrome-headless-shell', 'chrome-linux64/chrome', 'chrome-linux/chrome']) {
        if (existsSync(path.join(cache, dir, rel))) return path.join(cache, dir, rel);
      }
    }
  }
  return null;
}

// Swap the Google Fonts @import for a local copy so headless Chrome does not
// need network access (or proxy credentials) to load them.
function localizeFonts(dist) {
  const ua = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
  const cssFiles = readdirSync(path.join(dist, '_astro')).filter((f) => f.endsWith('.css'));
  const fontDir = path.join(dist, '__fonts');
  mkdirSync(fontDir, { recursive: true });
  let localized = false;
  for (const f of cssFiles) {
    const file = path.join(dist, '_astro', f);
    const css = readFileSync(file, 'utf8');
    const m = css.match(/https:\/\/fonts\.googleapis\.com\/css2\?[^)"']*/);
    if (!m) continue;
    let fontCss = execFileSync('curl', ['-fsS', '-A', ua, m[0]], { encoding: 'utf8' });
    for (const url of new Set(fontCss.match(/https:\/\/fonts\.gstatic\.com\/[^)]*/g) ?? [])) {
      const name = path.basename(url);
      execFileSync('curl', ['-fsS', url, '-o', path.join(fontDir, name)]);
      fontCss = fontCss.split(url).join(`/__fonts/${name}`);
    }
    writeFileSync(path.join(fontDir, 'fonts.css'), fontCss);
    writeFileSync(file, css.replace(m[0], '/__fonts/fonts.css'));
    localized = true;
  }
  return localized;
}

// Runs in the page; leaves its findings as JSON in <pre id="__layout">.
const probe = () => {
  const vw = document.documentElement.clientWidth;
  const label = (el) => `${el.className && typeof el.className === 'string' ? el.className.split(' ')[0] : el.tagName.toLowerCase()} "${(el.textContent || '').trim().slice(0, 30)}"`;
  const problems = [];
  if (document.documentElement.scrollWidth > vw) problems.push(`page scrolls sideways: scrollWidth ${document.documentElement.scrollWidth} > ${vw}`);
  for (const el of document.querySelectorAll('.stat-strip *, .cities *')) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.right > vw + 0.5) problems.push(`${label(el)} ends at ${Math.round(r.right)}px, past the ${vw}px viewport`);
  }
  for (const card of document.querySelectorAll('.city-card')) {
    const box = card.getBoundingClientRect();
    for (const el of card.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && (r.right > box.right + 0.5 || r.left < box.left - 0.5)) problems.push(`${label(el)} spills out of its city card`);
    }
  }
  const loadedFonts = [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family);
  const pre = document.createElement('pre');
  pre.id = '__layout';
  pre.textContent = JSON.stringify({
    vw,
    problems,
    columns: getComputedStyle(document.querySelector('.city-grid')).gridTemplateColumns.split(' ').length,
    cards: document.querySelectorAll('.city-card').length,
    fonts: [...new Set(loadedFonts)],
  });
  document.body.appendChild(pre);
};

function serve(dist) {
  const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
  const server = createServer((req, res) => {
    let file = path.join(dist, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(dist)) return res.writeHead(403).end();
    if (existsSync(file) && !path.extname(file)) file = path.join(file, 'index.html');
    if (!existsSync(file)) return res.writeHead(404).end();
    res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function dumpDom(chrome, url, width) {
  return new Promise((resolve, reject) => {
    const flags = ['--headless', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--no-proxy-server', `--window-size=${width},900`, '--virtual-time-budget=5000', '--dump-dom', url];
    const child = spawn(chrome, flags, { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('error', reject);
    child.on('close', () => resolve(out));
  });
}

const chrome = findChrome();
if (!chrome) {
  console.error('layout-check: no Chrome found. Set CHROME=/path/to/chrome.');
  process.exit(2);
}

const site = buildSite(fixture ? { cityLine: FIXTURE_LINE } : {});
let failed = false;
try {
  let fontsLocal = false;
  try {
    fontsLocal = localizeFonts(site.dist);
  } catch (err) {
    console.warn(`layout-check: WARNING could not fetch Google Fonts (${err.message.split('\n')[0]}); measuring with fallback fonts`);
  }
  const index = path.join(site.dist, 'index.html');
  writeFileSync(index, readFileSync(index, 'utf8').replace('</body>', `<script>addEventListener('load', () => setTimeout(${probe}, 300));</script></body>`));

  const server = await serve(site.dist);
  const url = `http://127.0.0.1:${server.address().port}/`;
  console.log(`layout-check: ${fixture ? 'with fixture fifth city' : 'site as-is'}; chrome ${chrome}`);
  for (const width of widths) {
    const dom = await dumpDom(chrome, url, width);
    const m = dom.match(/<pre id="__layout">([\s\S]*?)<\/pre>/);
    if (!m) {
      console.log(`  ${width}px  FAIL  page did not report (Chrome output ${dom.length} bytes)`);
      failed = true;
      continue;
    }
    const r = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
    const fontNote = fontsLocal && !r.fonts.includes('Inter') ? '  (WARNING: Inter did not load)' : '';
    console.log(`  ${width}px  ${r.problems.length ? 'FAIL' : 'ok  '}  ${r.cards} city cards in ${r.columns} column(s)${fontNote}`);
    for (const p of r.problems) console.log(`         - ${p}`);
    if (r.problems.length) failed = true;
  }
  server.close();
} finally {
  site.cleanup();
}
process.exit(failed ? 1 : 0);
