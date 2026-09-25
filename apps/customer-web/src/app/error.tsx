'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/error-state';
import { reportClientError } from '@/lib/error-reporter';

/**
 * **عطل غير متوقّع في صفحة** (ADR-0114).
 *
 * قاعدة واحدة مقدّسة هنا: **`error.message` عمره ما يتعرض للمستخدم**. الرسالة الأصلية بتروح
 * للسيرفر، والمستخدم بيشوف كلام مفهوم + زرار. ده اللي المالك طلبه بالنص: «ما يشوفش TypeError
 * ولا undefined ولا API Error 500».
 *
 * `error.digest` بيتعرض كـ«كود مرجعي» بس: مش رسالة خطأ، ده معرّف بيربط بلاغ المستخدم للدعم
 * بالسطر في السيرفر — نفس فكرة `req_…` في `scripts/find-error.js`.
 */
export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    reportClientError({
      kind: 'render',
      errorName: error.name || 'Error',
      errorMessage: error.message,
      componentStack: error.digest ? `digest:${error.digest}` : null,
    });
  }, [error]);

  return (
    <ErrorState
      testId="page-error-state"
      title="حصلت مشكلة مؤقتة"
      description="مقدرناش نحمّل الصفحة دي. جرّب تحدّثها — لو المشكلة فضلت، ابدأ من الرئيسية وإحنا بنراجع السبب من ناحيتنا."
      // `retry` مش `reset`: في Next 16 `reset()` بتمسح حالة الخطأ **بلا إعادة جلب** — يعني
      // الصفحة بترجع ترسم بنفس البيانات الفاشلة فالزرار بيبان مكسور. `retry()` بتعيد الجلب
      // والرسم، وهي المقصودة لزرار «حاول تاني».
      primary={{ label: 'حاول تاني', onClick: retry }}
      secondary={{ label: 'الرئيسية', href: '/' }}
      hint={error.digest ? <span dir="ltr">كود مرجعي: {error.digest}</span> : undefined}
    />
  );
}
