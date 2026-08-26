'use client';

import { useEffect, useState } from 'react';
import type {
  NotificationChannel,
  NotificationPriorityTier,
  NotificationTypeConfigResponseDto,
  UpdateNotificationTypeConfigBody,
} from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { TableSkeleton } from '@/components/table-skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { SelectNative } from '@/components/ui/select-native';

const CHANNEL_LABELS: Record<NotificationChannel, string> = {
  push: 'Push',
  sms: 'SMS',
  email: 'إيميل',
  in_app: 'داخل التطبيق',
  whatsapp: 'واتساب',
};

const ALL_CHANNELS: NotificationChannel[] = ['in_app', 'push', 'sms', 'whatsapp', 'email'];

const TIER_LABELS: Record<NotificationPriorityTier, string> = {
  critical_offer: 'عرض حرج (طوارئ)',
  action_required: 'يحتاج فعل',
  scheduled_job: 'مجدولة',
  informational: 'إعلامية بس',
};

const ALL_TIERS: NotificationPriorityTier[] = ['critical_offer', 'action_required', 'scheduled_job', 'informational'];

// إعداد الأولوية/الصوت/القناة/actionable لكل notification_type بلا كود جديد (ADR-0012) — كانت
// فجوة موثّقة صراحة (docs/08 §19 بند 22): AdminNotificationTypeConfigsController موجود بالكامل
// وشغال (GET/PATCH) من زمان، بس صفر شاشة أدمن تستهلكه — التعديل الوحيد كان عبر SQL يدوي مباشر.
// صفوف الجدول بتتزرع من migrations (0087/0097/إلخ) بس، مفيش إنشاء/حذف من هنا عمدًا — نفس نمط
// notification-routing بالحرف (تعديل بس، الصفوف مرتبطة بكود notification_type ثابت في الكود).
export default function NotificationTypeConfigsPage() {
  const { isLoading, authedFetch } = useAuth();
  const [configs, setConfigs] = useState<NotificationTypeConfigResponseDto[] | null>(null);
  const [editingType, setEditingType] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  function load() {
    authedFetch<NotificationTypeConfigResponseDto[]>('/admin/notification-type-configs')
      .then(setConfigs)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل إعدادات الإشعارات'));
  }

  useEffect(() => {
    if (isLoading) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  async function handleSave(config: NotificationTypeConfigResponseDto, form: HTMLFormElement) {
    const data = new FormData(form);
    const channels = data.getAll('channels') as NotificationChannel[];
    if (channels.length === 0) {
      setError('لازم تختار قناة واحدة على الأقل');
      return;
    }
    const actionLabelsRaw = (data.get('action_labels') as string).trim();
    let actionLabels: Record<string, string> | undefined;
    if (actionLabelsRaw) {
      try {
        actionLabels = JSON.parse(actionLabelsRaw) as Record<string, string>;
      } catch {
        setError('نصوص الأفعال (action_labels) لازم تكون JSON صالح — مثال: {"accept":"قبول","reject":"رفض"}');
        return;
      }
    }

    const body: UpdateNotificationTypeConfigBody = {
      priority_tier: data.get('priority_tier') as NotificationPriorityTier,
      default_channels: channels,
      sound_key: (data.get('sound_key') as string).trim() || undefined,
      is_actionable: data.get('is_actionable') === 'on',
      requires_acknowledgment: data.get('requires_acknowledgment') === 'on',
      action_labels: actionLabels,
    };

    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/notification-type-configs/${config.notification_type}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      setEditingType(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <AppShell>
      <PageHeader title="إعدادات أنواع الإشعارات" />
      <p className="mb-4 text-sm text-muted-foreground">
        الأولوية (وتأثيرها على الصوت/الإلحاح)، القنوات الافتراضية، وهل الإشعار actionable (بيحتاج قبول/رفض) —
        لكل نوع إشعار في النظام، بدون أي تعديل كود. الأنواع نفسها بتتحدد في الكود (`notification_type`)، هنا
        بس بنظبط سلوكها.
      </p>

      {error && <p className="mb-4 text-destructive">{error}</p>}

      {!configs && <TableSkeleton columns={6} />}
      {configs && configs.length === 0 && <EmptyState title="مفيش أنواع إشعارات مُعرَّفة لسه" />}

      {configs && configs.length > 0 && (
        <div className="space-y-3">
          {configs.map((config) => (
            <Card key={config.id}>
              <CardContent className="pt-6">
                {editingType !== config.notification_type ? (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div dir="ltr" className="text-start font-mono text-sm font-medium">
                        {config.notification_type}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant="outline">{TIER_LABELS[config.priority_tier]}</Badge>
                        {config.default_channels.map((channel) => (
                          <Badge key={channel} variant="secondary">
                            {CHANNEL_LABELS[channel]}
                          </Badge>
                        ))}
                        {config.is_actionable && <Badge variant="outline">actionable</Badge>}
                        {config.requires_acknowledgment && <Badge variant="outline">يحتاج تأكيد استلام</Badge>}
                        {config.sound_key && <span dir="ltr">صوت: {config.sound_key}</span>}
                      </div>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => setEditingType(config.notification_type)}>
                      تعديل
                    </Button>
                  </div>
                ) : (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void handleSave(config, e.target as HTMLFormElement);
                    }}
                    className="grid grid-cols-1 gap-3 sm:grid-cols-2"
                  >
                    <div className="sm:col-span-2">
                      <Label dir="ltr" className="font-mono text-xs">
                        {config.notification_type}
                      </Label>
                    </div>
                    <div>
                      <Label htmlFor={`priority_tier_${config.id}`}>الأولوية</Label>
                      <SelectNative
                        id={`priority_tier_${config.id}`}
                        name="priority_tier"
                        defaultValue={config.priority_tier}
                      >
                        {ALL_TIERS.map((tier) => (
                          <option key={tier} value={tier}>
                            {TIER_LABELS[tier]}
                          </option>
                        ))}
                      </SelectNative>
                    </div>
                    <div>
                      <Label htmlFor={`sound_key_${config.id}`}>مفتاح الصوت (اختياري)</Label>
                      <Input
                        id={`sound_key_${config.id}`}
                        name="sound_key"
                        dir="ltr"
                        maxLength={60}
                        defaultValue={config.sound_key ?? ''}
                        placeholder="مثال: critical_offer_alert"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <Label>القنوات الافتراضية</Label>
                      <div className="mt-1 flex flex-wrap gap-4">
                        {ALL_CHANNELS.map((channel) => (
                          <label key={channel} className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              name="channels"
                              value={channel}
                              defaultChecked={config.default_channels.includes(channel)}
                            />
                            {CHANNEL_LABELS[channel]}
                          </label>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id={`is_actionable_${config.id}`}
                        name="is_actionable"
                        defaultChecked={config.is_actionable}
                      />
                      <Label htmlFor={`is_actionable_${config.id}`}>actionable (بيحتاج قبول/رفض من المستخدم)</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id={`requires_ack_${config.id}`}
                        name="requires_acknowledgment"
                        defaultChecked={config.requires_acknowledgment}
                      />
                      <Label htmlFor={`requires_ack_${config.id}`}>يحتاج تأكيد استلام</Label>
                    </div>
                    <div className="sm:col-span-2">
                      <Label htmlFor={`action_labels_${config.id}`}>نصوص الأفعال (JSON، اختياري)</Label>
                      <textarea
                        id={`action_labels_${config.id}`}
                        name="action_labels"
                        dir="ltr"
                        rows={2}
                        defaultValue={config.action_labels ? JSON.stringify(config.action_labels) : ''}
                        placeholder='{"accept":"قبول","reject":"رفض"}'
                        className="w-full rounded-md border bg-background px-3 py-2 font-mono text-xs"
                      />
                    </div>
                    <div className="flex gap-2 sm:col-span-2">
                      <Button type="submit" size="sm" disabled={isSaving}>
                        حفظ
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => setEditingType(null)}>
                        إلغاء
                      </Button>
                    </div>
                  </form>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </AppShell>
  );
}
