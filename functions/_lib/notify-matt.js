/**
 * Notify Matt about a Square event (SMS and/or email).
 *
 * No SMS/email provider is configured on this project today (portal only
 * uses public `sms:+16166065277` links). This module is the hook:
 *   - if Twilio + destination are set, send SMS
 *   - if Resend + destination are set, send email
 *   - otherwise return { attempted: false, status: 'stubbed' }
 *
 * Env var NAMES only — never invent or commit credentials.
 *
 *   MATT_NOTIFY_PHONE     destination E.164 (default +16166065277)
 *   MATT_NOTIFY_EMAIL     destination email (no default)
 *   TWILIO_ACCOUNT_SID
 *   TWILIO_AUTH_TOKEN
 *   TWILIO_FROM_NUMBER
 *   RESEND_API_KEY
 *   RESEND_FROM_EMAIL
 *
 * Owner phone (docs / default destination, already public on the site):
 *   (616) 606-5277 · sms:+16166065277
 */

export const DEFAULT_OWNER_PHONE_E164 = '+16166065277';
export const DEFAULT_OWNER_PHONE_DISPLAY = '(616) 606-5277';

export function notifyPhone(env) {
  return String((env && env.MATT_NOTIFY_PHONE) || DEFAULT_OWNER_PHONE_E164).trim();
}

export function twilioConfigured(env) {
  return !!(env && env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM_NUMBER);
}

export function resendConfigured(env) {
  return !!(env && env.RESEND_API_KEY && env.RESEND_FROM_EMAIL && env.MATT_NOTIFY_EMAIL);
}

export function notifyConfigured(env) {
  return twilioConfigured(env) || resendConfigured(env);
}

export function formatNotifyBody(structured, extras = {}) {
  const lines = [
    `UMRT Square: ${structured.summary}`,
    extras.eventId ? `event ${extras.eventId}` : null,
    extras.readUrl ? `Read: ${extras.readUrl}` : null,
    `Owner: ${DEFAULT_OWNER_PHONE_DISPLAY}`,
  ].filter(Boolean);
  return lines.join('\n');
}

async function sendTwilioSms(env, body) {
  const sid = env.TWILIO_ACCOUNT_SID;
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`;
  const params = new URLSearchParams();
  params.set('To', notifyPhone(env));
  params.set('From', env.TWILIO_FROM_NUMBER);
  params.set('Body', body.slice(0, 1500));
  const token = btoa(`${sid}:${env.TWILIO_AUTH_TOKEN}`);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`twilio_${res.status}:${text.slice(0, 180)}`);
  }
  return 'sms';
}

async function sendResendEmail(env, { subject, body }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.RESEND_FROM_EMAIL,
      to: [env.MATT_NOTIFY_EMAIL],
      subject: subject.slice(0, 200),
      text: body.slice(0, 8000),
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`resend_${res.status}:${text.slice(0, 180)}`);
  }
  return 'email';
}

/**
 * Best-effort notify. Never throws. Safe no-op until provider env is set.
 */
export async function notifyMatt(env, { structured, eventId, readUrl }) {
  const subject = `UMRT Square: ${(structured && structured.eventType) || 'event'}`;
  const body = formatNotifyBody(structured || { summary: 'square event' }, { eventId, readUrl });

  if (!notifyConfigured(env)) {
    return {
      attempted: false,
      status: 'stubbed',
      channel: 'none',
      reason: 'notify_not_configured',
      destinationPhone: notifyPhone(env),
    };
  }

  const channels = [];
  const errors = [];

  if (twilioConfigured(env)) {
    try {
      channels.push(await sendTwilioSms(env, body));
    } catch (err) {
      errors.push(String(err && err.message || err));
    }
  }

  if (resendConfigured(env)) {
    try {
      channels.push(await sendResendEmail(env, { subject, body }));
    } catch (err) {
      errors.push(String(err && err.message || err));
    }
  }

  if (channels.length) {
    return {
      attempted: true,
      status: 'sent',
      channel: channels.join('+'),
      error: errors.length ? errors.join('; ') : null,
    };
  }

  return {
    attempted: true,
    status: 'failed',
    channel: 'none',
    error: errors.join('; ') || 'notify_failed',
  };
}
