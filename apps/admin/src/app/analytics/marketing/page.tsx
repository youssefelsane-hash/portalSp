'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import {
  MARKETING_CHANNELS,
  MARKETING_CHANNEL_LABELS_AR,
  type MarketingChannel,
  type MarketingSpendRow,
} from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { useAdminQuery } from '@/lib/use-admin-query';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SelectNative } from '@/components/ui/select-native';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AnalyticsRangePicker } from '@/components/analytics-range-picker';
import { ErrorNotice } from '@/components/notice';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { formatEgp } from '@/lib/format';
import { DEFAULT_RANGE_DAYS, daysAgoIso, exclusiveTo, formatCount, inclusiveFrom, todayIso } from '@/lib/analytics-format';

/**
 * **تكلفة اكتساب العميل (CAC) لكل قناة + إدخال مصروف الإعلانات** (طلب مالك 2026-09-25).
 *
 * ### الفجوة اللي الصفحة دي بتقفلها
 *
 * الباك-إند كان **كامل**: `GET /admin/analytics/marketing-spend` و`POST` و`DELETE`، وحساب الـCAC
 * جوّه `GET /admin/marketing/performance/channels`. بس **مفيش أي واجهة بتناديهم** — ولا سطر واحد
 * في `apps/admin` كان بيلمس `marketing-spend` ولا `performance/channels`. يعني المالك مكانش يقدر
 * **يدخل** مصروف ولا **يشوف** CAC، والأرقام دي هي أساس قراره «زوّد في القناة اللي CAC فيها أقل».
 *
 * نفس نمط فجوة تفعيل الموظف بالظبط: سيرفر مظبوط وواجهة مش موجودة.
 *
 * ### الصرف **شهري بالقناة**، والأداء **بمدى تواريخ**
 *
 * ده مش تفاوت — ده شكل البيانات: `marketing_spend` مفتاحه (شهر، قناة) والقيد في القاعدة بيرفض أي
 * تاريخ غير أول الشهر (ADR-0081 §6). فالجدول بيعرض الـCAC للمدى المختار، والإدخال شهري. الصفحة
 * بتقول ده صريح بدل ما الأدمن يفترض إن المدى بيفلتر الصرف.
 */

interface ChannelRow {
  channel: MarketingChannel | 'unattributed';
  sources: number;
  hits: number;
  signups: number;
  orders: number;
  completed_orders: number;
  gross_revenue_cents: number;
  platform_revenue_cents: number;
  spend_cents: number;
  cac_cents: number | null;
  average_order_cents: number | null;
}

interface ChannelPerformance {
  from: string;
  to: string;
  channels: ChannelRow[];
}

