'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Building2, CalendarDays, CheckCircle2, Layers3, MapPin, ShieldCheck, Users } from 'lucide-react';
import type { CompanyDetailResponseDto, CompanyOrderSummaryResponseDto, CompanyResponseDto } from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { VERIFICATION_STATUS_LABELS, LEVEL_LABELS } from '@/lib/technician-labels';
import { ORDER_STATUS_LABELS, BOOKING_MODE_LABELS } from '@/lib/order-labels';
import { formatEgp } from '@/lib/format';

// مساحة عمل الشركة (ADR-0033) — نفس تجميع الحالات المستخدم لـ"نشط" في apps/technician-app
// (ACTIVE_TECHNICIAN_ORDER_STATUSES بالباك-إند)، مترجم هنا للعرض بس — صفر endpoint إحصائيات منفصل.
const ACTIVE_ORDER_STATUSES = new Set(['accepted', 'technician_on_way', 'technician_arrived', 'in_progress', 'awaiting_quote_approval']);

const TEAM_ROLE_LABELS: Record<string, string> = {
  independent: 'مستقل',
  owner: 'مالك',
  manager: 'مدير',
  supervisor: 'مشرف',
  worker: 'عامل',
};

export default function TechnicianCompanyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { isLoading, authedFetch } = useAuth();
  const [detail, setDetail] = useState<CompanyDetailResponseDto | null>(null);
  const [orders, setOrders] = useState<CompanyOrderSummaryResponseDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isLoading) return;
    authedFetch<CompanyDetailResponseDto>(`/admin/technician-companies/${id}`)
      .then(setDetail)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل تفاصيل الشركة'));
    authedFetch<CompanyOrderSummaryResponseDto[]>(`/admin/technician-companies/${id}/orders`)
      .then(setOrders)
      .catch(() => setOrders([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, id]);

  const [trustNote, setTrustNote] = useState('');
  const [isSavingBadge, setIsSavingBadge] = useState(false);
  // ADR-0042 (docs/08 §64.و) — معامل سعر الشركة. الحقل بيتعبّى من الرد نفسه أول ما يوصل.
  const [multiplierInput, setMultiplierInput] = useState('');
  const [multiplierNote, setMultiplierNote] = useState('');
  const [isSavingMultiplier, setIsSavingMultiplier] = useState(false);

  // علامة التوثيق الزرقاء للشركة (ADR-0039، docs/08 §62.1) — الكتابة الوحيدة في شاشة الإشراف دي.
  async function handleSetTrustBadge(granted: boolean) {
    setIsSavingBadge(true);
    setError(null);
    try {
      const company = await authedFetch<CompanyResponseDto>(`/admin/technician-companies/${id}/trust-badge`, {
        method: 'PATCH',
        body: JSON.stringify({ granted, note: trustNote.trim() || undefined }),
      });
      setDetail((prev) => (prev ? { ...prev, company } : prev));
      setTrustNote('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحديث علامة التوثيق');
    } finally {
      setIsSavingBadge(false);
    }
  }

  // ADR-0042 — تغيير معامل السعر. محمي بصلاحية orders.adjust_price في الباك-إند.
  async function handleSaveMultiplier() {
    const parsed = Number(multiplierInput);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 3) {
      setError('المعامل لازم يكون رقم بين 1.00 و3.00');
      return;
    }
    setIsSavingMultiplier(true);
    setError(null);
    try {
      const company = await authedFetch<CompanyResponseDto>(`/admin/technician-companies/${id}/price-multiplier`, {
        method: 'PATCH',
        body: JSON.stringify({ price_multiplier: parsed, note: multiplierNote.trim() || undefined }),
      });
      setDetail((prev) => (prev ? { ...prev, company } : prev));
      setMultiplierNote('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحديث معامل السعر');
    } finally {
      setIsSavingMultiplier(false);
    }
  }

  const activeOrdersCount = orders?.filter((o) => ACTIVE_ORDER_STATUSES.has(o.order_status)).length ?? 0;
  const completedOrdersCount = orders?.filter((o) => o.order_status === 'completed').length ?? 0;
  const isCommercial = Boolean(detail?.company.commercial_registration_number);

  return (
    <AppShell>
      {error && <p className="text-destructive">{error}</p>}
      {!detail && !error && <p className="text-muted-foreground">جاري التحميل…</p>}

      {detail && (
        <div className="space-y-6">
          <PageHeader
            title={detail.company.name}
            description={isCommercial ? 'ملف شركة تنفيذ مسجلة ومساحة عملها التشغيلية.' : 'ملف فريق مهني ومساحة عمله التشغيلية.'}
            actions={
              <Badge variant={detail.company.is_active ? 'secondary' : 'outline'}>
                {detail.company.is_active ? 'نشطة' : 'غير نشطة'}
              </Badge>
            }
          />

          <section className={`relative overflow-hidden rounded-3xl border p-6 md:p-8 ${
            isCommercial
              ? 'border-amber-200 bg-[radial-gradient(circle_at_top_left,rgba(251,191,36,0.2),transparent_35%),linear-gradient(135deg,#172033,#28364d)] text-white shadow-xl shadow-slate-950/10'
              : 'border-slate-200 bg-gradient-to-l from-slate-50 to-white'
          }`}>
            <div className="relative flex flex-col justify-between gap-6 md:flex-row md:items-end">
              <div className="flex items-start gap-4">
                <div className={`grid h-16 w-16 shrink-0 place-items-center rounded-2xl ${isCommercial ? 'bg-amber-300 text-slate-950 shadow-lg shadow-amber-500/20' : 'bg-slate-200 text-slate-700'}`}>
                  {isCommercial ? <Building2 className="h-8 w-8" /> : <Layers3 className="h-8 w-8" />}
                </div>
                <div>
                  <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${isCommercial ? 'border border-amber-300/30 bg-amber-300/10 text-amber-100' : 'bg-slate-200 text-slate-700'}`}>
                    <ShieldCheck className="h-4 w-4" />
                    {isCommercial ? 'شركة مسجلة في شبكة التنفيذ' : 'فريق مهني معتمد'}
                  </div>
                  <h2 className="mt-3 text-2xl font-semibold md:text-3xl">{detail.company.name}</h2>
                  <p className={`mt-2 text-sm ${isCommercial ? 'text-slate-300' : 'text-muted-foreground'}`}>
                    {isCommercial
                      ? `السجل التجاري ${detail.company.commercial_registration_number}`
                      : 'فريق تنفيذي مرن بدون سجل تجاري مستقل'}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <span className={`inline-flex items-center gap-2 rounded-full px-3 py-2 ${isCommercial ? 'bg-white/10 text-slate-200' : 'bg-slate-100'}`}><Users className="h-4 w-4" />{detail.staff.length} عضو</span>
                <span className={`inline-flex items-center gap-2 rounded-full px-3 py-2 ${isCommercial ? 'bg-white/10 text-slate-200' : 'bg-slate-100'}`}><MapPin className="h-4 w-4" />{detail.branches.length} فرع</span>
                <span className={`inline-flex items-center gap-2 rounded-full px-3 py-2 ${isCommercial ? 'bg-white/10 text-slate-200' : 'bg-slate-100'}`}><CalendarDays className="h-4 w-4" />منذ {new Date(detail.company.created_at).toLocaleDateString('ar-EG-u-nu-latn')}</span>
              </div>
            </div>
          </section>

          {orders && (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Card className="border-slate-200 bg-gradient-to-br from-white to-slate-50">
                <CardContent className="pt-6">
                  <p className="text-sm text-muted-foreground">إجمالي الطلبات</p>
                  <p className="text-2xl font-bold">{orders.length}</p>
                </CardContent>
              </Card>
              <Card className="border-sky-200 bg-gradient-to-br from-white to-sky-50">
                <CardContent className="pt-6">
                  <p className="text-sm text-muted-foreground">جارية دلوقتي</p>
                  <p className="text-2xl font-bold">{activeOrdersCount}</p>
                </CardContent>
              </Card>
              <Card className="border-emerald-200 bg-gradient-to-br from-white to-emerald-50">
                <CardContent className="pt-6">
                  <p className="flex items-center gap-2 text-sm text-muted-foreground"><CheckCircle2 className="h-4 w-4 text-emerald-600" />مكتملة</p>
                  <p className="text-2xl font-bold">{completedOrdersCount}</p>
                </CardContent>
              </Card>
              <Card className="border-amber-200 bg-gradient-to-br from-white to-amber-50">
                <CardContent className="pt-6">
                  <p className="text-sm text-muted-foreground">إجمالي القيمة</p>
                  <p className="text-2xl font-bold">{formatEgp(orders.reduce((sum, o) => sum + o.total_amount_cents, 0))}</p>
                </CardContent>
              </Card>
            </div>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">بيانات الشركة</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div>
                <span className="text-muted-foreground">السجل التجاري: </span>
                <span dir="ltr">{detail.company.commercial_registration_number ?? '—'}</span>
              </div>
              <div>
                <span className="text-muted-foreground">تاريخ الإنشاء: </span>
                {new Date(detail.company.created_at).toLocaleDateString('ar-EG-u-nu-latn')}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">علامة التوثيق</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                {detail.company.is_trust_verified ? (
                  <Badge className="bg-[#1D9BF0] text-white hover:bg-[#1D9BF0]">موثّقة ✓</Badge>
                ) : (
                  <Badge variant="outline">من غير علامة</Badge>
                )}
                {detail.company.trust_verified_at && (
                  <span className="text-muted-foreground">
                    آخر تغيير: {new Date(detail.company.trust_verified_at).toLocaleString('ar-EG')}
                  </span>
                )}
              </div>
              {detail.company.trust_verified_note && (
                <p className="text-muted-foreground">السبب المسجّل: {detail.company.trust_verified_note}</p>
              )}
              <p className="text-muted-foreground">
                دي العلامة الزرقاء اللي العميل بيشوفها على كارت الشركة وقت اختيار مقدّم الخدمة. مالهاش
                علاقة بتفعيل/إيقاف الشركة — الشركة النشطة بتشتغل عادي من غيرها.
              </p>
              <Input
                value={trustNote}
                onChange={(e) => setTrustNote(e.target.value)}
                placeholder="سبب المنح/السحب (اختياري، بيتسجّل في سجل النشاط)"
                maxLength={500}
              />
              <div>
                {detail.company.is_trust_verified ? (
                  <Button size="sm" variant="destructive" disabled={isSavingBadge} onClick={() => handleSetTrustBadge(false)}>
                    اسحب العلامة
                  </Button>
                ) : (
                  <Button size="sm" disabled={isSavingBadge} onClick={() => handleSetTrustBadge(true)}>
                    امنح العلامة
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {/* ADR-0042 / docs/08 §64.و — معامل سعر الشركة. طلب مالك صريح: «جوا كل شركة يكون فيه
              معامل زيادة خاص بيها»، بدل ما كل الشركات تتسعّر بالسعر الأساسي المشترك. */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">معامل سعر الشركة</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={detail.company.price_multiplier > 1 ? 'secondary' : 'outline'}>
                  المعامل الحالي: ×{detail.company.price_multiplier.toFixed(2)}
                </Badge>
                {detail.company.price_multiplier > 1 && (
                  <span className="text-muted-foreground">
                    يعني +{Math.round((detail.company.price_multiplier - 1) * 100)}% فوق السعر الأساسي
                  </span>
                )}
              </div>
              <p className="text-muted-foreground">
                بيتطبّق على سعر الشغل في أي حجز للشركة دي، وبيحل محل مضاعف مستوى الفني (حجز الشركة
                مالوش مستوى فني محدد). العميل بيشوف السعر النهائي بالمعامل ده قبل ما يأكّد، وتوزيع
                نصيب الفنيين جوّه الطاقم بيفضل بنفس القاعدة زي ما هو.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  type="number"
                  step="0.05"
                  min="1"
                  max="3"
                  className="max-w-[140px]"
                  value={multiplierInput}
                  onChange={(e) => setMultiplierInput(e.target.value)}
                  placeholder={detail.company.price_multiplier.toFixed(2)}
                />
                <Input
                  value={multiplierNote}
                  onChange={(e) => setMultiplierNote(e.target.value)}
                  placeholder="سبب التغيير (اختياري، بيتسجّل في سجل النشاط)"
                  maxLength={500}
                  className="max-w-md"
                />
                <Button size="sm" disabled={isSavingMultiplier || !multiplierInput} onClick={handleSaveMultiplier}>
                  حفظ المعامل
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">الفروع ({detail.branches.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {detail.branches.length === 0 ? (
                <EmptyState title="مفيش فروع لسه" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>الاسم</TableHead>
                      <TableHead>العنوان</TableHead>
                      <TableHead>الحالة</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.branches.map((branch) => (
                      <TableRow key={branch.id}>
                        <TableCell>{branch.name}</TableCell>
                        <TableCell>{branch.address_line ?? '—'}</TableCell>
                        <TableCell>
                          <Badge variant={branch.is_active ? 'secondary' : 'outline'}>
                            {branch.is_active ? 'نشط' : 'غير نشط'}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">الأعضاء ({detail.staff.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الاسم</TableHead>
                    <TableHead>الكود</TableHead>
                    <TableHead>الدور بالشركة</TableHead>
                    <TableHead>المستوى</TableHead>
                    <TableHead>حالة التوثيق</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.staff.map((member) => (
                    <TableRow key={member.user_id}>
                      <TableCell>{member.full_name}</TableCell>
                      <TableCell dir="ltr" className="text-start">
                        {member.technician_code}
                      </TableCell>
                      <TableCell>{TEAM_ROLE_LABELS[member.team_role] ?? member.team_role}</TableCell>
                      <TableCell>{LEVEL_LABELS[member.current_level as keyof typeof LEVEL_LABELS] ?? member.current_level}</TableCell>
                      <TableCell>
                        {VERIFICATION_STATUS_LABELS[member.verification_status as keyof typeof VERIFICATION_STATUS_LABELS] ??
                          member.verification_status}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">الطلبات ({orders?.length ?? 0})</CardTitle>
            </CardHeader>
            <CardContent>
              {!orders ? (
                <p className="text-sm text-muted-foreground">جاري التحميل…</p>
              ) : orders.length === 0 ? (
                <EmptyState title="مفيش طلبات اتعيّنت للشركة دي لسه" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>رقم الطلب</TableHead>
                      <TableHead>الخدمة</TableHead>
                      <TableHead>الحالة</TableHead>
                      <TableHead>وضع الحجز</TableHead>
                      <TableHead>الموعد</TableHead>
                      <TableHead>الفني المسؤول</TableHead>
                      <TableHead>المنطقة</TableHead>
                      <TableHead>الإجمالي</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orders.map((order) => (
                      <TableRow key={order.id}>
                        <TableCell dir="ltr" className="text-start">
                          <Link href={`/orders/${order.id}`} className="font-medium underline-offset-4 hover:underline">{order.order_number}</Link>
                        </TableCell>
                        <TableCell>{order.service_name_ar}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{ORDER_STATUS_LABELS[order.order_status as keyof typeof ORDER_STATUS_LABELS] ?? order.order_status}</Badge>
                        </TableCell>
                        <TableCell>{BOOKING_MODE_LABELS[order.booking_mode] ?? order.booking_mode}</TableCell>
                        <TableCell>
                          {order.scheduled_at ? new Date(order.scheduled_at).toLocaleString('ar-EG-u-nu-latn') : '—'}
                        </TableCell>
                        <TableCell>{order.technician_name ?? '—'}</TableCell>
                        <TableCell>{order.zone_name_ar ?? '—'}</TableCell>
                        <TableCell>{formatEgp(order.total_amount_cents)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </AppShell>
  );
}
