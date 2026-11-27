// Post-build checks for TS-4425. Run: npm test (builds first).
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const fail = [];
for (const f of ['favicon.ico', 'favicon.png', 'og-image.png', 'sitemap-index.xml'])
  if (!existsSync(`dist/${f}`)) fail.push(`dist/${f} missing`);

const index = existsSync('dist/sitemap-index.xml') ? readFileSync('dist/sitemap-index.xml', 'utf8') : '';
const child = existsSync('dist/sitemap-0.xml') ? readFileSync('dist/sitemap-0.xml', 'utf8') : '';
if (!index.includes('sitemap-0.xml')) fail.push('sitemap-index.xml does not list sitemap-0.xml');
for (const p of ['https://wirelocal.app/', 'https://wirelocal.app/privacy/', 'https://wirelocal.app/terms/'])
  if (!child.includes(`<loc>${p}</loc>`)) fail.push(`sitemap missing ${p}`);

const walk = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
for (const f of walk('src')) {
  const t = readFileSync(f, 'utf8');
  if (/href="#"/.test(t)) fail.push(`${f}: href="#"`);
  if (/cloudflare/i.test(t)) fail.push(`${f}: mentions Cloudflare`);
}
if (fail.length) { console.error(fail.join('\n')); process.exit(1); }
console.log('dist checks passed');
