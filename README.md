# umrt-portal

Customer portal for United Mobile RV LLC — book / track / account with **Google sign-in** (Cloudflare Pages Functions + D1).

GitHub → Cloudflare Pages: `portal.unitedmobilerv.com` and `umrt-portal.pages.dev`. Portal stays **noindex**.

## Secrets (env var names only)

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `SESSION_SECRET`
- Optional: `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`

D1 binding name: `DB`. Migration: `migrations/0001_init.sql`.

Redirect URI: `/api/auth/callback/google` on both `portal.unitedmobilerv.com` and `umrt-portal.pages.dev`.

See `CF_PAGES.md` for Pages + D1 setup.

Text Now: sms:+16166065277. Listed: (616) 606-5277 (tel:+16166065277 for older clients). Starlink installs only — never Certified.
Book convert CTA: `https://united-mobile-rv-llc.square.site/`. Community: `https://forum.unitedmobilerv.com/`.
