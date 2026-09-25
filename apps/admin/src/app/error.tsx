'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { reportClientError } from '@/lib/error-reporter';

/**
 * **عطل غير متوقّع في شاشة أدمن** (ADR-0114).
 *
 * الأدمن كان بيشوف شاشة Next الافتراضية (إنجليزي + stack trace). دلوقتي: رسالة عربية + كود
 * مرجعي + خطوة تالية، والتفاصيل التقنية بتروح للسيرفر.
 *
 * **`AppShell` مش مستخدم هنا عن قصد**: العطل ممكن يكون في الـshell نفسه (الصلاحيات، القايمة)،
 * ورسمه تاني جوّه حدود الخطأ بيعمل حلقة. شاشة الخطأ لازم تعتمد على أقل حاجة ممكنة.
 */
export default function AdminError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    reportClientError({
      kind: 'render',
      errorName: error.name || 'Error',
      errorMessage: error.message,
      componentStack: error.digest ? `digest:${error.digest}` : null,
    });
  }, [error]);

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-3 px-4 text-center">
      <AlertTriangle className="size-9 text-muted-foreground/60" />
      <h1 className="text-lg font-semibold">حصلت مشكلة في الشاشة دي</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        مقدرناش نحمّل البيانات. جرّب تاني — لو المشكلة فضلت، الكود المرجعي تحت بيوصّل للسبب في
        سجلات السيرفر.
      </p>
      <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
        {/* `retry` مش `reset`: في Next 16 `reset()` بتمسح الحالة **بلا إعادة جلب**، فالزرار
            بيرجع بنفس البيانات الفاشلة. */}
        <Button onClick={retry} data-testid="admin-error-retry">
          حاول تاني
        </Button>
        <Button variant="outline" asChild>
          <Link href="/">لوحة التحكم</Link>
        </Button>
      </div>
      {error.digest && (
        <p className="mt-2 text-xs text-muted-foreground" dir="ltr">
          كود مرجعي: {error.digest}
        </p>
      )}
    </div>
  );
}
