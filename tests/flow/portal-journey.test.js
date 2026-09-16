/**
 * Customer-journey regressions for the Custos portal flow:
 *   land → sign in → account → book → track → directory/community
 *
 * Confirmed against live umrt-portal.pages.dev (2026-09-16) before this
 * change: Google start 302s; Facebook start 503 JSON; Pay card hits a
 * 404 square.link; Track/Apply treat any /api/auth/me user as signed in
 * (including ssoOnly); OAuth errors are dropped; Book grid CTAs leave
 * the portal for Square while /book/ exists.
 *
 * Header/mobile convert lock (Call / Text Now / Book→Square) is covered
 * by tests/chrome/convert-cta.test.js — this file must not fight that.
 *
 * Run: node tests/flow/portal-journey.test.js
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assert, test, run } from '../lib/tiny-test.js';
import { safeNextPath, authProviders, nextCookie, NEXT_COOKIE } from '../../functions/_lib/auth.js';
import { onRequestGet as googleStart } from '../../functions/api/auth/google/start.js';
import { onRequestGet as facebookStart } from '../../functions/api/auth/facebook/start.js';
import { onRequestGet as meHandler } from '../../functions/api/auth/me.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

function read(rel) {
  return readFileSync(join(root, rel), 'utf8');
}

function cookies(res) {
  return typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [...res.headers.entries()].filter(([k]) => k.toLowerCase() === 'set-cookie').map(([, v]) => v);
}

// --- safeNextPath -----------------------------------------------------------

test('safeNextPath: allow-listed portal paths pass', () => {
  assert.equal(safeNextPath('/track/'), '/track/');
  assert.equal(safeNextPath('/book/'), '/book/');
  assert.equal(safeNextPath('/directory/apply.html'), '/directory/apply.html');
  assert.equal(safeNextPath('/community/'), '/community/');
});

test('safeNextPath: open-redirect shapes fail closed', () => {
  assert.equal(safeNextPath('https://evil.example/'), '');
  assert.equal(safeNextPath('//evil.example/'), '');
  assert.equal(safeNextPath('/\\evil'), '');
  assert.equal(safeNextPath('/admin/'), '');
  assert.equal(safeNextPath('/track/?x=1'), '/track/');
  assert.equal(safeNextPath(''), '');
  assert.equal(safeNextPath(null), '');
});

// --- /api/auth/me advertises providers even when signed out ---------------

test('GET /api/auth/me 401 includes providers.facebook=false when Facebook env is missing', async () => {
  const res = await meHandler({ env: { GOOGLE_CLIENT_ID: 'gid' }, request: { headers: new Headers() } });
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.providers.google, true);
  assert.equal(body.providers.facebook, false);
});

test('authProviders: facebook only true when both id and secret are set', () => {
  assert.deepEqual(authProviders({ FACEBOOK_APP_ID: 'x' }), { google: false, facebook: false });
  assert.deepEqual(authProviders({ FACEBOOK_APP_ID: 'x', FACEBOOK_APP_SECRET: 'y' }), { google: false, facebook: true });
});

// --- OAuth start -----------------------------------------------------------

test('GET /api/auth/facebook/start: unconfigured → 302 /account/?error=facebook (not raw 503 JSON)', async () => {
  const res = await facebookStart({
    env: {},
    request: { url: 'https://umrt-portal.pages.dev/api/auth/facebook/start', headers: new Headers() },
  });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('Location'), 'https://umrt-portal.pages.dev/account/?error=facebook');
});

test('GET /api/auth/google/start: ?next=/track/ sets umrt_oauth_next cookie', async () => {
  const res = await googleStart({
    env: { GOOGLE_CLIENT_ID: 'test-client-id' },
    request: { url: 'https://umrt-portal.pages.dev/api/auth/google/start?next=/track/', headers: new Headers() },
  });
  assert.equal(res.status, 302);
  const set = cookies(res);
  assert.ok(set.some((c) => c.startsWith(`${NEXT_COOKIE}=${encodeURIComponent('/track/')}`)), `missing next cookie: ${JSON.stringify(set)}`);
  assert.ok(set.some((c) => c.startsWith('umrt_oauth_state=')), 'state cookie still required');
});

test('GET /api/auth/google/start: rejected next is cleared, not stored', async () => {
  const res = await googleStart({
    env: { GOOGLE_CLIENT_ID: 'test-client-id' },
    request: { url: 'https://umrt-portal.pages.dev/api/auth/google/start?next=https://evil.example/', headers: new Headers() },
  });
  assert.equal(res.status, 302);
  const set = cookies(res);
  const next = set.find((c) => c.startsWith(`${NEXT_COOKIE}=`));
  assert.ok(next && next.includes('Max-Age=0'), `expected cleared next cookie, got ${next}`);
});

test('nextCookie helper matches the state-cookie shape (HttpOnly, Lax, 10 min)', () => {
  const c = nextCookie('/track/');
  assert.match(c, /^umrt_oauth_next=/);
  assert.match(c, /HttpOnly/);
  assert.match(c, /SameSite=Lax/);
  assert.match(c, /Max-Age=600/);
});

// --- HTML journey ----------------------------------------------------------

test('home Book service card stays in-portal (/book/), convert Book stays Square', () => {
  const html = read('index.html');
  assert.match(html, /class="portal-card" href="\/book\/"/);
  assert.match(html, /<strong>Book service<\/strong>/);
  assert.equal(html.includes('square.link/u/STB7z2B6'), false, 'dead Pay square.link must not ship');
  assert.match(html, /href="https:\/\/united-mobile-rv-llc\.square\.site\/"/);
});

test('account page still ships exact OAuth start hrefs (convert-cta lock) and shows errors / next', () => {
  const html = read('account/index.html');
  assert.match(html, /class="btn btn-google btn-oauth" href="\/api\/auth\/google\/start"/);
  assert.match(html, /class="btn btn-facebook btn-oauth" href="\/api\/auth\/facebook\/start"/);
  assert.match(html, /id="auth-error"/);
  assert.match(html, /if\s*\(\s*data\s*&&\s*data\.user\s*&&\s*!data\.user\.ssoOnly\s*\)/);
  assert.equal(html.includes('square.link/u/STB7z2B6'), false);
});

test('track requires a real session (excludes ssoOnly) and returns via /account/?next=/track/', () => {
  const html = read('track/index.html');
  assert.match(html, /!meData\.user\.ssoOnly|meData\.user\.ssoOnly/);
  assert.match(html, /href="\/account\/\?next=\/track\/"/);
  assert.match(html, /if\s*\(\s*!meData\s*\|\|\s*!meData\.user\s*\|\|\s*meData\.user\.ssoOnly\s*\)/);
});

test('directory apply uses next= and excludes ssoOnly', () => {
  const html = read('directory/apply.html');
  assert.match(html, /href="\/account\/\?next=\/directory\/apply\.html"/);
  assert.match(html, /data\.user\.ssoOnly/);
});

test('directory stays noindex; book explains Square then track', () => {
  const dir = read('directory/index.html');
  assert.match(dir, /name="robots" content="noindex,follow"/);
  const book = read('book/index.html');
  assert.match(book, /id="deposit"/);
  assert.match(book, /href="\/account\/\?next=\/track\/"/);
  assert.match(book, /united-mobile-rv-llc\.square\.site/);
});

test('community points at the live forum, not umrt-community.pages.dev', () => {
  const html = read('community/index.html');
  assert.match(html, /https:\/\/forum\.unitedmobilerv\.com\//);
  assert.equal(html.includes('umrt-community.pages.dev'), false);
});

await run();
