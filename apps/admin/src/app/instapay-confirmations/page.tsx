'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { InstaPayPaymentResponseDto } from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { useAdminLiveRefresh } from '@/lib/admin-realtime-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { StatusChip } from '@/components/status-chip';
import { PromptDialog } from '@/components/prompt-dialog';
import { TableSkeleton } from '@/components/table-skeleton';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { formatEgp } from '@/lib/format';
import Link from 'next/link';

// طابور تأكيد InstaPay الإداري (§28) — كانت فجوة حقيقية: confirm/reject-instapay موجودين من زمان
// جوّه apps/orders/[id]/page.tsx بس مفيش شاشة تجمّع الدفعات المعلّقة في مكان واحد — موظف Finance
// كان لازم يدوّر طلب-طلب. نفس أسلوب /payouts بالحرف (طابور + موافقة/رفض).
export default function InstaPayConfirmationsPage() {
  const { isLoading, authedFetch, hasPermission } = useAuth();
  const [payments, setPayments] = useState<InstaPayPaymentResponseDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  // طلب مالك (2026-09-10): التحويلة المؤكَّدة **تفضل ظاهرة** بحالتها وتاريخها، مش تختفي.
  // الفلتر بيبدأ على «الكل» عشان ده هو السلوك المطلوب، والمعلّق بيتصدّر من الباك-إند نفسه.
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'decided'>('all');

  function load(status: 'all' | 'pending' | 'decided' = statusFilter) {
    authedFetch<{ items: InstaPayPaymentResponseDto[] }>(`/admin/payments/instapay?status=${status}`)
      .then((res) => setPayments(res.items))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل تحويلات InstaPay'));
  }

  useEffect(() => {
    if (isLoading) return;
    load(statusFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, statusFilter]);
  // docs/08 §63.ب1 — تحديث حي: الباك-إند بيبثّ الأحداث دي أصلاً عبر AdminRealtimeGateway،
  // الصفحة دي كانت بتفوّتها فكانت محتاجة refresh يدوي.
  useAdminLiveRefresh(["payments"], () => load());

  async function runAction(action: () => Promise<unknown>) {
    setIsSaving(true);
    setError(null);
    try {
      await action();
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleConfirm(id: string) {
    await runAction(() => authedFetch(`/admin/payments/${id}/confirm-instapay`, { method: 'POST' }));
  }

  async function handleReject(id: string, reason: string) {
    await runAction(() => authedFetch(`/admin/payments/${id}/reject-instapay`, { method: 'POST', body: JSON.stringify({ reason }) }));
  }

  return (
    <AppShell>
      <PageHeader
        title="تأكيدات InstaPay"
        description={
          'سجل تحويلات InstaPay كامل: المعلّق محتاج القرار ظاهر الأول (واللي العميل بلّغ التحويل ' +
          'فيه قبل غيره)، والمؤكَّد والمرفوض بيفضلوا في نفس الشاشة بتاريخ القرار ومين اتخذه. ' +
          'رقم الطلب في العمود الأول هو نفس الكود اللي العميل مكتوب له صراحةً إنه يحطّه في ملاحظة ' +
          'تحويل InstaPay — قارنه مباشرة بملاحظة التحويل الفعلية في كشف الحساب قبل ما تأكّد.'
        }
      />

      {/* ضبط الـQR جوّه نفس الصفحة عمدًا (docs/08 §78-د): ده المكان اللي موظف الـFinance
          بيراجع فيه تحويلات InstaPay فعليًا، فبيانات استقبالها المفروض تبقى قدّامه هنا مش
          مدفونة في /settings. الكارت بيختفي لمن مالوش `settings.manage` — القراءة نفسها محمية
          في الباك-إند برضه، مش بالإخفاء ده بس. */}
      {hasPermission('settings.manage') && <InstaPayQrCard authedFetch={authedFetch} />}

      {/* الفلتر مش تزويق: موظف الـFinance محتاج يشوف «اللي محتاج قرار» لوحده لما الطابور
          يكبر، من غير ما يفقد السجل اللي المالك طلب إنه يفضل ظاهر. */}
      <div className="mb-4 flex flex-wrap gap-2">
        {([
          ['all', 'الكل'],
          ['pending', 'محتاج قرار'],
          ['decided', 'تم البتّ فيها'],
        ] as const).map(([value, label]) => (
          <Button
            key={value}
            size="sm"
            variant={statusFilter === value ? 'default' : 'outline'}
            onClick={() => {
              setPayments(null);
              setStatusFilter(value);
            }}
          >
            {label}
          </Button>
        ))}
      </div>

      {error && <p className="mb-4 text-destructive">{error}</p>}
      {!error && !payments && <TableSkeleton columns={7} />}
      {payments && payments.length === 0 && (
        <EmptyState
          title={
            statusFilter === 'pending'
              ? 'مفيش دفعات InstaPay محتاجة قرار دلوقتي'
              : 'مفيش تحويلات InstaPay مسجّلة'
          }
        />
      )}

      {payments && payments.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>الطلب</TableHead>
              <TableHead>العميل</TableHead>
              <TableHead>المبلغ</TableHead>
              <TableHead>الحالة</TableHead>
              <TableHead>الخط الزمني</TableHead>
              <TableHead>القرار</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {payments.map((payment) => (
              <TableRow key={payment.id}>
                <TableCell>
                  <Link href={`/orders/${payment.order_id}`} className="underline" dir="ltr">
                    {payment.order_number}
                  </Link>
                  <span className="block text-xs text-muted-foreground" dir="ltr">
                    {payment.payment_number}
                  </span>
                </TableCell>
                <TableCell>
                  {payment.customer_name}
                  <span className="block text-xs text-muted-foreground" dir="ltr">
                    {payment.customer_phone}
                  </span>
                </TableCell>
                <TableCell>
                  <span className="font-medium">{formatEgp(payment.amount_cents)}</span>
                  {/* «معلومات الفلوس لازم تكون دقيقة جدًا» — التحويلة ممكن تكون عربون أو قسط،
                      فعرض إجمالي الطلب جنبها بيمنع قراءة غلط، والمُسترَد بيتشال صراحةً. */}
                  <span className="block text-xs text-muted-foreground">
                    من إجمالي {formatEgp(payment.order_total_amount_cents)}
                    {payment.installment_id ? ' · قسط' : ''}
                  </span>
                  {payment.refunded_cents > 0 && (
                    <span className="block text-xs text-destructive">
                      اتردّ منها {formatEgp(payment.refunded_cents)} · الصافي{' '}
                      {formatEgp(payment.amount_cents - payment.refunded_cents)}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  {payment.payment_status === 'succeeded' ? (
                    <StatusChip tone="success">مؤكَّدة — الفلوس وصلت</StatusChip>
                  ) : payment.payment_status === 'failed' ? (
                    <StatusChip tone="danger">مرفوضة</StatusChip>
                  ) : payment.customer_confirmed_transfer_at ? (
                    <StatusChip tone="warning">العميل بلّغ التحويل</StatusChip>
                  ) : (
                    <StatusChip tone="neutral">مستنّي العميل يبلّغ</StatusChip>
                  )}
                  {payment.gateway_reference && (
                    <span className="block text-xs text-muted-foreground" dir="ltr">
                      {payment.gateway_reference}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-xs leading-6">
                  <span className="block">
                    بدأت: {new Date(payment.initiated_at).toLocaleString('ar-EG-u-nu-latn')}
                  </span>
                  <span className="block">
                    بلاغ العميل:{' '}
                    {payment.customer_confirmed_transfer_at
                      ? new Date(payment.customer_confirmed_transfer_at).toLocaleString('ar-EG-u-nu-latn')
                      : '—'}
                  </span>
                </TableCell>
                <TableCell className="text-xs leading-6">
                  {payment.decided_at ? (
                    <>
                      <span className="block">{new Date(payment.decided_at).toLocaleString('ar-EG-u-nu-latn')}</span>
                      <span className="block text-muted-foreground">
                        بواسطة {payment.decided_by_name ?? '—'}
                      </span>
                      {payment.failure_message && (
                        <span className="block text-destructive">السبب: {payment.failure_message}</span>
                      )}
                    </>
                  ) : (
                    <span className="text-muted-foreground">لسه محتاجة قرار</span>
                  )}
                </TableCell>
                <TableCell>
                  {/* الأزرار بتظهر للمعلّق بس — التحويلة اللي اتبتّ فيها بقت سجل، والتغيير
                      عليها بيتم من صفحة الطلب نفسها (استرداد)، مش بإعادة تأكيد. */}
                  {payment.payment_status === 'pending' ? (
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" disabled={isSaving} onClick={() => handleConfirm(payment.id)}>
                        تأكيد الاستلام
                      </Button>
                      <PromptDialog
                        trigger={
                          <Button size="sm" variant="destructive" disabled={isSaving}>
                            رفض
                          </Button>
                        }
                        title="رفض دفعة InstaPay"
                        label="سبب الرفض"
                        minLength={2}
                        confirmLabel="رفض"
                        destructive
                        onConfirm={(reason) => handleReject(payment.id, reason)}
                      />
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </AppShell>
  );
}

interface InstaPayQrView {
  url: string | null;
  source: 'uploaded' | 'link' | null;
}

/**
 * ضبط QR استقبال تحويلات InstaPay (docs/08 §78-د، migration 0211).
 *
 * **طريقتين لنفس الإعداد الواحد**: رفع ملف صورة، أو لصق رابط https — والاتنين بيكتبوا في
 * `payments.instapay.qr_image`، فالأحدث هو اللي بيكسب دايمًا بلا أي التباس. الشيل بيرجّع الحالة
 * لـ«مفيش QR» وشاشة العميل بتعرض التعليمات النصية بس، زي ما كانت قبل الميزة دي بالظبط.
 *
 * الكتابة كلها محمية بـStep-Up في الباك-إند (نفس مستوى الاسترداد) — بيتعامل معاه `authedFetch`
 * تلقائيًا، فالمكوّن ده مش عارف عنه حاجة.
 */
function InstaPayQrCard({ authedFetch }: { authedFetch: <T>(path: string, options?: RequestInit) => Promise<T> }) {
  const [view, setView] = useState<InstaPayQrView | null>(null);
  const [link, setLink] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    authedFetch<InstaPayQrView>('/admin/payments/instapay-qr')
      .then(setView)
      .catch(() => setView({ url: null, source: null }));
  }, [authedFetch]);

  async function run(action: () => Promise<InstaPayQrView>, successMessage: string) {
    setIsBusy(true);
    try {
      setView(await action());
      toast.success(successMessage);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="text-sm font-medium">كود QR لاستقبال تحويلات InstaPay</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-start">
        {/* خلفية بيضا دايمًا — قارئات QR بتتوقّع مربّعات غامقة على فاتح، ومعاينة على سطح غامق
            بتخفي مشكلة حقيقية بتظهر بعدين على تليفون العميل. */}
        <div className="flex h-40 w-40 shrink-0 items-center justify-center rounded-md border bg-white">
          {view?.url ? (
            // eslint-disable-next-line @next/next/no-img-element -- رابط ديناميكي (presigned أو خارجي)، مش أصل static
            <img src={view.url} alt="QR كود InstaPay" className="max-h-36 max-w-36 object-contain" />
          ) : (
            <span className="px-2 text-center text-xs text-muted-foreground">
              مفيش QR — العميل بيشوف تعليمات التحويل النصية بس
            </span>
          )}
        </div>

        <div className="flex flex-1 flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            الصورة دي بتظهر للعميل في شاشة الدفع بـInstaPay جنب رقم الطلب وتعليمات التحويل. PNG/JPEG/WEBP بس، حتى 5MB.
            {view?.source === 'link' && ' (الحالي: رابط خارجي)'}
            {view?.source === 'uploaded' && ' (الحالي: ملف مرفوع)'}
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  const formData = new FormData();
                  formData.append('file', file);
                  void run(
                    () => authedFetch<InstaPayQrView>('/admin/payments/instapay-qr', { method: 'POST', body: formData }),
                    'اترفع الـQR',
                  );
                }
                e.target.value = '';
              }}
            />
            <Button size="sm" variant="outline" disabled={isBusy} onClick={() => fileInputRef.current?.click()}>
              {isBusy ? 'شغّال…' : 'ارفع صورة'}
            </Button>
            {view?.url && (
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive"
                disabled={isBusy}
                onClick={() =>
                  void run(
                    () => authedFetch<InstaPayQrView>('/admin/payments/instapay-qr', { method: 'DELETE' }),
                    'اتشال الـQR',
                  )
                }
              >
                شيل الـQR
              </Button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Input
              dir="ltr"
              placeholder="https://…/instapay-qr.png"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              className="max-w-md flex-1"
            />
            <Button
              size="sm"
              variant="outline"
              disabled={isBusy || link.trim().length === 0}
              onClick={() =>
                void run(async () => {
                  const next = await authedFetch<InstaPayQrView>('/admin/payments/instapay-qr', {
                    method: 'PUT',
                    body: JSON.stringify({ url: link.trim() }),
                  });
                  setLink('');
                  return next;
                }, 'اتحفظ الرابط')
              }
            >
              استخدم رابط
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
