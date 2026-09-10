/** Legacy path — prefer /api/auth/callback/google (CoS canon). */
export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  url.pathname = '/api/auth/callback/google';
  return Response.redirect(url.toString(), 302);
}
