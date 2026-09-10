# Cloudflare Pages — umrt-portal

Connect Git `crashdummy88/umrt-portal` → **output `/`** · **no build command** (static + Pages Functions).

**Tip URL:** `https://umrt-portal.pages.dev`  
**Domain:** HOLD (do not attach custom domain yet).  
Keep `robots.txt` Disallow + `noindex` on pages.

## Google OAuth redirect URI (exact)

```
https://umrt-portal.pages.dev/api/auth/callback/google
```

Add the same URI in Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client (Web).

## Environment variables (Pages → Settings → Environment variables)

Set for **Production** (and Preview if you test previews):

| Name | Required | Notes |
|------|----------|--------|
| `GOOGLE_CLIENT_ID` | yes (for Google login) | OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | yes | OAuth client secret — **secret**, never commit |
| `SESSION_SECRET` | recommended | Random string ≥32 chars (reserved for future signed cookies) |
| `APP_ORIGIN` | optional | Defaults to request host; set `https://umrt-portal.pages.dev` if behind proxies |
| `FACEBOOK_APP_ID` | optional | When both FACEBOOK_* set, Account UI enables Meta button copy |
| `FACEBOOK_APP_SECRET` | optional | Secret — never commit |

**Never put secrets in the repo.**

## D1 database

1. Create D1 database (suggested name: `umrt-portal`).
2. In Pages project → **Settings → Bindings** → add **D1** binding:
   - **Variable name / binding:** `DB` (exact — code expects `env.DB`)
   - Database: the D1 you created
3. Run SQL from `schema/d1.sql` (Console → D1 → Execute, or `wrangler d1 execute`).

## Auth routes (Pages Functions)

- `GET /api/auth/google/start` — begin Google OAuth
- `GET /api/auth/callback/google` — OAuth callback → HttpOnly `umrt_session` cookie
- `GET|POST /api/auth/logout` — clear session
- `GET /api/me` — `{ authenticated, user, providers }`

Session cookie: **HttpOnly**, `SameSite=Lax`, `Secure` on HTTPS, 30 days.

## Facebook / Meta

Buttons show on `/account/`. Until `FACEBOOK_APP_ID` + `FACEBOOK_APP_SECRET` are set, UI shows **“coming once Meta keys set”** and the button stays disabled.

## Brand / copy constraints

- Tokens: `#1A1A1A` `#C9972C`
- Phone: `(616) 606-5277` · Prefer Text CTA
- Starlink **installs only** — never “Certified”
- Soft portal separate from WordPress; Pay CTA → `umrt-pay.pages.dev`
