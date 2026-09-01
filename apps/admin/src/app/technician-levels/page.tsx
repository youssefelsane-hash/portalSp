'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import type { TechnicianLevelConfigResponseDto, UpdateTechnicianLevelConfigBody } from '@baytak/shared-types';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { formatEgp } from '@/lib/format';

export default function TechnicianLevelsPage() {
  const { isLoading, authedFetch } = useAuth();
  const [configs, setConfigs] = useState<TechnicianLevelConfigResponseDto[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function load() {
    authedFetch<TechnicianLevelConfigResponseDto[]>('/admin/technician-levels')
      .then(setConfigs)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'تعذر تحميل المستويات'));
  }

  useEffect(() => {
    if (!isLoading) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  async function save(event: FormEvent<HTMLFormElement>, level: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body: UpdateTechnicianLevelConfigBody = {
      display_name_ar: String(form.get('display_name_ar')),
      order_priority_weight: Number(form.get('order_priority_weight')),
      decision_limit_cents:
        form.get('no_limit') === 'on' ? null : Math.round(Number(form.get('decision_limit_egp')) * 100),
      can_lead_team: form.get('can_lead_team') === 'on',
      eligible_for_team_booking: form.get('eligible_for_team_booking') === 'on',
    };
    setSaving(true);
    try {
      await authedFetch(`/admin/technician-levels/${level}`, { method: 'PATCH', body: JSON.stringify(body) });
      setEditing(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'لم يتم حفظ المستوى');
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell>
      <PageHeader
        title="المستويات والمسار التشغيلي"
        description="هنا تُدار صلاحيات المستوى وأولوية الإرسال فقط. أوزان المستحقات ونِسب المساعدين لها مصدر مالي واحد مستقل."
      />
      <Card className="mb-5 border-sky-200 bg-sky-50/60">
        <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <strong>تبحث عن تسعير الفني أو المساعد؟</strong>
            <p className="text-sm text-muted-foreground">انتقل إلى مركز سياسة المستحقات لتجنب وجود إعدادين يؤثران على نفس الفلوس.</p>
          </div>
          <Button asChild><Link href="/earnings-policy">فتح سياسة المستحقات</Link></Button>
        </CardContent>
      </Card>
      {error && <p className="mb-4 text-destructive">{error}</p>}
      {!configs && !error && <p className="text-muted-foreground">جاري التحميل…</p>}
      <div className="space-y-4">
        {configs?.map((config, index) => (
          <Card key={config.level}>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-3 text-base">
                {config.display_name_ar}
                <span className="text-amber-500">{'★'.repeat(index + 1)}</span>
              </CardTitle>
              {editing !== config.level && <Button size="sm" variant="outline" onClick={() => setEditing(config.level)}>تعديل التشغيل</Button>}
            </CardHeader>
            <CardContent>
              {editing === config.level ? (
                <form onSubmit={(event) => save(event, config.level)} className="grid gap-3 sm:grid-cols-2">
                  <div><Label>الاسم المعروض</Label><Input name="display_name_ar" defaultValue={config.display_name_ar} required /></div>
                  <div><Label>وزن أولوية الإرسال</Label><Input name="order_priority_weight" type="number" min={0} max={1000} defaultValue={config.order_priority_weight} dir="ltr" required /></div>
                  <div>
                    <Label>حد القرار بالجنيه</Label>
                    <Input name="decision_limit_egp" type="number" min={0} step="0.01" defaultValue={config.decision_limit_cents == null ? '' : config.decision_limit_cents / 100} dir="ltr" />
                    <label className="mt-2 flex gap-2 text-sm"><input type="checkbox" name="no_limit" defaultChecked={config.decision_limit_cents == null} /> بلا حد</label>
                  </div>
                  <div className="space-y-3 pt-6">
                    <label className="flex gap-2 text-sm"><input type="checkbox" name="can_lead_team" defaultChecked={config.can_lead_team} /> يستطيع قيادة شركة أو فريق</label>
                    <label className="flex gap-2 text-sm"><input type="checkbox" name="eligible_for_team_booking" defaultChecked={config.eligible_for_team_booking} /> مؤهل لقيادة حجز اعتماد</label>
                  </div>
                  <div className="flex gap-2 sm:col-span-2"><Button disabled={saving}>حفظ</Button><Button type="button" variant="ghost" onClick={() => setEditing(null)}>إلغاء</Button></div>
                </form>
              ) : (
                <dl className="grid gap-3 text-sm sm:grid-cols-4">
                  <div><dt className="text-muted-foreground">ترتيب المستوى</dt><dd>{index + 1} من {configs.length}</dd></div>
                  <div><dt className="text-muted-foreground">أولوية الإرسال</dt><dd>{config.order_priority_weight}</dd></div>
                  <div><dt className="text-muted-foreground">حد القرار</dt><dd>{config.decision_limit_cents == null ? 'بلا حد' : formatEgp(config.decision_limit_cents)}</dd></div>
                  <div><dt className="text-muted-foreground">قيادة الفريق</dt><dd>{config.can_lead_team ? 'مسموح' : 'غير مسموح'}</dd></div>
                </dl>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </AppShell>
  );
}
