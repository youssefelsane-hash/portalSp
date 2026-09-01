'use client';

import { AccountRow, AccountSection } from '@/components/account-section';
import { fetchMyWarranties } from '@/lib/account';

export default function WarrantiesPage() {
  return (
    <AccountSection title="ضماناتي" load={fetchMyWarranties} emptyText="مفيش ضمانات سارية دلوقتي">
      {(warranties) => (
        <div className="space-y-2">
          {warranties.map((w) => {
            const expired = new Date(w.expires_at).getTime() < Date.now();
            return (
              <AccountRow
                key={w.id}
                href={w.order_id ? `/orders/${w.order_id}` : undefined}
                title={w.name_ar}
                subtitle={[
                  w.order_number && `طلب #${w.order_number}`,
                  `ينتهي ${new Date(w.expires_at).toLocaleDateString('ar-EG', { dateStyle: 'long' })}`,
                  // المدة بتتخزّن بالشهور للخطط المدفوعة وبالأيام لضمان الطلب نفسه — بنعرض
                  // الموجود منهم بس بدل ما نحوّل ونطلّع رقم مضلّل.
                  w.coverage_months ? `${w.coverage_months} شهر` : w.coverage_days ? `${w.coverage_days} يوم` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                trailing={
                  <span className={expired ? 'text-muted' : 'font-medium text-success'}>{expired ? 'منتهي' : 'ساري'}</span>
                }
              />
            );
          })}
        </div>
      )}
    </AccountSection>
  );
}
