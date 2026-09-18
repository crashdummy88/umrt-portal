# umrt-square-events

Standalone Cloudflare Worker: **Square webhook → D1 structured log → Matt notify stub + Claude read**.

| | |
|--|--|
| Worker name | `umrt-square-events` |
| Account | `662952da5de37843cb132fd1e79a9cb7` |
| workers.dev | `https://umrt-square-events.mattc2896.workers.dev` |
| Staging worker | `umrt-square-events-staging` → `https://umrt-square-events-staging.mattc2896.workers.dev` |

Reuses the `united-mobile-rv/workers/square-inventory-cron` pattern: own `wrangler.toml`, `wrangler secret put`, no-op until secrets exist, not a Pages Function.

**Staging / PR first.** Do not enable a **production** Square webhook subscription until Matt says so. Use Square **Sandbox** against the staging Worker.

Book land is unchanged: [united-mobile-rv-llc.square.site](https://united-mobile-rv-llc.square.site/). This Worker never invents Square catalog IDs and never calls Square write APIs.

Portal (`umrt-portal`) **consumes this log later** (`GET /events`). It is not the Square Dashboard subscription target.

```
Square (sandbox / later prod)
  POST https://umrt-square-events[-staging].mattc2896.workers.dev/webhook
    → verify x-square-hmacsha256-signature
    → INSERT square_events (D1)
    → notify Matt (stub unless Twilio/Resend secrets)
Claude
  GET /events?full=1
  Authorization: Bearer $CLAUDE_EVENTS_TOKEN
Portal (later)
  same GET /events, or a future D1/service binding
```

## Matt: paste into Square Developer Dashboard

Use **Sandbox** + the **staging** URL until Matt enables production.

**Webhook notification URL** (no trailing slash):

```
https://umrt-square-events-staging.mattc2896.workers.dev/webhook
```

Production URL (do **not** subscribe yet):

```
https://umrt-square-events.mattc2896.workers.dev/webhook
```

**Events to subscribe** (copy this list):

```
booking.created
booking.updated
invoice.created
invoice.published
invoice.updated
invoice.deleted
invoice.canceled
invoice.scheduled
invoice.payment_made
invoice.refunded
invoice.scheduled_charge_failed
payment.created
payment.updated
refund.created
refund.updated
order.created
order.updated
```

Do **not** subscribe `catalog.*` — this Worker does not touch catalog IDs.

After creating the subscription, put the Dashboard **signature key** into the Worker (never invent one):

```bash
cd workers/umrt-square-events
wrangler secret put SQUARE_WEBHOOK_SIGNATURE_KEY --env staging
wrangler secret put SQUARE_WEBHOOK_NOTIFICATION_URL --env staging
# value must equal the notification URL above, exactly
```

## Secrets (`wrangler secret put`)

Names only. Never commit values.

| Secret | Required | Purpose |
|--------|----------|---------|
| `SQUARE_WEBHOOK_SIGNATURE_KEY` | yes (live webhooks) | Square subscription signature key |
| `SQUARE_WEBHOOK_NOTIFICATION_URL` | recommended | Exact Dashboard URL |
| `CLAUDE_EVENTS_TOKEN` | for Claude/portal read | Bearer token for `GET /events` |
| `MATT_NOTIFY_PHONE` | no | Default destination `+16166065277` |
| `MATT_NOTIFY_EMAIL` | for email | With Resend |
| `TWILIO_ACCOUNT_SID` | for SMS | With token + from |
| `TWILIO_AUTH_TOKEN` | for SMS | |
| `TWILIO_FROM_NUMBER` | for SMS | |
| `RESEND_API_KEY` | for email | |
| `RESEND_FROM_EMAIL` | for email | |

Owner phone (docs / default SMS destination, already public): **(616) 606-5277**.

Without Twilio/Resend, `notify_status=stubbed`. The D1 row is still written.

## D1 log schema (`square_events`)

Claude-readable. Same shape portal will consume later.

| Column | Type | Notes |
|--------|------|--------|
| `id` | TEXT PK | Worker UUID |
| `square_event_id` | TEXT UNIQUE | Square `event_id` (idempotency) |
| `event_type` | TEXT | e.g. `invoice.payment_made` |
| `topic` | TEXT | `booking` \| `invoice` \| `payment` \| `refund` \| `order` \| `other` |
| `merchant_id` | TEXT | Square merchant |
| `object_id` | TEXT | Primary object id |
| `object_type` | TEXT | `invoice` / `payment` / … |
| `status` | TEXT | lowercased Square status |
| `amount_cents` | INTEGER | nullable |
| `currency` | TEXT | e.g. `USD` |
| `customer_id` | TEXT | Square customer if present |
| `customer_email` | TEXT | if present |
| `invoice_id` | TEXT | |
| `order_id` | TEXT | |
| `booking_id` | TEXT | |
| `payment_id` | TEXT | |
| `job_id` | TEXT | reserved for portal match later |
| `summary` | TEXT | one-line Claude/Matt blurb |
| `payload_json` | TEXT | `{ extracted, raw }` sanitized/capped |
| `notify_status` | TEXT | `pending` \| `sent` \| `stubbed` \| `skipped` \| `failed` |
| `notify_channel` | TEXT | `sms` \| `email` \| `sms+email` \| `none` |
| `notify_error` | TEXT | |
| `received_at` | TEXT | Worker clock |
| `square_created_at` | TEXT | Square `created_at` |

Migration: `migrations/0001_square_events.sql`.

```bash
wrangler d1 create umrt-square-events-staging
wrangler d1 execute umrt-square-events-staging --file=migrations/0001_square_events.sql --env staging
# paste the new database_id into wrangler.toml [env.staging]
```

## Claude / portal read

```http
GET /events?limit=50&full=1
Authorization: Bearer $CLAUDE_EVENTS_TOKEN
```

`GET /events/:id` for one row. Token unset → `401` (no default token).

## Deploy (staging only until Matt)

```bash
cd workers/umrt-square-events
wrangler deploy --env staging
# not production:
# wrangler deploy
```

## Tests

```bash
node workers/umrt-square-events/tests/worker.test.js
```
