/**
 * Header + mobile convert stack must match Matt's 2026-09-16 lock:
 *   Call (616) 606-5277 → tel:+16166065277
 *   Text Now (gold)     → sms:+16166065277
 *   Book                → https://united-mobile-rv-llc.square.site/
 *
 * OAuth start hrefs on /account/ must stay untouched.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assert, test, run } from '../lib/tiny-test.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

const CUSTOMER_PAGES = [
  'index.html',
  'account/index.html',
  'book/index.html',
  'track/index.html',
  'community/index.html',
  'directory/index.html',
  'directory/apply.html',
];

const CALL = 'tel:+16166065277';
const TEXT = 'sms:+16166065277';
const BOOK = 'https://united-mobile-rv-llc.square.site/';

function read(rel) {
  return readFileSync(join(root, rel), 'utf8');
}

function section(html, startRe, endRe) {
  const start = html.search(startRe);
  assert.ok(start >= 0, `missing start ${startRe}`);
  const from = html.slice(start);
  const end = from.search(endRe);
  assert.ok(end > 0, `missing end ${endRe}`);
  return from.slice(0, end);
}

function hrefs(block) {
  return [...block.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
}

function goldTextNow(block) {
  return /<a class="btn btn-gold" href="sms:\+16166065277">Text Now<\/a>/.test(block);
}

for (const page of CUSTOMER_PAGES) {
  test(`${page}: header + mobile convert stack matches canon`, () => {
    const html = read(page);
    const header = section(html, /<header[\s>]/, /<\/header>/);
    const cta = section(header, /<div class="nav-cta"/, /<\/div>/);
    const mobile = section(html, /<div class="mobile-bar"/, /<\/div>/);

    const ctaHrefs = hrefs(cta);
    const mobileHrefs = hrefs(mobile);

    assert.deepEqual(ctaHrefs, [CALL, TEXT, BOOK], `${page} header dests`);
    assert.deepEqual(mobileHrefs, [CALL, TEXT, BOOK], `${page} mobile dests`);
    assert.ok(goldTextNow(cta), `${page} header Text Now must be gold`);
    assert.ok(goldTextNow(mobile), `${page} mobile Text Now must be gold`);
    assert.match(cta, />Call \(616\) 606-5277</);
    assert.match(mobile, />Call \(616\) 606-5277</);
    assert.match(cta, />Book</);
    assert.match(mobile, />Book</);
  });
}

test('account OAuth start hrefs are unchanged', () => {
  const html = read('account/index.html');
  assert.match(html, /class="btn btn-google btn-oauth" href="\/api\/auth\/google\/start"/);
  assert.match(html, /class="btn btn-facebook btn-oauth" href="\/api\/auth\/facebook\/start"/);
});

test('OAuth CSS classes still win over gold', () => {
  const css = read('assets/styles.css');
  assert.match(css, /\.btn-gold\{background:var\(--gold\)/);
  assert.match(css, /\.btn-google\{background:#fff/);
  assert.match(css, /\.btn-facebook\{background:var\(--fb\)/);
  assert.match(css, /\.btn-oauth\{text-align:center;width:100%\}/);
  const goldAt = css.indexOf('.btn-gold{');
  const googleAt = css.indexOf('.btn-google{');
  assert.ok(goldAt >= 0 && googleAt > goldAt, '.btn-google must follow .btn-gold so OAuth colors stay white');
});

await run();
