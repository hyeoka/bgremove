import { type AuthEnv, readSession } from './_shared/auth';

export const onRequest: PagesFunction<AuthEnv> = async ({ request, next, env }) => {
  const url = new URL(request.url);

  if (url.pathname.startsWith('/api/auth/')) {
    return next();
  }

  const user = await readSession(request, env);
  if (user) return next();

  const loginUrl = new URL('/api/auth/login', url.origin);
  loginUrl.searchParams.set('next', `${url.pathname}${url.search}`);

  return Response.redirect(loginUrl.toString(), 302);
};
