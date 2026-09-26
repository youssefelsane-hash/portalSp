'use client';

import { useEffect, useState } from 'react';
import { Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

/**
 * **عرض كود لمرة واحدة** — مصدر واحد لكل الأكواد اللي بتتعرض مرة وبس (ADR-0109 §6-ب، ADR-0111).
 *
 * الأكواد دي (استرجاع رمز، تنشيط موظف) متخزّنة **مجزّأة** فمفيش أي طريقة تقراها تاني بعد الرد.
 * فالحوار **مايتقفلش بضغطة برّه ولا بـEscape** — لازم تأكيد صريح، عشان دوسة غلط ماتضيّعش الكود
 * الوحيد. اتطلّع من `reset-pin-button` عشان تنشيط الموظف يستخدم نفس السلوك بالظبط بدل نسخة تانية
 * بتفرق في تفصيلة صغيرة زي دي.
 */
export function OneTimeCodeDialog({
  open,
  title,
  description,
  code,
  expiresAt,
  confirmLabel,
  onConfirm,
  testId,
}: {
  open: boolean;
  title: string;
  description: React.ReactNode;
  code: string | null;
  expiresAt?: string | null;
  confirmLabel: string;
  onConfirm: () => void;
  testId?: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!open || !expiresAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [open, expiresAt]);
  const remainingSeconds = expiresAt ? Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 1000)) : null;
  const expired = remainingSeconds === 0;

  return (
    <Dialog open={open}>
      <DialogContent
        showCloseButton={false}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div
          className="rounded-md bg-muted p-4 text-center font-mono text-2xl tracking-[0.3em]"
          dir="ltr"
          data-testid={testId}
        >
          {expired ? 'انتهت صلاحية الكود' : code}
        </div>
        {remainingSeconds !== null && !expired && (
          <p className="text-center text-sm text-muted-foreground" role="timer">
            متبقي {Math.floor(remainingSeconds / 60)}:{String(remainingSeconds % 60).padStart(2, '0')} دقيقة
          </p>
        )}
        {expired && <p className="text-center text-sm text-destructive">اطلب كودًا جديدًا؛ الكود المعروض سابقًا لن يعمل.</p>}
        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            disabled={expired || !code}
            onClick={() => {
              if (code)
                void navigator.clipboard.writeText(code).then(
                  () => toast.success('اتنسخ'),
                  () => toast.error('المتصفح رفض النسخ — اقرا الكود من الشاشة'),
                );
            }}
          >
            <Copy className="size-4" /> انسخ
          </Button>
          <Button onClick={onConfirm}>{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
