# Square → Matt + Claude

Portal owns jobs/account. Integration chain: docs ↔ portal → Square → Matt + Claude.

```
Square Dashboard webhook
  POST /api/webhooks/square
    → verify HMAC
    → insert square_events (D1)
    → best-effort match jobs + reflect invoice/payment status
    → notify Matt (SMS/email if provider env is set; otherwise stub)
Claude / ADMIN
  GET /api/admin/events
  GET /api/admin/events/:id
```

Shop (`united-mobile-rv`) still creates draft Square orders/invoices via `_lib/square.js`. This repo does **not** call Square write APIs and does not change shop UI.

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

1. Apply migration `migrations/0008_square_events.sql` to D1 `umrt-portal-db` (binding `DB`).
2. [Square Developer Console](https://developer.squareup.com/apps) → your app → **Webhooks** → Add subscription.
3. **Notification URL** (no trailing slash):

   ```
   https://umrt-portal.pages.dev/api/webhooks/square
   ```

   Preview/staging: use the Pages preview origin + the same path. The URL in Square must equal `SQUARE_WEBHOOK_NOTIFICATION_URL` (or the request URL if that env is unset).
4. Event types: `booking.*`, `invoice.*`, `payment.*`, `refund.*`, `order.created`, `order.updated`.
5. Copy the subscription **signature key** into Cloudflare Pages → Environment variables:

   - `SQUARE_WEBHOOK_SIGNATURE_KEY`
   - `SQUARE_WEBHOOK_NOTIFICATION_URL` = the exact URL from step 3

   Do not invent a key. Sandbox and production subscriptions have different keys.

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
