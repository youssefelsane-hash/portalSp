'use client';

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

/**
 * حوار Step-Up عام (ADR-0011 §4) — بيتفتح تلقائيًا لما أي عملية حساسة (استرداد، رفع براندنج،
 * تصفير MFA، ...) ترجع AUTH_006. المستخدم بيدوس "تأكيد" فيه، والزرار نفسه (مش أي await قبله)
 * هو اللي بيستدعي navigator.credentials.get() — لازم يفضل جوّه نفس الـuser gesture (كليك مباشر)
 * عشان بعض المتصفحات (خصوصًا Safari) بترفض تفتح WebAuthn prompt من غير تفاعل مستخدم مباشر.
 */
export function StepUpDialog({
  open,
  isVerifying,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  isVerifying: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>تأكيد هويتك مطلوب</DialogTitle>
          <DialogDescription>
            العملية دي حساسة وبتحتاج تأكيد Passkey حديث (بصمة/Face ID/مفتاح أمان) — حتى لو أنت
            داخل بالفعل. ده إجراء أمان إضافي لحماية العمليات المالية والإدارية الحساسة.
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isVerifying}>
            إلغاء
          </Button>
          <Button onClick={onConfirm} disabled={isVerifying}>
            {isVerifying ? 'جاري التأكيد…' : 'تأكيد بـ Passkey'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

