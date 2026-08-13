'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { TechnicianProgressionRuleResponseDto, TechnicianProgressionStatusResponseDto } from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { formatEgp } from '@/lib/format';

const LEVEL_LABELS_AR: Record<string, string> = {
  new: 'جديد',
  verified: 'موثّق',
  professional: 'محترف',
  premium: 'بريميوم',
  team_leader: 'قائد فريق',
};

// إدارة محرك المسار الوظيفي/الترقي (docs/11 §4) — النظام يحسب ويعرض بس، الأدمن يقرر.
export default function TechnicianProgressionPage() {
  const { isLoading, authedFetch, authedFetchPaginated } = useAuth();
  const [rules, setRules] = useState<TechnicianProgressionRuleResponseDto[] | null>(null);
  const [statuses, setStatuses] = useState<TechnicianProgressionStatusResponseDto[] | null>(null);
  const [total, setTotal] = useState(0);
  const [eligibleOnly, setEligibleOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [ruleForm, setRuleForm] = useState<Record<string, string>>({});

  function loadRules() {
    authedFetch<TechnicianProgressionRuleResponseDto[]>('/admin/technician-progression/rules')
      .then(setRules)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل قواعد الترقية'));
  }

  function loadStatuses() {
    const params = new URLSearchParams({ per_page: '100' });
    if (eligibleOnly) params.set('is_eligible', 'true');
    authedFetchPaginated<TechnicianProgressionStatusResponseDto>(`/admin/technician-progression?${params.toString()}`)
      .then((res) => {
        setStatuses(res.items);
        setTotal(res.meta.total ?? res.items.length);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل حالات الفنيين'));
  }

  useEffect(() => {
    if (isLoading) return;
    loadRules();
    loadStatuses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, eligibleOnly]);

  async function handleCalculate() {
    setIsCalculating(true);
    setError(null);
    try {
      const res = await authedFetch<{ evaluated: number; autoPromoted: number }>('/admin/technician-progression/calculate', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      window.alert(`اتقيّم ${res.evaluated} فني — ${res.autoPromoted} اتترقّى آليًا`);
      loadStatuses();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ في الحساب');
    } finally {
      setIsCalculating(false);
    }
  }

  function startEditRule(rule: TechnicianProgressionRuleResponseDto) {
    setEditingRuleId(rule.id);
    setRuleForm({
      min_completed_orders: String(rule.min_completed_orders),
      min_platform_revenue_cents: String(rule.min_platform_revenue_cents),
      min_avg_rating: rule.min_avg_rating !== null ? String(rule.min_avg_rating) : '',
      max_cancellation_rate: rule.max_cancellation_rate !== null ? String(rule.max_cancellation_rate) : '',
      max_upheld_complaints: rule.max_upheld_complaints !== null ? String(rule.max_upheld_complaints) : '',
      min_days_active: String(rule.min_days_active),
      auto_promote: rule.auto_promote ? '1' : '',
      enabled: rule.enabled ? '1' : '',
    });
  }

  async function saveRule(id: string) {
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/technician-progression/rules/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          min_completed_orders: Number(ruleForm.min_completed_orders),
          min_platform_revenue_cents: Number(ruleForm.min_platform_revenue_cents),
          min_avg_rating: ruleForm.min_avg_rating === '' ? null : Number(ruleForm.min_avg_rating),
          max_cancellation_rate: ruleForm.max_cancellation_rate === '' ? null : Number(ruleForm.max_cancellation_rate),
          max_upheld_complaints: ruleForm.max_upheld_complaints === '' ? null : Number(ruleForm.max_upheld_complaints),
          min_days_active: Number(ruleForm.min_days_active),
          auto_promote: ruleForm.auto_promote === '1',
          enabled: ruleForm.enabled === '1',
        }),
      });
      setEditingRuleId(null);
      loadRules();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ في الحفظ');
    } finally {
      setIsSaving(false);
    }
  }

  async function runAction(action: () => Promise<unknown>) {
    setIsSaving(true);
    setError(null);
    try {
      await action();
      loadStatuses();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  function handleApprove(id: string) {
    runAction(() => authedFetch(`/admin/technician-progression/${id}/approve`, { method: 'PATCH', body: JSON.stringify({}) }));
  }

  function handleOverride(id: string) {
    const reason = window.prompt('سبب الترقية الاستثنائية (10 حروف على الأقل، إلزامي)؟');
    if (reason === null) return;
    if (reason.trim().length < 10) {
      window.alert('السبب قصير جداً');
      return;
    }
    runAction(() => authedFetch(`/admin/technician-progression/${id}/override`, { method: 'PATCH', body: JSON.stringify({ reason }) }));
  }

  function handleReject(id: string) {
    const reason = window.prompt('سبب رفض الترقية دلوقتي؟');
    if (reason === null) return;
    if (reason.trim().length < 5) {
      window.alert('السبب قصير جداً');
      return;
    }
    runAction(() => authedFetch(`/admin/technician-progression/${id}/reject`, { method: 'PATCH', body: JSON.stringify({ reason }) }));
  }

  return (
    <AppShell>
      <PageHeader
        title="المسار الوظيفي للفنيين"
        actions={
          <Button size="sm" disabled={isCalculating} onClick={handleCalculate}>
            {isCalculating ? 'جاري التقييم…' : 'احسب أهلية كل الفنيين'}
          </Button>
        }
      />

      {error && <p className="mb-4 text-destructive">{error}</p>}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">قواعد الترقية بين المستويات</CardTitle>
        </CardHeader>
        <CardContent>
          {!rules ? (
            <p className="text-sm text-muted-foreground">جاري التحميل…</p>
          ) : (
            <div className="space-y-3">
              {rules.map((rule) => (
                <div key={rule.id} className="rounded-md border p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-medium">
                      {LEVEL_LABELS_AR[rule.from_level] ?? rule.from_level} ← {LEVEL_LABELS_AR[rule.to_level] ?? rule.to_level}
                    </span>
                    <div className="flex items-center gap-2">
                      {rule.auto_promote && <Badge>ترقية آلية</Badge>}
                      {!rule.enabled && <Badge variant="outline">معطّلة</Badge>}
                      {editingRuleId === rule.id ? (
                        <Button size="sm" disabled={isSaving} onClick={() => saveRule(rule.id)}>
                          حفظ
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => startEditRule(rule)}>
                          تعديل
                        </Button>
                      )}
                    </div>
                  </div>
                  {editingRuleId === rule.id ? (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <div>
                        <Label>أقل طلبات مكتملة</Label>
                        <Input
                          type="number"
                          value={ruleForm.min_completed_orders}
                          onChange={(e) => setRuleForm({ ...ruleForm, min_completed_orders: e.target.value })}
                        />
                      </div>
                      <div>
                        <Label>أقل إيراد (قرش)</Label>
                        <Input
                          type="number"
                          value={ruleForm.min_platform_revenue_cents}
                          onChange={(e) => setRuleForm({ ...ruleForm, min_platform_revenue_cents: e.target.value })}
                        />
                      </div>
                      <div>
                        <Label>أقل متوسط تقييم</Label>
                        <Input
                          type="number"
                          step="0.1"
                          value={ruleForm.min_avg_rating}
                          onChange={(e) => setRuleForm({ ...ruleForm, min_avg_rating: e.target.value })}
                        />
                      </div>
                      <div>
                        <Label>أقصى معدل إلغاء %</Label>
                        <Input
                          type="number"
                          step="0.1"
                          value={ruleForm.max_cancellation_rate}
                          onChange={(e) => setRuleForm({ ...ruleForm, max_cancellation_rate: e.target.value })}
                        />
                      </div>
                      <div>
                        <Label>أقصى شكاوى مثبتة</Label>
                        <Input
                          type="number"
                          value={ruleForm.max_upheld_complaints}
                          onChange={(e) => setRuleForm({ ...ruleForm, max_upheld_complaints: e.target.value })}
                        />
                      </div>
                      <div>
                        <Label>أقل أيام نشاط</Label>
                        <Input
                          type="number"
                          value={ruleForm.min_days_active}
                          onChange={(e) => setRuleForm({ ...ruleForm, min_days_active: e.target.value })}
                        />
                      </div>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={ruleForm.auto_promote === '1'}
                          onChange={(e) => setRuleForm({ ...ruleForm, auto_promote: e.target.checked ? '1' : '' })}
                        />
                        ترقية آلية بلا موافقة أدمن
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={ruleForm.enabled === '1'}
                          onChange={(e) => setRuleForm({ ...ruleForm, enabled: e.target.checked ? '1' : '' })}
                        />
                        مفعّلة
                      </label>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {rule.min_completed_orders} طلب مكتمل، {formatEgp(rule.min_platform_revenue_cents)} إيراد
                      {rule.min_avg_rating !== null && `، تقييم ≥ ${rule.min_avg_rating}`}
                      {rule.max_cancellation_rate !== null && `، إلغاء ≤ ${rule.max_cancellation_rate}%`}
                      {rule.max_upheld_complaints !== null && `، شكاوى مثبتة ≤ ${rule.max_upheld_complaints}`}
                      {`، ${rule.min_days_active} يوم نشاط`}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">حالة الفنيين ({total})</CardTitle>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={eligibleOnly} onChange={(e) => setEligibleOnly(e.target.checked)} />
            المؤهّلين بس
          </label>
        </CardHeader>
        <CardContent>
          {!statuses ? (
            <p className="text-sm text-muted-foreground">جاري التحميل…</p>
          ) : statuses.length === 0 ? (
            <p className="text-sm text-muted-foreground">مفيش بيانات — دوس &quot;احسب أهلية كل الفنيين&quot;</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الفني</TableHead>
                  <TableHead>المستوى الحالي</TableHead>
                  <TableHead>المستوى الجاي</TableHead>
                  <TableHead>مؤهّل؟</TableHead>
                  <TableHead>مراجعة تخفيض</TableHead>
                  <TableHead>قرار الأدمن</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {statuses.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <Link href={`/technicians/${s.technician_id}`} className="underline-offset-2 hover:underline">
                        {s.technician_id.slice(0, 8)}…
                      </Link>
                    </TableCell>
                    <TableCell>{LEVEL_LABELS_AR[s.current_level] ?? s.current_level}</TableCell>
                    <TableCell>{s.next_level ? LEVEL_LABELS_AR[s.next_level] ?? s.next_level : '—'}</TableCell>
                    <TableCell>
                      {s.is_eligible ? (
                        <Badge>مؤهّل</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">{s.unmet_requirements.length} شرط ناقص</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {s.needs_demotion_review ? (
                        <Badge variant="destructive">{s.demotion_review_reason}</Badge>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {s.admin_decision ?? '—'}
                      {s.admin_decision_reason && <span className="block text-xs">{s.admin_decision_reason}</span>}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        {s.is_eligible && s.next_level && (
                          <Button size="sm" disabled={isSaving} onClick={() => handleApprove(s.id)}>
                            اعتماد الترقية
                          </Button>
                        )}
                        {!s.is_eligible && s.next_level && (
                          <Button size="sm" variant="outline" disabled={isSaving} onClick={() => handleOverride(s.id)}>
                            ترقية استثنائية
                          </Button>
                        )}
                        {s.is_eligible && (
                          <Button size="sm" variant="destructive" disabled={isSaving} onClick={() => handleReject(s.id)}>
                            رفض دلوقتي
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
