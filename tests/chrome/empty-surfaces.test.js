/**
 * Empty portal surfaces must stay honest:
 *   /community/  — one-tap Forum + Main Hub, no fake feed
 *   /directory/  — coming-online status + Book / Forum / Shop / Main Hub
 *                  when there is no vendor data. No invented listings.
 *
 * Convert lock stays the existing chrome test.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assert, test, run } from '../lib/tiny-test.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

const FORUM = 'https://forum.unitedmobilerv.com/';
const HUB = 'https://unitedmobilerv.com/';
const BOOK = 'https://united-mobile-rv-llc.square.site/';
const SHOP = 'https://shop.unitedmobilerv.com/';
const CALL = 'tel:+16166065277';
const TEXT = 'sms:+16166065277';

function read(rel) {
  return readFileSync(join(root, rel), 'utf8');
}

function hrefs(html) {
  return [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
}

const community = read('community/index.html');
const directory = read('directory/index.html');

test('community: primary Forum CTA is a one-tap button', () => {
  assert.match(community, /<a class="btn" href="https:\/\/forum\.unitedmobilerv\.com\/">Open the Forum<\/a>/);
});

test('community: Main Hub CTA is present and correct', () => {
  assert.match(community, /<a class="btn btn-ghost" href="https:\/\/unitedmobilerv\.com\/">Main Hub<\/a>/);
  assert.ok(hrefs(community).includes(HUB));
});

test('community: no fake community UI', () => {
  assert.doesNotMatch(community, /latest posts|member count|online now|join the discussion|recent threads/i);
  assert.match(community, /not a community feed/);
  assert.doesNotMatch(community, /<form/);
  assert.doesNotMatch(community, /<article|role="feed"/);
});

test('community: convert dests stay locked', () => {
  assert.ok(community.includes(CALL));
  assert.ok(community.includes(TEXT));
  assert.ok(community.includes(BOOK));
  assert.match(community, /<a class="btn btn-gold" href="sms:\+16166065277">Text Now<\/a>/);
});

test('directory: honest coming-online status is the default shell', () => {
  assert.match(directory, /id="coming-online"/);
  assert.match(directory, /Coming online/);
  assert.match(directory, /No vendors listed yet/);
  assert.match(directory, /id="listings" hidden/);
});

test('directory: empty state CTAs are Book + Forum + Shop + Main Hub', () => {
  const coming = directory.slice(
    directory.indexOf('id="coming-online"'),
    directory.indexOf('id="listings"'),
  );
  const dests = hrefs(coming);
  assert.ok(dests.includes(BOOK), 'Book Square');
  assert.ok(dests.includes(FORUM), 'Forum');
  assert.ok(dests.includes(SHOP), 'Shop');
  assert.ok(dests.includes(HUB), 'Main Hub');
});

test('directory: does not invent vendor listings in markup', () => {
  const staticMain = directory.slice(directory.indexOf('<main>'), directory.indexOf('<script>'));
  assert.doesNotMatch(staticMain, /"Acme"|Placeholder vendor|sample vendor|Example Tech/i);
  assert.doesNotMatch(staticMain, /<div class="vendor-card">/);
  assert.match(directory, /not inventing placeholder/);
  assert.match(directory, /data\.vendors \|\| \[\]/);
});

test('directory: filter tabs stay behind listings, not the empty shell', () => {
  const coming = directory.slice(0, directory.indexOf('id="listings"'));
  assert.doesNotMatch(coming, /id="tab-all"/);
  assert.match(directory, /id="listings" hidden/);
});

test('directory: convert dests stay locked', () => {
  assert.ok(directory.includes(CALL));
  assert.ok(directory.includes(TEXT));
  assert.ok(directory.includes(BOOK));
  assert.match(directory, /<a class="btn btn-gold" href="sms:\+16166065277">Text Now<\/a>/);
});

test('directory: noindex while the surface is a stub-or-empty door', () => {
  assert.match(directory, /content="noindex,follow"/);
});

await run();
