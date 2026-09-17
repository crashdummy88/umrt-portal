# umrt-portal

Customer portal for United Mobile RV LLC — book / track / account with **Google sign-in** (Cloudflare Pages Functions + D1).

GitHub → Cloudflare `umrt-portal.pages.dev`. Domain HOLD — pages.dev only. Portal stays **noindex**.

## Secrets (env var names only)

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `SESSION_SECRET`
- Optional: `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`

D1 binding name: `DB`. Migration: `migrations/0001_init.sql`.

Redirect URI: `https://umrt-portal.pages.dev/api/auth/google/callback`

See `CF_PAGES.md` for Pages + D1 setup.

Text Now: sms:+16166065277. Listed: (616) 606-5277 (tel:+16166065277 for older clients). Starlink installs only — never Certified.
Payments: sibling `umrt-pay`. Community door: `https://forum.unitedmobilerv.com/` (portal `/community/` redirects there). Directory is not live yet — noindex, off primary nav.
