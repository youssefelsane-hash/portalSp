import type { Metadata, Viewport } from 'next';
import { Suspense, type ReactNode } from 'react';
import { Tajawal } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/lib/auth-context';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { PromoLinkCapture } from '@/components/promo-link-capture';
import { SetPinBanner } from '@/components/set-pin-banner';
import { SITE_URL } from '@/lib/seo';
import { ConnectivityBanner } from '@/components/connectivity-banner';
import { GlobalErrorReporting } from '@/components/global-error-reporting';

// §8 — Arabic-first، مش English UI بترقّع RTL بعدين. Tajawal خط عربي عصري مقروء، مدعوم Google
// Fonts (يشتغل تحت CSP الافتراضي للـArtifacts، ومفيش قيد مشابه هنا لأن ده Next.js عادي، بس
// نفس المبدأ صح تقنيًا لأي بيئة).
const tajawal = Tajawal({
  variable: '--font-tajawal',
  subsets: ['arabic', 'latin'],
  weight: ['400', '500', '700'],
});

const SITE_TITLE = 'أسطى — خدمات منزلية موثوقة';
const SITE_DESCRIPTION = 'احجز صنايعي معتمد لأي شغلانة في البيت — سعر واضح، تتبّع لحظي، دفع آمن.';

export const metadata: Metadata = {
  // **لازم يتحدد هنا**: أي حقل ميتاداتا بمسار نسبي (زي `/og.png`) محتاج أصل مطلق عشان يتركّب،
  // ومن غيره Next بيكسر البناء. القيمة من نفس المتغير اللي `sitemap`/`robots` بيقروا منه
  // (`SITE_URL`) — مصدر واحد، مش قيمة مكتوبة مرتين بتفترق أول نشر على دومين تاني.
  metadataBase: new URL(SITE_URL),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [{ url: '/icon.png', sizes: '512x512', type: 'image/png' }],
    shortcut: '/favicon.ico',
    apple: '/apple-icon.png',
  },
  /**
   * **كارت المشاركة** (طلب مالك 2026-09-25): «لينك على واتساب يظهر كارت فيه صورة وعنوان مش
   * لينك أزرق». الصورة بتتولّد من الـbrand kit بـ`scripts/export-og-image.js`، والمقاس
   * 1200×630 هو اللي المنصات بتقصّ عليه — أي مقاس تاني بيتقص عشوائيًا.
   *
   * الافتراضي هنا بيغطّي **كل** صفحة؛ صفحات الـSEO بتستبدل العنوان والوصف بس وبتورث الصورة.
   */
  openGraph: {
    type: 'website',
    locale: 'ar_EG',
    siteName: 'أسطى',
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: '/',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'أسطى — صنعة تِطَمِّن' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: ['/og.png'],
  },
};

export const viewport: Viewport = {
  // لازم يطابق manifest.webmanifest — الاتنين بيلوّنوا شريط المتصفح، واختلافهم بيدّي لونين
  // مختلفين على نفس الصفحة حسب المنصة.
  themeColor: '#123b69',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ar" dir="rtl" className={`${tajawal.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {/* أخطاء الـwindow والوعود المرفوضة — فئة كاملة Next مابيلقطهاش في أي `error.tsx`. */}
        <GlobalErrorReporting />
        <ConnectivityBanner />
        <AuthProvider>
          <Suspense fallback={null}>
            <PromoLinkCapture />
          </Suspense>
          <SiteHeader />
          {/* ADR-0109 §6-أ — بيظهر لوحده بس للمستخدم اللي مالوش رمز، ومالوش زرار إغلاق. */}
          <Suspense fallback={null}>
            <SetPinBanner />
          </Suspense>
          <main className="flex-1">{children}</main>
          <SiteFooter />
        </AuthProvider>
      </body>
    </html>
  );
}