/** أول يوم في الشهر الحالي بصيغة `YYYY-MM` لخانة `<input type="month">`. */
function currentMonthValue(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

function channelLabel(channel: ChannelRow['channel']): string {
  return channel === 'unattributed' ? 'بلا إسناد' : MARKETING_CHANNEL_LABELS_AR[channel];
}

export default function MarketingPerformancePage() {
  const { isLoading, authedFetch, hasPermission } = useAuth();
  const [range, setRange] = useState({ from: daysAgoIso(DEFAULT_RANGE_DAYS), to: todayIso() });

  const canSeePerformance = hasPermission('marketing.manage');
  const canSeeSpend = hasPermission('analytics.financial.view');
  const canManageSpend = hasPermission('analytics.marketing_spend.manage');

  const params = new URLSearchParams({ from: inclusiveFrom(range.from), to: exclusiveTo(range.to) });
  const key = params.toString();

  const performance = useAdminQuery<ChannelPerformance>(
    isLoading || !canSeePerformance ? null : `marketing-channels:${key}`,
    () => authedFetch<ChannelPerformance>(`/admin/marketing/performance/channels?${key}`),
    'حصل خطأ في تحميل أداء القنوات',
  );

  const spend = useAdminQuery<MarketingSpendRow[]>(
    isLoading || !canSeeSpend ? null : 'marketing-spend',
    () => authedFetch<MarketingSpendRow[]>('/admin/analytics/marketing-spend'),
    'حصل خطأ في تحميل مصروف الإعلانات',
  );

  // ── نموذج الإدخال ──
  const [month, setMonth] = useState(currentMonthValue());
  const [channel, setChannel] = useState<MarketingChannel>('facebook');
  const [amountEgp, setAmountEgp] = useState('');
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  /**
   * القنوات اللي فيها صرف أو نتيجة بس — القنوات الفاضية تمامًا ضوضاء في جدول القرار.
   *
   * الاشتقاق جوّه `useMemo` مش برّه: `?? []` كان بيطلّع مصفوفة جديدة كل رندر فالـmemo مالوش أي
   * أثر (وeslint بيمسك ده).
   */
  const activeChannels = useMemo(
    () => (performance.data?.channels ?? []).filter((row) => row.spend_cents > 0 || row.orders > 0 || row.hits > 0),
    [performance.data],
  );

  async function handleSaveSpend(e: FormEvent) {
    e.preventDefault();
    const amount = Number(amountEgp);
    if (!Number.isFinite(amount) || amount < 0) {
      setFormError('اكتب مبلغ صحيح بالجنيه');
      return;
    }
    setFormError(null);
    setIsSaving(true);
    try {
      await authedFetch('/admin/analytics/marketing-spend', {
        method: 'POST',
        body: JSON.stringify({
          // الخانة بترجّع `YYYY-MM`؛ السيرفر بيطبّع لأول الشهر بس بيحتاج تاريخ كامل.
          month: `${month}-01`,
          channel,
          // **بالقرش** — كل مبالغ المشروع قروش صحيحة (docs/01 §1.3)، مفيش float في أي مبلغ.
          amount_cents: Math.round(amount * 100),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        }),
      });
      toast.success('المصروف اتحفظ');
      setAmountEgp('');
      setNotes('');
      spend.reload();
      performance.reload();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDeleteSpend(id: string) {
    try {
      await authedFetch(`/admin/analytics/marketing-spend/${id}`, { method: 'DELETE' });
      toast.success('المصروف اتشال');
      spend.reload();
      performance.reload();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'فشل حذف المصروف');
    }
  }

  return (
    <AppShell>
      <PageHeader
        title="أداء القنوات ومصروف الإعلانات"
        description="تكلفة اكتساب العميل (CAC) لكل قناة = المصروف ÷ العملاء اللي عملوا طلب مكتمل. القرار: زوّد في القناة اللي CAC فيها أقل وربح الطلب أعلى."
      />

      <div className="flex flex-col gap-6">
        {!canSeePerformance && !canSeeSpend && (
          <EmptyState title="ماعندكش صلاحية" description="الصفحة دي محتاجة صلاحية أداء التسويق أو التقارير المالية." />
        )}

        {canSeePerformance && (
          <>
            <Card>
              <CardContent className="pt-6">
                <AnalyticsRangePicker from={range.from} to={range.to} onChange={setRange} idPrefix="marketing" />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">CAC لكل قناة</CardTitle>
              </CardHeader>
              <CardContent>
                {performance.error && <ErrorNotice>{performance.error}</ErrorNotice>}
                {performance.loading && <p className="text-sm text-muted-foreground">جاري التحميل…</p>}
                {!performance.loading && !performance.error && activeChannels.length === 0 && (
                  <EmptyState
                    title="مفيش أرقام في المدى ده"
                    description="لسه مفيش زيارات ولا طلبات مُسندة لأي قناة. سجّل مصدر تسويقي وابدأ توزيع الأكواد، وبعدين ادخل المصروف من تحت."
                  />
                )}
                {activeChannels.length > 0 && (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>القناة</TableHead>
                        <TableHead>المصروف</TableHead>
                        <TableHead>طلبات</TableHead>
                        <TableHead>مكتملة</TableHead>
                        <TableHead>CAC</TableHead>
                        <TableHead>متوسط الطلب</TableHead>
                        <TableHead>ربح المنصة</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {activeChannels.map((row) => (
                        <TableRow key={row.channel} data-testid={`channel-row-${row.channel}`}>
                          <TableCell className="font-medium">{channelLabel(row.channel)}</TableCell>
                          <TableCell>{formatEgp(row.spend_cents)}</TableCell>
                          <TableCell>{formatCount(row.orders)}</TableCell>
                          <TableCell>{formatCount(row.completed_orders)}</TableCell>
                          {/* **`—` مش صفر** لما مفيش مقام: صفر بيقرا كـ«اكتساب مجاني» وهو عكس الحقيقة. */}
                          <TableCell className="font-semibold">
                            {row.cac_cents === null ? '—' : formatEgp(row.cac_cents)}
                          </TableCell>
                          <TableCell>
                            {row.average_order_cents === null ? '—' : formatEgp(row.average_order_cents)}
                          </TableCell>
                          <TableCell>{formatEgp(row.platform_revenue_cents)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
                <p className="mt-4 text-xs text-muted-foreground">
                  المصروف بيتسجّل <strong>شهري بالقناة</strong>، فعمود المصروف والـCAC بيجمعوا شهور
                  المدى المختار بالكامل — مش جزء من شهر.
                </p>
              </CardContent>
            </Card>
          </>
        )}

        {canSeeSpend && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">مصروف الإعلانات</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
              {canManageSpend ? (
                <form onSubmit={handleSaveSpend} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="spend-month">الشهر</Label>
                    <Input
                      id="spend-month"
                      data-testid="spend-month"
                      type="month"
                      value={month}
                      onChange={(e) => setMonth(e.target.value)}
                      required
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="spend-channel">القناة</Label>
                    <SelectNative
                      id="spend-channel"
                      data-testid="spend-channel"
                      value={channel}
                      onChange={(e) => setChannel(e.target.value as MarketingChannel)}
                    >
                      {MARKETING_CHANNELS.map((c) => (
                        <option key={c} value={c}>
                          {MARKETING_CHANNEL_LABELS_AR[c]}
                        </option>
                      ))}
                    </SelectNative>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="spend-amount">المبلغ (جنيه)</Label>
                    <Input
                      id="spend-amount"
                      data-testid="spend-amount"
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="0.01"
                      dir="ltr"
                      value={amountEgp}
                      onChange={(e) => setAmountEgp(e.target.value)}
                      required
                    />
                  </div>
                  <div className="flex flex-col gap-2 sm:col-span-2">
                    <Label htmlFor="spend-notes">ملاحظة (اختياري)</Label>
                    <Input
                      id="spend-notes"
                      data-testid="spend-notes"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      maxLength={500}
                      placeholder="مثال: حملة سباكة الإسكندرية"
                    />
                  </div>
                  <div className="sm:col-span-2 lg:col-span-5">
                    {formError && <ErrorNotice className="mb-3">{formError}</ErrorNotice>}
                    <Button type="submit" disabled={isSaving} data-testid="spend-submit">
                      {isSaving ? 'جاري الحفظ…' : 'احفظ المصروف'}
                    </Button>
                    {/* **upsert مش insert** — الشرح في `MarketingSpendService.upsert`: الأدمن اللي
                        بيصحّح رقم لازم يستبدله، مش يضيف صف يتجمع عليه فيبقى الصرف ضعف الحقيقة. */}
                    <p className="mt-2 text-xs text-muted-foreground">
                      إدخال نفس الشهر ونفس القناة تاني <strong>بيستبدل</strong> الرقم القديم مش
                      بيضيف عليه.
                    </p>
                  </div>
                </form>
              ) : (
                <p className="text-sm text-muted-foreground">
                  ماعندكش صلاحية إدخال المصروف — العرض بس.
                </p>
              )}

              {spend.error && <ErrorNotice>{spend.error}</ErrorNotice>}
              {spend.loading && <p className="text-sm text-muted-foreground">جاري التحميل…</p>}
              {!spend.loading && !spend.error && (spend.data ?? []).length === 0 && (
                <EmptyState
                  title="مفيش مصروف مسجّل"
                  description="ادخل مصروف أول شهر من فوق، وجدول الـCAC هيحسب لوحده."
                />
              )}
              {(spend.data ?? []).length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>الشهر</TableHead>
                      <TableHead>القناة</TableHead>
                      <TableHead>المبلغ</TableHead>
                      <TableHead>ملاحظة</TableHead>
                      {canManageSpend && <TableHead />}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(spend.data ?? []).map((row) => (
                      <TableRow key={row.id} data-testid={`spend-row-${row.id}`}>
                        <TableCell dir="ltr">{row.month.slice(0, 7)}</TableCell>
                        <TableCell>
                          {MARKETING_CHANNEL_LABELS_AR[row.channel as MarketingChannel] ?? row.channel}
                        </TableCell>
                        <TableCell>{formatEgp(row.amountCents)}</TableCell>
                        <TableCell className="text-muted-foreground">{row.notes ?? '—'}</TableCell>
                        {canManageSpend && (
                          <TableCell>
                            <ConfirmDialog
                              title="تشيل المصروف ده؟"
                              description={`هيتشال مصروف ${MARKETING_CHANNEL_LABELS_AR[row.channel as MarketingChannel] ?? row.channel} لشهر ${row.month.slice(0, 7)}، والـCAC هيتحسب من غيره.`}
                              confirmLabel="شيله"
                              onConfirm={() => handleDeleteSpend(row.id)}
                              trigger={
                                <Button variant="outline" size="sm" data-testid={`spend-delete-${row.id}`}>
                                  شيل
                                </Button>
                              }
                            />
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
