'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '@/lib/api-client';

const COOLDOWN_SECONDS = 30;

/**
 * §106 — زرار «ابعت الكود تاني» بعدّاد تنازلي.
 *
 * خطوة الكود في الويب (زي التطبيقين بالظبط قبل §106) مكانش فيها إعادة إرسال خالص: المخرج
 * الوحيد كان «غيّر الرقم» — رسالة محدش هيدوس عليها والرقم أصلاً صح. وده كان طريق مسدود حقيقي،
 * لأن السيرفر بيلغي أي كود أقدم أول ما يتصدر كود جديد، فأي كود بايظ/منتهي مكانش ليه علاج.
 *
 * المهلة هنا مش تجميل: `POST /auth/otp/request` عليه `@Throttle` بـ٥ طلبات/دقيقة، والعدّاد
 * بيمنع المستخدم يوصل للحظر بدل ما يتفاجئ بيه.
 */
export function OtpResendButton({
  onResend,
  disabled = false,
}: {
  onResend: () => Promise<void>;
  disabled?: boolean;
}) {
  const [seconds, setSeconds] = useState(COOLDOWN_SECONDS);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (seconds <= 0) return;
    const timer = setTimeout(() => setSeconds((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [seconds]);

  const resend = useCallback(async () => {
    setBusy(true);
    setNotice(null);
    try {
      await onResend();
      setSeconds(COOLDOWN_SECONDS);
      setNotice('بعتنالك كود جديد — الكود القديم بقى لاغي');
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : 'تعذر إرسال كود جديد، حاول تاني');
    } finally {
      setBusy(false);
    }
  }, [onResend]);

  return (
    <div className="space-y-1 text-center">
      <button
        type="button"
        onClick={resend}
        disabled={disabled || busy || seconds > 0}
        className="w-full text-sm text-primary hover:underline disabled:text-muted disabled:no-underline"
      >
        {seconds > 0 ? `تقدر تطلب كود جديد بعد ${seconds} ثانية` : 'ما وصلكش الكود؟ ابعته تاني'}
      </button>
      {notice && <p className="text-xs text-muted">{notice}</p>}
    </div>
  );
}
