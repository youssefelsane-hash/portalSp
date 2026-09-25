'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

/**
 * **تنبيه هجرة رمز الدخول** (ADR-0109 §6-أ).
 *
 * مستخدم داخل بجلسة محفوظة من قبل التبديل مالوش رمز دخول. الحساب في اللحظة دي مالوش **أي**
 * credential: أول ما الكوكي تنتهي (٣٠ يوم) أو يسجّل خروج، يبقى مقفول برّه حسابه ومحتاج
 * استرجاع من الأدمن.
 *
 * ### ليه تنبيه على الويب وشاشة بتقفل على الموبايل؟
 *
 * فرق مقصود مش سهو. على الموبايل الشاشة بتظهر مرة واحدة عند فتح التطبيق — لحظة **مفيش فيها
 * أي حاجة نصّها**. على الويب المستخدم ممكن يكون في نص دفع أو نص ملء عنوان، وقفل الصفحة عليه
 * وقتها بيلغي عملية حقيقية ويخسّر حجز — تكلفة أعلى من الخطر اللي بنحمي منه، وده خطر **مؤجّل**
 * (٣٠ يوم) مش فوري.
 *
 * فالتنبيه **مالوش زرار إغلاق** عمدًا: بيفضل ظاهر على كل صفحة لحد ما الرمز يتحط فعلاً. اللي
 * بيخفيه هو تحقيق الشرط، مش دوسة من المستخدم.
 */
export function SetPinBanner() {
  const { isAuthenticated, user } = useAuth();
  const pathname = usePathname();

  if (!isAuthenticated || user?.pin_set !== false) return null;
  // مايظهرش على الصفحة اللي بيوصّل لها — تنبيه بيقولك «روح هناك» وإنت هناك بالفعل هو ضوضاء.
  if (pathname === '/account/security') return null;

  return (
    <div
      role="status"
      data-testid="set-pin-banner"
      className="border-b border-warning/40 bg-warning/10 px-4 py-2.5 text-center text-sm"
    >
      <span className="text-foreground">حسابك لسه مالوش رمز دخول. </span>
      <Link
        href="/account/security"
        data-testid="set-pin-banner-link"
        className="font-medium text-primary underline-offset-4 hover:underline"
      >
        اختار رمز دلوقتي
      </Link>
      <span className="text-muted"> — عشان تقدر ترجع لحسابك لو سجّلت خروج.</span>
    </div>
  );
}
