'use client';

import { AccountRow, AccountSection } from '@/components/account-section';
import { cancelRecurringOrder, fetchRecurringOrders } from '@/lib/account';
import { useAuth } from '@/lib/auth-context';

const FREQUENCY_LABELS_AR: Record<string, string> = {
  weekly: 'كل أسبوع',
  monthly: 'كل شهر',
  yearly: 'كل سنة',
};

export default function RecurringOrdersPage() {
  const { authedFetch } = useAuth();
  return (
    <AccountSection
      title="الحجوزات المتكررة"
      load={fetchRecurringOrders}
      emptyText="مفيش حجوزات متكررة — تقدر تفعّل التكرار وإنت بتحجز أي خدمة"
    >
      {(templates, reload) => (
        <div className="space-y-2">
          {templates.map((t) => (
            <AccountRow
              key={t.id}
              title={t.service_name_ar ?? 'خدمة متكررة'}
              subtitle={
                t.next_run_at
                  ? `${FREQUENCY_LABELS_AR[t.frequency] ?? t.frequency} · الجاي ${new Date(t.next_run_at).toLocaleDateString('ar-EG', { dateStyle: 'long' })}`
                  : (FREQUENCY_LABELS_AR[t.frequency] ?? t.frequency)
              }
              trailing={
                t.is_active ? (
                  <button
                    type="button"
                    onClick={async () => {
                      // إيقاف نهائي لخدمة بتتحجز تلقائيًا — تأكيد صريح قبل التنفيذ.
                      if (!window.confirm('متأكد إنك عايز توقف التكرار ده؟')) return;
                      await cancelRecurringOrder(authedFetch, t.id);
                      reload();
                    }}
                    className="text-danger underline-offset-4 hover:underline"
                  >
                    إيقاف
                  </button>
                ) : (
                  <span className="text-muted">موقوف</span>
                )
              }
            />
          ))}
        </div>
      )}
    </AccountSection>
  );
}
