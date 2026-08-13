'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { AdminCustomerResponseDto, AdminWalletDetailResponseDto, CustomerTier } from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { formatEgp } from '@/lib/format';

const TIER_LABELS: Record<CustomerTier, string> = {
  standard: 'عادي',
  silver: 'فضي',
  gold: 'ذهبي',
  vip: 'VIP',
};

export default function CustomerDetailPage() {
  const { userId } = useParams<{ userId: string }>();
  const { isLoading, authedFetch } = useAuth();
  const router = useRouter();

  const [detail, setDetail] = useState<AdminCustomerResponseDto | null>(null);
  const [wallet, setWallet] = useState<AdminWalletDetailResponseDto | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [blockReason, setBlockReason] = useState('');
  const [showBlockForm, setShowBlockForm] = useState(false);

  function load() {
    authedFetch<AdminCustomerResponseDto>(`/admin/customers/${userId}`)
      .then(setDetail)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل بيانات العميل'));
  }

  useEffect(() => {
    if (isLoading) return;
    load();
    authedFetch<AdminWalletDetailResponseDto>(`/admin/wallets/${userId}`)
      .then(setWallet)
      .catch((err) => setWalletError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل المحفظة'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, userId]);

  async function handleBlock(e: FormEvent) {
    e.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/customers/${userId}/block`, {
        method: 'POST',
        body: JSON.stringify({ reason: blockReason }),
      });
      setShowBlockForm(false);
      setBlockReason('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleUnblock() {
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/customers/${userId}/unblock`, { method: 'POST' });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  if (error && !detail) {
    return (
      <AppShell>
        <p className="text-destructive">{error}</p>
      </AppShell>
    );
  }

  if (!detail) {
    return (
      <AppShell>
        <p className="text-muted-foreground">جاري التحميل…</p>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <Button variant="ghost" size="sm" className="mb-4" onClick={() => router.push('/customers')}>
        رجوع للقايمة
      </Button>

      <div className="mb-6 flex items-center gap-3">
        <h1 className="text-xl font-semibold">{detail.full_name}</h1>
        {detail.is_blocked ? (
          <Badge variant="destructive">محظور</Badge>
        ) : (
          <Badge variant="secondary">نشط</Badge>
        )}
        {detail.is_high_risk && <Badge variant="outline">عالي المخاطر</Badge>}
      </div>

      {error && <p className="mb-4 text-destructive">{error}</p>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">البيانات</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <p dir="ltr" className="text-muted-foreground">{detail.phone_number}</p>
            <p>الفئة: {TIER_LABELS[detail.customer_tier]}</p>
            <p>طلبات: {detail.total_orders_count} إجمالي · {detail.completed_orders_count} مكتملة · {detail.cancelled_orders_count} ملغاة</p>
            <p>إجمالي الإنفاق: {formatEgp(detail.total_spent_cents)}</p>
            <p>رصيد نقاط الولاء: {detail.loyalty_points_balance}</p>
            <p>متوسط التقييم اللي بيدّيه: {detail.average_rating_given ?? '—'}</p>
            <p>أول طلب: {detail.first_order_at ? new Date(detail.first_order_at).toLocaleDateString('ar-EG-u-nu-latn') : '—'}</p>
            <p>آخر طلب: {detail.last_order_at ? new Date(detail.last_order_at).toLocaleDateString('ar-EG-u-nu-latn') : '—'}</p>
            <p dir="ltr" className="text-muted-foreground">كود الترشيح: {detail.referral_code ?? '—'}</p>
            {detail.referred_by_user_id && (
              <p className="text-xs text-muted-foreground">
                اترشّح بواسطة مستخدم آخر (
                <a href={`/customers/${detail.referred_by_user_id}`} className="underline">
                  عرض
                </a>
                )
              </p>
            )}
            {detail.is_blocked && detail.blocked_reason && (
              <p className="text-destructive">سبب الحظر: {detail.blocked_reason}</p>
            )}
          </CardContent>
          <CardFooter className="flex-col items-stretch gap-3">
            {detail.is_blocked ? (
              <Button type="button" variant="outline" disabled={isSaving} onClick={handleUnblock}>
                فك الحظر
              </Button>
            ) : (
              <Button
                type="button"
                variant="destructive"
                disabled={isSaving}
                onClick={() => setShowBlockForm((s) => !s)}
              >
                حظر العميل
              </Button>
            )}
          </CardFooter>
          {showBlockForm && (
            <form onSubmit={handleBlock} className="border-t px-6 py-4">
              <Label htmlFor="block_reason">سبب الحظر</Label>
              <Input
                id="block_reason"
                value={blockReason}
                onChange={(e) => setBlockReason(e.target.value)}
                minLength={3}
                required
                className="mt-2"
              />
              <Button type="submit" variant="destructive" size="sm" disabled={isSaving} className="mt-3">
                تأكيد الحظر
              </Button>
            </form>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">المحفظة</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {walletError && <p className="text-destructive">{walletError}</p>}
            {!wallet && !walletError && <p className="text-muted-foreground">جاري التحميل…</p>}
            {wallet && (
              <>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-semibold">{formatEgp(wallet.wallet.balance_cents)}</span>
                  {wallet.wallet.is_frozen && <Badge variant="destructive">مجمّدة</Badge>}
                </div>
                <p className="text-muted-foreground">
                  إجمالي مكتسب: {formatEgp(wallet.wallet.total_earned_cents)} · إجمالي مسحوب:{' '}
                  {formatEgp(wallet.wallet.total_withdrawn_cents)}
                </p>
                <div>
                  <p className="mb-2 font-medium">آخر الحركات</p>
                  {wallet.transactions.length === 0 && <p className="text-muted-foreground">مفيش حركات لسه</p>}
                  <ul className="flex flex-col gap-2">
                    {wallet.transactions.slice(0, 10).map((tx) => (
                      <li key={tx.id} className="flex items-center justify-between border-b pb-2 text-xs last:border-0">
                        <div>
                          <p>{tx.description_ar ?? tx.transaction_type}</p>
                          <p className="text-muted-foreground">
                            {new Date(tx.created_at).toLocaleString('ar-EG-u-nu-latn')}
                          </p>
                        </div>
                        <span className={tx.direction === 'credit' ? 'text-green-600' : 'text-destructive'}>
                          {tx.direction === 'credit' ? '+' : '-'}
                          {formatEgp(tx.amount_cents)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
