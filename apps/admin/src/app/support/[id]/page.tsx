'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type {
  ComplaintAttachmentResponseDto,
  ComplaintMessageResponseDto,
  ComplaintResolutionType,
  ComplaintResponseDto,
  ComplaintSeverity,
} from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { resolveMediaUrl } from '@/lib/media-url';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { SelectNative } from '@/components/ui/select-native';
import { formatEgp } from '@/lib/format';
import {
  CLOSABLE_COMPLAINT_STATUSES,
  COMPLAINT_CATEGORY_LABELS,
  COMPLAINT_RESOLUTION_TYPE_LABELS,
  COMPLAINT_SEVERITY_LABELS,
  COMPLAINT_STATUS_LABELS,
  complaintSeverityTone,
  complaintStatusTone,
  OPEN_COMPLAINT_STATUSES,
} from '@/lib/support-labels';

const RESOLUTION_TYPES: ComplaintResolutionType[] = [
  'refund',
  'partial_refund',
  'redo_service',
  'warning_issued',
  'technician_suspended',
  'no_action',
];

const SEVERITY_LEVELS: ComplaintSeverity[] = ['low', 'medium', 'high', 'critical'];

export default function ComplaintDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { isLoading, authedFetch } = useAuth();
  const router = useRouter();

  const [complaint, setComplaint] = useState<ComplaintResponseDto | null>(null);
  const [messages, setMessages] = useState<ComplaintMessageResponseDto[]>([]);
  const [attachments, setAttachments] = useState<ComplaintAttachmentResponseDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [newMessage, setNewMessage] = useState('');
  const [isInternalNote, setIsInternalNote] = useState(false);

  const [showResolveForm, setShowResolveForm] = useState(false);
  const [resolutionType, setResolutionType] = useState<ComplaintResolutionType>('no_action');
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [compensationEgp, setCompensationEgp] = useState('');

  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectNotes, setRejectNotes] = useState('');

  function load() {
    authedFetch<ComplaintResponseDto>(`/complaints/${id}`)
      .then(setComplaint)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل الشكوى'));
    authedFetch<ComplaintMessageResponseDto[]>(`/complaints/${id}/messages`)
      .then(setMessages)
      .catch(() => setMessages([]));
    authedFetch<ComplaintAttachmentResponseDto[]>(`/complaints/${id}/attachments`)
      .then(setAttachments)
      .catch(() => setAttachments([]));
  }

  useEffect(() => {
    if (isLoading) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, id]);

  async function handleSendMessage(e: FormEvent) {
    e.preventDefault();
    if (!newMessage.trim()) return;
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/complaints/${id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ message: newMessage, is_internal_note: isInternalNote }),
      });
      setNewMessage('');
      setIsInternalNote(false);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleResolve(e: FormEvent) {
    e.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      const compensationCents = compensationEgp.trim() ? Math.round(Number(compensationEgp) * 100) : undefined;
      await authedFetch(`/admin/complaints/${id}/resolve`, {
        method: 'POST',
        body: JSON.stringify({
          resolution_type: resolutionType,
          resolution_notes: resolutionNotes,
          ...(compensationCents !== undefined ? { compensation_cents: compensationCents } : {}),
        }),
      });
      setShowResolveForm(false);
      setResolutionNotes('');
      setCompensationEgp('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleReject(e: FormEvent) {
    e.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/complaints/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ resolution_notes: rejectNotes }),
      });
      setShowRejectForm(false);
      setRejectNotes('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleClose() {
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/complaints/${id}/close`, { method: 'POST' });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSeverityChange(severity: ComplaintSeverity) {
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/complaints/${id}/severity`, { method: 'PATCH', body: JSON.stringify({ severity }) });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  if (error && !complaint) {
    return (
      <AppShell>
        <p className="text-destructive">{error}</p>
      </AppShell>
    );
  }

  if (!complaint) {
    return (
      <AppShell>
        <p className="text-muted-foreground">جاري التحميل…</p>
      </AppShell>
    );
  }

  const canResolveOrReject = OPEN_COMPLAINT_STATUSES.has(complaint.complaint_status);
  const canClose = CLOSABLE_COMPLAINT_STATUSES.has(complaint.complaint_status);

  return (
    <AppShell>
      <Button variant="ghost" size="sm" className="mb-4" onClick={() => router.push('/support')}>
        رجوع للقايمة
      </Button>

      <PageHeader
        title={<span dir="ltr">{complaint.complaint_number}</span>}
        actions={
          <>
            <StatusChip tone={complaintStatusTone(complaint.complaint_status)}>
              {COMPLAINT_STATUS_LABELS[complaint.complaint_status]}
            </StatusChip>
            <StatusChip tone={complaintSeverityTone(complaint.severity)}>
              {COMPLAINT_SEVERITY_LABELS[complaint.severity]}
            </StatusChip>
            {complaint.complaint_status !== 'closed' && (
              <SelectNative
                aria-label="تعديل التصنيف"
                className="w-fit"
                value={complaint.severity}
                disabled={isSaving}
                onChange={(e) => handleSeverityChange(e.target.value as ComplaintSeverity)}
              >
                {SEVERITY_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {COMPLAINT_SEVERITY_LABELS[level]}
                  </option>
                ))}
              </SelectNative>
            )}
          </>
        }
      />

      {error && <p className="mb-4 text-destructive">{error}</p>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{complaint.title}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <p className="text-muted-foreground">{complaint.description}</p>
            <p>الفئة: {COMPLAINT_CATEGORY_LABELS[complaint.category]}</p>
            {complaint.order_id && (
              <p>
                الطلب:{' '}
                <a href={`/orders/${complaint.order_id}`} className="underline underline-offset-2">
                  عرض الطلب
                </a>
              </p>
            )}
            {complaint.resolution_type && (
              <p>نوع الحل: {COMPLAINT_RESOLUTION_TYPE_LABELS[complaint.resolution_type]}</p>
            )}
            {complaint.resolution_notes && <p>ملاحظات الحل: {complaint.resolution_notes}</p>}
            {complaint.compensation_cents > 0 && <p>التعويض: {formatEgp(complaint.compensation_cents)}</p>}
            <p>مهلة الرد (SLA): {new Date(complaint.sla_due_at).toLocaleString('ar-EG-u-nu-latn')}</p>

            {attachments.length > 0 && (
              <div className="mt-2 grid grid-cols-3 gap-2">
                {attachments.map((att) => (
                  <a key={att.id} href={resolveMediaUrl(att.file_url)} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element -- ملف من سيرفر الباك-إند نفسه */}
                    <img
                      src={resolveMediaUrl(att.file_url)}
                      alt="مرفق الشكوى"
                      className="aspect-square w-full rounded-md border object-cover"
                    />
                  </a>
                ))}
              </div>
            )}
          </CardContent>
          {(canResolveOrReject || canClose) && (
            <CardFooter className="flex-col items-stretch gap-3">
              <div className="flex gap-2">
                {canResolveOrReject && (
                  <>
                    <Button type="button" disabled={isSaving} onClick={() => setShowResolveForm((s) => !s)}>
                      حل الشكوى
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={isSaving}
                      onClick={() => setShowRejectForm((s) => !s)}
                    >
                      رفض الشكوى
                    </Button>
                  </>
                )}
                {canClose && (
                  <Button type="button" variant="outline" disabled={isSaving} onClick={handleClose}>
                    قفل الشكوى
                  </Button>
                )}
              </div>

              {showResolveForm && (
                <form onSubmit={handleResolve} className="flex flex-col gap-2 border-t pt-3">
                  <Label htmlFor="resolution_type">نوع الحل</Label>
                  <SelectNative
                    id="resolution_type"
                    value={resolutionType}
                    onChange={(e) => setResolutionType(e.target.value as ComplaintResolutionType)}
                  >
                    {RESOLUTION_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {COMPLAINT_RESOLUTION_TYPE_LABELS[type]}
                      </option>
                    ))}
                  </SelectNative>
                  <Label htmlFor="resolution_notes">ملاحظات الحل</Label>
                  <textarea
                    id="resolution_notes"
                    value={resolutionNotes}
                    onChange={(e) => setResolutionNotes(e.target.value)}
                    minLength={3}
                    required
                    rows={3}
                    className="border-input w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                  />
                  <Label htmlFor="compensation">تعويض (جنيه، اختياري)</Label>
                  <Input
                    id="compensation"
                    type="number"
                    min={0}
                    step="0.01"
                    value={compensationEgp}
                    onChange={(e) => setCompensationEgp(e.target.value)}
                    dir="ltr"
                  />
                  <Button type="submit" size="sm" disabled={isSaving} className="mt-1 w-fit">
                    تأكيد الحل
                  </Button>
                </form>
              )}

              {showRejectForm && (
                <form onSubmit={handleReject} className="flex flex-col gap-2 border-t pt-3">
                  <Label htmlFor="reject_notes">سبب الرفض</Label>
                  <textarea
                    id="reject_notes"
                    value={rejectNotes}
                    onChange={(e) => setRejectNotes(e.target.value)}
                    minLength={3}
                    required
                    rows={3}
                    className="border-input w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                  />
                  <Button type="submit" variant="destructive" size="sm" disabled={isSaving} className="mt-1 w-fit">
                    تأكيد الرفض
                  </Button>
                </form>
              )}
            </CardFooter>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">المراسلات</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {messages.length === 0 ? (
              <EmptyState title="مفيش رسائل لسه" />
            ) : (
              messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`rounded-md border p-2 text-sm ${msg.is_internal_note ? 'bg-muted/50' : ''}`}
                >
                  <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{msg.sender_role}</span>
                    {msg.is_internal_note && <Badge variant="outline">ملاحظة داخلية</Badge>}
                    <span>{new Date(msg.created_at).toLocaleString('ar-EG-u-nu-latn')}</span>
                  </div>
                  <p>{msg.message}</p>
                </div>
              ))
            )}
          </CardContent>
          <CardFooter>
            <form onSubmit={handleSendMessage} className="flex w-full flex-col gap-2">
              <textarea
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                placeholder="اكتب رد..."
                rows={2}
                className="border-input w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
              />
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={isInternalNote}
                    onChange={(e) => setIsInternalNote(e.target.checked)}
                  />
                  ملاحظة داخلية (مش هتظهر للعميل/الفني)
                </label>
                <Button type="submit" size="sm" disabled={isSaving || !newMessage.trim()}>
                  إرسال
                </Button>
              </div>
            </form>
          </CardFooter>
        </Card>
      </div>
    </AppShell>
  );
}
