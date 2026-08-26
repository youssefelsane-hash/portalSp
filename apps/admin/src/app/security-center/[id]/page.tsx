'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'next/navigation';
import { toast } from 'sonner';
import type { SecurityEventDto, SecurityEventNoteDto } from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { useAdminLiveRefresh } from '@/lib/admin-realtime-context';
import { ApiError } from '@/lib/api-client';
import { AppShell, useAdminBack } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { EmptyState } from '@/components/empty-state';

// تفاصيل حدث أمني — Part 11 §23. الإجراءات (acknowledge/investigate/resolve/note) محتاجة
// security.alerts.manage، القراءة بس محتاجة security.alerts.view (نفس فصل view/manage الموجود
// في كل موديول تاني بالمشروع).
const SEVERITY_LABELS: Record<string, string> = { info: 'معلومة', warning: 'تحذير', high: 'خطورة عالية', critical: 'حرج' };
const STATUS_LABELS: Record<string, string> = {
  open: 'مفتوح',
  acknowledged: 'مُقرّ بيه',
  investigating: 'تحت المراجعة',
  resolved: 'اتحل',
  false_positive: 'إنذار كاذب',
};

export default function SecurityEventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { isLoading, authedFetch } = useAuth();
  // رجوع حقيقي بيحافظ على حالة القايمة (docs/08 §63.ب6) بدل router.push اللي كان بيضيّعها.
  const goBack = useAdminBack('/security-center');

  const [event, setEvent] = useState<SecurityEventDto | null>(null);
  const [notes, setNotes] = useState<SecurityEventNoteDto[] | null>(null);
  const [noteText, setNoteText] = useState('');
  const [resolutionNote, setResolutionNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function load() {
    authedFetch<SecurityEventDto>(`/admin/security/events/${id}`)
      .then(setEvent)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل الحدث'));
    authedFetch<SecurityEventNoteDto[]>(`/admin/security/events/${id}/notes`)
      .then(setNotes)
      .catch(() => setNotes([]));
  }

  useEffect(() => {
    if (isLoading) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, id]);
  // docs/08 §63.ب1 — تحديث حي: الباك-إند بيبثّ الأحداث دي أصلاً عبر AdminRealtimeGateway،
  // الصفحة دي كانت بتفوّتها فكانت محتاجة refresh يدوي.
  useAdminLiveRefresh(["security"], () => load());

  async function runAction(path: string, body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      await authedFetch(`/admin/security/events/${id}/${path}`, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
      toast.success('اتنفّذ');
      load();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني';
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  async function handleAddNote(e: FormEvent) {
    e.preventDefault();
    if (!noteText.trim()) return;
    setBusy(true);
    try {
      await authedFetch(`/admin/security/events/${id}/notes`, { method: 'POST', body: JSON.stringify({ note: noteText }) });
      setNoteText('');
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'فشل إضافة الملاحظة');
    } finally {
      setBusy(false);
    }
  }

  if (error && !event) {
    return (
      <AppShell>
        <p className="text-destructive">{error}</p>
      </AppShell>
    );
  }

  if (!event) {
    return (
      <AppShell>
        <p className="text-muted-foreground">جاري التحميل…</p>
      </AppShell>
    );
  }

  const isClosed = event.status === 'resolved' || event.status === 'false_positive';

  return (
    <AppShell>
      <PageHeader
        title={
          <>
            حدث أمني
            <Badge variant={event.severity === 'critical' ? 'destructive' : 'secondary'}>{SEVERITY_LABELS[event.severity]}</Badge>
          </>
        }
        actions={
          <Button variant="outline" onClick={goBack}>
            رجوع لمركز الأمان
          </Button>
        }
      />

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">التفاصيل</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <div>
              <span className="text-muted-foreground">الحالة: </span>
              {STATUS_LABELS[event.status]}
            </div>
            <div>
              <span className="text-muted-foreground">الفاعل: </span>
              <span dir="ltr">{event.actorUserId ?? '—'}</span>
              {event.actorRole && ` (${event.actorRole})`}
            </div>
            <div>
              <span className="text-muted-foreground">الهدف: </span>
              <span dir="ltr">{event.targetUserId ?? '—'}</span>
            </div>
            <div>
              <span className="text-muted-foreground">الفعل المحاول: </span>
              {event.action ?? '—'}
            </div>
            <div>
              <span className="text-muted-foreground">IP: </span>
              <span dir="ltr">{event.ipAddress ?? '—'}</span>
            </div>
            <div>
              <span className="text-muted-foreground">عدد المحاولات: </span>
              {event.occurrenceCount}
            </div>
            <div>
              <span className="text-muted-foreground">أول محاولة: </span>
              {new Date(event.firstOccurredAt).toLocaleString('ar-EG-u-nu-latn')}
            </div>
            <div>
              <span className="text-muted-foreground">آخر محاولة: </span>
              {new Date(event.lastOccurredAt).toLocaleString('ar-EG-u-nu-latn')}
            </div>
            {event.attemptedValue && (
              <div>
                <span className="text-muted-foreground">تفاصيل إضافية: </span>
                <code className="text-xs">{JSON.stringify(event.attemptedValue)}</code>
              </div>
            )}
          </CardContent>
          <CardFooter className="flex flex-wrap gap-2">
            {event.status === 'open' && (
              <Button size="sm" disabled={busy} onClick={() => runAction('acknowledge')}>
                إقرار
              </Button>
            )}
            {!isClosed && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => runAction('investigate')}>
                بدء مراجعة
              </Button>
            )}
            {!isClosed && (
              <>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => runAction('resolve', { status: 'resolved', resolution_note: resolutionNote || undefined })}
                >
                  حل الحدث
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => runAction('resolve', { status: 'false_positive', resolution_note: resolutionNote || undefined })}
                >
                  إنذار كاذب
                </Button>
              </>
            )}
          </CardFooter>
          {!isClosed && (
            <div className="border-t px-6 py-4">
              <Label htmlFor="resolution_note">ملاحظة الحل (اختياري)</Label>
              <Textarea id="resolution_note" className="mt-2" value={resolutionNote} onChange={(e) => setResolutionNote(e.target.value)} rows={2} />
            </div>
          )}
          {isClosed && event.resolutionNote && (
            <div className="border-t px-6 py-4 text-sm">
              <span className="text-muted-foreground">ملاحظة الحل: </span>
              {event.resolutionNote}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">ملاحظات التحقيق</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {notes === null ? (
              <p className="text-sm text-muted-foreground">جاري التحميل…</p>
            ) : notes.length === 0 ? (
              <EmptyState title="مفيش ملاحظات لسه" />
            ) : (
              notes.map((note) => (
                <div key={note.id} className="rounded-md border p-3 text-sm">
                  <p>{note.note}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{new Date(note.createdAt).toLocaleString('ar-EG-u-nu-latn')}</p>
                </div>
              ))
            )}
          </CardContent>
          <form onSubmit={handleAddNote} className="border-t px-6 py-4">
            <Label htmlFor="new_note">ملاحظة جديدة</Label>
            <Textarea id="new_note" className="mt-2" value={noteText} onChange={(e) => setNoteText(e.target.value)} rows={2} minLength={3} />
            <Button type="submit" size="sm" className="mt-3" disabled={busy || !noteText.trim()}>
              إضافة
            </Button>
          </form>
        </Card>
      </div>
    </AppShell>
  );
}
