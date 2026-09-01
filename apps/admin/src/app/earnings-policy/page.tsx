'use client';

import { useEffect, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  Calculator,
  CheckCircle2,
  Coins,
  History,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  UserRound,
} from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { formatEgp } from '@/lib/format';

type LevelPolicy = {
  id: string;
  level: string;
  display_name_ar: string;
  earning_weight_bps: number;
  assistant_ratio_bps: number;
};
type SkillPolicy = { skill_level: string; factor_bps: number };
type ServicePolicy = {
  id: string;
  name_ar: string;
  slug: string;
  is_active: boolean;
  platform_commission_cents: number | null;
};
type ServiceLevelOverride = { service_id: string; technician_level: string; assistant_ratio_bps: number };
type ServiceSkillOverride = { service_id: string; skill_level: string; factor_bps: number };
type TechnicianOption = {
  id: string;
  full_name: string;
  technician_kind: 'technician' | 'assistant';
  current_level: string;
};
type TechnicianAdjustment = TechnicianOption & {
  technician_id: string;
  service_id: string | null;
  service_name_ar: string | null;
  adjustment_bps: number;
  reason: string;
  effective_from: string;
  effective_until: string | null;
};
type ShadowOrder = {
  order_id: string;
  order_number: string;
  legacy_platform_cents: number;
  v2_platform_cents: number;
  legacy_worker_pool_cents: number;
  v2_worker_pool_cents: number;
  absolute_delta_cents: number;
};
type AuditEntry = {
  action: string;
  actor_name: string | null;
  new_values: Record<string, unknown> | null;
  created_at: string;
};
type SimulationResult = {
  platformCommissionCents: number;
  workerPoolCents: number;
  participantShares: Array<{
    technicianId: string;
    earningRole: 'technician' | 'assistant';
    effectiveWeightUnits: string;
    shareCents: number;
  }>;
};
type Overview = {
  cutover_enabled: boolean;
  shadow_enabled: boolean;
  readiness: {
    ready: boolean;
    configured_active_services: number;
    active_services: number;
    missing_services: Array<{ id: string; name_ar: string }>;
  };
  levels: LevelPolicy[];
  skills: SkillPolicy[];
  services: ServicePolicy[];
  service_level_overrides: ServiceLevelOverride[];
  service_skill_overrides: ServiceSkillOverride[];
  technicians: TechnicianOption[];
  technician_adjustments: TechnicianAdjustment[];
  shadow: { compared_orders: number; average_absolute_delta_cents: string; maximum_absolute_delta_cents: number };
  shadow_orders: ShadowOrder[];
  audit_history: AuditEntry[];
};

const skillNames: Record<string, string> = { beginner: 'مبتدئ', standard: 'قياسي', expert: 'خبير' };

