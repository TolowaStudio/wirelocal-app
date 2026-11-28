// Run with `npm test` (builds first, then reads dist/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { speakSamples } from '../src/data/speak-samples.ts';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const home = read('dist/index.html');
const section = home.match(/<section[^>]*id="everyone".*?<\/section>/s)?.[0] ?? '';
const underThirteen = /\b(kids?|child(ren)?|toddlers?|preschool\w*|all[ -]ages|any age|under[ -]?13)\b/i;

test('/ has the audience cards and the speak mode button', () => {
  for (const title of ['Teens 13+', 'Families', 'Adults']) assert.ok(section.includes(title), title);
  assert.match(section, /<button[^>]*type="button"[^>]*aria-pressed="false"/);
});

test('every sample ships in both tones, brainrot hidden by default', () => {
  assert.equal(section.match(/data-tone="standard"/g)?.length, speakSamples.length);
  assert.equal(section.match(/data-tone="brainrot" hidden/g)?.length, speakSamples.length);
  for (const s of speakSamples) {
    assert.ok(section.includes(s.standard), s.standard);
    assert.ok(section.includes(s.brainrot), s.brainrot);
  }
});

test('no under-13 wording on the landing page', () => {
  // visible text only: drop scripts, styles, then tags (class names are not wording)
  assert.doesNotMatch(home.replace(/<(script|style)\b.*?<\/\1>/gs, '').replace(/<[^>]*>/g, ' '), underThirteen);
});

test('samples stay on benign topics', () => {
  const unsafe = /\b(fires?|blaze|smoke|crash\w*|collision|wreck|crimes?|police|arrest\w*|shoot\w*|shot|theft|stolen|robbe\w*|assault|kill\w*|dead|death|injur\w*)\b/i;
  for (const s of speakSamples) {
    assert.ok(['Weather', 'Events', 'Sports'].includes(s.topic), s.topic);
    assert.doesNotMatch(`${s.standard} ${s.brainrot}`, unsafe);
  }
});

test("privacy policy children's section is unchanged", () => {
  assert.ok(read('src/pages/privacy.astro').includes(
    "<h2>Children's privacy</h2>\n        <p>Wire Local is not directed at children under 13. We do not knowingly collect personal information from children under 13.</p>",
  ));
});
