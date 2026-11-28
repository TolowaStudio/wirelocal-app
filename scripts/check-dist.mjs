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

for (const page of ['privacy', 'terms']) {
  const srcPath = `src/pages/${page}.astro`;
  const distPath = `dist/${page}/index.html`;
  const src = readFileSync(srcPath, 'utf8');
  const html = existsSync(distPath) ? readFileSync(distPath, 'utf8') : '';
  if (src.includes('May 17, 2025') || html.includes('May 17, 2025'))
    fail.push(`${srcPath}: still contains "May 17, 2025"`);
  const hasLastUpdatedLabel = /Last updated:\s*\S+/.test(src);
  const hasNonEmptyVar = /const\s+lastUpdated\s*=\s*['"][^'"]+['"]/.test(src);
  if (!hasLastUpdatedLabel || (src.includes('{lastUpdated}') && !hasNonEmptyVar))
    fail.push(`${srcPath}: missing "Last updated" value`);
  if (!/Last updated:\s*[^<\s][^<]*/.test(html))
    fail.push(`${distPath}: missing rendered "Last updated" value`);
}

const privacySrc = readFileSync('src/pages/privacy.astro', 'utf8');
const privacyHtml = existsSync('dist/privacy/index.html') ? readFileSync('dist/privacy/index.html', 'utf8') : '';
for (const [label, content] of [
  ['src/pages/privacy.astro', privacySrc],
  ['dist/privacy/index.html', privacyHtml],
]) {
  if (!/Google Fonts,\s*a third party/i.test(content))
    fail.push(`${label}: missing Google Fonts third-party disclosure`);
  if (!/<h2[^>]*>Children's privacy<\/h2>/.test(content))
    fail.push(`${label}: missing Children's privacy heading`);
  if (!content.includes('Wire Local is not directed at children under 13.'))
    fail.push(`${label}: missing "under 13" children's sentence`);
}

if (fail.length) { console.error(fail.join('\n')); process.exit(1); }
console.log('dist checks passed');
