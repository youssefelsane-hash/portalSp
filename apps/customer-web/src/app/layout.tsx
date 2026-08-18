import type { Metadata, Viewport } from 'next';
import { Tajawal } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/lib/auth-context';
import { SiteHeader } from '@/components/site-header';

// §8 — Arabic-first، مش English UI بترقّع RTL بعدين. Tajawal خط عربي عصري مقروء، مدعوم Google
// Fonts (يشتغل تحت CSP الافتراضي للـArtifacts، ومفيش قيد مشابه هنا لأن ده Next.js عادي، بس
// نفس المبدأ صح تقنيًا لأي بيئة).
const tajawal = Tajawal({
  variable: '--font-tajawal',
  subsets: ['arabic', 'latin'],
  weight: ['400', '500', '700'],
});

export const metadata: Metadata = {
  title: 'صُنّاع — خدمات منزلية موثوقة',
  description: 'احجز صنايعي معتمد لأي شغلانة في البيت — سعر واضح، تتبّع لحظي، دفع آمن.',
  manifest: '/manifest.webmanifest',
};

export const viewport: Viewport = {
  themeColor: '#2f5aa6',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="ar" dir="rtl" className={`${tajawal.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <AuthProvider>
          <SiteHeader />
          <main className="flex-1">{children}</main>
        </AuthProvider>
      </body>
    </html>
  );
}
