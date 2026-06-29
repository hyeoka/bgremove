import { type AuthEnv, clearCookie, isSecureRequest, SESSION_COOKIE } from '../../_shared/auth';

export const onRequestGet: PagesFunction<AuthEnv> = async ({ request }) => {
  const headers = new Headers({ Location: '/api/auth/login' });
  headers.append('Set-Cookie', clearCookie(SESSION_COOKIE, isSecureRequest(request)));

  return new Response(null, { status: 302, headers });
};
