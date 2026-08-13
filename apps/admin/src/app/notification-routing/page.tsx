'use client';

import { useEffect, useState, type FormEvent } from 'react';
import type {
  CreateRoutingRuleBody,
  NotificationChannel,
  RoleResponseDto,
  RoutingRuleResponseDto,
} from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { SelectNative } from '@/components/ui/select-native';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

const CHANNEL_LABELS: Record<NotificationChannel, string> = {
  push: 'Push',
  sms: 'SMS',
  email: 'إيميل',
  in_app: 'داخل التطبيق',
  whatsapp: 'واتساب',
};

const ALL_CHANNELS: NotificationChannel[] = ['in_app', 'push', 'sms', 'whatsapp', 'email'];

// الأحداث الحساسة المزروعة فعلاً بالمشروع (migrations 0030 و0036) — قايمة مساعدة بس،
// الحقل نفسه نص حر لأن أي حدث جديد ممكن يتضاف من غير migration للجدول ده.
const KNOWN_EVENT_TYPES = [
  'complaint.filed',
  'payout.requires_review',
  'payment.cash_collected',
  'payout.completed',
  'rating.low_rating_submitted',
];

export default function NotificationRoutingPage() {
  const { isLoading, authedFetch } = useAuth();
  const [rules, setRules] = useState<RoutingRuleResponseDto[] | null>(null);
  const [roles, setRoles] = useState<RoleResponseDto[] | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  function load() {
    authedFetch<RoutingRuleResponseDto[]>('/admin/notification-routing-rules')
      .then(setRules)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل قواعد التوجيه'));
    authedFetch<RoleResponseDto[]>('/admin/roles')
      .then(setRoles)
      .catch(() => setRoles([]));
  }

  useEffect(() => {
    if (isLoading) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    const form = new FormData(e.target as HTMLFormElement);
    const channels = form.getAll('channels') as NotificationChannel[];
    if (channels.length === 0) {
      setError('لازم تختار قناة واحدة على الأقل');
      return;
    }
    const body: CreateRoutingRuleBody = {
      event_type: (form.get('event_type') as string).trim(),
      role_name: form.get('role_name') as string,
      channels,
    };
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch('/admin/notification-routing-rules', { method: 'POST', body: JSON.stringify(body) });
      setShowNew(false);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  async function toggleActive(rule: RoutingRuleResponseDto) {
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/notification-routing-rules/${rule.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: !rule.is_active }),
      });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteRule(rule: RoutingRuleResponseDto) {
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/notification-routing-rules/${rule.id}`, { method: 'DELETE' });
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
        title="قواعد توجيه الإشعارات"
        actions={
          <Button size="sm" variant="outline" onClick={() => setShowNew((s) => !s)}>
            + قاعدة جديدة
          </Button>
        }
      />
      <p className="mb-4 text-sm text-muted-foreground">
        كل حدث داخلي محتاج فعل إداري (شكوى جديدة، صرف محتاج مراجعة، ...) بيوصل لكل أدمن عنده الدور المحدد هنا،
        عبر القنوات المختارة — بدون أي تعديل كود.
      </p>

      {error && <p className="mb-4 text-destructive">{error}</p>}

      {showNew && (
        <Card className="mb-6">
          <CardContent className="pt-6">
            <form onSubmit={handleCreate} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="event_type">نوع الحدث</Label>
                <Input
                  id="event_type"
                  name="event_type"
                  required
                  minLength={2}
                  maxLength={80}
                  dir="ltr"
                  list="known-event-types"
                  placeholder="مثال: complaint.filed"
                />
                <datalist id="known-event-types">
                  {KNOWN_EVENT_TYPES.map((event) => (
                    <option key={event} value={event} />
                  ))}
                </datalist>
              </div>
              <div>
                <Label htmlFor="role_name">الدور</Label>
                <SelectNative id="role_name" name="role_name" defaultValue="">
                  <option value="" disabled>
                    اختار دور
                  </option>
                  {(roles ?? []).map((role) => (
                    <option key={role.id} value={role.name}>
                      {role.displayName} ({role.name})
                    </option>
                  ))}
                </SelectNative>
              </div>
              <div className="sm:col-span-2">
                <Label>القنوات</Label>
                <div className="mt-1 flex flex-wrap gap-4">
                  {ALL_CHANNELS.map((channel) => (
                    <label key={channel} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="channels" value={channel} defaultChecked={channel === 'in_app'} />
                      {CHANNEL_LABELS[channel]}
                    </label>
                  ))}
                </div>
              </div>
              <Button type="submit" size="sm" disabled={isSaving} className="w-fit sm:col-span-2">
                حفظ القاعدة
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {!rules && <p className="text-muted-foreground">جاري التحميل…</p>}
      {rules && rules.length === 0 && <EmptyState title="مفيش قواعد توجيه لسه" />}

      {rules && rules.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>الحدث</TableHead>
              <TableHead>الدور</TableHead>
              <TableHead>القنوات</TableHead>
              <TableHead>الحالة</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rules.map((rule) => (
              <TableRow key={rule.id}>
                <TableCell dir="ltr" className="text-start font-mono text-xs">
                  {rule.event_type}
                </TableCell>
                <TableCell>{rule.role_name}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {rule.channels.map((channel) => (
                      <Badge key={channel} variant="outline">
                        {CHANNEL_LABELS[channel]}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell>
                  <button type="button" disabled={isSaving} onClick={() => toggleActive(rule)} className="cursor-pointer">
                    <Badge variant={rule.is_active ? 'secondary' : 'outline'}>
                      {rule.is_active ? 'مفعّلة' : 'معطّلة'}
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
                    title={`متأكد من حذف قاعدة "${rule.event_type} → ${rule.role_name}"؟`}
                    confirmLabel="حذف"
                    onConfirm={() => deleteRule(rule)}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </AppShell>
  );
}
