import { NextRequest, NextResponse } from 'next/server';
import { REFRESH_TOKEN_COOKIE } from '@/lib/backend';
import { isPreAuthRoute } from '@/lib/public-routes';

// فحص وجود الكوكي بس (مش التحقق من صحة التوقيع — ده بيحصل فعلياً في الباك-إند مع كل نداء).
// الهدف هنا منع "flash" للوحة التحكم قبل ما نكتشف إن المستخدم مش مسجّل دخول، مش طبقة أمان
// بديلة عن تحقق الباك-إند.
export function proxy(req: NextRequest) {
  const hasSession = req.cookies.has(REFRESH_TOKEN_COOKIE);
  const { pathname } = req.nextUrl;

  // **مسارات ما قبل الدخول** (`/login`, `/activate`) — الشرح في `lib/public-routes.ts`.
  if (!hasSession && !isPreAuthRoute(pathname)) {
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // **`/activate` مستثنية من التحويل ده عن قصد**: أدمن داخل بالفعل ممكن يكون بيفعّل حساب
  // لموظف تاني قصاده، أو بيستهلك كود استرجاع لنفسه. تحويله للرئيسية كان بيقفل الحالتين.
  if (hasSession && pathname === '/login') {
    return NextResponse.redirect(new URL('/', req.url));
  }

  return NextResponse.next();
}

/**
 * **الملفات الساكنة مستثناة — بَقّة حقيقية اتلقطت بصريًا (2026-09-25).**
 *
 * الاستثناء كان `favicon.ico` بس، فأي أصل تاني بيطلبه متصفح **مش مسجّل دخول** كان بياخد تحويل
 * ٣٠٧ للّوجن ويرجع HTML مكان الصورة. النتيجة اللي اتشافت في لقطة حقيقية: **لوجو مكسور في نص
 * شاشة الدخول** (`<img src="/icon.svg">` في `app/login/page.tsx`) — أول حاجة أي أدمن بيشوفها.
 *
 * الاستثناء دلوقتي بالامتداد مش بالاسم: أي طلب لملف بامتداد معروف مايعدّيش على الحارس. ده آمن
 * لأن مفيش **صفحة** في اللوحة بتنتهي بأي من الامتدادات دي — كلها مسارات بلا امتداد.
 */
export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|txt|xml|json|webmanifest|woff|woff2)$).*)',
  ],
};
