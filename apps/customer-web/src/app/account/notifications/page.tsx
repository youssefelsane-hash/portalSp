'use client';

import { AccountRow, AccountSection } from '@/components/account-section';
import { fetchNotifications, markAllNotificationsRead } from '@/lib/account';
import { useAuth } from '@/lib/auth-context';

/**
 * الإشعار بيوصّل لمكانه الحقيقي — إشعار مش بيوديك لحاجة نصف إشعار.
 * `deep_link` جاي من الباك-إند وهو الأدق؛ الرجوع لـ`reference_*` بيغطي الإشعارات القديمة اللي
 * اتسجّلت قبل ما الحقل ده يتضاف.
 */
function notificationHref(notification: {
  deep_link: string | null;
  reference_type: string | null;
  reference_id: string | null;
}): string | undefined {
  if (notification.deep_link?.startsWith('/')) return notification.deep_link;
  if (notification.reference_type === 'order' && notification.reference_id) {
    return `/orders/${notification.reference_id}`;
  }
  return undefined;
}

export default function NotificationsPage() {
  const { authedFetch } = useAuth();
  return (
    <AccountSection title="الإشعارات" load={fetchNotifications} emptyText="مفيش إشعارات لسه">
      {(notifications, reload) => (
        <>
          {notifications.some((n) => n.read_at === null) && (
            <button
              type="button"
              onClick={async () => {
                await markAllNotificationsRead(authedFetch);
                reload();
              }}
              className="mb-3 text-sm text-primary underline-offset-4 hover:underline"
            >
              علّم الكل كمقروء
            </button>
          )}
          <div className="space-y-2">
            {notifications.map((n) => (
              <div key={n.id} className={n.read_at === null ? 'rounded-xl ring-1 ring-primary/40' : ''}>
                <AccountRow
                  href={notificationHref(n)}
                  title={n.title_ar}
                  subtitle={n.body_ar}
                  trailing={
                    <span className="text-muted">
                      {new Date(n.created_at).toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' })}
                    </span>
                  }
                />
              </div>
            ))}
          </div>
        </>
      )}
    </AccountSection>
  );
}
