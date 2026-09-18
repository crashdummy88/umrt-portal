# Cloudflare Pages — umrt-portal

Connect Git `crashdummy88/umrt-portal` → Framework None · Build empty · Output `/`.
Tip: `https://umrt-portal.pages.dev`
No WP domain attach (HOLD — pages.dev only). Keep `robots.txt` Disallow + meta `noindex,follow`.

## D1

1. Create a D1 database (Dashboard or `wrangler d1 create umrt-portal`).
2. Bind it to this Pages project as **`DB`** (Settings → Functions → D1 bindings).
3. Apply migrations in order (`0001_init.sql` … `0008_square_events.sql`) via the Dashboard SQL editor or `wrangler d1 execute umrt-portal-db --file=migrations/<file>.sql`.

## Environment variables (Pages → Settings → Environment variables)

Set these **names** (production + preview as needed). Never commit values.

| Name | Required | Notes |
|------|----------|-------|
| `GOOGLE_CLIENT_ID` | yes | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | yes | Google OAuth client secret |
| `SESSION_SECRET` | yes | Long random string for HMAC session ids |
| `FACEBOOK_APP_ID` | no | If missing, Facebook routes return 503 JSON |
| `FACEBOOK_APP_SECRET` | no | Pair with APP_ID |
| `SQUARE_WEBHOOK_SIGNATURE_KEY` | for live webhooks | Square Dashboard → Webhooks → subscription signature key. Never invent. |
| `SQUARE_WEBHOOK_NOTIFICATION_URL` | recommended | Exact URL configured in Square (no trailing slash). Example: `https://umrt-portal.pages.dev/api/webhooks/square` |
| `CLAUDE_EVENTS_TOKEN` | no | Bearer token for `GET /api/admin/events`. Unset = admin session only. |
| `MATT_NOTIFY_PHONE` | no | Default destination `+16166065277` if unset |
| `MATT_NOTIFY_EMAIL` | no | Required for Resend email notify |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER` | no | All three required to send SMS |
| `RESEND_API_KEY` / `RESEND_FROM_EMAIL` | no | Plus `MATT_NOTIFY_EMAIL` to send email |

Without Twilio/Resend, notify is **stubbed** (`notify_status=stubbed`). The event is still stored.

## Square webhooks

1. Apply `migrations/0008_square_events.sql` to the D1 bound as `DB`.
2. Square Developer Console → Webhooks → Add subscription.
3. Notification URL: `https://umrt-portal.pages.dev/api/webhooks/square` (or the custom portal host once attached). Must match `SQUARE_WEBHOOK_NOTIFICATION_URL`.
4. Subscribe to booking, invoice, payment, refund, and order events.
5. Copy the subscription **signature key** into Pages secret `SQUARE_WEBHOOK_SIGNATURE_KEY`.
6. Send a test event from the Dashboard; confirm a row on `/admin/` and `GET /api/admin/events`.

Claude/ADMIN read: signed-in admin session, or `Authorization: Bearer $CLAUDE_EVENTS_TOKEN`.

See `SQUARE_EVENTS.md` for the sample payload and test plan.

## Google OAuth redirect URI

```
https://umrt-portal.pages.dev/api/auth/callback/google
```

Scopes: `openid email profile`.
Auth URL: `https://accounts.google.com/o/oauth2/v2/auth`
Token: `https://oauth2.googleapis.com/token`
Userinfo: `https://openidconnect.googleapis.com/v1/userinfo`

Cookie: `umrt_session` — HttpOnly, Secure, SameSite=Lax.

## Sibling tips

- Pay: `umrt-pay.pages.dev`
- Community: `umrt-community.pages.dev` (linked from `/community/`)
