'use client';

import { Fragment, useEffect, useState, type FormEvent } from 'react';
import type { AdminServiceZoneResponseDto, CreateFeatureFlagBody, FeatureFlagResponseDto } from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { TableSkeleton } from '@/components/table-skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function FeatureFlagsPage() {
  const { isLoading, authedFetch } = useAuth();
  const [flags, setFlags] = useState<FeatureFlagResponseDto[] | null>(null);
  const [zones, setZones] = useState<AdminServiceZoneResponseDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  // مفتاح الفلاج اللي جوّه تعديل rollout_percentage دلوقتي (null = مفيش)
  const [editingRolloutKey, setEditingRolloutKey] = useState<string | null>(null);
  const [rolloutDraft, setRolloutDraft] = useState('');
  // مفتاح الفلاج اللي لوحة الاستهداف الصريح بتاعته مفتوحة دلوقتي (null = كله مقفول)
  const [targetingKey, setTargetingKey] = useState<string | null>(null);
  const [newUserIdDraft, setNewUserIdDraft] = useState('');
  const [newZoneIdDraft, setNewZoneIdDraft] = useState('');

  function load() {
    authedFetch<FeatureFlagResponseDto[]>('/admin/feature-flags')
      .then(setFlags)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل الفلاجز'));
  }

  useEffect(() => {
    if (isLoading) return;
    load();
    authedFetch<AdminServiceZoneResponseDto[]>('/admin/service-zones').then(setZones);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    const form = new FormData(e.target as HTMLFormElement);
    const body: CreateFeatureFlagBody = {
      key: form.get('key') as string,
      description: (form.get('description') as string) || undefined,
      is_enabled: false,
      rollout_percentage: 0,
    };
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch('/admin/feature-flags', { method: 'POST', body: JSON.stringify(body) });
      setShowNew(false);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  async function patchFlag(key: string, body: Record<string, unknown>) {
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/feature-flags/${key}`, { method: 'PATCH', body: JSON.stringify(body) });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  async function toggleEnabled(flag: FeatureFlagResponseDto) {
    await patchFlag(flag.key, { is_enabled: !flag.is_enabled });
  }

  async function saveRollout(key: string) {
    const value = Number(rolloutDraft);
    if (!Number.isInteger(value) || value < 0 || value > 100) {
      window.alert('نسبة التوزيع لازم تكون رقم صحيح من 0 لـ100');
      return;
    }
    await patchFlag(key, { rollout_percentage: value });
    setEditingRolloutKey(null);
  }

  function zoneName(zoneId: string) {
    return zones?.find((z) => z.id === zoneId)?.name_ar ?? zoneId;
  }

  async function addUserId(flag: FeatureFlagResponseDto) {
    const id = newUserIdDraft.trim();
    if (!UUID_RE.test(id)) {
      window.alert('لازم UUID صحيح لمستخدم');
      return;
    }
    if (flag.enabled_for_user_ids?.includes(id)) {
      setNewUserIdDraft('');
      return;
    }
    await patchFlag(flag.key, { enabled_for_user_ids: [...(flag.enabled_for_user_ids ?? []), id] });
    setNewUserIdDraft('');
  }

  async function removeUserId(flag: FeatureFlagResponseDto, id: string) {
    await patchFlag(flag.key, { enabled_for_user_ids: (flag.enabled_for_user_ids ?? []).filter((x) => x !== id) });
  }

  async function addZoneId(flag: FeatureFlagResponseDto) {
    if (!newZoneIdDraft) return;
    if (flag.enabled_for_zone_ids?.includes(newZoneIdDraft)) {
      setNewZoneIdDraft('');
      return;
    }
    await patchFlag(flag.key, { enabled_for_zone_ids: [...(flag.enabled_for_zone_ids ?? []), newZoneIdDraft] });
    setNewZoneIdDraft('');
  }

  async function removeZoneId(flag: FeatureFlagResponseDto, id: string) {
    await patchFlag(flag.key, { enabled_for_zone_ids: (flag.enabled_for_zone_ids ?? []).filter((x) => x !== id) });
  }

  async function handleDelete(flag: FeatureFlagResponseDto) {
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/feature-flags/${flag.key}`, { method: 'DELETE' });
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
        title="Feature Flags"
        actions={
          <Button size="sm" variant="outline" onClick={() => setShowNew((s) => !s)}>
            + فلاج جديد
          </Button>
        }
      />
      {error && <p className="mb-4 text-destructive">{error}</p>}

      {showNew && (
        <Card className="mb-6">
          <CardContent className="pt-6">
            <form onSubmit={handleCreate} className="flex flex-col gap-2">
              <Label htmlFor="flag_key">المفتاح</Label>
              <Input id="flag_key" name="key" placeholder="مثال: new_matching_algorithm" required dir="ltr" />
              <Label htmlFor="flag_description">الوصف (اختياري)</Label>
              <Input id="flag_description" name="description" placeholder="وصف مختصر للفلاج" />
              <Button type="submit" size="sm" disabled={isSaving} className="mt-2 w-fit">
                حفظ الفلاج
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">كل الفلاجز</CardTitle>
        </CardHeader>
        <CardContent>
          {!flags ? (
            <TableSkeleton columns={6} />
          ) : flags.length === 0 ? (
            <p className="text-sm text-muted-foreground">مفيش فلاجز لسه</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>المفتاح</TableHead>
                  <TableHead>الوصف</TableHead>
                  <TableHead>نسبة التوزيع</TableHead>
                  <TableHead>الاستهداف الصريح</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {flags.map((flag) => (
                  <Fragment key={flag.key}>
                  <TableRow>
                    <TableCell dir="ltr">{flag.key}</TableCell>
                    <TableCell className="max-w-xs whitespace-normal text-muted-foreground">
                      {flag.description ?? '—'}
                    </TableCell>
                    <TableCell>
                      {editingRolloutKey === flag.key ? (
                        <div className="flex items-center gap-2">
                          <Input
                            value={rolloutDraft}
                            onChange={(e) => setRolloutDraft(e.target.value)}
                            type="number"
                            min={0}
                            max={100}
                            className="w-20"
                            dir="ltr"
                          />
                          <Button size="sm" disabled={isSaving} onClick={() => saveRollout(flag.key)}>
                            حفظ
                          </Button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="cursor-pointer underline-offset-2 hover:underline"
                          onClick={() => {
                            setEditingRolloutKey(flag.key);
                            setRolloutDraft(String(flag.rollout_percentage));
                          }}
                        >
                          {flag.rollout_percentage}%
                        </button>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      <button
                        type="button"
                        className="cursor-pointer underline-offset-2 hover:underline"
                        onClick={() => setTargetingKey((k) => (k === flag.key ? null : flag.key))}
                      >
                        {(flag.enabled_for_user_ids?.length ?? 0) + (flag.enabled_for_zone_ids?.length ?? 0) > 0
                          ? `${flag.enabled_for_user_ids?.length ?? 0} مستخدم، ${flag.enabled_for_zone_ids?.length ?? 0} منطقة`
                          : 'إضافة استهداف'}
                      </button>
                    </TableCell>
                    <TableCell>
                      <button
                        type="button"
                        disabled={isSaving}
                        onClick={() => toggleEnabled(flag)}
                        className="cursor-pointer"
                      >
                        <Badge variant={flag.is_enabled ? 'secondary' : 'outline'}>
                          {flag.is_enabled ? 'مفعّل' : 'معطّل'}
                        </Badge>
                      </button>
                    </TableCell>
                    <TableCell>
                      <ConfirmDialog
                        trigger={
                          <Button size="sm" variant="ghost" disabled={isSaving}>
                            حذف
                          </Button>
                        }
                        title={`متأكد إنك عايز تحذف الفلاج "${flag.key}"؟`}
                        confirmLabel="حذف"
                        onConfirm={() => handleDelete(flag)}
                      />
                    </TableCell>
                  </TableRow>
                  {targetingKey === flag.key && (
                    <TableRow>
                      <TableCell colSpan={6} className="bg-muted/30">
                        <div className="flex flex-col gap-4 py-2 sm:flex-row sm:gap-8">
                          <div className="flex flex-1 flex-col gap-2">
                            <p className="text-sm font-medium">مستخدمين محدّدين (UUID)</p>
                            <div className="flex flex-wrap gap-2">
                              {(flag.enabled_for_user_ids ?? []).length === 0 && (
                                <p className="text-sm text-muted-foreground">مفيش مستخدمين محدّدين</p>
                              )}
                              {(flag.enabled_for_user_ids ?? []).map((id) => (
                                <Badge key={id} variant="outline" className="gap-2" dir="ltr">
                                  {id}
                                  <button
                                    type="button"
                                    disabled={isSaving}
                                    onClick={() => removeUserId(flag, id)}
                                    className="cursor-pointer text-muted-foreground hover:text-destructive"
                                  >
                                    ×
                                  </button>
                                </Badge>
                              ))}
                            </div>
                            <div className="flex gap-2">
                              <Input
                                value={newUserIdDraft}
                                onChange={(e) => setNewUserIdDraft(e.target.value)}
                                placeholder="user UUID"
                                dir="ltr"
                                className="max-w-xs"
                              />
                              <Button size="sm" disabled={isSaving} onClick={() => addUserId(flag)}>
                                إضافة
                              </Button>
                            </div>
                          </div>
                          <div className="flex flex-1 flex-col gap-2">
                            <p className="text-sm font-medium">مناطق خدمة محدّدة</p>
                            <div className="flex flex-wrap gap-2">
                              {(flag.enabled_for_zone_ids ?? []).length === 0 && (
                                <p className="text-sm text-muted-foreground">مفيش مناطق محدّدة</p>
                              )}
                              {(flag.enabled_for_zone_ids ?? []).map((id) => (
                                <Badge key={id} variant="outline" className="gap-2">
                                  {zoneName(id)}
                                  <button
                                    type="button"
                                    disabled={isSaving}
                                    onClick={() => removeZoneId(flag, id)}
                                    className="cursor-pointer text-muted-foreground hover:text-destructive"
                                  >
                                    ×
                                  </button>
                                </Badge>
                              ))}
                            </div>
                            <div className="flex gap-2">
                              <select
                                value={newZoneIdDraft}
                                onChange={(e) => setNewZoneIdDraft(e.target.value)}
                                className="border-input h-9 max-w-xs rounded-md border bg-transparent px-3 text-sm"
                              >
                                <option value="">اختار منطقة</option>
                                {zones?.map((z) => (
                                  <option key={z.id} value={z.id}>
                                    {z.name_ar}
                                  </option>
                                ))}
                              </select>
                              <Button size="sm" disabled={isSaving || !newZoneIdDraft} onClick={() => addZoneId(flag)}>
                                إضافة
                              </Button>
                            </div>
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <p className="mt-6 text-sm text-muted-foreground">
        "الحالة" هي مفتاح الإيقاف الفوري (kill switch) — بيغلب أي حاجة تانية. نسبة التوزيع بتحدد
        نسبة المستخدمين اللي هياخدوا الفلاج داخل مجموعة `is_enabled=true`. الاستهداف الصريح
        (مستخدمين/مناطق بعينها) بيتخطّى نسبة التوزيع — دوس على عمود "الاستهداف الصريح" لأي فلاج
        عشان تضيف/تشيل مستخدم بمعرّفه (UUID) أو منطقة خدمة من القايمة.
      </p>
    </AppShell>
  );
}
