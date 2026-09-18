# Square → Matt + Claude

Portal owns jobs/account. Integration chain: docs ↔ portal → Square → Matt + Claude.

**Canonical webhook Worker:** `umrt-square-events` on account `662952da5de37843cb132fd1e79a9cb7` (`Mattc2896.workers.dev`). See [`workers/umrt-square-events/README.md`](workers/umrt-square-events/README.md) for the D1 schema and the exact Square Dashboard paste list.

```
Square Dashboard (staging / sandbox first — not production until Matt)
  POST https://umrt-square-events-staging.mattc2896.workers.dev/webhook
    → verify HMAC
    → insert square_events (Worker D1)
    → notify Matt (stub unless Twilio/Resend secrets)
Claude
  GET https://umrt-square-events-staging.mattc2896.workers.dev/events
Portal (later)
  consumes GET /events — /api/admin/events is the future portal reader
```

Shop (`united-mobile-rv`) still creates draft Square orders/invoices via `_lib/square.js`. This repo does **not** call Square write APIs, does **not** invent catalog IDs, and does **not** change Book land (`https://united-mobile-rv-llc.square.site/`).

Portal `/api/webhooks/square` remains as an optional later ingest; **do not** point a production Square subscription at Pages.

## Endpoints

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/webhooks/square` | none (health) |
| POST | `/api/webhooks/square` | `x-square-hmacsha256-signature` |
| GET | `/api/admin/events` | admin session **or** `Authorization: Bearer $CLAUDE_EVENTS_TOKEN` |
| GET | `/api/admin/events/:id` | same |

Query on the list: `?topic=invoice` `?type=payment.created` `?limit=50` `?full=1`.

UI: `/admin/` (existing owner dashboard) shows a Square events list under jobs. Dark/gold chrome unchanged.

## Configure Square Dashboard

**Paste this — Sandbox + staging Worker only. Do not enable production until Matt.**

Notification URL:

```
https://umrt-square-events-staging.mattc2896.workers.dev/webhook
```

Events:

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

Then `wrangler secret put SQUARE_WEBHOOK_SIGNATURE_KEY --env staging` and `SQUARE_WEBHOOK_NOTIFICATION_URL` (exact URL above). Do not invent a key.

Production Worker URL (do not subscribe yet): `https://umrt-square-events.mattc2896.workers.dev/webhook`.

## How Claude / ADMIN reads events

**Matt (browser):** sign in with an `ADMIN_EMAILS` account → `/admin/`.

**Claude / agents:**

```http
GET /api/admin/events?limit=50&full=1
Authorization: Bearer $CLAUDE_EVENTS_TOKEN
```

`CLAUDE_EVENTS_TOKEN` is optional. When unset, only an admin session works — there is no default token.

Response fields: `event_type`, `topic`, `summary`, `object_id`, `invoice_id`, `order_id`, `booking_id`, `payment_id`, `job_id`, `status`, `amount_cents`, `notify_status`, `payload` (when `full=1`).

## Notify Matt

Owner phone (already public): **(616) 606-5277** / `+16166065277`.

No SMS/email provider is configured on portal today. Notify is a stub unless these env names are all set:

| Channel | Required env names |
|---------|--------------------|
| SMS | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` |
| Email | `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `MATT_NOTIFY_EMAIL` |

Optional: `MATT_NOTIFY_PHONE` (defaults to `+16166065277`).

Unconfigured → `notify_status=stubbed`. The D1 row is still written.

## Sample payload (sanitized)

Square sends JSON like this. Do not use these IDs in production.

```json
{
  "merchant_id": "MERCHANT-SANITIZED",
  "type": "invoice.payment_made",
  "event_id": "evt-sanitized-0001",
  "created_at": "2026-09-18T12:00:00Z",
  "data": {
    "type": "invoice",
    "id": "inv:SANITIZED",
    "object": {
      "invoice": {
        "id": "inv:SANITIZED",
        "status": "PAID",
        "order_id": "order-SANITIZED",
        "location_id": "LOC-SANITIZED",
        "invoice_number": "000012",
        "primary_recipient": { "customer_id": "CUST-SANITIZED" },
        "payment_requests": [
          {
            "request_type": "BALANCE",
            "total_completed_amount_money": { "amount": 22500, "currency": "USD" }
          }
        ]
      }
    }
  }
}
```

## Test plan

Unit tests (no live Square, no secrets):

```bash
node tests/square/webhook.test.js
node tests/square/events-read.test.js
node tests/square/notify.test.js
```

Manual / staging:

1. `GET https://<origin>/api/webhooks/square` → `{ ok: true, path: "/api/webhooks/square" }`.
2. `POST` without `SQUARE_WEBHOOK_SIGNATURE_KEY` → `503 not_configured`.
3. `POST` with a wrong `x-square-hmacsha256-signature` → `401 invalid_signature`.
4. `POST` signed HMAC-SHA256 of `notificationUrl + rawBody` using a test key → `200` and a `square_events` row. `notify.status` is `stubbed` unless Twilio/Resend env is set.
5. Repeat the same `event_id` → `200 { duplicate: true }`.
6. `catalog.version.updated` (signed) → `200 { ignored: true }`.
7. Sign in as admin → `/admin/` lists the event. `GET /api/admin/events` as a non-admin → `401`.
8. Square Dashboard → Send test event against the staging URL.

HMAC construction (same as Square's WebhooksHelper): Base64(HMAC-SHA256(key, notificationUrl + rawBody)).
