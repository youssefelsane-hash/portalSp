'use client';

import { useState, type FormEvent } from 'react';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SelectNative } from '@/components/ui/select-native';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';

// §24 — كانت فجوة موثّقة: PATCH /admin/wallets/:userId/adjust موجود ومختبر (wallets.adjust +
// step-up إجباري، docs/08 §20 بند 5) بس صفر زرار له في أي شاشة — أدمن Finance مضطر ينادي الـAPI
// مباشرة لأي تصحيح رصيد يدوي. مكوّن مشترك (نفس الفورم مستخدم في /customers/[userId] و
// /technicians/[id] بالحرف — صف واحد لمنع تكرار المنطق).
function WalletAdjustmentForm({ userId, onAdjusted }: { userId: string; onAdjusted: () => void }) {
  const { authedFetch } = useAuth();
  const [open, setOpen] = useState(false);
  const [amountEgp, setAmountEgp] = useState('');
  const [direction, setDirection] = useState<'credit' | 'debit'>('credit');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setAmountEgp('');
      setReason('');
      setError(null);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const amountCents = Math.round(Number(amountEgp) * 100);
    if (!amountCents || amountCents < 1) {
      setError('المبلغ لازم يكون رقم أكبر من صفر');
      return;
    }
    if (reason.trim().length < 5) {
      setError('السبب لازم يكون 5 حروف على الأقل');
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/wallets/${userId}/adjust`, {
        method: 'PATCH',
        body: JSON.stringify({ amount_cents: amountCents, direction, reason_ar: reason.trim() }),
      });
      handleOpenChange(false);
      onAdjusted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          تصحيح رصيد يدوي
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>تصحيح رصيد المحفظة يدويًا</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-4">
            <div>
              <Label htmlFor="wallet-adjust-amount" className="mb-1.5 block">
                المبلغ (جنيه)
              </Label>
              <Input
                id="wallet-adjust-amount"
                type="number"
                min={0.01}
                step="0.01"
                value={amountEgp}
                onChange={(e) => setAmountEgp(e.target.value)}
                autoFocus
                required
              />
            </div>
            <div>
              <Label htmlFor="wallet-adjust-direction" className="mb-1.5 block">
                الاتجاه
              </Label>
              <SelectNative
                id="wallet-adjust-direction"
                value={direction}
                onChange={(e) => setDirection(e.target.value as 'credit' | 'debit')}
              >
                <option value="credit">زيادة (لصالح المستخدم)</option>
                <option value="debit">نقص (ضد المستخدم)</option>
              </SelectNative>
            </div>
            <div>
              <Label htmlFor="wallet-adjust-reason" className="mb-1.5 block">
                السبب
              </Label>
              <Input id="wallet-adjust-reason" value={reason} onChange={(e) => setReason(e.target.value)} minLength={5} required />
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                إلغاء
              </Button>
            </DialogClose>
            <Button type="submit" disabled={isSaving}>
              تأكيد التصحيح
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export { WalletAdjustmentForm };
