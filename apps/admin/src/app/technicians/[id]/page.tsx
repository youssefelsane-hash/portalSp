'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type {
  AdminServiceZoneResponseDto,
  AdminTechnicianDetailResponseDto,
  AdminWalletDetailResponseDto,
  AssignTechnicianZoneBody,
  TechnicianLevel,
  TechnicianZoneResponseDto,
} from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { PromptDialog } from '@/components/prompt-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { SelectNative } from '@/components/ui/select-native';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { VERIFICATION_STATUS_LABELS, LEVEL_LABELS, ALL_LEVELS, NEXT_VERIFICATION_STEP } from '@/lib/technician-labels';
import { formatEgp } from '@/lib/format';

export default function TechnicianDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { isLoading, authedFetch } = useAuth();
  const router = useRouter();

  const [detail, setDetail] = useState<AdminTechnicianDetailResponseDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [selectedLevel, setSelectedLevel] = useState<TechnicianLevel | ''>('');

  const [zones, setZones] = useState<TechnicianZoneResponseDto[] | null>(null);
  const [allZones, setAllZones] = useState<AdminServiceZoneResponseDto[] | null>(null);
  const [newZoneId, setNewZoneId] = useState('');
  const [newZoneIsPrimary, setNewZoneIsPrimary] = useState(false);

  const [wallet, setWallet] = useState<AdminWalletDetailResponseDto | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);

  function load() {
    authedFetch<AdminTechnicianDetailResponseDto>(`/admin/technicians/${id}`)
      .then((data) => {
        setDetail(data);
        setSelectedLevel(data.current_level);
        authedFetch<AdminWalletDetailResponseDto>(`/admin/wallets/${data.user_id}`)
          .then(setWallet)
          .catch((err) => setWalletError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل المحفظة'));
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل بيانات الفني'));
  }

  function loadZones() {
    authedFetch<TechnicianZoneResponseDto[]>(`/admin/technicians/${id}/zones`).then(setZones);
  }

  useEffect(() => {
    if (isLoading) return;
    load();
    loadZones();
    authedFetch<AdminServiceZoneResponseDto[]>('/admin/service-zones').then(setAllZones);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, id]);

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

  async function handleApprove() {
    await runAction(() => authedFetch(`/admin/technicians/${id}/approve`, { method: 'POST' }));
  }

  async function handleNextStep(endpoint: string, notes: string) {
    await runAction(() =>
      authedFetch(`/admin/technicians/${id}/${endpoint}`, {
        method: 'POST',
        body: JSON.stringify({ notes: notes || undefined }),
      }),
    );
  }

  async function handleReject(e: FormEvent) {
    e.preventDefault();
    await runAction(() =>
      authedFetch(`/admin/technicians/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason: rejectReason }),
      }),
    );
    setShowRejectForm(false);
    setRejectReason('');
  }

  async function handleChangeLevel(e: FormEvent) {
    e.preventDefault();
    if (!selectedLevel) return;
    await runAction(() =>
      authedFetch(`/admin/technicians/${id}/level`, {
        method: 'PATCH',
        body: JSON.stringify({ level: selectedLevel }),
      }),
    );
  }

  async function handleReviewDocument(documentId: string, reviewStatus: 'approved' | 'rejected', rejection_reason?: string) {
    await runAction(() =>
      authedFetch(`/admin/technicians/${id}/documents/${documentId}/review`, {
        method: 'POST',
        body: JSON.stringify({ review_status: reviewStatus, rejection_reason }),
      }),
    );
  }

  // كانت فجوة موثّقة صراحة: الشهادات (technician_certificates، تسويقية، منفصلة عن مستندات KYC
  // فوق) كانت بتتراجع عبر curl/Postman بس — مفيش شاشة أدمن تعرض المعلّقة أصلاً. نفس نمط
  // handleReviewDocument بالحرف.
  async function handleReviewCertificate(certificateId: string, reviewStatus: 'approved' | 'rejected', rejection_reason?: string) {
    await runAction(() =>
      authedFetch(`/admin/technicians/${id}/certificates/${certificateId}/review`, {
        method: 'POST',
        body: JSON.stringify({ review_status: reviewStatus, rejection_reason }),
      }),
    );
  }

  // "معاه مساعد؟" (docs/06 §3.7) — كانت فجوة موثّقة صراحة: endpoints الموافقة/الرفض كانت
  // موجودة ومختبرة (assistant-matching module بيعتمد عليها فعليًا في الأولوية 1 للمطابقة)
  // بس مفيش أي شاشة أدمن بتعرض طلبات pending_approval أصلاً.
  async function handleApproveAssistant() {
    await runAction(() => authedFetch(`/admin/technicians/${id}/assistant/approve`, { method: 'POST' }));
  }

  async function handleRejectAssistant() {
    await runAction(() => authedFetch(`/admin/technicians/${id}/assistant/reject`, { method: 'POST' }));
  }

  async function handleAssignZone(e: FormEvent) {
    e.preventDefault();
    if (!newZoneId) return;
    const body: AssignTechnicianZoneBody = { service_zone_id: newZoneId, is_primary: newZoneIsPrimary };
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/technicians/${id}/zones`, { method: 'POST', body: JSON.stringify(body) });
      setNewZoneId('');
      setNewZoneIsPrimary(false);
      loadZones();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleRemoveZone(serviceZoneId: string) {
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/technicians/${id}/zones/${serviceZoneId}`, { method: 'DELETE' });
      loadZones();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  function zoneName(serviceZoneId: string): string {
    return allZones?.find((z) => z.id === serviceZoneId)?.name_ar ?? serviceZoneId;
  }

  if (error && !detail) {
    return (
      <AppShell>
        <p className="text-destructive">{error}</p>
      </AppShell>
    );
  }

  if (!detail) {
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
            {detail.full_name}
            <Badge variant="outline">{VERIFICATION_STATUS_LABELS[detail.verification_status]}</Badge>
          </>
        }
        actions={
          <Button variant="outline" onClick={() => router.push('/technicians')}>
            رجوع للقايمة
          </Button>
        }
      />

      {error && <p className="mb-4 text-destructive">{error}</p>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">البيانات — كود {detail.technician_code}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <p dir="ltr" className="text-muted-foreground">{detail.phone_number}</p>
            <p>سنين خبرة: {detail.years_of_experience}</p>
            <p>نقاط الجودة: {detail.quality_score.toFixed(2)}</p>
            <p>متوسط التقييم: {detail.average_rating.toFixed(2)} ({detail.total_ratings_count} تقييم)</p>
            <p>طلبات مكتملة: {detail.completed_orders_count} · ملغاة: {detail.cancelled_orders_count}</p>
            <p>متاح دلوقتي: {detail.is_available ? 'أيوة' : 'لأ'} · في الخدمة: {detail.is_on_duty ? 'أيوة' : 'لأ'}</p>
          </CardContent>
          {detail.verification_status !== 'approved' && detail.verification_status !== 'rejected' && (
            <CardFooter className="flex-col items-stretch gap-3">
              <div className="flex gap-2">
                {NEXT_VERIFICATION_STEP[detail.verification_status] && (
                  <PromptDialog
                    trigger={
                      <Button variant="secondary" disabled={isSaving}>
                        {NEXT_VERIFICATION_STEP[detail.verification_status]!.label}
                      </Button>
                    }
                    title={NEXT_VERIFICATION_STEP[detail.verification_status]!.label}
                    label="ملاحظات (اختياري)"
                    required={false}
                    confirmLabel="تأكيد"
                    onConfirm={(notes) => handleNextStep(NEXT_VERIFICATION_STEP[detail.verification_status]!.endpoint, notes)}
                  />
                )}
                <Button disabled={isSaving} onClick={handleApprove}>
                  اعتماد
                </Button>
                <Button variant="destructive" disabled={isSaving} onClick={() => setShowRejectForm((s) => !s)}>
                  رفض
                </Button>
              </div>
              {showRejectForm && (
                <form onSubmit={handleReject} className="flex flex-col gap-2">
                  <Label htmlFor="reject_reason">سبب الرفض</Label>
                  <Input
                    id="reject_reason"
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    minLength={5}
                    required
                  />
                  <Button type="submit" variant="destructive" size="sm" disabled={isSaving}>
                    تأكيد الرفض
                  </Button>
                </form>
              )}
            </CardFooter>
          )}
        </Card>

        <Card>
          <form onSubmit={handleChangeLevel}>
            <CardHeader>
              <CardTitle className="text-base">المستوى</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {ALL_LEVELS.map((level) => (
                  <Button
                    key={level}
                    type="button"
                    size="sm"
                    variant={selectedLevel === level ? 'default' : 'outline'}
                    onClick={() => setSelectedLevel(level)}
                  >
                    {LEVEL_LABELS[level]}
                  </Button>
                ))}
              </div>
            </CardContent>
            <CardFooter>
              <Button type="submit" size="sm" disabled={isSaving || selectedLevel === detail.current_level}>
                حفظ المستوى
              </Button>
            </CardFooter>
          </form>
        </Card>

        {detail.assistant_link_status !== 'none' && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">المساعد الشخصي</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <p className="text-sm">
                الحالة:{' '}
                <Badge
                  variant={
                    detail.assistant_link_status === 'approved'
                      ? 'secondary'
                      : detail.assistant_link_status === 'pending_approval'
                        ? 'outline'
                        : 'destructive'
                  }
                >
                  {detail.assistant_link_status === 'approved'
                    ? 'معتمد'
                    : detail.assistant_link_status === 'pending_approval'
                      ? 'في انتظار الموافقة'
                      : detail.assistant_link_status}
                </Badge>
              </p>
              {detail.assistant_link_status === 'pending_approval' && (
                <div className="flex gap-2">
                  <Button type="button" size="sm" disabled={isSaving} onClick={handleApproveAssistant}>
                    موافقة
                  </Button>
                  <Button type="button" size="sm" variant="destructive" disabled={isSaving} onClick={handleRejectAssistant}>
                    رفض
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">المستندات</CardTitle>
          </CardHeader>
          <CardContent>
            {detail.documents.length === 0 ? (
              <EmptyState title="مفيش مستندات مرفوعة" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>النوع</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead>الملف</TableHead>
                    <TableHead>إجراء</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.documents.map((doc) => (
                    <TableRow key={doc.id}>
                      <TableCell>{doc.document_type}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            doc.review_status === 'approved'
                              ? 'secondary'
                              : doc.review_status === 'rejected'
                                ? 'destructive'
                                : 'outline'
                          }
                        >
                          {doc.review_status === 'approved'
                            ? 'معتمد'
                            : doc.review_status === 'rejected'
                              ? 'مرفوض'
                              : 'قيد المراجعة'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <a href={doc.file_url} target="_blank" rel="noreferrer" className="underline">
                          فتح الملف
                        </a>
                      </TableCell>
                      <TableCell>
                        {doc.review_status === 'pending' && (
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              disabled={isSaving}
                              onClick={() => handleReviewDocument(doc.id, 'approved')}
                            >
                              اعتماد
                            </Button>
                            <PromptDialog
                              trigger={
                                <Button size="sm" variant="destructive" disabled={isSaving}>
                                  رفض
                                </Button>
                              }
                              title="رفض المستند"
                              label="سبب الرفض"
                              minLength={1}
                              confirmLabel="رفض"
                              destructive
                              onConfirm={(reason) => handleReviewDocument(doc.id, 'rejected', reason)}
                            />
                          </div>
                        )}
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
            <CardTitle className="text-base">الشهادات</CardTitle>
          </CardHeader>
          <CardContent>
            {detail.certificates.length === 0 ? (
              <EmptyState title="مفيش شهادات مرفوعة" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>العنوان</TableHead>
                    <TableHead>الجهة المانحة</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead>الملف</TableHead>
                    <TableHead>إجراء</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.certificates.map((cert) => (
                    <TableRow key={cert.id}>
                      <TableCell>{cert.title}</TableCell>
                      <TableCell>{cert.issuer_name ?? '—'}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            cert.review_status === 'approved'
                              ? 'secondary'
                              : cert.review_status === 'rejected'
                                ? 'destructive'
                                : 'outline'
                          }
                        >
                          {cert.review_status === 'approved'
                            ? 'معتمدة'
                            : cert.review_status === 'rejected'
                              ? 'مرفوضة'
                              : 'قيد المراجعة'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <a href={cert.file_url} target="_blank" rel="noreferrer" className="underline">
                          فتح الملف
                        </a>
                      </TableCell>
                      <TableCell>
                        {cert.review_status === 'pending' && (
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              disabled={isSaving}
                              onClick={() => handleReviewCertificate(cert.id, 'approved')}
                            >
                              اعتماد
                            </Button>
                            <PromptDialog
                              trigger={
                                <Button size="sm" variant="destructive" disabled={isSaving}>
                                  رفض
                                </Button>
                              }
                              title="رفض الشهادة"
                              label="سبب الرفض"
                              minLength={1}
                              confirmLabel="رفض"
                              destructive
                              onConfirm={(reason) => handleReviewCertificate(cert.id, 'rejected', reason)}
                            />
                          </div>
                        )}
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
            <CardTitle className="text-base">مناطق العمل</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <form onSubmit={handleAssignZone} className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor="zone_select">المنطقة</Label>
                <SelectNative
                  id="zone_select"
                  value={newZoneId}
                  onChange={(e) => setNewZoneId(e.target.value)}
                  className="min-w-48"
                >
                  <option value="">اختار منطقة</option>
                  {allZones?.map((zone) => (
                    <option key={zone.id} value={zone.id}>
                      {zone.name_ar}
                    </option>
                  ))}
                </SelectNative>
              </div>
              <label className="flex items-center gap-2 pb-2 text-sm">
                <input
                  type="checkbox"
                  checked={newZoneIsPrimary}
                  onChange={(e) => setNewZoneIsPrimary(e.target.checked)}
                />
                منطقة أساسية
              </label>
              <Button type="submit" size="sm" disabled={isSaving || !newZoneId}>
                إضافة منطقة
              </Button>
            </form>

            {!zones ? (
              <p className="text-sm text-muted-foreground">جاري التحميل…</p>
            ) : zones.length === 0 ? (
              <EmptyState title="مفيش مناطق عمل معيّنة لسه" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>المنطقة</TableHead>
                    <TableHead>أساسية؟</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {zones.map((zone) => (
                    <TableRow key={zone.id}>
                      <TableCell>{zoneName(zone.service_zone_id)}</TableCell>
                      <TableCell>{zone.is_primary ? 'أيوة' : '—'}</TableCell>
                      <TableCell>
                        <Badge variant={zone.is_active ? 'secondary' : 'outline'}>
                          {zone.is_active ? 'نشطة' : 'معطّلة'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={isSaving}
                          onClick={() => handleRemoveZone(zone.service_zone_id)}
                        >
                          إزالة
                        </Button>
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
            <CardTitle className="text-base">المحفظة</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {walletError && <p className="text-destructive">{walletError}</p>}
            {!wallet && !walletError && <p className="text-muted-foreground">جاري التحميل…</p>}
            {wallet && (
              <>
                <div className="flex items-center gap-2">
                  <span className={`text-lg font-semibold ${wallet.wallet.balance_cents < 0 ? 'text-destructive' : ''}`}>
                    {formatEgp(wallet.wallet.balance_cents)}
                  </span>
                  {wallet.wallet.is_frozen && <Badge variant="destructive">مجمّدة</Badge>}
                  {wallet.wallet.balance_cents < 0 && <Badge variant="destructive">مديون للمنصة</Badge>}
                </div>
                <p className="text-muted-foreground">
                  محجوز للصرف: {formatEgp(wallet.wallet.reserved_balance_cents)} · إجمالي مكتسب:{' '}
                  {formatEgp(wallet.wallet.total_earned_cents)} · إجمالي مسحوب:{' '}
                  {formatEgp(wallet.wallet.total_withdrawn_cents)}
                </p>
                {wallet.wallet.balance_cents < 0 && (
                  <p className="text-xs text-destructive">
                    رصيد الفني سالب — عمولة كاش لسه متحصّلتش أو تصحيح استرداد بعد صرف سابق (docs/08 §20 بند 7).
                    هيتسوّى تلقائيًا من أول أرباح جاية قبل ما يقدر يطلب صرف تاني.
                  </p>
                )}
                <div>
                  <p className="mb-2 font-medium">آخر الحركات</p>
                  {wallet.transactions.length === 0 && <p className="text-muted-foreground">مفيش حركات لسه</p>}
                  <ul className="flex flex-col gap-2">
                    {wallet.transactions.slice(0, 10).map((tx) => (
                      <li key={tx.id} className="flex items-center justify-between border-b pb-2 text-xs last:border-0">
                        <div>
                          <p>{tx.description_ar ?? tx.transaction_type}</p>
                          <p className="text-muted-foreground">
                            {new Date(tx.created_at).toLocaleString('ar-EG-u-nu-latn')}
                          </p>
                        </div>
                        <span className={tx.direction === 'credit' ? 'text-green-600' : 'text-destructive'}>
                          {tx.direction === 'credit' ? '+' : '-'}
                          {formatEgp(tx.amount_cents)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
