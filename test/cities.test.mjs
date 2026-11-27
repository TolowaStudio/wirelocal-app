// Run with `npm test` (Node 22.18+ so the .ts data file imports directly).
// CityRoster and StatStrip must both render exactly what src/data/cities.ts
// says, and adding a city must be a one-line change to that file.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { cities, siteHost, statusLabel } from '../src/data/cities.ts';
import { FIXTURE_LINE, buildSite, root } from './build-site.mjs';

const decode = (s) =>
  s
    .replace(/&rarr;/g, '→')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

/** Text of the first element with `className` inside `html`, or null. */
function textOf(html, className) {
  const m = html.match(new RegExp(`class="${className}"[^>]*>([\\s\\S]*?)</`));
  return m ? decode(m[1].replace(/<[^>]*>/g, '')) : null;
}

/** The city cards CityRoster rendered, in page order. */
function rosterCards(html) {
  const section = html.slice(html.indexOf('class="city-grid"'));
  return section
    .split(/(?=<div class="city-card )/)
    .slice(1)
    .map((card) => {
      const link = card.match(/<a class="city-link" href="([^"]*)"/);
      return {
        status: card.match(/^<div class="city-card city-card--(\w+)"/)?.[1],
        name: textOf(card, 'city-name'),
        state: textOf(card, 'city-state'),
        badge: card.match(/class="status-badge [^"]*"[^>]*>([\s\S]*?)<\/span>\s*<\/div>/)?.[1].replace(/<[^>]*>/g, '').trim(),
        tagline: textOf(card, 'city-tagline'),
        href: link ? decode(link[1]) : null,
        cta: textOf(card, 'city-cta'),
      };
    });
}

/** The entries StatStrip rendered, in page order. */
function stripStats(html) {
  const strip = html.slice(html.indexOf('class="stat-strip-inner"'));
  const inner = strip.slice(0, strip.indexOf('</div>'));
  return [...inner.matchAll(/class="stat"[^>]*>([^<]*)</g)].map((m) => decode(m[1]));
}

function expectedCard(city) {
  return {
    status: city.status,
    name: city.name,
    state: city.state,
    badge: statusLabel[city.status],
    tagline: city.tagline,
    href: city.href,
    cta: city.status === 'live' ? `Visit ${siteHost(city.href)} →` : null,
  };
}

const stripEntry = (city) => `${city.name} · ${statusLabel[city.status]}`;

describe('src/data/cities.ts', () => {
  test('every city is complete and well formed', () => {
    assert.ok(cities.length > 0);
    const names = cities.map((c) => c.name);
    assert.equal(new Set(names).size, names.length, `duplicate city name in ${names}`);
    for (const c of cities) {
      assert.ok(c.name.trim(), 'name is empty');
      assert.match(c.state, /^[A-Z]{2}$/, `${c.name}: state must be a two-letter code`);
      assert.ok(c.tagline.trim(), `${c.name}: tagline is empty`);
      assert.ok(c.status in statusLabel, `${c.name}: unknown status ${c.status}`);
      if (c.status === 'live') assert.ok(c.href, `${c.name}: a live city needs an href`);
      if (c.href) assert.equal(new URL(c.href).protocol, 'https:', `${c.name}: href must be https`);
    }
  });

  test('includes the four launch cities, Tri-Cities among them', () => {
    for (const name of ['Spokane', 'Boise', 'Tacoma', 'Tri-Cities']) {
      assert.ok(cities.some((c) => c.name === name), `${name} missing`);
    }
  });

  test('siteHost strips the scheme, www and path', () => {
    assert.equal(siteHost('https://spokanewire.com'), 'spokanewire.com');
    assert.equal(siteHost('https://www.boisewire.com/news?x=1'), 'boisewire.com');
  });
});

describe('components on the built home page', () => {
  let site;
  before(() => {
    site = buildSite();
  });
  after(() => site?.cleanup());

  test('CityRoster renders every city from the data file, in order', () => {
    assert.deepEqual(rosterCards(site.html), cities.map(expectedCard));
  });

  test('StatStrip lists every city from the data file, Tri-Cities included', () => {
    const stats = stripStats(site.html);
    assert.deepEqual(stats.slice(0, cities.length), cities.map(stripEntry));
    assert.ok(stats.includes('Tri-Cities · Coming soon'), `Tri-Cities missing from ${JSON.stringify(stats)}`);
    assert.deepEqual(stats.slice(cities.length), ['Community-powered', '24 / 7']);
  });

  test('no city text is hard-coded in either component', () => {
    for (const file of ['CityRoster.astro', 'StatStrip.astro']) {
      const source = readFileSync(path.join(root, 'src/components', file), 'utf8');
      for (const c of cities) {
        assert.ok(!source.includes(c.name), `${file} hard-codes ${c.name}`);
        if (c.href) assert.ok(!source.includes(siteHost(c.href)), `${file} hard-codes ${siteHost(c.href)}`);
      }
    }
  });

  test('the city grid auto-fits instead of fixing a column count', () => {
    const source = readFileSync(path.join(root, 'src/components/CityRoster.astro'), 'utf8');
    assert.match(source, /grid-template-columns:\s*repeat\(auto-fit,/);
    assert.doesNotMatch(source, /grid-template-columns:\s*repeat\(\d+,/);
  });
});

describe('adding a fifth city is one line in cities.ts', () => {
  let site;
  before(() => {
    site = buildSite({ cityLine: FIXTURE_LINE });
  });
  after(() => site?.cleanup());

  const fixture = {
    name: 'Coeur d’Alene',
    state: 'ID',
    status: 'live',
    href: 'https://www.cdawire.example/',
    tagline: 'Fixture city.',
  };

  test('CityRoster shows the fixture with a CTA derived from its href', () => {
    const cards = rosterCards(site.html);
    assert.deepEqual(cards, [...cities, fixture].map(expectedCard));
    assert.equal(cards.at(-1).cta, 'Visit cdawire.example →');
  });

  test('StatStrip shows the fixture', () => {
    const stats = stripStats(site.html);
    assert.deepEqual(stats.slice(0, cities.length + 1), [...cities, fixture].map(stripEntry));
    assert.ok(stats.includes('Coeur d’Alene · Live'));
  });
});
