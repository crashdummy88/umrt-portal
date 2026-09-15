/**
 * Regression test for the P1 fix (2026-09-15): POST /api/vendors accepted
 * any string for `website` and stored it as-is; only esc() (HTML-entity
 * escaping) was applied at render time on /directory/, which does not
 * block a javascript:/data:/vbscript: scheme from executing when the
 * rendered link is clicked. Fixed with a real URL-parse-based scheme
 * check at the storage boundary (functions/_lib/url-safety.js) AND an
 * independent check at render time (directory/index.html).
 *
 * Run: node tests/security/vendor-url-validation.test.js
 */
import fs from 'node:fs';
import { test, run, assert } from '../lib/tiny-test.js';
import { sanitizeHttpUrl } from '../../functions/_lib/url-safety.js';
import { onRequestPost } from '../../functions/api/vendors/index.js';
import { signSessionId, randomToken } from '../../functions/_lib/auth.js';

const MALICIOUS_SCHEMES = [
  'javascript:alert(document.cookie)',
  'javascript:/*comment*/alert(1)',
  'JaVaScRiPt:alert(1)', // case variation
  'data:text/html,<script>alert(1)</script>',
  'vbscript:msgbox(1)',
  'file:///etc/passwd',
];

const VALID_URLS = ['https://example.com', 'http://my-shop.com/page?x=1', 'https://sub.domain.co/path#frag'];

// ---- Unit tests: the real server-side validator ----

test('sanitizeHttpUrl: rejects every malicious/executable scheme', () => {
  for (const bad of MALICIOUS_SCHEMES) {
    const result = sanitizeHttpUrl(bad);
    assert.equal(result.ok, false, `expected rejection for: ${bad}`);
    assert.equal(result.error, 'invalid_website');
  }
});

test('sanitizeHttpUrl: accepts real http/https URLs', () => {
  for (const good of VALID_URLS) {
    const result = sanitizeHttpUrl(good);
    assert.equal(result.ok, true, `expected acceptance for: ${good}`);
    assert.equal(typeof result.url, 'string');
  }
});

test('sanitizeHttpUrl: empty/missing website is allowed (optional field)', () => {
  assert.equal(sanitizeHttpUrl('').ok, true);
  assert.equal(sanitizeHttpUrl(undefined).ok, true);
  assert.equal(sanitizeHttpUrl(null).ok, true);
});

test('sanitizeHttpUrl: garbage/malformed strings are rejected, not silently passed through', () => {
  const result = sanitizeHttpUrl('not a url at all, just words');
  assert.equal(result.ok, false);
});

// ---- Unit test: the client-side render-time check, extracted from the
// actual shipped HTML so this catches a future edit that removes it ----

test('directory/index.html: isSafeHttpUrl (as actually shipped) rejects malicious schemes and accepts http(s)', () => {
  const html = fs.readFileSync(new URL('../../directory/index.html', import.meta.url), 'utf8');
  const match = html.match(/function isSafeHttpUrl\(s\)\{[\s\S]*?\n\s*\}/);
  assert.ok(match, 'isSafeHttpUrl() not found in directory/index.html -- was it removed or renamed?');
  // eslint-disable-next-line no-new-func -- evaluating the real shipped function body, not arbitrary input
  const isSafeHttpUrl = new Function(`return (${match[0]})`)();
  for (const bad of MALICIOUS_SCHEMES) {
    assert.equal(isSafeHttpUrl(bad), false, `expected rejection for: ${bad}`);
  }
  for (const good of VALID_URLS) {
    assert.equal(isSafeHttpUrl(good), true, `expected acceptance for: ${good}`);
  }
});

// ---- Integration test: the real POST /api/vendors handler end to end ----

function makeMockD1({ users, sessions, vendors }) {
  function prepare(sql) {
    let boundArgs = [];
    const stmt = {
      bind(...args) {
        boundArgs = args;
        return stmt;
      },
      async first() {
        if (/FROM sessions s JOIN users u/.test(sql)) {
          const session = sessions.find((s) => s.id === boundArgs[0]);
          if (!session) return undefined;
          const user = users.find((u) => u.id === session.user_id);
          return user ? { id: user.id, email: user.email, name: user.name, picture: user.picture, provider: user.provider, expires_at: session.expires_at } : undefined;
        }
        if (/SELECT id FROM vendors WHERE user_id = \?/.test(sql)) {
          const v = vendors.find((v) => v.user_id === boundArgs[0]);
          return v ? { id: v.id } : undefined;
        }
        throw new Error(`mock D1: unhandled .first(): ${sql}`);
      },
      async run() {
        if (/INSERT INTO vendors/.test(sql)) {
          vendors.push({ id: boundArgs[0], user_id: boundArgs[1], website: boundArgs[8] });
          return { success: true };
        }
        throw new Error(`mock D1: unhandled .run(): ${sql}`);
      },
    };
    return stmt;
  }
  return { prepare };
}

test('POST /api/vendors: a javascript: website is rejected with 400, never stored', async () => {
  const vendors = [];
  const rawId = await randomToken(24);
  const env = {
    SESSION_SECRET: 'test-secret',
    DB: makeMockD1({
      users: [{ id: 'u1', email: 'tech@example.com' }],
      sessions: [{ id: rawId, user_id: 'u1', expires_at: new Date(Date.now() + 86400000).toISOString() }],
      vendors,
    }),
  };
  const signed = await signSessionId(rawId, env.SESSION_SECRET);
  const headers = new Headers();
  headers.set('Cookie', `umrt_session=${signed}`);
  const request = {
    headers,
    async json() {
      return {
        businessName: 'Evil Corp',
        category: 'vendor',
        contactEmail: 'evil@example.com',
        website: 'javascript:alert(document.cookie)',
      };
    },
  };

  const res = await onRequestPost({ env, request });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, 'invalid_website');
  assert.equal(vendors.length, 0, 'malicious vendor row must never be inserted');
});

test('POST /api/vendors: a real https website is accepted and stored', async () => {
  const vendors = [];
  const rawId = await randomToken(24);
  const env = {
    SESSION_SECRET: 'test-secret',
    DB: makeMockD1({
      users: [{ id: 'u2', email: 'realtech@example.com' }],
      sessions: [{ id: rawId, user_id: 'u2', expires_at: new Date(Date.now() + 86400000).toISOString() }],
      vendors,
    }),
  };
  const signed = await signSessionId(rawId, env.SESSION_SECRET);
  const headers = new Headers();
  headers.set('Cookie', `umrt_session=${signed}`);
  const request = {
    headers,
    async json() {
      return {
        businessName: 'Real RV Techs',
        category: 'tech',
        contactEmail: 'realtech@example.com',
        website: 'https://real-rv-techs.example.com',
      };
    },
  };

  const res = await onRequestPost({ env, request });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(vendors.length, 1);
  assert.equal(vendors[0].website, 'https://real-rv-techs.example.com/');
});

await run();
