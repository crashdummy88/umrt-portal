# umrt-portal

Customer portal for United Mobile RV LLC — book / track / account with **Google sign-in** (Cloudflare Pages Functions + D1).

GitHub → Cloudflare `umrt-portal.pages.dev`. Domain HOLD — pages.dev only (`portal.unitedmobilerv.com` is DNS-only until it is attached as a custom domain). Portal stays **noindex**.

## How it fits the rest of UMRT

| Piece | Lives in | Portal touchpoint |
|---|---|---|
| Booking | `united-mobile-rv` `functions/api/book.js` (one endpoint for the WP form, the hub form and `/book/` here) | `/book/` posts there with `form_source=portal_book`; the row lands in this project's D1 `jobs` table |
| Track / invoices | this repo, `functions/api/jobs/mine.js` | matched to the signed-in email; Square invoice link shown per job when Matt has sent one |
| Forum | `united-mobile-rv` `/forum/` at `forum.unitedmobilerv.com` | separate Google sign-in today; forum reads this project's D1 for the "Verified Customer" badge |
| Shop / Pay / Software / Status | `shop.unitedmobilerv.com`, `umrt-pay`, `umrt-software`, `umrt-status` | linked from the home grid and the shared platform bar |
| Live corridor / hours | `united-mobile-rv` `GET /api/status` | `assets/portal.js` renders it in the "Field status" card |

Every page uses the same shell: `design/platform-bar.css` (shared across UMRT sites), `assets/styles.css` (tokens from `united-mobile-rv/design/theme.json`) and `assets/portal.js` (one `/api/auth/me` call per page).

## Secrets (env var names only)

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `SESSION_SECRET`
- `ADMIN_EMAILS` — comma-separated admin list for `/admin/` (falls back to the owner's address in code if unset)
- Optional: `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`

D1 binding name: `DB`. Migrations: `migrations/0001_init.sql` … `0005_vendor_directory.sql`, applied in order.

Redirect URI: `https://umrt-portal.pages.dev/api/auth/callback/google`

See `CF_PAGES.md` for Pages + D1 setup.

Prefer Text: (616) 606-5277. Starlink installs only — never Certified.
