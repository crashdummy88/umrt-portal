/**
 * Validates a user-supplied URL is a safe http(s) link -- added 2026-09-15
 * as part of the P1 fix for the vendor directory's `website` field, which
 * previously only HTML-escaped the value on render (blocks markup
 * injection, not a `javascript:`/`data:`/`vbscript:` scheme executing when
 * the link is clicked). Parses with the real URL constructor rather than
 * string-matching or replacing -- a substring check is not how a browser
 * actually resolves a scheme.
 */
export function sanitizeHttpUrl(raw) {
  const value = (raw || '').toString().trim();
  if (!value) return { ok: true, url: null }; // empty is fine -- website is optional

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return {
      ok: false,
      error: 'invalid_website',
      message: 'Website must be a valid http:// or https:// URL.',
    };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      ok: false,
      error: 'invalid_website',
      message: 'Website must use http:// or https:// -- other link types are not allowed.',
    };
  }

  return { ok: true, url: parsed.href };
}
