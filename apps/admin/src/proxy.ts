import { NextRequest, NextResponse } from 'next/server';
import { REFRESH_TOKEN_COOKIE } from '@/lib/backend';

// فحص وجود الكوكي بس (مش التحقق من صحة التوقيع — ده بيحصل فعلياً في الباك-إند مع كل نداء).
// الهدف هنا منع "flash" للوحة التحكم قبل ما نكتشف إن المستخدم مش مسجّل دخول، مش طبقة أمان
// بديلة عن تحقق الباك-إند.
export function proxy(req: NextRequest) {
  const hasSession = req.cookies.has(REFRESH_TOKEN_COOKIE);
  const { pathname } = req.nextUrl;

  if (!hasSession && pathname !== '/login') {
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (hasSession && pathname === '/login') {
    return NextResponse.redirect(new URL('/', req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
