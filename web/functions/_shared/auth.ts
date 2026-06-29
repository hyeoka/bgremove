const DISCORD_OAUTH_TOKEN_URL = 'https://discord.com/api/oauth2/token';
const DISCORD_CURRENT_USER_URL = 'https://discord.com/api/v10/users/@me';
const SESSION_MAX_AGE = 60 * 60 * 24 * 7;
const SITE_ORIGIN = 'https://removebg.giyeoum.me';
const SITE_TITLE = '기여움 디자인팀 BG Remover';
const SITE_DESCRIPTION = '기여움 디자인팀 전용 고품질 AI 배경 제거 도구';
const SITE_IMAGE = `${SITE_ORIGIN}/favicon.webp`;

const DEFAULT_ALLOWED_USER_IDS = [
  '1187909015397728276',
  '1296053433371066390',
  '1268931934596366440',
  '828545528056512512',
];

export const SESSION_COOKIE = 'gy_design_session';
export const STATE_COOKIE = 'gy_design_oauth_state';
export const NEXT_COOKIE = 'gy_design_oauth_next';

export type AuthEnv = {
  DISCORD_CLIENT_ID?: string;
  DISCORD_CLIENT_SECRET?: string;
  DISCORD_REDIRECT_URI?: string;
  DISCORD_SESSION_SECRET?: string;
  DISCORD_ALLOWED_USER_IDS?: string;
};

export type DiscordUser = {
  id: string;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
};

type SessionPayload = DiscordUser & {
  exp: number;
};

export function getRedirectUri(request: Request, env: AuthEnv) {
  if (env.DISCORD_REDIRECT_URI) return env.DISCORD_REDIRECT_URI;

  const url = new URL(request.url);
  return `${url.origin}/api/auth/callback`;
}

export function getAllowedUserIds(env: AuthEnv) {
  const configured = env.DISCORD_ALLOWED_USER_IDS?.split(',')
    .map((id) => id.trim())
    .filter(Boolean);

  return new Set(configured?.length ? configured : DEFAULT_ALLOWED_USER_IDS);
}

export function isAllowedUserId(userId: string, env: AuthEnv) {
  return getAllowedUserIds(env).has(userId);
}

export function getCookie(request: Request, name: string) {
  const cookie = request.headers.get('Cookie');
  if (!cookie) return null;

  const match = cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));

  if (!match) return null;
  return decodeURIComponent(match.slice(name.length + 1));
}

export function makeCookie(name: string, value: string, maxAge: number, secure: boolean) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ];

  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearCookie(name: string, secure: boolean) {
  return makeCookie(name, '', 0, secure);
}

export function isSecureRequest(request: Request) {
  return new URL(request.url).protocol === 'https:';
}

export function sanitizeNext(next: string | null) {
  if (!next?.startsWith('/') || next.startsWith('//')) return '/';
  return next;
}

export function missingConfigResponse() {
  return htmlResponse(
    'Discord OAuth 설정 필요',
    'Cloudflare Pages 환경변수 DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_SESSION_SECRET를 먼저 설정해 주세요.',
    500,
  );
}

export function deniedResponse(userId?: string) {
  const detail = userId
    ? `이 Discord 계정(${userId})은 기여움 디자인팀 허용 목록에 없습니다.`
    : '이 Discord 계정은 기여움 디자인팀 허용 목록에 없습니다.';

  return htmlResponse('접근할 수 없습니다', detail, 403);
}

export function loginPageResponse(request: Request) {
  const url = new URL(request.url);
  const next = sanitizeNext(`${url.pathname}${url.search}`);
  const loginUrl = new URL('/api/auth/login', url.origin);
  loginUrl.searchParams.set('next', next);

  return new Response(
    `<!doctype html>
<html lang="ko" class="dark" data-theme="dark">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    ${socialMeta(SITE_TITLE, SITE_DESCRIPTION)}
    <title>${SITE_TITLE}</title>
    <style>
      @import url("https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css");
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0f1115; color: #f5f5f5; font-family: Pretendard, system-ui, sans-serif; }
      main { width: min(440px, calc(100vw - 32px)); padding: 28px; border: 1px solid #30343d; border-radius: 14px; background: #171a21; box-shadow: 0 24px 80px rgba(0, 0, 0, .28); }
      img { width: 58px; height: 58px; border-radius: 14px; object-fit: cover; margin-bottom: 18px; }
      h1 { margin: 0 0 10px; font-size: 24px; line-height: 1.25; }
      p { margin: 0 0 22px; color: #b7bdc9; line-height: 1.6; }
      a { display: inline-flex; width: 100%; min-height: 48px; align-items: center; justify-content: center; border-radius: 10px; background: #5865f2; color: white; font-weight: 800; text-decoration: none; }
      small { display: block; margin-top: 14px; color: #858c9a; line-height: 1.5; }
    </style>
  </head>
  <body>
    <main>
      <img src="/favicon.webp" alt="" />
      <h1>기여움 디자인팀 전용</h1>
      <p>Discord 계정으로 로그인한 뒤 허용된 팀원만 BG Remover를 사용할 수 있습니다.</p>
      <a href="${escapeHtml(loginUrl.toString())}">Discord로 로그인</a>
      <small>허용되지 않은 계정은 로그인 후에도 접근할 수 없습니다.</small>
    </main>
  </body>
</html>`,
    {
      status: 401,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    },
  );
}

