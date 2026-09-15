import { resolveCentralIdentity } from './_lib/central-identity.js';

/**
 * Auth-unification stage 2 (2026-09-15) -- see functions/_lib/central-
 * identity.js for the full explanation. LOG-ONLY this stage: resolves a
 * central identity and attaches it as X-User-Id/X-User-Role on the
 * request passed downstream, but no route reads those headers yet --
 * existing auth (_lib/auth.js's getSessionUser/isAdminUser) remains the
 * sole real authorization check through Stage 3.
 *
 * The one live behavior change: any client-supplied X-User-Id/X-User-Role
 * on the INCOMING request is always stripped, whether or not identity
 * resolution finds anything -- this closes the header-spoofing hole
 * before anything downstream is ever built to trust these headers,
 * rather than as an afterthought once something does. Companion to the
 * identical stripping logic in united-mobile-rv/functions/_middleware.js.
 */
export async function onRequest(context) {
  const strippedHeaders = new Headers(context.request.headers);
  strippedHeaders.delete('X-User-Id');
  strippedHeaders.delete('X-User-Role');
  let request = new Request(context.request, { headers: strippedHeaders });

  const identity = await resolveCentralIdentity(request, context.env);
  if (identity) {
    const enrichedHeaders = new Headers(request.headers);
    enrichedHeaders.set('X-User-Id', identity.id);
    enrichedHeaders.set('X-User-Role', identity.role);
    request = new Request(request, { headers: enrichedHeaders });
  }

  return context.next(request);
}
