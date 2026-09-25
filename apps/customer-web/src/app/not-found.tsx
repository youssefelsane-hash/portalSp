import type { Metadata } from 'next';
import { ErrorState } from '@/components/error-state';
import { NotFoundReporter } from '@/components/not-found-reporter';

/**
 * **٤٠٤** (ADR-0114). `noindex` مهم هنا: صفحة مش موجودة تتفهرس معناها إن نتيجة البحث بتودّي
 * لحيطة — وده بيضرّ ترتيب باقي الصفحات مش بس الصفحة دي.
 */
export const metadata: Metadata = {
  title: 'الصفحة مش موجودة — أسطى',
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <>
      <NotFoundReporter />
      <ErrorState
        testId="not-found-state"
        title="الصفحة مش موجودة"
        description="اللينك اللي فتحته اتغيّر أو انتهى. تقدر تبدأ من الرئيسية أو تدوّر على الخدمة اللي محتاجها."
        primary={{ label: 'الرئيسية', href: '/' }}
        secondary={{ label: 'كل الخدمات', href: '/categories' }}
      />
    </>
  );
}
