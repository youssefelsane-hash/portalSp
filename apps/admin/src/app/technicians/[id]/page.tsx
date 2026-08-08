'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { AdminTechnicianDetailResponseDto, TechnicianLevel } from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { VERIFICATION_STATUS_LABELS, LEVEL_LABELS, ALL_LEVELS } from '@/lib/technician-labels';

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

  function load() {
    authedFetch<AdminTechnicianDetailResponseDto>(`/admin/technicians/${id}`)
      .then((data) => {
        setDetail(data);
        setSelectedLevel(data.current_level);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل بيانات الفني'));
  }

  useEffect(() => {
    if (isLoading) return;
    load();
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

  async function handleReviewDocument(documentId: string, reviewStatus: 'approved' | 'rejected') {
    const rejection_reason = reviewStatus === 'rejected' ? window.prompt('سبب الرفض؟') : undefined;
    if (reviewStatus === 'rejected' && !rejection_reason) return;
    await runAction(() =>
      authedFetch(`/admin/technicians/${id}/documents/${documentId}/review`, {
        method: 'POST',
        body: JSON.stringify({ review_status: reviewStatus, rejection_reason }),
      }),
    );
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
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">{detail.full_name}</h1>
          <Badge variant="outline">{VERIFICATION_STATUS_LABELS[detail.verification_status]}</Badge>
        </div>
        <Button variant="outline" onClick={() => router.push('/technicians')}>
          رجوع للقايمة
        </Button>
      </div>

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

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">المستندات</CardTitle>
          </CardHeader>
          <CardContent>
            {detail.documents.length === 0 ? (
              <p className="text-sm text-muted-foreground">مفيش مستندات مرفوعة</p>
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
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={isSaving}
                              onClick={() => handleReviewDocument(doc.id, 'rejected')}
                            >
                              رفض
                            </Button>
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
      </div>
    </AppShell>
  );
}
