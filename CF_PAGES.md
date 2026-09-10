# Cloudflare Pages — umrt-portal

Connect Git `crashdummy88/umrt-portal` → Framework None · Build empty · Output `/`.
Tip: `https://umrt-portal.pages.dev`
No WP domain attach (HOLD — pages.dev only). Keep `robots.txt` Disallow + meta `noindex,follow`.

## D1

1. Create a D1 database (Dashboard or `wrangler d1 create umrt-portal`).
2. Bind it to this Pages project as **`DB`** (Settings → Functions → D1 bindings).
3. Apply migration `migrations/0001_init.sql` (Dashboard SQL editor, or `wrangler d1 execute umrt-portal --file=migrations/0001_init.sql`).

## Environment variables (Pages → Settings → Environment variables)

Set these **names** (production + preview as needed). Never commit values.

| Name | Required | Notes |
|------|----------|-------|
| `GOOGLE_CLIENT_ID` | yes | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | yes | Google OAuth client secret |
| `SESSION_SECRET` | yes | Long random string for HMAC session ids |
| `FACEBOOK_APP_ID` | no | If missing, Facebook routes return 503 JSON |
| `FACEBOOK_APP_SECRET` | no | Pair with APP_ID |

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