export default function EarningsPolicyPage() {
  const { authedFetch, isLoading } = useAuth();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [selectedServiceId, setSelectedServiceId] = useState('');
  const [simulation, setSimulation] = useState<SimulationResult | null>(null);

  function load() {
    setError(null);
    authedFetch<Overview>('/admin/earnings-policy')
      .then(setOverview)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'تعذر تحميل سياسة المستحقات'));
  }

  useEffect(() => {
    if (isLoading) return;
    const timeoutId = window.setTimeout(load, 0);
    return () => window.clearTimeout(timeoutId);
    // `load` intentionally reads the current authenticated fetcher when this auth gate opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  async function submit(
    key: string,
    path: string,
    body: Record<string, unknown>,
    method: 'PATCH' | 'POST' | 'PUT' | 'DELETE' = 'PATCH',
  ) {
    setSaving(key);
    setError(null);
    try {
      await authedFetch(path, { method, body: JSON.stringify(body) });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'لم يتم حفظ التعديل');
    } finally {
      setSaving(null);
    }
  }

  async function saveLevel(event: FormEvent<HTMLFormElement>, level: LevelPolicy) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await submit(`level:${level.level}`, `/admin/earnings-policy/levels/${level.level}`, {
      earning_weight_bps: Math.round(Number(form.get('weight')) * 10_000),
      assistant_ratio_bps: Math.round(Number(form.get('assistant_ratio')) * 100),
      reason: form.get('reason'),
    });
  }

  async function saveSkill(event: FormEvent<HTMLFormElement>, skill: SkillPolicy) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await submit(`skill:${skill.skill_level}`, `/admin/earnings-policy/skills/${skill.skill_level}`, {
      factor_bps: Math.round(Number(form.get('factor')) * 10_000),
      reason: form.get('reason'),
    });
  }

  async function saveService(event: FormEvent<HTMLFormElement>, service: ServicePolicy) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await submit(`service:${service.id}`, `/admin/earnings-policy/services/${service.id}/commission`, {
      platform_commission_cents: Math.round(Number(form.get('commission_egp')) * 100),
      reason: form.get('reason'),
    });
  }

  async function saveLevelOverride(event: FormEvent<HTMLFormElement>, level: LevelPolicy) {
    event.preventDefault();
    if (!selectedServiceId) return;
    const form = new FormData(event.currentTarget);
    await submit(
      `service-level:${level.level}`,
      `/admin/earnings-policy/services/${selectedServiceId}/levels/${level.level}`,
      {
        assistant_ratio_bps: Math.round(Number(form.get('assistant_ratio')) * 100),
        reason: form.get('reason'),
      },
      'PUT',
    );
  }

  async function saveSkillOverride(event: FormEvent<HTMLFormElement>, skill: SkillPolicy) {
    event.preventDefault();
    if (!selectedServiceId) return;
    const form = new FormData(event.currentTarget);
    await submit(
      `service-skill:${skill.skill_level}`,
      `/admin/earnings-policy/services/${selectedServiceId}/skills/${skill.skill_level}`,
      { factor_bps: Math.round(Number(form.get('factor')) * 10_000), reason: form.get('reason') },
      'PUT',
    );
  }

  async function resetOverride(kind: 'levels' | 'skills', key: string) {
    if (!selectedServiceId) return;
    await submit(
      `reset:${kind}:${key}`,
      `/admin/earnings-policy/services/${selectedServiceId}/${kind}/${key}`,
      { reason: 'إعادة الخدمة إلى السياسة العامة من مركز المستحقات' },
      'DELETE',
    );
  }

  async function createAdjustment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const technicianId = String(form.get('technician_id'));
    const serviceId = String(form.get('service_id') ?? '');
    const effectiveUntil = String(form.get('effective_until') ?? '');
    await submit(
      'technician-adjustment',
      `/admin/earnings-policy/technicians/${technicianId}/adjustments`,
      {
        service_id: serviceId || undefined,
        adjustment_bps: Math.round(Number(form.get('adjustment_percentage')) * 100),
        reason: form.get('reason'),
        effective_until: effectiveUntil ? new Date(effectiveUntil).toISOString() : undefined,
      },
      'POST',
    );
    event.currentTarget.reset();
  }

  async function runSimulation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!overview) return;
    const form = new FormData(event.currentTarget);
    const leaderLevel = overview.levels.find((item) => item.level === form.get('leader_level'))!;
    const assistantLevel = overview.levels.find((item) => item.level === form.get('assistant_level'))!;
    const leaderSkill = overview.skills.find((item) => item.skill_level === form.get('leader_skill'))!;
    const assistantSkill = overview.skills.find((item) => item.skill_level === form.get('assistant_skill'))!;
    setSaving('simulation');
    setError(null);
    try {
      const result = await authedFetch<SimulationResult>('/admin/earnings-policy/simulate', {
        method: 'POST',
        body: JSON.stringify({
          order_total_cents: Math.round(Number(form.get('total_egp')) * 100),
          platform_commission_cents: Math.round(Number(form.get('commission_egp')) * 100),
          participants: [
            {
              technician_id: 'simulated-leader',
              earning_role: 'technician',
              is_leader: true,
              technician_kind: 'technician',
              technician_level: leaderLevel.level,
              level_weight_bps: leaderLevel.earning_weight_bps,
              assistant_ratio_bps: leaderLevel.assistant_ratio_bps,
              service_skill: leaderSkill.skill_level,
              service_skill_factor_bps: leaderSkill.factor_bps,
            },
            {
              technician_id: 'simulated-assistant',
              earning_role: 'assistant',
              is_leader: false,
              technician_kind: 'assistant',
              technician_level: assistantLevel.level,
              level_weight_bps: assistantLevel.earning_weight_bps,
              assistant_ratio_bps: assistantLevel.assistant_ratio_bps,
              service_skill: assistantSkill.skill_level,
              service_skill_factor_bps: assistantSkill.factor_bps,
              individual_adjustment_bps: Math.round(Number(form.get('assistant_adjustment')) * 100),
            },
          ],
        }),
      });
      setSimulation(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'تعذر تشغيل المحاكي');
    } finally {
      setSaving(null);
    }
  }

  async function toggleCutover() {
    if (!overview) return;
    setSaving('cutover');
    setError(null);
    try {
      await authedFetch('/admin/earnings-policy/cutover', {
        method: 'POST',
        body: JSON.stringify({
          enabled: !overview.cutover_enabled,
          reason: overview.cutover_enabled ? 'إيقاف تشغيلي من مركز سياسة المستحقات' : 'تفعيل بعد اكتمال فحص الجاهزية',
        }),
      });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'لم يتم تغيير حالة التشغيل');
    } finally {
      setSaving(null);
    }
  }

  return (
    <AppShell>
      <PageHeader
        title="مركز سياسة المستحقات"
        description="مصدر واحد لعمولة المنصة الثابتة وتوزيع وعاء الفنيين والمساعدين. التعديلات تسري على الطلبات الجديدة فقط."
      />

      {error && <div className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
      {!overview && !error && <p className="text-muted-foreground">جاري تحميل السياسة المالية…</p>}

      {overview && (
        <div className="space-y-6">
          <Card className={overview.readiness.ready ? 'border-emerald-200 bg-emerald-50/60' : 'border-amber-200 bg-amber-50/70'}>
            <CardContent className="flex flex-col gap-5 pt-6 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-start gap-3">
                {overview.readiness.ready ? <CheckCircle2 className="mt-1 text-emerald-700" /> : <AlertTriangle className="mt-1 text-amber-700" />}
                <div>
                  <h2 className="text-lg font-bold">{overview.readiness.ready ? 'السياسة جاهزة للتشغيل' : 'الإعداد لم يكتمل بعد'}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    تم ضبط {overview.readiness.configured_active_services} من {overview.readiness.active_services} خدمة نشطة.
                    {overview.readiness.missing_services.length > 0 && ` المتبقي: ${overview.readiness.missing_services.map((item) => item.name_ar).join('، ')}.`}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge variant={overview.cutover_enabled ? 'default' : 'secondary'}>
                      {overview.cutover_enabled ? 'V2 يعمل للطلبات الجديدة' : 'V2 غير مفعّل'}
                    </Badge>
                    <Badge variant="outline">المقارنة الصامتة: {overview.shadow_enabled ? 'تعمل' : 'متوقفة'}</Badge>
                  </div>
                </div>
              </div>
              <Button
                onClick={toggleCutover}
                disabled={saving === 'cutover' || (!overview.readiness.ready && !overview.cutover_enabled)}
                variant={overview.cutover_enabled ? 'outline' : 'default'}
              >
                <ShieldCheck className="ml-2 h-4 w-4" />
                {overview.cutover_enabled ? 'إيقاف V2 للطلبات الجديدة' : 'تفعيل V2 بأمان'}
              </Button>
            </CardContent>
          </Card>

          <section>
            <div className="mb-3">
              <h2 className="text-xl font-bold">السلم المهني والتوزيع</h2>
              <p className="text-sm text-muted-foreground">وزن الفني يحدد حصته النسبية، ونسبة المساعد تقارنه بفني في نفس المستوى.</p>
            </div>
            <div className="grid gap-4 xl:grid-cols-5">
              {overview.levels.map((level, index) => (
                <Card key={level.level} className="overflow-hidden">
                  <div className="h-1.5 bg-gradient-to-l from-sky-600 to-amber-400" />
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="text-base">{level.display_name_ar}</CardTitle>
                      <span className="text-amber-500" aria-label={`المستوى ${index + 1}`}>{'★'.repeat(index + 1)}</span>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <form className="space-y-3" onSubmit={(event) => saveLevel(event, level)}>
                      <div>
                        <Label>وزن الفني</Label>
                        <Input name="weight" type="number" min="0.0001" step="0.01" defaultValue={level.earning_weight_bps / 10_000} dir="ltr" required />
                      </div>
                      <div>
                        <Label>المساعد من فني نفس المستوى %</Label>
                        <Input name="assistant_ratio" type="number" min="0.01" max="100" step="0.01" defaultValue={level.assistant_ratio_bps / 100} dir="ltr" required />
                      </div>
                      <Input name="reason" placeholder="سبب التعديل" minLength={3} required />
                      <Button className="w-full" size="sm" disabled={saving === `level:${level.level}`}>حفظ المستوى</Button>
                    </form>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>

          <section>
            <div className="mb-3 flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-sky-700" />
              <h2 className="text-xl font-bold">عامل مهارة الخدمة</h2>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              {overview.skills.map((skill) => (
                <Card key={skill.skill_level}>
                  <CardContent className="pt-6">
                    <form className="grid gap-3" onSubmit={(event) => saveSkill(event, skill)}>
                      <div className="flex items-center justify-between">
                        <strong>{skillNames[skill.skill_level] ?? skill.skill_level}</strong>
                        <Badge variant="outline">× {(skill.factor_bps / 10_000).toFixed(2)}</Badge>
                      </div>
                      <Input name="factor" type="number" min="0.0001" step="0.01" defaultValue={skill.factor_bps / 10_000} dir="ltr" required />
                      <Input name="reason" placeholder="سبب التعديل" minLength={3} required />
                      <Button size="sm" variant="outline" disabled={saving === `skill:${skill.skill_level}`}>حفظ عامل المهارة</Button>
                    </form>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>

          <section>
            <div className="mb-3 flex items-center gap-2">
              <Coins className="h-5 w-5 text-emerald-700" />
              <div>
                <h2 className="text-xl font-bold">عمولة المنصة الثابتة لكل خدمة</h2>
                <p className="text-sm text-muted-foreground">مبلغ بالجنيه يُخصم مرة واحدة، وليس نسبة من الطلب.</p>
              </div>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              {overview.services.map((service) => (
                <Card key={service.id} className={!service.is_active ? 'opacity-60' : undefined}>
                  <CardContent className="pt-5">
                    <form className="grid gap-3 sm:grid-cols-[1fr_130px]" onSubmit={(event) => saveService(event, service)}>
                      <div>
                        <div className="flex items-center gap-2">
                          <strong>{service.name_ar}</strong>
                          {!service.is_active && <Badge variant="secondary">متوقفة</Badge>}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {service.platform_commission_cents == null ? 'لم تُضبط بعد' : `الحالي: ${formatEgp(service.platform_commission_cents)}`}
                        </p>
                        <Input className="mt-3" name="reason" placeholder="سبب التعديل" minLength={3} required />
                      </div>
                      <div className="space-y-2">
                        <Label>العمولة بالجنيه</Label>
                        <Input name="commission_egp" type="number" min="0" step="0.01" dir="ltr" defaultValue={service.platform_commission_cents == null ? '' : service.platform_commission_cents / 100} required />
                        <Button className="w-full" size="sm" disabled={saving === `service:${service.id}`}>حفظ</Button>
                      </div>
                    </form>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>

          <section>
            <div className="mb-3 flex items-center gap-2">
              <SlidersHorizontal className="h-5 w-5 text-sky-700" />
              <div>
                <h2 className="text-xl font-bold">استثناءات الخدمات</h2>
                <p className="text-sm text-muted-foreground">الاستثناء يستبدل القيمة العامة لهذه الخدمة فقط، ولا يتراكم فوقها.</p>
              </div>
            </div>
            <Card>
              <CardContent className="space-y-5 pt-6">
                <div>
                  <Label>الخدمة</Label>
                  <select
                    className="mt-2 h-10 w-full rounded-md border bg-background px-3 text-sm"
                    value={selectedServiceId}
                    onChange={(event) => setSelectedServiceId(event.target.value)}
                  >
                    <option value="">اختر خدمة لعرض سياستها</option>
                    {overview.services.map((service) => <option key={service.id} value={service.id}>{service.name_ar}</option>)}
                  </select>
                </div>
                {selectedServiceId && (
                  <div className="grid gap-4 xl:grid-cols-2">
                    <div className="space-y-3">
                      <h3 className="font-bold">نسبة المساعد حسب المستوى</h3>
                      {overview.levels.map((level) => {
                        const active = overview.service_level_overrides.find((item) => item.service_id === selectedServiceId && item.technician_level === level.level);
                        return (
                          <form key={level.level} onSubmit={(event) => saveLevelOverride(event, level)} className="rounded-xl border p-3">
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <strong className="text-sm">{level.display_name_ar}</strong>
                              <Badge variant={active ? 'default' : 'outline'}>{active ? 'استثناء نشط' : 'السياسة العامة'}</Badge>
                            </div>
                            <div className="grid gap-2 sm:grid-cols-[110px_1fr_auto]">
                              <Input name="assistant_ratio" type="number" min="0.01" max="100" step="0.01" defaultValue={(active?.assistant_ratio_bps ?? level.assistant_ratio_bps) / 100} dir="ltr" required />
                              <Input name="reason" placeholder="سبب الاستثناء" minLength={3} required />
                              <div className="flex gap-1">
                                <Button size="sm" disabled={saving === `service-level:${level.level}`}>حفظ</Button>
                                {active && <Button type="button" size="icon" variant="ghost" onClick={() => resetOverride('levels', level.level)} aria-label="إعادة للعامة"><RotateCcw className="h-4 w-4" /></Button>}
                              </div>
                            </div>
                          </form>
                        );
                      })}
                    </div>
                    <div className="space-y-3">
                      <h3 className="font-bold">عامل مهارة الخدمة</h3>
                      {overview.skills.map((skill) => {
                        const active = overview.service_skill_overrides.find((item) => item.service_id === selectedServiceId && item.skill_level === skill.skill_level);
                        return (
                          <form key={skill.skill_level} onSubmit={(event) => saveSkillOverride(event, skill)} className="rounded-xl border p-3">
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <strong className="text-sm">{skillNames[skill.skill_level] ?? skill.skill_level}</strong>
                              <Badge variant={active ? 'default' : 'outline'}>{active ? 'استثناء نشط' : 'السياسة العامة'}</Badge>
                            </div>
                            <div className="grid gap-2 sm:grid-cols-[110px_1fr_auto]">
                              <Input name="factor" type="number" min="0.0001" step="0.01" defaultValue={(active?.factor_bps ?? skill.factor_bps) / 10_000} dir="ltr" required />
                              <Input name="reason" placeholder="سبب الاستثناء" minLength={3} required />
                              <div className="flex gap-1">
                                <Button size="sm" disabled={saving === `service-skill:${skill.skill_level}`}>حفظ</Button>
                                {active && <Button type="button" size="icon" variant="ghost" onClick={() => resetOverride('skills', skill.skill_level)} aria-label="إعادة للعامة"><RotateCcw className="h-4 w-4" /></Button>}
                              </div>
                            </div>
                          </form>
                        );
                      })}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </section>

          <section>
            <div className="mb-3 flex items-center gap-2"><UserRound className="h-5 w-5 text-emerald-700" /><h2 className="text-xl font-bold">تعديلات الأشخاص</h2></div>
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
              <Card>
                <CardHeader><CardTitle className="text-base">إضافة تعديل نسبي مؤقت أو دائم</CardTitle></CardHeader>
                <CardContent>
                  <form className="space-y-3" onSubmit={createAdjustment}>
                    <select name="technician_id" className="h-10 w-full rounded-md border bg-background px-3 text-sm" required defaultValue="">
                      <option value="" disabled>اختر الفني أو المساعد</option>
                      {overview.technicians.map((person) => <option key={person.id} value={person.id}>{person.full_name} - {person.technician_kind === 'assistant' ? 'مساعد' : 'فني'}</option>)}
                    </select>
                    <select name="service_id" className="h-10 w-full rounded-md border bg-background px-3 text-sm" defaultValue="">
                      <option value="">عام لكل الخدمات</option>
                      {overview.services.map((service) => <option key={service.id} value={service.id}>{service.name_ar}</option>)}
                    </select>
                    <div className="grid grid-cols-2 gap-3">
                      <div><Label>التعديل %</Label><Input name="adjustment_percentage" type="number" min="-99.99" max="200" step="0.01" dir="ltr" required /></div>
                      <div><Label>ينتهي في (اختياري)</Label><Input name="effective_until" type="datetime-local" dir="ltr" /></div>
                    </div>
                    <Input name="reason" placeholder="سبب التعديل الإلزامي" minLength={3} required />
                    <Button className="w-full" disabled={saving === 'technician-adjustment'}>حفظ التعديل</Button>
                  </form>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-base">التعديلات النشطة</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {overview.technician_adjustments.length === 0 && <p className="text-sm text-muted-foreground">لا توجد تعديلات فردية نشطة.</p>}
                  {overview.technician_adjustments.map((item) => (
                    <div key={item.id} className="flex flex-col gap-1 rounded-xl border p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                      <div><strong>{item.full_name}</strong><p className="text-muted-foreground">{item.service_name_ar ?? 'كل الخدمات'} - {item.reason}</p></div>
                      <Badge variant={item.adjustment_bps >= 0 ? 'default' : 'destructive'}>{item.adjustment_bps >= 0 ? '+' : ''}{(item.adjustment_bps / 100).toFixed(2)}%</Badge>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </section>

          <section>
            <div className="mb-3 flex items-center gap-2"><Calculator className="h-5 w-5 text-sky-700" /><h2 className="text-xl font-bold">محاكي التوزيع</h2></div>
            <Card>
              <CardContent className="grid gap-6 pt-6 xl:grid-cols-2">
                <form className="space-y-3" onSubmit={runSimulation}>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>إجمالي الطلب</Label><Input name="total_egp" type="number" min="0" step="0.01" defaultValue="5000" dir="ltr" required /></div>
                    <div><Label>عمولة المنصة الثابتة</Label><Input name="commission_egp" type="number" min="0" step="0.01" defaultValue="500" dir="ltr" required /></div>
                  </div>
                  <div className="rounded-xl border p-3"><strong className="text-sm">الفني القائد</strong><div className="mt-2 grid grid-cols-2 gap-2"><select name="leader_level" className="h-10 rounded-md border px-2" defaultValue="professional">{overview.levels.map((level) => <option key={level.level} value={level.level}>{level.display_name_ar}</option>)}</select><select name="leader_skill" className="h-10 rounded-md border px-2" defaultValue="expert">{overview.skills.map((skill) => <option key={skill.skill_level} value={skill.skill_level}>{skillNames[skill.skill_level]}</option>)}</select></div></div>
                  <div className="rounded-xl border p-3"><strong className="text-sm">المساعد</strong><div className="mt-2 grid grid-cols-3 gap-2"><select name="assistant_level" className="h-10 rounded-md border px-2" defaultValue="verified">{overview.levels.map((level) => <option key={level.level} value={level.level}>{level.display_name_ar}</option>)}</select><select name="assistant_skill" className="h-10 rounded-md border px-2" defaultValue="standard">{overview.skills.map((skill) => <option key={skill.skill_level} value={skill.skill_level}>{skillNames[skill.skill_level]}</option>)}</select><Input name="assistant_adjustment" type="number" step="0.01" defaultValue="5" aria-label="تعديل المساعد بالمئة" dir="ltr" /></div></div>
                  <Button className="w-full" disabled={saving === 'simulation'}>احسب بنفس محرك التسوية</Button>
                </form>
                <div className="rounded-2xl bg-slate-950 p-5 text-white">
                  {!simulation ? <p className="text-sm text-slate-300">شغّل المحاكي لرؤية العمولة والوعاء والحصة الدقيقة لكل مشارك.</p> : (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-3"><div><p className="text-xs text-slate-400">المنصة</p><strong>{formatEgp(simulation.platformCommissionCents)}</strong></div><div><p className="text-xs text-slate-400">وعاء الطاقم</p><strong>{formatEgp(simulation.workerPoolCents)}</strong></div></div>
                      {simulation.participantShares.map((share) => <div key={share.technicianId} className="flex items-center justify-between border-t border-slate-700 pt-3"><div><strong>{share.earningRole === 'assistant' ? 'المساعد' : 'الفني القائد'}</strong><p className="text-xs text-slate-400">الوزن الفعلي: {share.effectiveWeightUnits}</p></div><strong>{formatEgp(share.shareCents)}</strong></div>)}
                      <p className="text-xs text-emerald-300">المجموع مطابق للإجمالي حتى آخر قرش.</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Sparkles className="h-4 w-4" />المقارنة الصامتة</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                <p className="text-sm text-muted-foreground">{overview.shadow.compared_orders} طلب تمت مقارنته - متوسط الفرق {formatEgp(Math.round(Number(overview.shadow.average_absolute_delta_cents)))}</p>
                {overview.shadow_orders.slice(0, 8).map((row) => <div key={row.order_id} className="grid grid-cols-3 gap-2 rounded-xl border p-3 text-sm"><strong>{row.order_number}</strong><span>V1: {formatEgp(row.legacy_platform_cents)}</span><span>V2: {formatEgp(row.v2_platform_cents)}</span></div>)}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><History className="h-4 w-4" />آخر تغييرات السياسة</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {overview.audit_history.length === 0 && <p className="text-sm text-muted-foreground">لا توجد تغييرات مسجلة بعد.</p>}
                {overview.audit_history.slice(0, 10).map((entry, index) => <div key={`${entry.created_at}:${index}`} className="rounded-xl border p-3 text-sm"><strong>{entry.action}</strong><p className="text-muted-foreground">{entry.actor_name ?? 'النظام'} - {new Date(entry.created_at).toLocaleString('ar-EG')}</p></div>)}
              </CardContent>
            </Card>
          </section>
        </div>
      )}
    </AppShell>
  );
}
