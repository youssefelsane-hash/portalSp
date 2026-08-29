'use client';

import { AccountRow, AccountSection } from '@/components/account-section';
import { fetchMyComplaints } from '@/lib/account';

const COMPLAINT_STATUS_LABELS_AR: Record<string, string> = {
  open: 'مفتوحة',
  in_progress: 'بيتشاف',
  awaiting_customer: 'مستنية ردّك',
  resolved: 'اتحلّت',
  closed: 'مقفولة',
  rejected: 'مرفوضة',
};

export default function ComplaintsPage() {
  return (
    <AccountSection title="شكاويّي" load={fetchMyComplaints} emptyText="مفيش شكاوى — وده كويس">
      {(complaints) => (
        <div className="space-y-2">
          {complaints.map((c) => (
            <AccountRow
              key={c.id}
              href={c.order_id ? `/orders/${c.order_id}` : undefined}
              title={c.title}
              subtitle={`#${c.complaint_number} · ${new Date(c.created_at).toLocaleDateString('ar-EG', { dateStyle: 'long' })}`}
              trailing={<span className="text-muted">{COMPLAINT_STATUS_LABELS_AR[c.complaint_status] ?? c.complaint_status}</span>}
            />
          ))}
        </div>
      )}
    </AccountSection>
  );
}
