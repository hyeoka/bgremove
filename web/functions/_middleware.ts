import { type AuthEnv, loginPageResponse, readSession } from './_shared/auth';

export const onRequest: PagesFunction<AuthEnv> = async ({ request, next, env }) => {
  const url = new URL(request.url);

  if (url.pathname.startsWith('/api/auth/') || isPublicAsset(url.pathname)) {
    return next();
  }

  const user = await readSession(request, env);
  if (user) return next();

  return loginPageResponse(request);
};

function isPublicAsset(pathname: string) {
  return (
    pathname === '/favicon.webp' ||
    pathname === '/robots.txt' ||
    pathname.startsWith('/assets/') ||
    pathname.endsWith('.png') ||
    pathname.endsWith('.jpg') ||
    pathname.endsWith('.jpeg') ||
    pathname.endsWith('.webp') ||
    pathname.endsWith('.svg') ||
    pathname.endsWith('.ico') ||
    pathname.endsWith('.css') ||
    pathname.endsWith('.js') ||
    pathname.endsWith('.wasm') ||
    pathname.endsWith('.mjs')
  );
}
