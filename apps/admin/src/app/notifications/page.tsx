'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, CheckCheck, ChevronLeft, CircleAlert, CreditCard, Headset, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

interface AdminNotification {
  id: string;
  notification_type: string;
  title_ar: string;
  body_ar: string;
  deep_link: string | null;
  read_at: string | null;
  created_at: string;
}

const TYPE_META: Record<string, { label: string; icon: typeof Bell }> = {
  payment_instapay_transfer_reported: { label: 'مراجعة مالية', icon: CreditCard },
  payout_requires_review: { label: 'مراجعة مالية', icon: CreditCard },
  support_ticket_created: { label: 'دعم العملاء', icon: Headset },
  complaint_filed: { label: 'شكوى', icon: CircleAlert },
  warranty_claim_opened: { label: 'ضمان', icon: ShieldCheck },
};

function displayDate(value: string): string {
  return new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function adminPath(deepLink: string | null): string {
  return deepLink?.replace(/^\/admin/, '') || '/';
}

export default function NotificationsPage() {
  const { authedFetch, authedFetchPaginated, isLoading } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<AdminNotification[] | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const query = showUnreadOnly ? '?per_page=50&unread_only=true' : '?per_page=50';
      const [list, count] = await Promise.all([
        authedFetchPaginated<AdminNotification>(`/notifications${query}`),
        authedFetch<{ unread_count: number }>('/notifications/unread-count'),
      ]);
      setItems(Array.isArray(list.items) ? list.items : []);
      setUnreadCount(count.unread_count ?? 0);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل الإشعارات');
      setItems([]);
    }
  }, [authedFetch, authedFetchPaginated, showUnreadOnly]);

  useEffect(() => {
    if (isLoading) return;
    void load();
  }, [isLoading, load]);

  async function openNotification(notification: AdminNotification) {
    if (!notification.read_at) {
      try {
        await authedFetch(`/notifications/${notification.id}/read`, { method: 'PATCH' });
        setItems((previous) => previous?.map((item) => (
          item.id === notification.id ? { ...item, read_at: new Date().toISOString() } : item
        )) ?? null);
        setUnreadCount((previous) => Math.max(0, previous - 1));
      } catch {
        // الوصول لمكان العمل أهم من نجاح تحديث حالة القراءة.
      }
    }
    router.push(adminPath(notification.deep_link));
  }

  async function markAllRead() {
    setIsSaving(true);
    try {
      await authedFetch('/notifications/read-all', { method: 'PATCH' });
      setItems((previous) => previous?.map((item) => ({ ...item, read_at: item.read_at ?? new Date().toISOString() })) ?? null);
      setUnreadCount(0);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <AppShell>
      <PageHeader
        title="مركز الإشعارات"
        description="تنبيهات العمل التي تحتاج انتباهك: تحويلات InstaPay، التذاكر، الضمان، الشكاوى، وباقي الأحداث الموجهة لدورك. اضغط أي تنبيه للوصول مباشرة لمكان المراجعة."
        actions={
          unreadCount > 0 ? (
            <Button variant="outline" size="sm" disabled={isSaving} onClick={() => void markAllRead()}>
              <CheckCheck className="size-4" />
              علّم الكل كمقروء
            </Button>
          ) : null
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Button size="sm" variant={!showUnreadOnly ? 'default' : 'outline'} onClick={() => setShowUnreadOnly(false)}>
          الكل
        </Button>
        <Button size="sm" variant={showUnreadOnly ? 'default' : 'outline'} onClick={() => setShowUnreadOnly(true)}>
          غير المقروءة{unreadCount > 0 ? ` (${unreadCount})` : ''}
        </Button>
      </div>

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}
      {items === null ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">جارٍ تحميل الإشعارات...</CardContent></Card>
      ) : items.length === 0 ? (
        <EmptyState title={showUnreadOnly ? 'مفيش إشعارات غير مقروءة' : 'مفيش إشعارات لسه'} />
      ) : (
        <div className="space-y-3">
          {items.map((notification) => {
            const meta = TYPE_META[notification.notification_type] ?? { label: 'تنبيه تشغيلي', icon: Bell };
            const Icon = meta.icon;
            return (
              <button
                key={notification.id}
                type="button"
                onClick={() => void openNotification(notification)}
                className={`group w-full rounded-2xl border p-4 text-start transition hover:border-primary/45 hover:bg-primary/3 ${
                  notification.read_at ? 'border-border bg-card/70' : 'border-primary/30 bg-primary/5 shadow-sm'
                }`}
              >
                <div className="flex gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon className="size-5" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="mb-1 flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold">{notification.title_ar}</span>
                      <span className="text-xs text-muted-foreground">{displayDate(notification.created_at)}</span>
                    </span>
                    <span className="block text-sm leading-6 text-muted-foreground">{notification.body_ar}</span>
                    <span className="mt-2 flex items-center gap-1 text-xs font-medium text-primary">
                      {meta.label}<ChevronLeft className="size-3.5" />
                    </span>
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
