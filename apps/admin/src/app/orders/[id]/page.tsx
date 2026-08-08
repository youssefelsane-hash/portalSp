'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { AdminTechnicianResponseDto, OrderDetailResponseDto, OrderItemResponseDto, OrderMediaResponseDto } from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';

// /uploads/... راجعة من LocalDiskStorageService بره الـ globalPrefix (/api/v1) عمداً — لازم
// أصل السيرفر بس من غير الـ prefix، مش نفس NEXT_PUBLIC_API_URL المستخدم في apiFetch.
const API_ORIGIN = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1').replace(/\/api\/v1\/?$/, '');

const MEDIA_TYPE_LABELS: Record<string, string> = {
  before_photo: 'قبل الشغل',
  after_photo: 'بعد الشغل',
  problem_photo: 'صورة المشكلة',
  receipt: 'إيصال',
  signature: 'توقيع',
  video: 'فيديو',
};

const ITEM_TYPE_LABELS: Record<string, string> = {
  service: 'خدمة',
  addon: 'إضافة',
  spare_part: 'قطعة غيار',
  extra_labor: 'أجرة إضافية',
};
import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { SelectNative } from '@/components/ui/select-native';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { ORDER_STATUS_LABELS, orderStatusBadgeVariant, isOrderCancellable, isOrderReassignable } from '@/lib/order-labels';
import { formatEgp } from '@/lib/format';

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { isLoading, authedFetch, authedFetchPaginated } = useAuth();
  const router = useRouter();

  const [order, setOrder] = useState<OrderDetailResponseDto | null>(null);
  const [media, setMedia] = useState<OrderMediaResponseDto[]>([]);
  const [quoteItems, setQuoteItems] = useState<OrderItemResponseDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showCancelForm, setShowCancelForm] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [showReassignForm, setShowReassignForm] = useState(false);
  const [technicianId, setTechnicianId] = useState('');
  const [approvedTechnicians, setApprovedTechnicians] = useState<AdminTechnicianResponseDto[] | null>(null);

  function load() {
    authedFetch<OrderDetailResponseDto>(`/admin/orders/${id}`)
      .then(setOrder)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل الطلب'));
    // مسار منفصل عمداً — فشل تحميل الصور (نادر) ميمنعش عرض باقي تفاصيل الطلب
    authedFetch<OrderMediaResponseDto[]>(`/admin/orders/${id}/media`)
      .then(setMedia)
      .catch(() => setMedia([]));
    authedFetch<OrderItemResponseDto[]>(`/admin/orders/${id}/quote-items`)
      .then(setQuoteItems)
      .catch(() => setQuoteItems([]));
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

  function loadApprovedTechnicians() {
    authedFetchPaginated<AdminTechnicianResponseDto>('/admin/technicians?verification_status=approved&per_page=100')
      .then(({ items }) => setApprovedTechnicians(items))
      .catch(() => setApprovedTechnicians([]));
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

  // كانت فجوة موثّقة صراحة: POST /admin/orders/:id/refund موجود ومختبر من زمان (payments/README.md)
  // بس مفيش زرار ليه في أي شاشة — نفس فئة فجوة "endpoint إداري من غير واجهة" اللي ظهرت في
  // /customers, /support, /payouts. مطابق تماماً لشروط payments.service.ts's refundOrder():
  // payment_status=paid + order_status في completed/disputed بس (canTransition(..., REFUNDED)).
  async function handleRefund() {
    const reason = window.prompt('سبب الاسترجاع (حرفين على الأقل)؟');
    if (reason === null) return;
    if (reason.trim().length < 2) {
      window.alert('سبب الاسترجاع قصير جداً');
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/orders/${id}/refund`, {
        method: 'POST',
        body: JSON.stringify({ reason_notes: reason }),
      });
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
                {isOrderReassignable(order.order_status) && (
                  <Button
                    variant="outline"
                    disabled={isSaving}
                    onClick={() => {
                      setShowReassignForm((s) => !s);
                      if (!approvedTechnicians) loadApprovedTechnicians();
                    }}
                  >
                    {order.technician_id ? 'استبدال الفني المعيّن' : 'تعيين فني يدوي'}
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
                  <Label htmlFor="technician_id">الفني الجديد</Label>
                  {!approvedTechnicians ? (
                    <p className="text-sm text-muted-foreground">جاري تحميل الفنيين المعتمدين…</p>
                  ) : approvedTechnicians.length === 0 ? (
                    <p className="text-sm text-muted-foreground">مفيش فنيين معتمدين متاحين</p>
                  ) : (
                    <SelectNative
                      id="technician_id"
                      value={technicianId}
                      onChange={(e) => setTechnicianId(e.target.value)}
                      required
                    >
                      <option value="" disabled>
                        اختار فني
                      </option>
                      {approvedTechnicians.map((tech) => (
                        <option key={tech.id} value={tech.id}>
                          {tech.full_name} ({tech.technician_code})
                        </option>
                      ))}
                    </SelectNative>
                  )}
                  <Button type="submit" size="sm" disabled={isSaving || !technicianId}>
                    تأكيد إعادة التعيين
                  </Button>
                </form>
              )}
            </CardFooter>
          )}
          {order.payment_status === 'paid' &&
            (order.order_status === 'completed' || order.order_status === 'disputed') && (
              <CardFooter>
                <Button variant="destructive" disabled={isSaving} onClick={handleRefund}>
                  استرجاع المبلغ
                </Button>
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

        <Card>
          <CardHeader>
            <CardTitle className="text-base">بنود عرض السعر</CardTitle>
          </CardHeader>
          <CardContent>
            {quoteItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">مفيش بنود إضافية اتقترحت على الطلب ده</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>البند</TableHead>
                    <TableHead>النوع</TableHead>
                    <TableHead>السعر</TableHead>
                    <TableHead>الحالة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {quoteItems.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        {item.name_ar}
                        <span className="block text-xs text-muted-foreground">
                          {item.quantity} {item.unit_name ?? ''} × {formatEgp(item.unit_price_cents)}
                        </span>
                      </TableCell>
                      <TableCell>{ITEM_TYPE_LABELS[item.item_type] ?? item.item_type}</TableCell>
                      <TableCell>{formatEgp(item.total_price_cents)}</TableCell>
                      <TableCell>
                        <Badge variant={item.is_customer_approved ? 'secondary' : 'outline'}>
                          {item.is_customer_approved ? 'موافَق عليه' : 'معلّق'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">صور الطلب</CardTitle>
          </CardHeader>
          <CardContent>
            {media.length === 0 ? (
              <p className="text-sm text-muted-foreground">مفيش صور اترفعت للطلب ده لسه</p>
            ) : (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
                {media.map((item) => (
                  <a
                    key={item.id}
                    href={`${API_ORIGIN}${item.file_url}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex flex-col gap-1"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- ملف من سيرفر الباك-إند نفسه، مش next/image محتاجة config لأصل خارجي */}
                    <img
                      src={`${API_ORIGIN}${item.file_url}`}
                      alt={MEDIA_TYPE_LABELS[item.media_type] ?? item.media_type}
                      className="aspect-square w-full rounded-md border object-cover"
                    />
                    <span className="text-xs text-muted-foreground">
                      {MEDIA_TYPE_LABELS[item.media_type] ?? item.media_type}
                    </span>
                    {item.caption && <span className="text-xs">{item.caption}</span>}
                  </a>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
