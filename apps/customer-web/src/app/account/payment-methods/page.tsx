'use client';

import { AccountRow, AccountSection } from '@/components/account-section';
import { deletePaymentMethod, fetchPaymentMethods } from '@/lib/account';
import { useAuth } from '@/lib/auth-context';

export default function PaymentMethodsPage() {
  const { authedFetch } = useAuth();
  return (
    <AccountSection
      title="وسائل الدفع المحفوظة"
      load={fetchPaymentMethods}
      emptyText="مفيش وسائل دفع محفوظة — تقدر تحفظ كارتك وإنت بتدفع"
    >
      {(methods, reload) => (
        <div className="space-y-2">
          {methods.map((m) => (
            <AccountRow
              key={m.id}
              title={
                <span dir="ltr">
                  {m.card_brand ?? m.provider} {m.masked_pan ?? ''}
                </span>
              }
              subtitle={m.is_default ? 'الافتراضية' : undefined}
              trailing={
                <button
                  type="button"
                  onClick={async () => {
                    if (!window.confirm('متأكد إنك عايز تشيل الكارت ده؟')) return;
                    await deletePaymentMethod(authedFetch, m.id);
                    reload();
                  }}
                  className="text-danger underline-offset-4 hover:underline"
                >
                  شيل
                </button>
              }
            />
          ))}
        </div>
      )}
    </AccountSection>
  );
}
