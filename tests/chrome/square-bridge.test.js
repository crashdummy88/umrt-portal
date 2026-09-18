/**
 * Portal → Square jobs/estimates bridge (wire-only).
 *
 * Booking land is Square. /book/ explains deposit-after-confirm.
 * Track shows honest stored status + Book / open-invoice paths.
 * No invented payment URLs, no pages.dev in customer chrome,
 * no fake live Square sync copy on customer pages.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assert, test, run } from '../lib/tiny-test.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const BOOK = 'https://united-mobile-rv-llc.square.site/';
const HUB = 'https://unitedmobilerv.com/';
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

test('book hub explains Square handoff and deposit-after-confirm', () => {
  const html = read('book/index.html');
  assert.match(html, /Booking continues on Square/);
  assert.match(html, /Deposits are collected then/);
  assert.match(html, /there is no public pay link on this portal/);
  assert.match(html, new RegExp(BOOK.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(html.includes('square.link'), false);
  assert.equal(html.includes('return_url'), false);
});

test('home + account Book service cards go to /book/; convert Book stays Square', () => {
  for (const page of ['index.html', 'account/index.html']) {
    const html = read(page);
    assert.match(html, /class="portal-card" href="\/book\/"/, `${page} Book service hub`);
    assert.match(html, /href="https:\/\/united-mobile-rv-llc\.square\.site\/"/, `${page} Square dest`);
  }
});

test('home lede does not advertise a public invoice pay path', () => {
  const html = read('index.html');
  assert.doesNotMatch(html, /pay an invoice/i);
  assert.match(html, /Deposits are collected after we confirm/);
});

test('track empty + signed-out copy is Square, not a WP form', () => {
  const html = read('track/index.html');
  assert.match(html, /Book on Square/);
  assert.match(html, /deposits are collected after confirmation/i);
  assert.doesNotMatch(html, /submitted the form/);
  assert.match(html, /<a class="btn" href="https:\/\/united-mobile-rv-llc\.square\.site\/">Book<\/a>/);
  assert.match(html, /Open invoice/);
  assert.match(html, /isSafeInvoiceUrl/);
});

test('track job cards always include a Square Book path', () => {
  const html = read('track/index.html');
  assert.match(
    html,
    /<a class="btn" href="https:\/\/united-mobile-rv-llc\.square\.site\/" target="_blank" rel="noopener">Book<\/a>/,
  );
  assert.doesNotMatch(html, /live sync|synced with Square|real-time Square/i);
});

test('customer pages: no pages.dev, no square.link, convert lock dests present', () => {
  for (const page of CUSTOMER_PAGES) {
    const html = read(page);
    assert.equal(html.includes('pages.dev'), false, `${page} leaked pages.dev`);
    assert.equal(html.includes('square.link'), false, `${page} leaked square.link`);
    assert.ok(html.includes(BOOK), `${page} missing Square book`);
    assert.ok(html.includes(HUB), `${page} missing Main Hub`);
    assert.ok(html.includes(FORUM), `${page} missing Forum`);
  }
});

test('admin shows stored Square invoice fields and webhook stub for Matt', () => {
  const html = read('admin/index.html');
  assert.match(html, /umrt-square-events/);
  assert.match(html, /does not poll Square/);
  assert.match(html, /square_invoice_status/);
  assert.match(html, /open in Square/);
  assert.doesNotMatch(html, /Synced with Square|live Square status/i);
});

test('jobs API does not expose a fake sync flag', () => {
  const src = read('functions/api/jobs/mine.js');
  assert.match(src, /shapeCustomerJob/);
  assert.doesNotMatch(src, /synced:\s*true|live_sync:\s*true/);
});

test('portal chrome has no Field Guides / WP /guide/ button', () => {
  for (const page of CUSTOMER_PAGES) {
    const html = read(page);
    const bar = html.match(/<div class="umrt-platform-bar"[\s\S]*?<\/div>\s*<\/div>/);
    const header = html.match(/<header[\s>][\s\S]*?<\/header>/);
    const footer = html.match(/<footer[\s>][\s\S]*?<\/footer>/);
    const mobile = html.match(/<div class="mobile-bar"[\s\S]*?<\/div>/);
    for (const [name, block] of [
      ['platform bar', bar && bar[0]],
      ['header', header && header[0]],
      ['footer', footer && footer[0]],
      ['mobile bar', mobile && mobile[0]],
    ]) {
      assert.ok(block, `${page} missing ${name}`);
      assert.doesNotMatch(block, /unitedmobilerv\.com\/guide\//, `${page} ${name} has WP /guide/`);
      assert.doesNotMatch(block, /href="\/guide\/"/, `${page} ${name} has relative /guide/`);
      assert.doesNotMatch(block, />Field Guides</, `${page} ${name} has Field Guides`);
      assert.doesNotMatch(block, />Guides</, `${page} ${name} has Guides`);
    }
  }
});

await run();
