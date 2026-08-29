'use client';

import { AccountRow, AccountSection } from '@/components/account-section';
import { listAddresses } from '@/lib/addresses';

/** سطر عنوان مقروء من الحقول الموجودة — بيتخطّى الخانات الفاضية بدل ما يطلّع فواصل ورا بعض. */
function formatAddressLine(address: {
  street_name: string;
  building_number: string | null;
  floor_number: string | null;
  apartment_number: string | null;
  landmark: string | null;
}): string {
  return [
    address.street_name,
    address.building_number && `عمارة ${address.building_number}`,
    address.floor_number && `الدور ${address.floor_number}`,
    address.apartment_number && `شقة ${address.apartment_number}`,
    address.landmark,
  ]
    .filter(Boolean)
    .join(' · ');
}

export default function AddressesPage() {
  return (
    <AccountSection
      title="عناويني"
      load={listAddresses}
      emptyText="مفيش عناوين محفوظة — هتضيف عنوانك أول ما تحجز خدمة"
    >
      {(addresses) => (
        <div className="space-y-2">
          {addresses.map((a) => (
            <AccountRow
              key={a.id}
              title={a.label ?? 'عنوان'}
              subtitle={formatAddressLine(a)}
              trailing={
                <div className="flex flex-col items-end gap-1">
                  {a.is_default && <span className="text-primary">الافتراضي</span>}
                  {/* العنوان المرتبط بطلب شغال مينفعش يتغيّر — الفني رايح عليه دلوقتي. */}
                  {a.has_active_order && <span className="text-muted">عليه طلب شغال</span>}
                </div>
              }
            />
          ))}
        </div>
      )}
    </AccountSection>
  );
}
