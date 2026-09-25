'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth-context';
import { useAdminQuery } from '@/lib/use-admin-query';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { SelectNative } from '@/components/ui/select-native';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ErrorNotice } from '@/components/notice';
import { ConfirmDialog } from '@/components/confirm-dialog';

/**
 * **سياسات وشروط الدفع** (migration 0177).
 *
 * الفجوة اللي بتقفلها: الباك-إند بيفرض السياسات دي **على كل حجز** — طلب مش مدفوع مقدّمًا على
 * خدمة عليها سياسة `is_required` بيترفض لو العميل ماقبلهاش. والعميل بيشوفها فعلاً في الموقع
 * وفي التطبيق. بس **مفيش أي ملف في `apps/admin` كان بيلمس المسارات دي** — يعني الشرط اللي
 * بيوقف الحجز مكانش له طريقة يتعمل أو يتعدّل أو حتى يتشاف منها.
 *
 * ### النسخ غير قابلة للتعديل — وده مقصود
 *
 * نص السياسة مابيتعدّلش في مكانه: أي تغيير بينشر **نسخة جديدة**. السبب إن قبول العميل بيتسجّل
 * بمعرّف النسخة، فتعديل النص في مكانه كان هيخلّي قبول قديم يشاور على كلام العميل عمره ما شافه.
 * الشاشة بتوضّح ده صراحةً بدل ما الأدمن يدوّر على زرار «تعديل النص» مش موجود.
 */

const APPLIES_TO_OPTIONS = [
  { value: 'postpaid_service', label: 'الدفع بعد الخدمة' },
  { value: 'installment', label: 'التقسيط' },
  { value: 'deposit', label: 'العربون' },
  { value: 'manual_transfer', label: 'التحويل اليدوي' },
  { value: 'general', label: 'عامة' },
] as const;

const APPLIES_TO_LABELS: Record<string, string> = Object.fromEntries(
  APPLIES_TO_OPTIONS.map((o) => [o.value, o.label]),
);

interface PaymentPolicyRow {
  id: string;
  slug: string;
  titleAr: string;
  appliesTo: string;
  targetServiceId: string | null;
  targetCategoryId: string | null;
  isRequired: boolean;
  isActive: boolean;
  displayOrder: number;
  latest_version: number | null;
}

interface PolicyVersion {
  id: string;
  version: number;
  bodyAr: string;
  publishedAt: string;
}

/** أقل طول نص بيقبله الباك-إند — مكتوب هنا عشان الأدمن يعرف قبل ما يترفض. */
const MIN_BODY_LENGTH = 20;

