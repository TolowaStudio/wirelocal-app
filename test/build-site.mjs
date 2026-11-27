// Builds the site in a throwaway copy of the repo so tests can edit
// src/data/cities.ts (the fixture city) without touching the working tree.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const root = path.resolve(import.meta.dirname, '..');

// A fifth city, written the way a person would add one: a single new line.
// It is live with a www href, so it also proves the CTA is derived from href.
export const FIXTURE_LINE =
  "  { name: 'Coeur d’Alene', state: 'ID', status: 'live', href: 'https://www.cdawire.example/', tagline: 'Fixture city.' },";

/** Returns cities.ts with `line` added as the last entry of the cities array. */
export function addCityLine(source, line) {
  const start = source.indexOf('export const cities');
  const close = source.indexOf('\n];', start);
  if (start === -1 || close === -1) throw new Error('cities array not found in src/data/cities.ts');
  return source.slice(0, close + 1) + line + '\n' + source.slice(close + 1);
}

/**
 * Builds a copy of the site. With `cityLine`, that line is added to
 * src/data/cities.ts first and nothing else is edited.
 * Returns { dir, dist, html, cleanup }.
 */
export function buildSite({ cityLine } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'wirelocal-build-'));
  for (const entry of ['src', 'public', 'astro.config.mjs', 'package.json', 'tsconfig.json']) {
    cpSync(path.join(root, entry), path.join(dir, entry), { recursive: true });
  }
  symlinkSync(path.join(root, 'node_modules'), path.join(dir, 'node_modules'), 'dir');

  if (cityLine) {
    const file = path.join(dir, 'src/data/cities.ts');
    const before = readFileSync(file, 'utf8');
    const after = addCityLine(before, cityLine);
    if (after.split('\n').length !== before.split('\n').length + 1) throw new Error('fixture edit was not exactly one line');
    writeFileSync(file, after);
  }

  execFileSync(path.join(root, 'node_modules/.bin/astro'), ['build'], { cwd: dir, stdio: 'pipe' });
  const dist = path.join(dir, 'dist');
  return {
    dir,
    dist,
    html: readFileSync(path.join(dist, 'index.html'), 'utf8'),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
