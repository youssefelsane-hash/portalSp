'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import type {
  AdminTechnicianResponseDto,
  OrderDetailResponseDto,
  OrderItemResponseDto,
  OrderMediaResponseDto,
  TeamMemberResponseDto,
} from '@baytak/shared-types';
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
import { PageHeader } from '@/components/page-header';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { SelectNative } from '@/components/ui/select-native';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import {
  ORDER_STATUS_LABELS,
  ORDER_TYPE_LABELS,
  BOOKING_MODE_LABELS,
  orderStatusTone,
  PAYMENT_STATUS_LABELS,
  paymentStatusTone,
  isOrderCancellable,
  isOrderReassignable,
} from '@/lib/order-labels';
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
  const [showAdjustPriceForm, setShowAdjustPriceForm] = useState(false);
  const [newTotalEgp, setNewTotalEgp] = useState('');
  const [adjustPriceReason, setAdjustPriceReason] = useState('');
  const [teamMembers, setTeamMembers] = useState<TeamMemberResponseDto[]>([]);
  const [showAssignAssistantForm, setShowAssignAssistantForm] = useState(false);
  const [assistantTechnicianId, setAssistantTechnicianId] = useState('');

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
    // تعيين مساعد يدوي بعد التصعيد (ADR-0008) — محتاجين نعرف كام مساعد اتعيّن فعلاً عشان
    // نعرف نعرض فورم التعيين ولا لأ (لو الأماكن اكتملت بالفعل، مفيش داعي نعرضه).
    authedFetch<TeamMemberResponseDto[]>(`/admin/orders/${id}/team-members`)
      .then(setTeamMembers)
      .catch(() => setTeamMembers([]));
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

  // كانت فجوة موثّقة صراحة برضه: PATCH /admin/orders/:id/adjust-price موجود ومختبر (تعديل
  // يدوي لسعر طلب لسه ما اتدفعش، لتصحيح خطأ/تعويض) بس مفيش أي زرار ليه في أي شاشة.
  async function handleAdjustPrice(e: FormEvent) {
    e.preventDefault();
    const newTotalCents = Math.round(Number(newTotalEgp) * 100);
    if (!newTotalCents || newTotalCents < 0) return;
    if (adjustPriceReason.trim().length < 5) {
      window.alert('السبب لازم يكون 5 حروف على الأقل');
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/orders/${id}/adjust-price`, {
        method: 'PATCH',
        body: JSON.stringify({ new_total_amount_cents: newTotalCents, reason: adjustPriceReason }),
      });
      setShowAdjustPriceForm(false);
      setNewTotalEgp('');
      setAdjustPriceReason('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  // تعيين مساعد يدوي بعد تصعيد مطابقة المساعد التلقائية (ADR-0008) — POST /admin/orders/:id/assistants
  // كان موجود بلا أي واجهة تستخدمه، نفس فئة adjust-price/refund فوق.
  async function handleAssignAssistant(e: FormEvent) {
    e.preventDefault();
    if (!assistantTechnicianId) return;
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/orders/${id}/assistants`, {
        method: 'POST',
        body: JSON.stringify({ technician_id: assistantTechnicianId }),
      });
      setShowAssignAssistantForm(false);
      setAssistantTechnicianId('');
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
      <PageHeader
        title={
          <>
            طلب {order.order_number}
            <StatusChip tone={orderStatusTone(order.order_status)}>
              {ORDER_STATUS_LABELS[order.order_status]}
            </StatusChip>
            {order.order_type === 'emergency' && <Badge variant="destructive">طوارئ</Badge>}
            {order.order_type === 'recurring' && <Badge variant="outline">متكرر</Badge>}
            {order.original_order_id && (
              <Link href={`/orders/${order.original_order_id}`}>
                <Badge variant="outline">إعادة زيارة — الطلب الأصلي</Badge>
              </Link>
            )}
            {order.building_id && <Badge variant="outline">عمارة</Badge>}
          </>
        }
        actions={
          <Button variant="outline" onClick={() => router.push('/orders')}>
            رجوع للقايمة
          </Button>
        }
      />

      {error && <p className="mb-4 text-destructive">{error}</p>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">البيانات</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <p>نوع الطلب: {ORDER_TYPE_LABELS[order.order_type] ?? order.order_type}</p>
            <p>وضع الحجز: {BOOKING_MODE_LABELS[order.booking_mode] ?? order.booking_mode}</p>
            <p>الإجمالي: {formatEgp(order.total_amount_cents)}</p>
            <p className="flex items-center gap-2">
              حالة الدفع:
              <StatusChip tone={paymentStatusTone(order.payment_status)}>
                {PAYMENT_STATUS_LABELS[order.payment_status] ?? order.payment_status}
              </StatusChip>
            </p>
            <p>رسوم الكشف: {formatEgp(order.inspection_fee_cents)}</p>
            {order.surge_amount_cents > 0 && (
              <p className="text-destructive">رسوم الطوارئ: {formatEgp(order.surge_amount_cents)}</p>
            )}
            {order.discount_amount_cents > 0 && <p>الخصم: {formatEgp(order.discount_amount_cents)}</p>}
            <p>الفني: {order.technician_id ? <span dir="ltr">{order.technician_id}</span> : 'لسه مفيش'}</p>
            {order.problem_description && <p>وصف المشكلة: {order.problem_description}</p>}
            {order.customer_notes && <p>ملاحظات العميل: {order.customer_notes}</p>}
            <p>
              اتحجز في: {order.placed_at ? new Date(order.placed_at).toLocaleString('ar-EG-u-nu-latn') : '—'}
            </p>
            {order.warranty_expires_at && (
              <p>
                الضمان لحد: {new Date(order.warranty_expires_at).toLocaleString('ar-EG-u-nu-latn')}
                {new Date(order.warranty_expires_at) > new Date() ? (
                  <Badge variant="secondary" className="mr-2">
                    سارٍ
                  </Badge>
                ) : (
                  <Badge variant="outline" className="mr-2">
                    منتهي
                  </Badge>
                )}
              </p>
            )}
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
          {order.payment_status !== 'paid' && (
            <CardFooter className="flex-col items-stretch gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isSaving}
                onClick={() => setShowAdjustPriceForm((s) => !s)}
                className="w-fit"
              >
                تعديل السعر يدويًا
              </Button>
              {showAdjustPriceForm && (
                <form onSubmit={handleAdjustPrice} className="flex flex-col gap-2">
                  <div>
                    <Label htmlFor="new_total_egp">السعر الجديد (جنيه)</Label>
                    <Input
                      id="new_total_egp"
                      type="number"
                      min={0}
                      step="0.01"
                      dir="ltr"
                      value={newTotalEgp}
                      onChange={(e) => setNewTotalEgp(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor="adjust_price_reason">السبب</Label>
                    <Input
                      id="adjust_price_reason"
                      value={adjustPriceReason}
                      onChange={(e) => setAdjustPriceReason(e.target.value)}
                      minLength={5}
                      required
                    />
                  </div>
                  <Button type="submit" size="sm" disabled={isSaving} className="w-fit">
                    حفظ السعر الجديد
                  </Button>
                </form>
              )}
            </CardFooter>
          )}
        </Card>

        {/* تعيين مساعد يدوي بعد التصعيد (ADR-0008) — بيظهر بس لو الطلب أصلاً محتاج مساعدين. */}
        {!!order.required_assistants && order.required_assistants > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">المساعدين ({teamMembers.length}/{order.required_assistants})</CardTitle>
            </CardHeader>
            <CardContent>
              {teamMembers.length === 0 ? (
                <p className="text-sm text-muted-foreground">مفيش مساعد معيّن لسه</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>الاسم</TableHead>
                      <TableHead>الدور</TableHead>
                      <TableHead>اتعيّن إمتى</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {teamMembers.map((member) => (
                      <TableRow key={member.id}>
                        <TableCell>{member.full_name}</TableCell>
                        <TableCell>{member.role_label}</TableCell>
                        <TableCell>{new Date(member.created_at).toLocaleString('ar-EG-u-nu-latn')}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
            {teamMembers.length < order.required_assistants && (
              <CardFooter className="flex-col items-stretch gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isSaving}
                  className="w-fit"
                  onClick={() => {
                    setShowAssignAssistantForm((s) => !s);
                    if (!approvedTechnicians) loadApprovedTechnicians();
                  }}
                >
                  عيّن مساعد يدويًا
                </Button>
                {showAssignAssistantForm && (
                  <form onSubmit={handleAssignAssistant} className="flex flex-col gap-2">
                    <Label htmlFor="assistant_technician_id">الفني</Label>
                    {!approvedTechnicians ? (
                      <p className="text-sm text-muted-foreground">بيحمّل قايمة الفنيين…</p>
                    ) : (
                      <SelectNative
                        id="assistant_technician_id"
                        value={assistantTechnicianId}
                        onChange={(e) => setAssistantTechnicianId(e.target.value)}
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
                    <Button type="submit" size="sm" disabled={isSaving || !assistantTechnicianId}>
                      تأكيد التعيين
                    </Button>
                  </form>
                )}
              </CardFooter>
            )}
          </Card>
        )}

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
            <CardTitle className="text-base">الإنتاجية والمدة المتوقعة</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {order.pricing_evaluation ? (
              <>
                <p>
                  المدة المتوقعة:{' '}
                  {order.pricing_evaluation.computed_duration_days !== null
                    ? `${order.pricing_evaluation.computed_duration_days} يوم`
                    : '—'}
                </p>
                <p>
                  عدد الصنايعية المطلوب:{' '}
                  {order.pricing_evaluation.computed_technicians ?? '—'}
                </p>
                <p>
                  عدد المساعدين المطلوب:{' '}
                  {order.pricing_evaluation.computed_assistants ?? '—'}
                </p>
                <p className="text-xs text-muted-foreground">
                  محسوبة وقت الحجز في:{' '}
                  {new Date(order.pricing_evaluation.created_at).toLocaleString('ar-EG-u-nu-latn')}
                </p>
              </>
            ) : order.standard_data_id ? (
              // محرك الإنتاجية (docs/06 §3.3-§3.6) — نفس فكرة pricing_evaluation فوق بس لخدمات
              // مبنية على بيانات قياسية (service_standard_data) مش formula.
              <>
                <p>
                  المدة المتوقعة:{' '}
                  {order.estimated_duration_days !== null ? `${order.estimated_duration_days} يوم` : '—'}
                </p>
                <p>عدد الصنايعية المطلوب: {order.required_technicians ?? '—'}</p>
                <p>عدد المساعدين المطلوب: {order.required_assistants ?? '—'}</p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                مفيش بيانات إنتاجية محسوبة لهذا الطلب — الخدمة مش بتستخدم معادلة تسعير (pricing_model=formula)
                ولا بيانات قياسية (service_standard_data)
              </p>
            )}
          </CardContent>
        </Card>

        {order.technician_cancellations.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">إلغاءات الفني (سياسة إلغاء الفني)</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>وقت الإلغاء</TableHead>
                    <TableHead>بعد القبول بـ</TableHead>
                    <TableHead>جوّه النافذة؟</TableHead>
                    <TableHead>إجراء الاسترجاع</TableHead>
                    <TableHead>الرسوم</TableHead>
                    <TableHead>السبب</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {order.technician_cancellations.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>{new Date(c.cancelled_at).toLocaleString('ar-EG-u-nu-latn')}</TableCell>
                      <TableCell>{Math.round(c.elapsed_seconds_after_acceptance / 60)} دقيقة</TableCell>
                      <TableCell>{c.within_policy_window ? 'أيوه' : 'لأ (متأخر)'}</TableCell>
                      <TableCell>
                        {c.recovery_action === 'auto_rematch' ? 'إعادة مطابقة تلقائية' : 'محتاج العميل يختار بديل'}
                      </TableCell>
                      <TableCell>{c.fee_cents > 0 ? `${c.fee_cents / 100} ج.م.` : '—'}</TableCell>
                      <TableCell>{c.reason_text ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

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
