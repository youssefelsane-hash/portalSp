'use client';

import { useState } from 'react';
import type {
  MarketingChannel,
  MarketingChannelPerformanceReport,
  MarketingSourceDto,
  MarketingSourcePerformanceReport,
} from '@baytak/shared-types';
import { MARKETING_CHANNELS, MARKETING_CHANNEL_LABELS_AR } from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { useAdminQuery } from '@/lib/use-admin-query';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { PromoCodeQr } from '@/components/promo-code-qr';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SelectNative } from '@/components/ui/select-native';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AnalyticsRangePicker } from '@/components/analytics-range-picker';
import { DEFAULT_RANGE_DAYS, daysAgoIso, exclusiveTo, formatCount, inclusiveFrom, todayIso } from '@/lib/analytics-format';
import { formatEgp } from '@/lib/format';

/** قيمة بالقرش أو «—» لو `null`. */
function money(cents: number | null): string {
  return cents === null ? '—' : formatEgp(cents);
}

export default function MarketingPage() {
  const { isLoading, authedFetch } = useAuth();
  const [range, setRange] = useState({ from: daysAgoIso(DEFAULT_RANGE_DAYS), to: todayIso() });
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name_ar: '',
    channel: 'poster' as MarketingChannel,
    region_label: '',
    payout_egp: '',
  });

  const params = new URLSearchParams({ from: inclusiveFrom(range.from), to: exclusiveTo(range.to) });
  const key = params.toString();

  const sources = useAdminQuery<MarketingSourceDto[]>(
    isLoading ? null : 'marketing-sources',
    () => authedFetch<MarketingSourceDto[]>('/admin/marketing/sources'),
    'حصل خطأ في تحميل مصادر التسويق',
  );

  const byChannel = useAdminQuery<MarketingChannelPerformanceReport>(
    isLoading ? null : `marketing-channels:${key}`,
    () => authedFetch<MarketingChannelPerformanceReport>(`/admin/marketing/performance/channels?${key}`),
    'حصل خطأ في تحميل أرقام القنوات',
  );

  const bySource = useAdminQuery<MarketingSourcePerformanceReport>(
    isLoading ? null : `marketing-sources-perf:${key}`,
    () => authedFetch<MarketingSourcePerformanceReport>(`/admin/marketing/performance/sources?${key}`),
    'حصل خطأ في تحميل أرقام المصادر',
  );

  async function createSource(event: React.FormEvent) {
    event.preventDefault();
    if (!form.name_ar.trim()) return;
    setCreating(true);
    setFormError(null);
    try {
      // المبلغ بيتكتب بالجنيه في الشاشة وبيتبعت بالقرش — كل الأسعار في النظام بالقرش
      // (`docs/01` §1.3)، والتحويل بيحصل عند الحدود مش جوّه المنطق.
      const payoutEgp = Number(form.payout_egp || '0');
      await authedFetch('/admin/marketing/sources', {
        method: 'POST',
        body: JSON.stringify({
          name_ar: form.name_ar.trim(),
          channel: form.channel,
          ...(form.region_label.trim() ? { region_label: form.region_label.trim() } : {}),
          ...(payoutEgp > 0 ? { payout_per_completed_order_cents: Math.round(payoutEgp * 100) } : {}),
        }),
      });
      setForm({ name_ar: '', channel: 'poster', region_label: '', payout_egp: '' });
      sources.reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'مقدرناش نضيف المصدر');
    } finally {
      setCreating(false);
    }
  }

  const channels = byChannel.data?.channels ?? [];
  const sourceRows = bySource.data?.sources ?? [];

  return (
    <AppShell>
      <PageHeader
        title="التسويق والإسناد"
        description="كل إعلان له كود ورابط، وكل عميل بيتربط بالإعلان اللي جابه — عشان «أزوّد في ده ولا لأ» يبقى قرار برقم."
      />

      <div className="flex flex-col gap-6">
        <Card>
          <CardContent className="pt-6">
            <AnalyticsRangePicker from={range.from} to={range.to} onChange={setRange} idPrefix="marketing" />
          </CardContent>
        </Card>

        {/* ═══ مقارنة القنوات — ده المستوى اللي قرار الميزانية بيتاخد عنده ═══ */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">مقارنة القنوات</CardTitle>
            <p className="text-muted-foreground text-sm">
              الصرف بيتسجّل بالقناة والشهر (صفحة «لوحة المال»)، فالـCAC بيتحسب هنا بس مش على مستوى
              الإعلان الواحد. <strong>«—» معناها مفيش مقام</strong> (مفيش صرف مسجّل أو مفيش عملاء اتحوّلوا) —
              مش صفر.
            </p>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {byChannel.error && <EmptyState title={byChannel.error} />}
            {!byChannel.error && channels.length === 0 && !byChannel.loading && (
              <EmptyState
                title="مفيش بيانات في الفترة دي"
                description="الأرقام بتظهر أول ما يبقى فيه مصدر بكود، وناس تفتح رابطه أو تسجّل بيه."
              />
            )}
            {channels.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>القناة</TableHead>
                    <TableHead>زيارات</TableHead>
                    <TableHead>تسجيل</TableHead>
                    <TableHead>طلبات</TableHead>
                    <TableHead>مكتملة</TableHead>
                    <TableHead>الصرف</TableHead>
                    <TableHead>تكلفة العميل (CAC)</TableHead>
                    <TableHead>متوسط الطلب</TableHead>
                    <TableHead>إيراد المنصة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {channels.map((row) => (
                    <TableRow key={row.channel}>
                      <TableCell className="font-medium">
                        {MARKETING_CHANNEL_LABELS_AR[row.channel] ?? row.channel}
                        <span className="text-muted-foreground block text-xs">{formatCount(row.sources)} مصدر</span>
                      </TableCell>
                      <TableCell className="tabular-nums">{formatCount(row.hits)}</TableCell>
                      <TableCell className="tabular-nums">{formatCount(row.signups)}</TableCell>
                      <TableCell className="tabular-nums">{formatCount(row.orders)}</TableCell>
                      <TableCell className="tabular-nums">{formatCount(row.completed_orders)}</TableCell>
                      <TableCell className="tabular-nums">{money(row.spend_cents || null)}</TableCell>
                      <TableCell className="tabular-nums font-semibold">{money(row.cac_cents)}</TableCell>
                      <TableCell className="tabular-nums">{money(row.average_order_cents)}</TableCell>
                      <TableCell className="tabular-nums">{money(row.platform_revenue_cents || null)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <p className="text-muted-foreground mt-3 text-xs">
              <strong>«زيارات» يعني فتحات للرابط مش أشخاص</strong> — مابنسجّلش أي حاجة تعرّف الزائر
              (لا IP ولا جهاز)، فنفس الشخص لو فتح مرتين بيتعد ٢.
            </p>
          </CardContent>
        </Card>

        {/* ═══ إضافة مصدر ═══ */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">أضف إعلان / بواب / إنفلونسر</CardTitle>
            <p className="text-muted-foreground text-sm">
              كل واحد بياخد كود ورابط خاص. الرابط بيتطبع تحت QR ومابيتغيّرش — وجهته بتتظبط من
              صفحة الإعدادات (روابط المتاجر وصفحة الهبوط) فالملصق المطبوع يفضل صالح.
            </p>
          </CardHeader>
          <CardContent>
            <form onSubmit={createSource} className="grid gap-4 md:grid-cols-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="mk-name">الاسم</Label>
                <Input
                  id="mk-name"
                  value={form.name_ar}
                  onChange={(e) => setForm((f) => ({ ...f, name_ar: e.target.value }))}
                  placeholder="ملصق سموحة — نوفمبر"
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="mk-channel">القناة</Label>
                <SelectNative
                  id="mk-channel"
                  value={form.channel}
                  onChange={(e) => setForm((f) => ({ ...f, channel: e.target.value as MarketingChannel }))}
                >
                  {MARKETING_CHANNELS.map((c) => (
                    <option key={c} value={c}>
                      {MARKETING_CHANNEL_LABELS_AR[c]}
                    </option>
                  ))}
                </SelectNative>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="mk-region">المنطقة (اختياري)</Label>
                <Input
                  id="mk-region"
                  value={form.region_label}
                  onChange={(e) => setForm((f) => ({ ...f, region_label: e.target.value }))}
                  placeholder="سموحة"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="mk-payout">عمولة الشغلانة (ج.م، للبواب)</Label>
                <Input
                  id="mk-payout"
                  type="number"
                  min={0}
                  step={5}
                  value={form.payout_egp}
                  onChange={(e) => setForm((f) => ({ ...f, payout_egp: e.target.value }))}
                  placeholder="0"
                />
              </div>
              <div className="md:col-span-4 flex items-center gap-3">
                <Button type="submit" disabled={creating}>
                  {creating ? 'بنضيف…' : 'أضف المصدر'}
                </Button>
                {formError && <span className="text-destructive text-sm">{formError}</span>}
                <span className="text-muted-foreground text-xs">
                  العمولة بتتحسب <strong>مرة واحدة</strong> على أول طلب مكتمل للعميل، وبتتلغي لو الطلب
                  اتلغى أو اترد. الصرف نفسه بيتم بره النظام وبتعلّمه مدفوع من قايمة المستحقات.
                </span>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* ═══ المصادر وأرقامها ═══ */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">الإعلانات والمصادر</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {sources.error && <EmptyState title={sources.error} />}
            {!sources.error && (sources.data?.length ?? 0) === 0 && !sources.loading && (
              <EmptyState title="لسه مفيش أي مصدر" description="أضف أول إعلان من الفورم فوق." />
            )}
            {(sources.data?.length ?? 0) > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>المصدر</TableHead>
                    <TableHead>الكود والرابط</TableHead>
                    <TableHead>زيارات</TableHead>
                    <TableHead>تسجيل</TableHead>
                    <TableHead>مكتملة</TableHead>
                    <TableHead>إيراد</TableHead>
                    <TableHead>مستحق للشريك</TableHead>
                    <TableHead>QR</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(sources.data ?? []).map((source) => {
                    const perf = sourceRows.find((r) => r.source_id === source.id);
                    return (
                      <TableRow key={source.id}>
                        <TableCell>
                          <span className="font-medium">{source.name_ar}</span>
                          <span className="mt-1 flex flex-wrap items-center gap-1">
                            <Badge variant="outline" className="text-xs">
                              {MARKETING_CHANNEL_LABELS_AR[source.channel] ?? source.channel}
                            </Badge>
                            {source.region_label && (
                              <Badge variant="secondary" className="text-xs">{source.region_label}</Badge>
                            )}
                            {!source.is_active && (
                              <Badge variant="destructive" className="text-xs">موقوف</Badge>
                            )}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span dir="ltr" className="block font-mono text-sm font-semibold">{source.code}</span>
                          <span dir="ltr" className="text-muted-foreground block break-all text-xs">
                            {source.share_url}
                          </span>
                        </TableCell>
                        <TableCell className="tabular-nums">{formatCount(perf?.hits ?? 0)}</TableCell>
                        <TableCell className="tabular-nums">{formatCount(perf?.signups ?? 0)}</TableCell>
                        <TableCell className="tabular-nums">{formatCount(perf?.completed_orders ?? 0)}</TableCell>
                        <TableCell className="tabular-nums">{money(perf?.gross_revenue_cents || null)}</TableCell>
                        <TableCell className="tabular-nums">
                          {source.payout_per_completed_order_cents > 0
                            ? money(perf?.accrued_commission_cents || 0)
                            : '—'}
                        </TableCell>
                        <TableCell>
                          {/* الـQR بيحمل **الرابط** مش الكود: ده اللي بيخلّي المسح يودّي على
                              المتجر/الصفحة على طول بدل ما المستخدم يكتب الكود بإيده. */}
                          <PromoCodeQr code={source.share_url} />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
