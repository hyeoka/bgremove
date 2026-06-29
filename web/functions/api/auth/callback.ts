import {
  type AuthEnv,
  clearCookie,
  createSessionToken,
  deniedResponse,
  exchangeDiscordCode,
  fetchDiscordUser,
  getCookie,
  getSessionMaxAge,
  hasRequiredConfig,
  isAllowedUserId,
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

  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const storedState = getCookie(request, STATE_COOKIE);
  const secure = isSecureRequest(request);
  const next = sanitizeNext(getCookie(request, NEXT_COOKIE));

  if (!code || !state || !storedState || state !== storedState) {
    const headers = clearAuthHeaders(secure);
    return new Response('Invalid Discord OAuth state.', { status: 400, headers });
  }

  try {
    const token = await exchangeDiscordCode(code, request, env);
    const user = await fetchDiscordUser(token.access_token);

    if (!isAllowedUserId(user.id, env)) {
      const response = deniedResponse(user.id);
      appendClearAuthCookies(response.headers, secure);
      return response;
    }

    const sessionToken = await createSessionToken(user, env.DISCORD_SESSION_SECRET ?? '');
    const headers = clearAuthHeaders(secure);
    headers.set('Location', next);
    headers.append(
      'Set-Cookie',
      makeCookie(SESSION_COOKIE, sessionToken, getSessionMaxAge(), secure),
    );

    return new Response(null, { status: 302, headers });
  } catch (error) {
    console.error(error);
    const headers = clearAuthHeaders(secure);
    return new Response('Discord OAuth failed.', { status: 502, headers });
  }
};

function clearAuthHeaders(secure: boolean) {
  const headers = new Headers();
  headers.append('Set-Cookie', clearCookie(STATE_COOKIE, secure));
  headers.append('Set-Cookie', clearCookie(NEXT_COOKIE, secure));
  return headers;
}

function appendClearAuthCookies(headers: Headers, secure: boolean) {
  headers.append('Set-Cookie', clearCookie(STATE_COOKIE, secure));
  headers.append('Set-Cookie', clearCookie(NEXT_COOKIE, secure));
}