export function htmlResponse(title: string, message: string, status = 200) {
  return new Response(
    `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    ${socialMeta(title, message)}
    <title>${escapeHtml(title)}</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0f1115; color: #f5f5f5; font-family: Pretendard, system-ui, sans-serif; }
      main { width: min(420px, calc(100vw - 32px)); padding: 24px; border: 1px solid #30343d; border-radius: 12px; background: #171a21; }
      h1 { margin: 0 0 10px; font-size: 22px; }
      p { margin: 0 0 18px; color: #b7bdc9; line-height: 1.55; }
      a { color: #8ab4ff; font-weight: 700; }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(message)}</p>
      <a href="/api/auth/login">Discord로 다시 로그인</a>
    </main>
  </body>
</html>`,
    {
      status,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    },
  );
}

function socialMeta(title: string, description: string) {
  return `<link rel="icon" type="image/webp" href="/favicon.webp" />
    <meta name="description" content="${escapeHtml(description)}" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:image" content="${SITE_IMAGE}" />
    <meta property="og:url" content="${SITE_ORIGIN}" />
    <meta name="theme-color" content="#5865f2" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${SITE_IMAGE}" />`;
}

export async function createSessionToken(user: DiscordUser, secret: string) {
  const payload: SessionPayload = {
    id: user.id,
    username: user.username,
    global_name: user.global_name ?? null,
    avatar: user.avatar ?? null,
    exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE,
  };
  const data = base64UrlEncode(JSON.stringify(payload));
  const signature = await sign(data, secret);
  return `${data}.${signature}`;
}

export async function readSession(request: Request, env: AuthEnv) {
  if (!env.DISCORD_SESSION_SECRET) return null;

  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return null;

  const [data, signature] = token.split('.');
  if (!data || !signature) return null;

  const expected = await sign(data, env.DISCORD_SESSION_SECRET);
  if (!constantTimeEqual(signature, expected)) return null;

  const payload = JSON.parse(base64UrlDecode(data)) as SessionPayload;
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;
  if (!isAllowedUserId(payload.id, env)) return null;

  return {
    id: payload.id,
    username: payload.username,
    global_name: payload.global_name ?? null,
    avatar: payload.avatar ?? null,
  } satisfies DiscordUser;
}

export async function exchangeDiscordCode(code: string, request: Request, env: AuthEnv) {
  const body = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID ?? '',
    client_secret: env.DISCORD_CLIENT_SECRET ?? '',
    grant_type: 'authorization_code',
    code,
    redirect_uri: getRedirectUri(request, env),
  });

  const response = await fetch(DISCORD_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!response.ok) throw new Error('Discord 토큰 교환에 실패했습니다.');
  return (await response.json()) as { access_token: string };
}

export async function fetchDiscordUser(accessToken: string) {
  const response = await fetch(DISCORD_CURRENT_USER_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) throw new Error('Discord 유저 정보를 가져오지 못했습니다.');
  return (await response.json()) as DiscordUser;
}

export function hasRequiredConfig(env: AuthEnv) {
  return Boolean(env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET && env.DISCORD_SESSION_SECRET);
}

export function getSessionMaxAge() {
  return SESSION_MAX_AGE;
}

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

async function sign(data: string, secret: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return arrayBufferToBase64Url(signature);
}

function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;

  let result = 0;
  for (let index = 0; index < a.length; index += 1) {
    result |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return result === 0;
}

function base64UrlEncode(value: string) {
  return bytesToBase64Url(new TextEncoder().encode(value));
}

function base64UrlDecode(value: string) {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new TextDecoder().decode(bytes);
}

function arrayBufferToBase64Url(buffer: ArrayBuffer) {
  return bytesToBase64Url(new Uint8Array(buffer));
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
