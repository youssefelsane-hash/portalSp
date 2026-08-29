'use client';

import { AccountSection } from '@/components/account-section';
import { fetchMyReferrals } from '@/lib/account';

export default function ReferralsPage() {
  return (
    <AccountSection title="رشّح صحابك" load={fetchMyReferrals}>
      {(referrals) => (
        <>
          <div className="rounded-xl border border-border bg-surface p-5 text-center">
            <p className="text-sm text-muted">كود الترشيح بتاعك</p>
            {referrals.referral_code ? (
              <p className="mt-2 text-3xl font-bold tracking-widest text-primary" dir="ltr">
                {referrals.referral_code}
              </p>
            ) : (
              <p className="mt-2 text-muted">هيتولّد لك كود بعد أول طلب مكتمل</p>
            )}
            {referrals.referral_code && (
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(referrals.referral_code!)}
                className="mt-3 text-sm text-primary underline-offset-4 hover:underline"
              >
                انسخ الكود
              </button>
            )}
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="text-sm text-muted">ترشيحات مكتملة</p>
              <p className="mt-1 text-2xl font-bold">{referrals.completed_referrals_count}</p>
            </div>
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="text-sm text-muted">في انتظار أول طلب</p>
              <p className="mt-1 text-2xl font-bold">{referrals.pending_referrals_count}</p>
            </div>
          </div>

          <p className="mt-4 rounded-xl border border-border bg-surface p-4 text-sm text-muted">
            فاضل <span className="font-bold text-foreground">{referrals.referrals_until_next_reward}</span> ترشيح كمان
            عشان تاخد المكافأة الجاية (كل {referrals.required_referrals_per_reward} ترشيح مكتمل = مكافأة).
          </p>
        </>
      )}
    </AccountSection>
  );
}