export default function PaymentPoliciesPage() {
  const { isLoading, authedFetch, hasPermission } = useAuth();
  const canManage = hasPermission('payment_policies.manage');

  const policies = useAdminQuery<PaymentPolicyRow[]>(
    isLoading || !canManage ? null : 'payment-policies',
    () => authedFetch<PaymentPolicyRow[]>('/admin/payment-policies'),
    'حصل خطأ في تحميل سياسات الدفع',
  );

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const versions = useAdminQuery<PolicyVersion[]>(
    expandedId === null ? null : `policy-versions:${expandedId}`,
    () => authedFetch<PolicyVersion[]>(`/admin/payment-policies/${expandedId}/versions`),
    'حصل خطأ في تحميل نسخ السياسة',
  );

  // ── إنشاء سياسة ──
  const [slug, setSlug] = useState('');
  const [titleAr, setTitleAr] = useState('');
  const [appliesTo, setAppliesTo] = useState<string>('postpaid_service');
  const [isRequired, setIsRequired] = useState(true);
  const [bodyAr, setBodyAr] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // ── نشر نسخة جديدة ──
  const [newVersionBody, setNewVersionBody] = useState('');
  const [publishingFor, setPublishingFor] = useState<string | null>(null);

  const rows = policies.data ?? [];
  // الاشتقاق جوّه `useMemo` مش برّه: `?? []` بيطلّع مصفوفة جديدة كل رندر فالـmemo مالوش أثر.
  const activeRequiredCount = useMemo(
    () => (policies.data ?? []).filter((r) => r.isActive && r.isRequired).length,
    [policies.data],
  );

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (bodyAr.trim().length < MIN_BODY_LENGTH) {
      setFormError(`نص السياسة لازم يكون ${MIN_BODY_LENGTH} حرف على الأقل`);
      return;
    }
    setFormError(null);
    setIsSaving(true);
    try {
      await authedFetch('/admin/payment-policies', {
        method: 'POST',
        body: JSON.stringify({
          slug: slug.trim(),
          title_ar: titleAr.trim(),
          applies_to: appliesTo,
          is_required: isRequired,
          body_ar: bodyAr.trim(),
        }),
      });
      toast.success('السياسة اتعملت');
      setSlug('');
      setTitleAr('');
      setBodyAr('');
      policies.reload();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  async function patchPolicy(id: string, body: Record<string, unknown>, successMessage: string) {
    try {
      await authedFetch(`/admin/payment-policies/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
      toast.success(successMessage);
      policies.reload();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'فشل الحفظ');
    }
  }

  async function publishVersion(id: string) {
    if (newVersionBody.trim().length < MIN_BODY_LENGTH) {
      toast.error(`نص السياسة لازم يكون ${MIN_BODY_LENGTH} حرف على الأقل`);
      return;
    }
    try {
      await authedFetch(`/admin/payment-policies/${id}/versions`, {
        method: 'POST',
        body: JSON.stringify({ body_ar: newVersionBody.trim() }),
      });
      toast.success('النسخة الجديدة اتنشرت');
      setNewVersionBody('');
      setPublishingFor(null);
      policies.reload();
      if (expandedId === id) versions.reload();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'فشل النشر');
    }
  }

  return (
    <AppShell>
      <PageHeader
        title="سياسات وشروط الدفع"
        description="الشروط اللي العميل لازم يوافق عليها قبل ما الحجز يعدّي. السياسة الإجبارية بتوقف الحجز فعلًا لحد ما العميل يقبلها."
      />

      <div className="flex flex-col gap-6">
        {!canManage && (
          <EmptyState title="ماعندكش صلاحية" description="الصفحة دي محتاجة صلاحية إدارة سياسات الدفع." />
        )}

        {canManage && (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">السياسات الحالية</CardTitle>
              </CardHeader>
              <CardContent>
                {policies.error && <ErrorNotice>{policies.error}</ErrorNotice>}
                {policies.loading && <p className="text-sm text-muted-foreground">جاري التحميل…</p>}
                {!policies.loading && !policies.error && rows.length === 0 && (
                  <EmptyState
                    title="مفيش سياسات"
                    description="مفيش أي شرط مفعّل دلوقتي — الحجز بيعدّي من غير أي موافقة. اعمل سياسة من تحت لو محتاج."
                  />
                )}
                {rows.length > 0 && (
                  <>
                    {/* **الرقم ده مهم قبل أي تعديل**: كل سياسة إجبارية مفعّلة هي شرط زيادة على
                        كل حجز مطابق — تفعيل واحدة بالغلط بيوقف حجوزات حقيقية. */}
                    <p className="mb-3 text-xs text-muted-foreground">
                      {activeRequiredCount === 0
                        ? 'مفيش أي سياسة إجبارية مفعّلة — مفيش حجز بيتوقف على موافقة دلوقتي.'
                        : `فيه ${activeRequiredCount} سياسة إجبارية مفعّلة — العميل لازم يوافق عليها قبل ما الحجز المطابق يعدّي.`}
                    </p>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>العنوان</TableHead>
                          <TableHead>بتنطبق على</TableHead>
                          <TableHead>إجبارية</TableHead>
                          <TableHead>الحالة</TableHead>
                          <TableHead>آخر نسخة</TableHead>
                          <TableHead />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rows.map((policy) => (
                          <TableRow key={policy.id} data-testid={`policy-row-${policy.slug}`}>
                            <TableCell className="font-medium">
                              {policy.titleAr}
                              <span className="block text-xs text-muted-foreground" dir="ltr">
                                {policy.slug}
                              </span>
                            </TableCell>
                            <TableCell>{APPLIES_TO_LABELS[policy.appliesTo] ?? policy.appliesTo}</TableCell>
                            <TableCell>
                              <Badge variant={policy.isRequired ? 'destructive' : 'secondary'}>
                                {policy.isRequired ? 'إجبارية' : 'اختيارية'}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge variant={policy.isActive ? 'default' : 'secondary'}>
                                {policy.isActive ? 'مفعّلة' : 'موقوفة'}
                              </Badge>
                            </TableCell>
                            <TableCell>{policy.latest_version ?? '—'}</TableCell>
                            <TableCell>
                              <div className="flex flex-wrap justify-end gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setExpandedId(expandedId === policy.id ? null : policy.id)}
                                  data-testid={`policy-versions-${policy.slug}`}
                                >
                                  {expandedId === policy.id ? 'إخفاء النسخ' : 'النسخ'}
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() =>
                                    setPublishingFor(publishingFor === policy.id ? null : policy.id)
                                  }
                                >
                                  نسخة جديدة
                                </Button>
                                <ConfirmDialog
                                  title={policy.isActive ? 'توقف السياسة دي؟' : 'تفعّل السياسة دي؟'}
                                  description={
                                    policy.isActive
                                      ? 'هتتوقف عن الظهور للعميل، وأي حجز كان بيستناها هيعدّي من غير موافقة.'
                                      : `هتبدأ تظهر للعميل فورًا${policy.isRequired ? '، و**الحجز المطابق هيتوقف** لحد ما يوافق عليها' : ''}.`
                                  }
                                  confirmLabel={policy.isActive ? 'أوقفها' : 'فعّلها'}
                                  onConfirm={() =>
                                    patchPolicy(
                                      policy.id,
                                      { is_active: !policy.isActive },
                                      policy.isActive ? 'السياسة اتوقفت' : 'السياسة اتفعّلت',
                                    )
                                  }
                                  trigger={
                                    <Button variant="outline" size="sm" data-testid={`policy-toggle-${policy.slug}`}>
                                      {policy.isActive ? 'أوقف' : 'فعّل'}
                                    </Button>
                                  }
                                />
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </>
                )}

                {publishingFor && (
                  <div className="mt-5 rounded-lg border p-4">
                    <Label htmlFor="policy-new-version">نص النسخة الجديدة</Label>
                    {/* **مفيش تعديل في المكان** — الشرح في تعليق أعلى الملف. */}
                    <p className="mt-1 mb-2 text-xs text-muted-foreground">
                      النص القديم بيفضل محفوظ زي ما هو، والنسخة دي بتبقى هي المعروضة للعميل من دلوقتي.
                      قبول العميل القديم مربوط بالنسخة اللي وافق عليها، فمش هيتغيّر بأثر رجعي.
                    </p>
                    <Textarea
                      id="policy-new-version"
                      data-testid="policy-new-version-body"
                      rows={6}
                      value={newVersionBody}
                      onChange={(e) => setNewVersionBody(e.target.value)}
                    />
                    <div className="mt-3 flex gap-2">
                      <Button onClick={() => publishVersion(publishingFor)} data-testid="policy-publish-version">
                        انشر النسخة
                      </Button>
                      <Button variant="outline" onClick={() => setPublishingFor(null)}>
                        إلغاء
                      </Button>
                    </div>
                  </div>
                )}

                {expandedId && (
                  <div className="mt-5 rounded-lg border p-4">
                    <p className="mb-3 text-sm font-semibold">النسخ المنشورة</p>
                    {versions.error && <ErrorNotice>{versions.error}</ErrorNotice>}
                    {versions.loading && <p className="text-sm text-muted-foreground">جاري التحميل…</p>}
                    {(versions.data ?? []).map((version) => (
                      <div key={version.id} className="mb-3 border-b pb-3 last:border-0">
                        <p className="text-xs text-muted-foreground">
                          نسخة {version.version} · {new Date(version.publishedAt).toLocaleString('ar-EG')}
                        </p>
                        <p className="mt-1 whitespace-pre-line text-sm">{version.bodyAr}</p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">سياسة جديدة</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleCreate} className="grid gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="policy-title">العنوان اللي العميل بيشوفه</Label>
                    <Input
                      id="policy-title"
                      data-testid="policy-title"
                      value={titleAr}
                      onChange={(e) => setTitleAr(e.target.value)}
                      maxLength={200}
                      required
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="policy-slug">المعرّف (إنجليزي، مرة واحدة ومش بيتغيّر)</Label>
                    <Input
                      id="policy-slug"
                      data-testid="policy-slug"
                      value={slug}
                      onChange={(e) => setSlug(e.target.value.replace(/[^a-z0-9-]/g, ''))}
                      maxLength={60}
                      dir="ltr"
                      placeholder="postpaid-terms"
                      required
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="policy-applies-to">بتنطبق على</Label>
                    <SelectNative
                      id="policy-applies-to"
                      data-testid="policy-applies-to"
                      value={appliesTo}
                      onChange={(e) => setAppliesTo(e.target.value)}
                    >
                      {APPLIES_TO_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </SelectNative>
                    <p className="text-xs text-muted-foreground">
                      «الدفع بعد الخدمة» هي الوحيدة اللي بتتفرض وقت إنشاء الطلب نفسه.
                    </p>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="policy-required">إجبارية؟</Label>
                    <SelectNative
                      id="policy-required"
                      data-testid="policy-required"
                      value={isRequired ? 'yes' : 'no'}
                      onChange={(e) => setIsRequired(e.target.value === 'yes')}
                    >
                      <option value="yes">إجبارية — الحجز مايعدّيش من غيرها</option>
                      <option value="no">اختيارية — بتتعرض بس</option>
                    </SelectNative>
                  </div>
                  <div className="flex flex-col gap-2 sm:col-span-2">
                    <Label htmlFor="policy-body">نص الشروط (النسخة الأولى)</Label>
                    <Textarea
                      id="policy-body"
                      data-testid="policy-body"
                      rows={6}
                      value={bodyAr}
                      onChange={(e) => setBodyAr(e.target.value)}
                      required
                    />
                    <p className="text-xs text-muted-foreground">{MIN_BODY_LENGTH} حرف على الأقل.</p>
                  </div>
                  <div className="sm:col-span-2">
                    {formError && <ErrorNotice className="mb-3">{formError}</ErrorNotice>}
                    <Button type="submit" disabled={isSaving} data-testid="policy-submit">
                      {isSaving ? 'جاري الحفظ…' : 'اعمل السياسة'}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppShell>
  );
}
