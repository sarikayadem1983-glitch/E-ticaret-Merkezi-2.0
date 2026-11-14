import { type NextRequest, NextResponse } from 'next/server';

const PUBLIC_PAGES = new Set(['/login', '/register', '/forgot-password']);
/** Token links from e-mails (USR-19) and invitations: open without a session. */
const PUBLIC_PREFIXES = ['/invite/', '/reset-password/', '/verify-email/'];

/**
 * Page-level redirect only: no session cookie means the sign-in page. The
 * cookie is not validated here; every data request is checked by the BFF and
 * the backend, so a forged cookie only shows an empty shell.
 */
export function proxy(req: NextRequest) {
  const name =
    process.env.NODE_ENV === 'production' ? '__Host-tm_sid' : 'tm_sid';
  const hasSession = req.cookies.has(name);
  const { pathname } = req.nextUrl;
  // Token links work without a session; a token never goes into ?next=.
  const isPublic =
    PUBLIC_PAGES.has(pathname) ||
    PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));

  if (!hasSession && !isPublic) {
    const url = new URL('/login', req.url);
    if (pathname !== '/') url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }
  if (pathname === '/') {
    return NextResponse.redirect(new URL('/dashboard', req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|ico|webp)$).*)',
  ],
};
