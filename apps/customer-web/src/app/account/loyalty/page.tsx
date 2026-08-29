'use client';

import { AccountRow, AccountSection } from '@/components/account-section';
import { fetchLoyaltyBalance, fetchLoyaltyTransactions } from '@/lib/account';

/** مصادر كسب/صرف النقاط بأسماء مفهومة بدل قيمة الـenum الخام. */
const LOYALTY_SOURCE_LABELS_AR: Record<string, string> = {
  order_completed: 'طلب مكتمل',
  referral: 'ترشيح صديق',
  manual_credit: 'إضافة من الدعم',
  redemption: 'استبدال نقاط',
  expiry: 'انتهاء صلاحية',
};

export default function LoyaltyPage() {
  return (
    <AccountSection
      title="نقاط الولاء"
      load={async (authedFetch) => ({
        balance: await fetchLoyaltyBalance(authedFetch),
        transactions: await fetchLoyaltyTransactions(authedFetch),
      })}
    >
      {({ balance, transactions }) => (
        <>
          <div className="mb-6 rounded-xl border border-border bg-surface p-5">
            <p className="text-sm text-muted">رصيد نقاطك</p>
            <p className="mt-1 text-3xl font-bold text-primary">{balance.points_balance} نقطة</p>
          </div>

          <h2 className="mb-3 font-bold">سجل النقاط</h2>
          {transactions.length === 0 ? (
            <div className="rounded-xl border border-border bg-surface p-8 text-center text-muted">
              لسه مجمعتش نقاط — كل طلب مكتمل بيزوّد رصيدك
            </div>
          ) : (
            <div className="space-y-2">
              {transactions.map((tx) => (
                <AccountRow
                  key={tx.id}
                  title={LOYALTY_SOURCE_LABELS_AR[tx.source] ?? tx.source}
                  subtitle={new Date(tx.created_at).toLocaleDateString('ar-EG', { dateStyle: 'long' })}
                  trailing={
                    <span className={tx.direction === 'earn' ? 'font-semibold text-success' : 'font-semibold text-danger'}>
                      {tx.direction === 'earn' ? '+' : '−'}
                      {Math.abs(tx.points_amount)}
                    </span>
                  }
                />
              ))}
            </div>
          )}
        </>
      )}
    </AccountSection>
  );
}
