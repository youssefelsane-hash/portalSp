'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { useAdminLiveRefresh } from '@/lib/admin-realtime-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatEgp } from '@/lib/format';

// ADR-0041 / docs/08 §63.أ2 — نص المالك: «الأدمن يكون عنده الأكسس إنه يقول إن الراجل ده دفع
// فنصفر له المديونيات بتاعته، الراجل ده ما دفعش فلأ الفلوس دول مفتوحة كده عنده في الظل».

type DebtStatus = 'none' | 'ok' | 'watch' | 'alert';

interface DebtView {
  technicianId: string;
  status: DebtStatus;
  debtCents: number;
  ageDays: number | null;
  exceedsAmount: boolean;
  exceedsAge: boolean;
  balanceCents: number;
  debtSinceAt: string | null;
  settlements: {
    id: string;
    amountCents: number;
    method: 'cash' | 'instapay' | 'bank_transfer';
    externalReference: string | null;
    note: string | null;
    recordedAt: string;
    balanceBeforeCents: number;
    balanceAfterCents: number;
  }[];
}

const METHOD_LABELS: Record<DebtView['settlements'][number]['method'], string> = {
  cash: 'كاش',
  instapay: 'إنستاباي',
  bank_transfer: 'تحويل بنكي',
};

const STATUS: Record<DebtStatus, { label: string; variant: 'secondary' | 'outline' | 'destructive' }> = {
  none: { label: 'مفيش مديونية', variant: 'secondary' },
  ok: { label: 'مديونية عادية', variant: 'outline' },
  watch: { label: 'تستاهل متابعة', variant: 'outline' },
  alert: { label: 'إنذار', variant: 'destructive' },
};

export function TechnicianDebtPanel({ technicianId }: { technicianId: string }) {
  const { isLoading, authedFetch, hasPermission } = useAuth();
  const [debt, setDebt] = useState<DebtView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<DebtView['settlements'][number]['method']>('cash');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');

  const load = useCallback(() => {
    authedFetch<DebtView>(`/admin/technicians/${technicianId}/debt`)
      .then((d) => {
        setDebt(d);
        setError(null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل المديونية'));
  }, [authedFetch, technicianId]);

  useEffect(() => {
    if (isLoading) return;
    load();
  }, [isLoading, load]);

  useAdminLiveRefresh(['payments', 'payouts'], load);

  async function handleSettle(e: FormEvent) {
    e.preventDefault();
    const egp = Number(amount);
    if (!Number.isFinite(egp) || egp <= 0) return;
    setIsSaving(true);
    setError(null);
    try {
      const updated = await authedFetch<DebtView>(`/admin/technicians/${technicianId}/debt/settlements`, {
        method: 'POST',
        body: JSON.stringify({
          amount_cents: Math.round(egp * 100),
          method,
          external_reference: reference.trim() || undefined,
          note: note.trim() || undefined,
        }),
      });
      setDebt(updated);
      setAmount('');
      setReference('');
      setNote('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ في تسجيل السداد');
    } finally {
      setIsSaving(false);
    }
  }

  const canSettle = hasPermission('wallets.adjust');

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="text-base">
          مديونية الفني للمنصة
          {debt && (
            <Badge variant={STATUS[debt.status].variant} className="ms-2">
              {STATUS[debt.status].label}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        {error && <p className="text-destructive">{error}</p>}
        {!debt && !error && <p className="text-muted-foreground">جاري التحميل…</p>}

        {debt && (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <div className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground">المديونية الحالية</div>
                <div className={`mt-1 text-lg font-semibold tabular-nums ${debt.debtCents > 0 ? 'text-destructive' : ''}`}>
                  {formatEgp(debt.debtCents)}
                </div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground">من إمتى</div>
                <div className="mt-1 text-lg font-semibold tabular-nums">
                  {debt.ageDays === null ? '—' : `${debt.ageDays} يوم`}
                </div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground">رصيد المحفظة</div>
                <div className="mt-1 text-lg font-semibold tabular-nums">{formatEgp(debt.balanceCents)}</div>
              </div>
            </div>

            {debt.status === 'alert' && (
              <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-destructive">
                مبلغ كبير <strong>ومستمر من فترة</strong> — ده اللي يستاهل تدخّل، مش مجرد مديونية يوم أو
                يومين. الإنذار معلوماتي: الفني لسه بيشتغل عادي، والقرار قرارك.
              </p>
            )}
            {debt.status === 'watch' && (
              <p className="text-muted-foreground">
                {debt.exceedsAmount && !debt.exceedsAge && 'المبلغ كبير بس لسه جديد — طبيعي بعد طلب كاش كبير.'}
                {!debt.exceedsAmount && debt.exceedsAge && 'المبلغ صغير بس مستمر من فترة.'}
              </p>
            )}

            {debt.debtCents > 0 && canSettle && (
              <form onSubmit={handleSettle} className="flex flex-col gap-3 rounded-lg border p-3">
                <div className="font-medium">تسجيل سداد حصل برّه التطبيق</div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                  <div>
                    <Label htmlFor="debt-amount" className="mb-1.5 block">المبلغ (ج.م.)</Label>
                    <Input
                      id="debt-amount"
                      type="number"
                      min="0.01"
                      step="0.01"
                      max={debt.debtCents / 100}
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor="debt-method" className="mb-1.5 block">الطريقة</Label>
                    <select
                      id="debt-method"
                      className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                      value={method}
                      onChange={(e) => setMethod(e.target.value as typeof method)}
                    >
                      <option value="cash">كاش</option>
                      <option value="instapay">إنستاباي</option>
                      <option value="bank_transfer">تحويل بنكي</option>
                    </select>
                  </div>
                  <div>
                    <Label htmlFor="debt-ref" className="mb-1.5 block">رقم الإيصال/التحويل</Label>
                    <Input
                      id="debt-ref"
                      value={reference}
                      onChange={(e) => setReference(e.target.value)}
                      maxLength={120}
                      placeholder={method === 'cash' ? 'اختياري' : 'مهم للتحويلات'}
                    />
                  </div>
                  <div>
                    <Label htmlFor="debt-note" className="mb-1.5 block">ملاحظة</Label>
                    <Input id="debt-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Button type="submit" size="sm" disabled={isSaving}>
                    سجّل السداد
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={isSaving}
                    onClick={() => setAmount(String(debt.debtCents / 100))}
                  >
                    سدّد المديونية كاملة
                  </Button>
                </div>
              </form>
            )}

            {debt.debtCents > 0 && !canSettle && (
              <p className="text-muted-foreground">تسجيل السداد محتاج صلاحية تعديل المحافظ.</p>
            )}

            {debt.settlements.length > 0 && (
              <div className="overflow-x-auto">
                <div className="mb-2 font-medium">سجل السدادات</div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>التاريخ</TableHead>
                      <TableHead>المبلغ</TableHead>
                      <TableHead>الطريقة</TableHead>
                      <TableHead>المرجع</TableHead>
                      <TableHead>الرصيد قبل → بعد</TableHead>
                      <TableHead>ملاحظة</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {debt.settlements.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell>{new Date(s.recordedAt).toLocaleString('ar-EG-u-nu-latn')}</TableCell>
                        <TableCell className="tabular-nums">{formatEgp(s.amountCents)}</TableCell>
                        <TableCell>{METHOD_LABELS[s.method]}</TableCell>
                        <TableCell dir="ltr">{s.externalReference ?? '—'}</TableCell>
                        <TableCell className="tabular-nums">
                          {formatEgp(s.balanceBeforeCents)} → {formatEgp(s.balanceAfterCents)}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{s.note ?? '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
