'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { AdminCustomerResponseDto, AdminWalletDetailResponseDto, CreditLoyaltyBody, CustomerTier } from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { WalletAdjustmentForm } from '@/components/wallet-adjustment-form';
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
  const [showLoyaltyForm, setShowLoyaltyForm] = useState(false);
  const [loyaltyPoints, setLoyaltyPoints] = useState('');
  const [isSavingLoyalty, setIsSavingLoyalty] = useState(false);

  function load() {
    authedFetch<AdminCustomerResponseDto>(`/admin/customers/${userId}`)
      .then(setDetail)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل بيانات العميل'));
  }

  function loadWallet() {
    authedFetch<AdminWalletDetailResponseDto>(`/admin/wallets/${userId}`)
      .then(setWallet)
      .catch((err) => setWalletError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل المحفظة'));
  }

  useEffect(() => {
    if (isLoading) return;
    load();
    loadWallet();
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

  // §24 — كانت فجوة موثّقة صراحة: DELETE /admin/customers/:userId مش موجود أصلاً (نفس فجوة
  // الموظفين اللي كانت الأداة الوحيدة block، اتقفلت الاتنين مع بعض). حذف دائم، فالتوجيه للقايمة
  // بعد النجاح مباشرة.
  async function handleDelete() {
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/customers/${userId}`, { method: 'DELETE' });
      router.push('/customers');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
      setIsSaving(false);
    }
  }

  async function handleCreditLoyalty(e: FormEvent) {
    e.preventDefault();
    const points = Number(loyaltyPoints);
    if (!points || points <= 0) return;
    setIsSavingLoyalty(true);
    setError(null);
    try {
      const body: CreditLoyaltyBody = { points };
      await authedFetch(`/admin/customers/${userId}/loyalty/credit`, { method: 'POST', body: JSON.stringify(body) });
      setShowLoyaltyForm(false);
      setLoyaltyPoints('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSavingLoyalty(false);
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

      <PageHeader
        title={
          <>
            {detail.full_name}
            {detail.is_blocked ? (
              <Badge variant="destructive">محظور</Badge>
            ) : (
              <Badge variant="secondary">نشط</Badge>
            )}
            {detail.is_high_risk && <Badge variant="outline">عالي المخاطر</Badge>}
          </>
        }
      />

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
            <div className="flex items-center gap-2">
              <p>رصيد نقاط الولاء: {detail.loyalty_points_balance}</p>
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowLoyaltyForm((s) => !s)}>
                + إضافة نقاط
              </Button>
            </div>
            {showLoyaltyForm && (
              <form onSubmit={handleCreditLoyalty} className="flex items-end gap-2">
                <div>
                  <Label htmlFor="loyalty_points">عدد النقاط (تعويض/هدية)</Label>
                  <Input
                    id="loyalty_points"
                    type="number"
                    min={1}
                    dir="ltr"
                    value={loyaltyPoints}
                    onChange={(e) => setLoyaltyPoints(e.target.value)}
                    required
                  />
                </div>
                <Button type="submit" size="sm" disabled={isSavingLoyalty}>
                  إضافة
                </Button>
              </form>
            )}
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
            <ConfirmDialog
              trigger={
                <Button type="button" variant="destructive" disabled={isSaving}>
                  حذف الحساب
                </Button>
              }
              title="حذف حساب العميل نهائيًا"
              description="ده حذف دائم — الحساب مش هيقدر يسجّل دخول تاني، ومفيش استرجاع بعد كده."
              confirmLabel="حذف نهائي"
              onConfirm={handleDelete}
            />
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
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">المحفظة</CardTitle>
            <WalletAdjustmentForm userId={userId} onAdjusted={loadWallet} />
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {walletError && <p className="text-destructive">{walletError}</p>}
            {!wallet && !walletError && <p className="text-muted-foreground">جاري التحميل…</p>}
            {wallet && (
              <>
                <div className="flex items-center gap-2">
                  <span className={`text-lg font-semibold ${wallet.wallet.balance_cents < 0 ? 'text-destructive' : ''}`}>
                    {formatEgp(wallet.wallet.balance_cents)}
                  </span>
                  {wallet.wallet.is_frozen && <Badge variant="destructive">مجمّدة</Badge>}
                  {wallet.wallet.balance_cents < 0 && <Badge variant="destructive">مديون للمنصة</Badge>}
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
