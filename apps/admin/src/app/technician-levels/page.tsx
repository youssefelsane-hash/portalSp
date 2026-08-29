'use client';

import { useEffect, useState, type FormEvent } from 'react';
import type { TechnicianLevelConfigResponseDto, UpdateTechnicianLevelConfigBody } from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatEgp } from '@/lib/format';

export default function TechnicianLevelsPage() {
  const { isLoading, authedFetch } = useAuth();
  const [configs, setConfigs] = useState<TechnicianLevelConfigResponseDto[] | null>(null);
  const [editingLevel, setEditingLevel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  function load() {
    authedFetch<TechnicianLevelConfigResponseDto[]>('/admin/technician-levels')
      .then(setConfigs)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل إعدادات المستويات'));
  }

  useEffect(() => {
    if (isLoading) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  async function handleSave(e: FormEvent, level: string) {
    e.preventDefault();
    const form = new FormData(e.target as HTMLFormElement);
    const noLimit = form.get('no_limit') === 'on';
    const body: UpdateTechnicianLevelConfigBody = {
      display_name_ar: form.get('display_name_ar') as string,
      commission_adjustment_percentage: Number(form.get('commission_adjustment_percentage')),
      order_priority_weight: Number(form.get('order_priority_weight')),
      decision_limit_cents: noLimit ? null : Math.round(Number(form.get('decision_limit_egp')) * 100),
      can_lead_team: form.get('can_lead_team') === 'on',
      eligible_for_team_booking: form.get('eligible_for_team_booking') === 'on',
    };
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/technician-levels/${level}`, { method: 'PATCH', body: JSON.stringify(body) });
      setEditingLevel(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleAssistantSave(e: FormEvent, level: string) {
    e.preventDefault();
    const form = new FormData(e.target as HTMLFormElement);
    const body: UpdateTechnicianLevelConfigBody = {
      assistant_earning_multiplier: Number(form.get('assistant_earning_multiplier')),
    };
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/technician-levels/${level}`, { method: 'PATCH', body: JSON.stringify(body) });
      setEditingLevel(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <AppShell>
      <PageHeader
        title="سياسة مستويات الفنيين والمساعدين"
        description="سياسة الفنيين كما هي، ومعها ترقية المساعد التي ترفع أجره الأساسي حسب مستواه مع سجل مالي واضح لكل طلب."
      />

      {error && <p className="mb-4 text-destructive">{error}</p>}
      {!configs && !error && <p className="text-muted-foreground">جاري التحميل…</p>}

      {configs && (
        <div className="space-y-4">
          <Card className="overflow-hidden border-sky-200 bg-gradient-to-l from-sky-50 via-background to-amber-50">
            <CardHeader>
              <CardTitle>مستويات المساعدين</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-4 max-w-3xl text-sm leading-7 text-muted-foreground">
                الأجر الأساسي يتحدد داخل بيانات الخدمة في الكاتالوج. وقت التسوية يحسب النظام أجر المساعد عن مدة
                الطلب ثم يطبق معامل مستواه. التغيير يسري على الطلبات الجديدة فقط ولا يغيّر أي مستحق قديم.
              </p>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {configs.map((config) => {
                  const editKey = `assistant:${config.level}`;
                  return (
                    <div key={editKey} className="rounded-xl border bg-background/90 p-4 shadow-sm">
                      <div className="mb-3 flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold">مساعد {config.display_name_ar}</p>
                          <p className="text-xs text-muted-foreground">{config.level}</p>
                        </div>
                        {editingLevel !== editKey && (
                          <Button size="sm" variant="outline" onClick={() => setEditingLevel(editKey)}>
                            تعديل المعامل
                          </Button>
                        )}
                      </div>
                      {editingLevel === editKey ? (
                        <form onSubmit={(e) => handleAssistantSave(e, config.level)} className="space-y-3">
                          <div>
                            <Label htmlFor={`assistant_multiplier_${config.level}`}>معامل أجر المساعد</Label>
                            <Input
                              id={`assistant_multiplier_${config.level}`}
                              name="assistant_earning_multiplier"
                              type="number"
                              min={0.1}
                              max={3}
                              step="0.01"
                              dir="ltr"
                              defaultValue={config.assistant_earning_multiplier}
                              required
                            />
                          </div>
                          <p className="text-xs text-muted-foreground">
                            مثال على أجر أساسي 1,000 ج.م: {formatEgp(Math.round(100000 * config.assistant_earning_multiplier))}
                          </p>
                          <div className="flex gap-2">
                            <Button type="submit" size="sm" disabled={isSaving}>حفظ</Button>
                            <Button type="button" size="sm" variant="ghost" onClick={() => setEditingLevel(null)} disabled={isSaving}>
                              إلغاء
                            </Button>
                          </div>
                        </form>
                      ) : (
                        <div className="flex items-end justify-between rounded-lg bg-muted/45 px-3 py-2">
                          <span className="text-sm text-muted-foreground">أجر الخدمة الأساسي ×</span>
                          <span className="text-2xl font-bold tabular-nums">{config.assistant_earning_multiplier}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <div className="pt-2">
            <h2 className="text-lg font-semibold">سياسة الفنيين</h2>
            <p className="text-sm text-muted-foreground">العمولة والأولوية وحد القرار وأهلية قيادة الفريق بدون تغيير.</p>
          </div>
          {configs.map((config) => (
            <Card key={config.level}>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle className="text-base">
                  {config.display_name_ar} <span className="font-mono text-xs text-muted-foreground">({config.level})</span>
                </CardTitle>
                {editingLevel !== config.level && (
                  <Button size="sm" variant="outline" onClick={() => setEditingLevel(config.level)}>
                    تعديل
                  </Button>
                )}
              </CardHeader>
              <CardContent>
                {editingLevel === config.level ? (
                  <form
                    onSubmit={(e) => handleSave(e, config.level)}
                    className="grid grid-cols-1 gap-3 sm:grid-cols-2"
                  >
                    <div>
                      <Label htmlFor={`display_name_ar_${config.level}`}>الاسم المعروض</Label>
                      <Input
                        id={`display_name_ar_${config.level}`}
                        name="display_name_ar"
                        defaultValue={config.display_name_ar}
                        required
                        maxLength={60}
                      />
                    </div>
                    <div>
                      <Label htmlFor={`commission_${config.level}`}>تعديل العمولة % (سالب = خصم لصالح الفني)</Label>
                      <Input
                        id={`commission_${config.level}`}
                        name="commission_adjustment_percentage"
                        type="number"
                        step="0.01"
                        min={-100}
                        max={100}
                        dir="ltr"
                        defaultValue={config.commission_adjustment_percentage}
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor={`priority_${config.level}`}>وزن أولوية الإرسال</Label>
                      <Input
                        id={`priority_${config.level}`}
                        name="order_priority_weight"
                        type="number"
                        min={0}
                        max={1000}
                        dir="ltr"
                        defaultValue={config.order_priority_weight}
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor={`limit_${config.level}`}>حد قرار الفني بالجنيه (لو مفيش حد، فعّل &quot;بلا حد&quot;)</Label>
                      <Input
                        id={`limit_${config.level}`}
                        name="decision_limit_egp"
                        type="number"
                        min={0}
                        step="0.01"
                        dir="ltr"
                        defaultValue={config.decision_limit_cents !== null ? config.decision_limit_cents / 100 : ''}
                        disabled={config.decision_limit_cents === null}
                      />
                      <label className="mt-1 flex items-center gap-2 text-sm">
                        <input type="checkbox" name="no_limit" defaultChecked={config.decision_limit_cents === null} />
                        بلا حد (الفني يقبل أي قيمة طلب لوحده)
                      </label>
                    </div>
                    <label className="flex items-center gap-2 text-sm sm:col-span-2">
                      <input type="checkbox" name="can_lead_team" defaultChecked={config.can_lead_team} />
                      يقدر ينشئ/يقود شركة أو فريق
                    </label>
                    <label className="flex items-center gap-2 text-sm sm:col-span-2">
                      <input
                        type="checkbox"
                        name="eligible_for_team_booking"
                        defaultChecked={config.eligible_for_team_booking}
                      />
                      يظهر ويترشّح كقائد مهمة في حجوزات &quot;اعتماد&quot;
                    </label>
                    <div className="flex gap-2 sm:col-span-2">
                      <Button type="submit" size="sm" disabled={isSaving}>
                        حفظ
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setEditingLevel(null)} disabled={isSaving}>
                        إلغاء
                      </Button>
                    </div>
                  </form>
                ) : (
                  <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                    <div>
                      <dt className="text-muted-foreground">تعديل العمولة</dt>
                      <dd>{config.commission_adjustment_percentage}%</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">وزن الأولوية</dt>
                      <dd>{config.order_priority_weight}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">حد قرار الفني</dt>
                      <dd>{config.decision_limit_cents !== null ? formatEgp(config.decision_limit_cents) : 'بلا حد'}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">قيادة فريق</dt>
                      <dd>{config.can_lead_team ? 'مسموح' : 'غير مسموح'}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">قائد مهمة &quot;اعتماد&quot;</dt>
                      <dd>{config.eligible_for_team_booking ? 'مؤهّل' : 'غير مؤهّل'}</dd>
                    </div>
                  </dl>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </AppShell>
  );
}
