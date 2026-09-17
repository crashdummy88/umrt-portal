/**
 * Empty Directory / Community must not sit on primary convert paths.
 * Community door = https://forum.unitedmobilerv.com/
 * Directory = off nav + noindex + honest "not live yet" (no fake listings).
 *
 * Convert lock is unchanged (see convert-cta.test.js). Pay deposit cards
 * are owned by a separate PR and are not asserted here.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assert, test, run } from '../lib/tiny-test.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const FORUM = 'https://forum.unitedmobilerv.com/';

const CUSTOMER_PAGES = [
  'index.html',
  'account/index.html',
  'book/index.html',
  'track/index.html',
  'community/index.html',
  'directory/index.html',
  'directory/apply.html',
];

function read(rel) {
  return readFileSync(join(root, rel), 'utf8');
}

function primaryNav(html) {
  const start = html.search(/<nav[^>]*aria-label="Portal navigation"/);
  assert.ok(start >= 0, 'missing portal navigation');
  const from = html.slice(start);
  const end = from.search(/<\/nav>/);
  assert.ok(end > 0, 'missing </nav>');
  return from.slice(0, end);
}

function hrefs(block) {
  return [...block.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
}

for (const page of CUSTOMER_PAGES) {
  test(`${page}: primary nav has no Directory or /community/ stub`, () => {
    const nav = primaryNav(read(page));
    const dests = hrefs(nav);
    assert.ok(!dests.includes('/directory/'), `${page} nav still links /directory/`);
    assert.ok(!dests.includes('/directory/apply.html'), `${page} nav still links apply`);
    assert.ok(!dests.includes('/community/'), `${page} nav still links /community/`);
    assert.ok(!dests.some((h) => /directory/i.test(h)), `${page} nav still has a directory href`);
    assert.ok(dests.includes(FORUM), `${page} nav must keep Forum as the community door`);
    assert.ok(!/>Directory</.test(nav), `${page} nav still labels Directory`);
    assert.ok(!/>Community</.test(nav), `${page} nav still labels Community`);
  });
}

test('admin nav drops Directory (not a customer convert path, still not a live product)', () => {
  const html = read('admin/index.html');
  const start = html.search(/<nav[^>]*aria-label="Portal navigation"/);
  const nav = html.slice(start, start + html.slice(start).search(/<\/nav>/));
  assert.ok(!/\/directory\//.test(nav));
  assert.ok(!/>Directory</.test(nav));
});

test('home portal-grid Community/Forum card goes to the live forum', () => {
  const html = read('index.html');
  const gridStart = html.search(/<div class="portal-grid">/);
  const grid = html.slice(gridStart, html.indexOf('</div>', gridStart + 1) > 0 ? html.search(/<div class="portal-help/) : html.length);
  assert.match(grid, /href="https:\/\/forum\.unitedmobilerv\.com\/"/);
  assert.ok(!/href="\/community\/"/.test(grid), 'home grid must not send Community to the stub');
  assert.ok(!/href="\/directory\//.test(grid), 'home grid must not advertise Directory');
});

test('account cards send Community/Forum to the live forum, not /community/', () => {
  const html = read('account/index.html');
  assert.match(html, /class="portal-card" href="https:\/\/forum\.unitedmobilerv\.com\/"/);
  assert.ok(!/href="\/community\/"/.test(html), 'account must not link the community stub');
  assert.ok(!/href="\/directory\//.test(html), 'account must not advertise Directory');
});

test('directory pages are noindex + honest not-live, no fake listing UI', () => {
  for (const page of ['directory/index.html', 'directory/apply.html']) {
    const html = read(page);
    assert.match(html, /<meta name="robots" content="noindex,follow">/);
    assert.match(html, /not live yet/i);
    assert.ok(!/\/api\/vendors/.test(html), `${page} still calls /api/vendors`);
    assert.ok(!/\$40/.test(html), `${page} still advertises $40 membership`);
    assert.ok(!/id="apply-form"/.test(html), `${page} still ships a live apply form`);
    assert.ok(!/id="tab-all"/.test(html), `${page} still ships listing tabs`);
  }
});

test('/community/ redirects (and fallback page) go to the live forum', () => {
  const redirects = read('_redirects');
  assert.match(redirects, /\/community\/\s+https:\/\/forum\.unitedmobilerv\.com\/\s+302/);
  const html = read('community/index.html');
  assert.match(html, /<meta name="robots" content="noindex,follow">/);
  assert.match(html, /http-equiv="refresh"[^>]+url=https:\/\/forum\.unitedmobilerv\.com\//);
  assert.match(html, /href="https:\/\/forum\.unitedmobilerv\.com\/"/);
  assert.ok(!/href="\/community\/"/.test(html), 'community fallback must not self-link as a product');
});

test('convert dests stay on the lock (sanity — do not retarget Book)', () => {
  const html = read('index.html');
  assert.match(html, /href="tel:\+16166065277"/);
  assert.match(html, /href="sms:\+16166065277"/);
  assert.match(html, /href="https:\/\/united-mobile-rv-llc\.square\.site\/"/);
});

await run();
