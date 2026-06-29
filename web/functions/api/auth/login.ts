import {
  type AuthEnv,
  clearCookie,
  getRedirectUri,
  hasRequiredConfig,
  isSecureRequest,
  makeCookie,
  missingConfigResponse,
  NEXT_COOKIE,
  SESSION_COOKIE,
  STATE_COOKIE,
  sanitizeNext,
} from '../../_shared/auth';

export const onRequestGet: PagesFunction<AuthEnv> = async ({ request, env }) => {
  if (!hasRequiredConfig(env)) return missingConfigResponse();

  const requestUrl = new URL(request.url);
  const next = sanitizeNext(requestUrl.searchParams.get('next'));
  const state = crypto.randomUUID();
  const secure = isSecureRequest(request);

  const authorizeUrl = new URL('https://discord.com/oauth2/authorize');
  authorizeUrl.searchParams.set('client_id', env.DISCORD_CLIENT_ID ?? '');
  authorizeUrl.searchParams.set('redirect_uri', getRedirectUri(request, env));
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('scope', 'identify');
  authorizeUrl.searchParams.set('state', state);

  const headers = new Headers({ Location: authorizeUrl.toString() });
  headers.append('Set-Cookie', makeCookie(STATE_COOKIE, state, 600, secure));
  headers.append('Set-Cookie', makeCookie(NEXT_COOKIE, next, 600, secure));
  headers.append('Set-Cookie', clearCookie(SESSION_COOKIE, secure));

  return new Response(null, { status: 302, headers });
};
