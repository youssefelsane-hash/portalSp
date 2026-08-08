'use client';

import { useEffect, useState, type FormEvent } from 'react';
import type { CreateFeatureFlagBody, FeatureFlagResponseDto } from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

export default function FeatureFlagsPage() {
  const { isLoading, authedFetch } = useAuth();
  const [flags, setFlags] = useState<FeatureFlagResponseDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  // مفتاح الفلاج اللي جوّه تعديل rollout_percentage دلوقتي (null = مفيش)
  const [editingRolloutKey, setEditingRolloutKey] = useState<string | null>(null);
  const [rolloutDraft, setRolloutDraft] = useState('');

  function load() {
    authedFetch<FeatureFlagResponseDto[]>('/admin/feature-flags')
      .then(setFlags)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل الفلاجز'));
  }

  useEffect(() => {
    if (isLoading) return;
    load();
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

  async function handleDelete(flag: FeatureFlagResponseDto) {
    if (!window.confirm(`متأكد إنك عايز تحذف الفلاج "${flag.key}"؟`)) return;
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
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Feature Flags</h1>
        <Button size="sm" variant="outline" onClick={() => setShowNew((s) => !s)}>
          + فلاج جديد
        </Button>
      </div>
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
            <p className="text-sm text-muted-foreground">جاري التحميل…</p>
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
                  <TableRow key={flag.key}>
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
                      {(flag.enabled_for_user_ids?.length ?? 0) + (flag.enabled_for_zone_ids?.length ?? 0) > 0
                        ? `${flag.enabled_for_user_ids?.length ?? 0} مستخدم، ${flag.enabled_for_zone_ids?.length ?? 0} منطقة`
                        : '—'}
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
                      <Button size="sm" variant="ghost" disabled={isSaving} onClick={() => handleDelete(flag)}>
                        حذف
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <p className="mt-6 text-sm text-muted-foreground">
        "الحالة" هي مفتاح الإيقاف الفوري (kill switch) — بيغلب أي حاجة تانية. نسبة التوزيع بتحدد
        نسبة المستخدمين اللي هياخدوا الفلاج داخل مجموعة `is_enabled=true`. الاستهداف الصريح
        (مستخدمين/مناطق بعينها) بيتخطّى نسبة التوزيع لكن لسه محتاج تعديل عبر الـ API مباشرة —
        إضافة/شيل مستخدم أو منطقة معيّنة من هنا لسه مش متاح، فجوة موثّقة.
      </p>
    </AppShell>
  );
}
