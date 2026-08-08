'use client';

import { useEffect, useState, type FormEvent } from 'react';
import type {
  CancellationAppliesTo,
  CancellationReasonResponseDto,
  CreateCancellationReasonBody,
} from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { SelectNative } from '@/components/ui/select-native';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

const APPLIES_TO_LABELS: Record<CancellationAppliesTo, string> = {
  customer: 'العميل',
  technician: 'الفني',
  admin: 'الأدمن',
};

export default function CancellationReasonsPage() {
  const { isLoading, authedFetch } = useAuth();
  const [reasons, setReasons] = useState<CancellationReasonResponseDto[] | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  function load() {
    authedFetch<CancellationReasonResponseDto[]>('/admin/cancellation-reasons')
      .then(setReasons)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل الأسباب'));
  }

  useEffect(() => {
    if (isLoading) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    const form = new FormData(e.target as HTMLFormElement);
    const chargesFee = form.get('charges_fee') === 'on';
    const body: CreateCancellationReasonBody = {
      reason_ar: form.get('reason_ar') as string,
      reason_en: form.get('reason_en') as string,
      applies_to: form.get('applies_to') as CancellationAppliesTo,
      charges_fee: chargesFee,
      affects_technician_score: form.get('affects_technician_score') === 'on',
    };
    if (chargesFee) {
      body.fee_percentage = Number(form.get('fee_percentage') as string);
    }
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch('/admin/cancellation-reasons', { method: 'POST', body: JSON.stringify(body) });
      setShowNew(false);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  async function toggleActive(reason: CancellationReasonResponseDto) {
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/cancellation-reasons/${reason.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: !reason.is_active }),
      });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <AppShell>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">أسباب الإلغاء</h1>
        <Button size="sm" variant="outline" onClick={() => setShowNew((s) => !s)}>
          + سبب جديد
        </Button>
      </div>

      {error && <p className="mb-4 text-destructive">{error}</p>}

      {showNew && (
        <Card className="mb-6">
          <CardContent className="pt-6">
            <form onSubmit={handleCreate} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="reason_ar">السبب (عربي)</Label>
                <Input id="reason_ar" name="reason_ar" required minLength={2} maxLength={200} />
              </div>
              <div>
                <Label htmlFor="reason_en">السبب (إنجليزي)</Label>
                <Input id="reason_en" name="reason_en" required minLength={2} maxLength={200} dir="ltr" />
              </div>
              <div>
                <Label htmlFor="applies_to">بيتاح لمين</Label>
                <SelectNative id="applies_to" name="applies_to" defaultValue="customer">
                  {Object.entries(APPLIES_TO_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </SelectNative>
              </div>
              <div>
                <Label htmlFor="fee_percentage">نسبة الرسوم % (لو "بيحصّل رسوم" مفعّلة)</Label>
                <Input id="fee_percentage" name="fee_percentage" type="number" min={0} max={100} dir="ltr" />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="charges_fee" />
                بيحصّل رسوم
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="affects_technician_score" />
                بيأثر على تقييم الفني
              </label>
              <Button type="submit" size="sm" disabled={isSaving} className="w-fit sm:col-span-2">
                حفظ السبب
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {!reasons && <p className="text-muted-foreground">جاري التحميل…</p>}
      {reasons && reasons.length === 0 && <p className="text-muted-foreground">مفيش أسباب لسه</p>}

      {reasons && reasons.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>السبب</TableHead>
              <TableHead>بيتاح لـ</TableHead>
              <TableHead>الرسوم</TableHead>
              <TableHead>الحالة</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {reasons.map((reason) => (
              <TableRow key={reason.id}>
                <TableCell>{reason.reason_ar}</TableCell>
                <TableCell>{APPLIES_TO_LABELS[reason.applies_to]}</TableCell>
                <TableCell>{reason.charges_fee ? `${reason.fee_percentage}%` : '—'}</TableCell>
                <TableCell>
                  <button type="button" disabled={isSaving} onClick={() => toggleActive(reason)} className="cursor-pointer">
                    <Badge variant={reason.is_active ? 'secondary' : 'outline'}>
                      {reason.is_active ? 'مفعّل' : 'معطّل'}
                    </Badge>
                  </button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </AppShell>
  );
}
