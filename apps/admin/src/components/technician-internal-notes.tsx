'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { LockKeyhole, Send, StickyNote } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';

interface TechnicianInternalNoteDto {
  id: string;
  technician_id: string;
  author_user_id: string;
  author_full_name: string;
  note: string;
  created_at: string;
}

export function TechnicianInternalNotes({ technicianId }: { technicianId: string }) {
  const { authedFetch } = useAuth();
  const [notes, setNotes] = useState<TechnicianInternalNoteDto[] | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await authedFetch<TechnicianInternalNoteDto[]>(`/admin/technicians/${technicianId}/notes`);
      setNotes(data);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'تعذّر تحميل الملاحظات الداخلية');
    }
  }, [authedFetch, technicianId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const note = draft.trim();
    if (!note) return;
    setSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/technicians/${technicianId}/notes`, {
        method: 'POST',
        body: JSON.stringify({ note }),
      });
      setDraft('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'تعذّر حفظ الملاحظة');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="border-info/20 bg-info-bg/25">
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <StickyNote className="size-4 text-info" />
            ملاحظات الإدارة على الفني
          </CardTitle>
          <CardDescription className="mt-1 flex items-center gap-1.5">
            <LockKeyhole className="size-3.5" />
            داخلية فقط، لا تظهر للفني أو العميل
          </CardDescription>
        </div>
        <span className="rounded-full bg-card px-2.5 py-1 text-xs text-muted-foreground shadow-sm">
          {notes?.length ?? 0} ملاحظة
        </span>
      </CardHeader>
      <CardContent className="grid gap-5 lg:grid-cols-[minmax(18rem,0.85fr)_minmax(20rem,1.15fr)]">
        <form onSubmit={submit} className="space-y-3">
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={2000}
            rows={4}
            placeholder="مثال: يفضّل التواصل معه صباحًا، أو تفاصيل تشغيلية يحتاج الفريق يعرفها…"
            aria-label="ملاحظة داخلية جديدة"
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">{draft.length}/2000</span>
            <Button type="submit" size="sm" disabled={saving || !draft.trim()}>
              <Send className="size-4" />
              {saving ? 'جاري الحفظ…' : 'إضافة ملاحظة'}
            </Button>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </form>

        <div className="max-h-64 space-y-2 overflow-y-auto pe-1">
          {notes === null && !error && <p className="text-sm text-muted-foreground">جاري تحميل الملاحظات…</p>}
          {notes?.length === 0 && <p className="rounded-xl border border-dashed bg-card/60 p-4 text-sm text-muted-foreground">لا توجد ملاحظات داخلية حتى الآن.</p>}
          {notes?.map((note) => (
            <article key={note.id} className="rounded-xl border bg-card/90 p-3 shadow-sm">
              <p className="whitespace-pre-wrap text-sm leading-6">{note.note}</p>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>{note.author_full_name}</span>
                <time dateTime={note.created_at}>{new Date(note.created_at).toLocaleString('ar-EG-u-nu-latn')}</time>
              </div>
            </article>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
