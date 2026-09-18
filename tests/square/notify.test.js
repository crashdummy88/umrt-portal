/**
 * Matt notify hook: stub unless Twilio/Resend env names are set.
 * Run: node tests/square/notify.test.js
 */
import { test, run, assert } from '../lib/tiny-test.js';
import {
  DEFAULT_OWNER_PHONE_E164,
  DEFAULT_OWNER_PHONE_DISPLAY,
  formatNotifyBody,
  notifyConfigured,
  notifyMatt,
  notifyPhone,
  resendConfigured,
  twilioConfigured,
} from '../../functions/_lib/notify-matt.js';

const structured = {
  eventType: 'invoice.payment_made',
  summary: 'invoice.payment_made · inv:SANITIZED · paid · USD 225.00',
};

test('default owner phone is the public Text Now number', () => {
  assert.equal(DEFAULT_OWNER_PHONE_E164, '+16166065277');
  assert.equal(DEFAULT_OWNER_PHONE_DISPLAY, '(616) 606-5277');
  assert.equal(notifyPhone({}), '+16166065277');
  assert.equal(notifyPhone({ MATT_NOTIFY_PHONE: '+15551212' }), '+15551212');
});

test('notifyConfigured is false when provider env is missing', () => {
  assert.equal(notifyConfigured({}), false);
  assert.equal(twilioConfigured({ TWILIO_ACCOUNT_SID: 'ACxxxx' }), false);
  assert.equal(resendConfigured({ RESEND_API_KEY: 're_x' }), false);
});

test('notifyMatt stubs and does not call providers without env', async () => {
  const result = await notifyMatt({}, { structured, eventId: 'evt-1' });
  assert.equal(result.attempted, false);
  assert.equal(result.status, 'stubbed');
  assert.equal(result.reason, 'notify_not_configured');
  assert.equal(result.destinationPhone, '+16166065277');
});

test('formatNotifyBody includes summary and owner phone', () => {
  const body = formatNotifyBody(structured, { eventId: 'evt-1', readUrl: 'https://umrt-portal.pages.dev/api/admin/events' });
  assert.match(body, /invoice.payment_made/);
  assert.match(body, /616\) 606-5277/);
  assert.match(body, /api\/admin\/events/);
});

test('twilioConfigured requires all three names', () => {
  assert.equal(
    twilioConfigured({
      TWILIO_ACCOUNT_SID: 'ACxxxx',
      TWILIO_AUTH_TOKEN: 'token',
      TWILIO_FROM_NUMBER: '+15550001111',
    }),
    true
  );
});

test('notifyMatt SMS path uses Twilio when configured (mocked fetch)', async () => {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response('{"sid":"SM-SANITIZED"}', { status: 201 });
  };
  try {
    const result = await notifyMatt(
      {
        TWILIO_ACCOUNT_SID: 'ACxxxx',
        TWILIO_AUTH_TOKEN: 'token',
        TWILIO_FROM_NUMBER: '+15550001111',
      },
      { structured, eventId: 'evt-1' }
    );
    assert.equal(result.attempted, true);
    assert.equal(result.status, 'sent');
    assert.equal(result.channel, 'sms');
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /api\.twilio\.com/);
    assert.match(calls[0].init.body, /16166065277/);
  } finally {
    globalThis.fetch = original;
  }
});

await run();
