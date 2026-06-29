import {
  type AuthEnv,
  clearCookie,
  isSecureRequest,
  readSession,
  SESSION_COOKIE,
} from '../../_shared/auth';

export const onRequestGet: PagesFunction<AuthEnv> = async ({ request, env }) => {
  const user = await readSession(request, env);
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  });

  if (!user) {
    headers.append('Set-Cookie', clearCookie(SESSION_COOKIE, isSecureRequest(request)));
    return new Response(JSON.stringify({ ok: false }), { status: 401, headers });
  }

  return new Response(JSON.stringify({ ok: true, user }), { headers });
};
