'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { OrderDetailResponseDto } from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { ORDER_STATUS_LABELS, orderStatusBadgeVariant, isOrderCancellable } from '@/lib/order-labels';
import { formatEgp } from '@/lib/format';

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { isLoading, authedFetch } = useAuth();
  const router = useRouter();

  const [order, setOrder] = useState<OrderDetailResponseDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showCancelForm, setShowCancelForm] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [showReassignForm, setShowReassignForm] = useState(false);
  const [technicianId, setTechnicianId] = useState('');

  function load() {
    authedFetch<OrderDetailResponseDto>(`/admin/orders/${id}`)
      .then(setOrder)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل الطلب'));
  }

  useEffect(() => {
    if (isLoading) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, id]);

  async function handleCancel(e: FormEvent) {
    e.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/orders/${id}/cancel`, { method: 'POST', body: JSON.stringify({ reason: cancelReason }) });
      setShowCancelForm(false);
      setCancelReason('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleReassign(e: FormEvent) {
    e.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/orders/${id}/reassign`, {
        method: 'POST',
        body: JSON.stringify({ technician_id: technicianId }),
      });
      setShowReassignForm(false);
      setTechnicianId('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  if (error && !order) {
    return (
      <AppShell>
        <p className="text-destructive">{error}</p>
      </AppShell>
    );
  }

  if (!order) {
    return (
      <AppShell>
        <p className="text-muted-foreground">جاري التحميل…</p>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">طلب {order.order_number}</h1>
          <Badge variant={orderStatusBadgeVariant(order.order_status)}>
            {ORDER_STATUS_LABELS[order.order_status]}
          </Badge>
        </div>
        <Button variant="outline" onClick={() => router.push('/orders')}>
          رجوع للقايمة
        </Button>
      </div>

      {error && <p className="mb-4 text-destructive">{error}</p>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">البيانات</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <p>الإجمالي: {formatEgp(order.total_amount_cents)}</p>
            <p>حالة الدفع: {order.payment_status}</p>
            <p>رسوم الكشف: {formatEgp(order.inspection_fee_cents)}</p>
            {order.discount_amount_cents > 0 && <p>الخصم: {formatEgp(order.discount_amount_cents)}</p>}
            <p>الفني: {order.technician_id ? <span dir="ltr">{order.technician_id}</span> : 'لسه مفيش'}</p>
            {order.problem_description && <p>وصف المشكلة: {order.problem_description}</p>}
            {order.customer_notes && <p>ملاحظات العميل: {order.customer_notes}</p>}
            <p>
              اتحجز في: {order.placed_at ? new Date(order.placed_at).toLocaleString('ar-EG-u-nu-latn') : '—'}
            </p>
          </CardContent>
          {isOrderCancellable(order.order_status) && (
            <CardFooter className="flex-col items-stretch gap-3">
              <div className="flex gap-2">
                <Button variant="destructive" disabled={isSaving} onClick={() => setShowCancelForm((s) => !s)}>
                  إلغاء الطلب
                </Button>
                {order.technician_id && (
                  <Button variant="outline" disabled={isSaving} onClick={() => setShowReassignForm((s) => !s)}>
                    إعادة تعيين فني
                  </Button>
                )}
              </div>
              {showCancelForm && (
                <form onSubmit={handleCancel} className="flex flex-col gap-2">
                  <Label htmlFor="cancel_reason">سبب الإلغاء</Label>
                  <Input
                    id="cancel_reason"
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                    minLength={5}
                    required
                  />
                  <Button type="submit" variant="destructive" size="sm" disabled={isSaving}>
                    تأكيد الإلغاء
                  </Button>
                </form>
              )}
              {showReassignForm && (
                <form onSubmit={handleReassign} className="flex flex-col gap-2">
                  <Label htmlFor="technician_id">معرّف الفني الجديد (UUID)</Label>
                  <Input
                    id="technician_id"
                    dir="ltr"
                    value={technicianId}
                    onChange={(e) => setTechnicianId(e.target.value)}
                    required
                  />
                  <Button type="submit" size="sm" disabled={isSaving}>
                    تأكيد إعادة التعيين
                  </Button>
                </form>
              )}
            </CardFooter>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">تاريخ الحالة</CardTitle>
          </CardHeader>
          <CardContent>
            {order.status_history.length === 0 ? (
              <p className="text-sm text-muted-foreground">مفيش سجل</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>من</TableHead>
                    <TableHead>إلى</TableHead>
                    <TableHead>الوقت</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {order.status_history.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell>{entry.previous_status ? ORDER_STATUS_LABELS[entry.previous_status] : '—'}</TableCell>
                      <TableCell>{ORDER_STATUS_LABELS[entry.new_status]}</TableCell>
                      <TableCell>{new Date(entry.created_at).toLocaleString('ar-EG-u-nu-latn')}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
