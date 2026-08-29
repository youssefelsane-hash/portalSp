'use client';

import { AccountRow, AccountSection } from '@/components/account-section';
import { fetchWallet, fetchWalletTransactions, WALLET_TX_LABELS_AR } from '@/lib/account';
import { formatEgp } from '@/lib/orders';

export default function WalletPage() {
  return (
    <AccountSection
      title="محفظتي"
      load={async (authedFetch) => ({
        wallet: await fetchWallet(authedFetch),
        transactions: await fetchWalletTransactions(authedFetch),
      })}
    >
      {({ wallet, transactions }) => (
        <>
          <div className="mb-6 rounded-xl border border-border bg-surface p-5">
            <p className="text-sm text-muted">الرصيد المتاح</p>
            <p className="mt-1 text-3xl font-bold text-primary">{formatEgp(wallet.balance_cents)}</p>
            {/* محفظة متجمّدة = المستخدم مش هيقدر يدفع بيها؛ إخفاء الحقيقة دي بتخلّيه يكتشفها
                وقت الدفع بس، وده أسوأ توقيت ممكن. */}
            {wallet.is_frozen && (
              <p className="mt-2 rounded-lg bg-danger/10 p-2 text-sm text-danger">
                محفظتك متوقّفة مؤقتًا — كلّم الدعم لمعرفة السبب.
              </p>
            )}
            {/* الرصيد المعلّق والمحجوز بيظهروا بس لو ليهم قيمة فعلاً — صفر جنيه معلّق معلومة بلا فايدة. */}
            {(wallet.pending_balance_cents > 0 || wallet.reserved_balance_cents > 0) && (
              <div className="mt-3 flex gap-4 text-sm text-muted">
                {wallet.pending_balance_cents > 0 && <span>معلّق: {formatEgp(wallet.pending_balance_cents)}</span>}
                {wallet.reserved_balance_cents > 0 && <span>محجوز: {formatEgp(wallet.reserved_balance_cents)}</span>}
              </div>
            )}
          </div>

          <h2 className="mb-3 font-bold">الحركات</h2>
          {transactions.length === 0 ? (
            <div className="rounded-xl border border-border bg-surface p-8 text-center text-muted">
              مفيش أي حركات على محفظتك لسه
            </div>
          ) : (
            <div className="space-y-2">
              {transactions.map((tx) => (
                <AccountRow
                  key={tx.id}
                  title={tx.description_ar ?? WALLET_TX_LABELS_AR[tx.transaction_type] ?? tx.transaction_type}
                  subtitle={new Date(tx.created_at).toLocaleDateString('ar-EG', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                  trailing={
                    <span className={tx.direction === 'credit' ? 'font-semibold text-success' : 'font-semibold text-danger'}>
                      {tx.direction === 'credit' ? '+' : '−'}
                      {formatEgp(tx.amount_cents)}
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
