/**
 * Money-fast honesty: empty Directory/Community stubs must not sit on
 * primary customer paths. Community door is the live Forum.
 *
 *   Community → https://forum.unitedmobilerv.com/
 *   Directory → off primary nav + noindex + not-live copy
 *   Leftover /community/ → 301 to Forum
 *
 * Independent of the dead Pay-deposit card work. Convert lock is
 * covered by convert-cta.test.js.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assert, test, run } from '../lib/tiny-test.js';
import { onRequest } from '../../functions/_middleware.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

const PRIMARY = [
  'index.html',
  'account/index.html',
  'book/index.html',
  'track/index.html',
];

const CUSTOMER_HTML = [
  ...PRIMARY,
  'community/index.html',
  'directory/index.html',
  'directory/apply.html',
];

const FORUM = 'https://forum.unitedmobilerv.com/';
const HUB = 'https://unitedmobilerv.com/';
const BOOK = 'https://united-mobile-rv-llc.square.site/';
const CALL = 'tel:+16166065277';
const TEXT = 'sms:+16166065277';

function read(rel) {
  return readFileSync(join(root, rel), 'utf8');
}

function headerNav(html) {
  const start = html.search(/<nav[^>]*>/);
  assert.ok(start >= 0, 'missing <nav>');
  const from = html.slice(start);
  const end = from.search(/<\/nav>/);
  assert.ok(end > 0, 'missing </nav>');
  return from.slice(0, end);
}

function hrefs(block) {
  return [...block.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
}

for (const page of PRIMARY) {
  test(`${page}: Directory is off primary header nav`, () => {
    const nav = headerNav(read(page));
    assert.ok(!hrefs(nav).includes('/directory/'), `${page} nav still links /directory/`);
    assert.ok(!/>Directory</.test(nav), `${page} nav still labels Directory`);
  });

  test(`${page}: Community door is the Forum, not /community/`, () => {
    const html = read(page);
    const nav = headerNav(html);
    assert.ok(hrefs(nav).includes(FORUM), `${page} nav missing Forum dest`);
    assert.match(nav, />Community</);
    assert.ok(!hrefs(nav).includes('/community/'), `${page} nav still links /community/`);
    assert.ok(!html.includes('href="/community/"'), `${page} still has a /community/ href`);
  });
}

test('home portal-grid Community card goes to the Forum', () => {
  const html = read('index.html');
  assert.match(html, /class="portal-card" href="https:\/\/forum\.unitedmobilerv\.com\/"/);
  assert.ok(!html.includes('class="portal-card" href="/community/"'));
  assert.ok(!html.includes('class="portal-card" href="/directory/"'));
});

test('account Community card goes to the Forum', () => {
  const html = read('account/index.html');
  assert.match(html, /class="portal-card" href="https:\/\/forum\.unitedmobilerv\.com\/"/);
  assert.ok(!html.includes('class="portal-card" href="/community/"'));
  assert.ok(!html.includes('class="portal-card" href="/directory/"'));
});

test('directory listing is noindex with not-live copy', () => {
  const html = read('directory/index.html');
  assert.match(html, /<meta name="robots" content="noindex,follow">/);
  assert.match(html, /Not live/i);
  assert.match(html, /no public/i);
});

test('directory apply is noindex and says the directory is not live', () => {
  const html = read('directory/apply.html');
  assert.match(html, /<meta name="robots" content="noindex,follow">/);
  assert.match(html, /not live/i);
});

test('community fallback page noindexes and points at the Forum', () => {
  const html = read('community/index.html');
  assert.match(html, /<meta name="robots" content="noindex,follow">/);
  assert.match(html, /url=https:\/\/forum\.unitedmobilerv\.com\//);
  assert.match(html, /href="https:\/\/forum\.unitedmobilerv\.com\/"/);
  assert.ok(!html.includes('href="/community/"'));
});

test('_redirects sends leftover /community/ to the Forum', () => {
  const text = read('_redirects');
  assert.match(text, /\/community\s+https:\/\/forum\.unitedmobilerv\.com\/\s+301/);
  assert.match(text, /\/community\/\s+https:\/\/forum\.unitedmobilerv\.com\/\s+301/);
});

test('middleware 301s /community/ to the Forum before auth work', async () => {
  const context = {
    request: new Request('https://portal.unitedmobilerv.com/community/'),
    env: {},
    async next() { throw new Error('community stub must not fall through'); },
  };
  const res = await onRequest(context);
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('Location'), FORUM);
});

test('middleware 301s /community (no slash) to the Forum', async () => {
  const context = {
    request: new Request('https://portal.unitedmobilerv.com/community'),
    env: {},
    async next() { throw new Error('community stub must not fall through'); },
  };
  const res = await onRequest(context);
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('Location'), FORUM);
});

test('customer HTML hrefs stay off pages.dev; hub/book/call/text stay locked', () => {
  for (const page of CUSTOMER_HTML) {
    const html = read(page);
    const all = hrefs(html);
    assert.ok(!all.some((h) => h.includes('pages.dev')), `${page} has a pages.dev href`);
    assert.ok(all.includes(HUB), `${page} missing Main Hub`);
    assert.ok(all.includes(BOOK), `${page} missing Square Book`);
    assert.ok(all.includes(CALL), `${page} missing tel Call`);
    assert.ok(all.includes(TEXT), `${page} missing sms Text Now`);
    assert.ok(all.includes(FORUM), `${page} missing Forum`);
  }
});

await run();
