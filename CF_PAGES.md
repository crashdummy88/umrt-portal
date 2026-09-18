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

## Square webhooks (Worker, not Pages)

Canonical ingest is Worker `umrt-square-events` on account `662952da5de37843cb132fd1e79a9cb7`. Staging URL Matt pastes into Square **Sandbox**:

```
https://umrt-square-events-staging.mattc2896.workers.dev/webhook
```

Do not enable a production Square subscription without Matt. Do not point production Square at `umrt-portal.pages.dev`. Schema + event list: `workers/umrt-square-events/README.md`.

Portal `/api/admin/events` is the later consumer. Book land stays `https://united-mobile-rv-llc.square.site/`.

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
