'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { BadgeDollarSign, CheckCircle2, ClipboardList, WalletCards } from 'lucide-react';
import type { AdminCustomerResponseDto, AdminWalletDetailResponseDto, CreditLoyaltyBody, CustomerTier } from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { useAdminLiveRefresh } from '@/lib/admin-realtime-context';
import { ApiError } from '@/lib/api-client';
import { AppShell, useAdminBack } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { ProfileSummary } from '@/components/profile-summary';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { WalletAdjustmentForm } from '@/components/wallet-adjustment-form';
import { formatEgp } from '@/lib/format';
import { ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS } from '@/lib/order-labels';

const TIER_LABELS: Record<CustomerTier, string> = {
  standard: 'عادي',
  silver: 'فضي',
  gold: 'ذهبي',
  vip: 'VIP',
};

// §35.15 — بروفايل عميل 360°: GET /admin/customers/:userId/360 (نفس نمط بروفايل الفني 360°،
// apps/admin/src/app/technicians/[id]/page.tsx). shape يدوي هنا بدل shared-types لنفس السبب
// (تجميعة قراءة بس خاصة بشاشة واحدة، مش عقد بين موديولات).
interface Customer360Order {
  order_id: string;
  order_number: string;
  order_status: string;
  scheduled_at: string | null;
  service_name_ar: string;
}
interface Customer360ComplaintRow {
  id: string;
  complaint_number: string;
  severity: string;
  status: string;
  created_at: string;
}
interface Customer360Complaints {
  open_count: number;
  total_count: number;
  recent: Customer360ComplaintRow[];
}
interface Customer360Address {
  id: string;
  label: string | null;
  street_name: string;
  building_number: string | null;
  city_id: string | null;
  area_id: string | null;
  is_default: boolean;
}
interface Customer360Response {
  addresses: Customer360Address[];
  current_and_upcoming_orders: Customer360Order[];
  complaints_filed: Customer360Complaints;
  complaints_against: Customer360Complaints;
  ratings_received: {
    average_rating: number | null;
    total_count: number;
    recent: {
      rating_id: string;
      order_id: string;
      order_number: string;
      overall_rating: number;
      comment: string | null;
      created_at: string;
    }[];
  };
}

// سجل الطلبات الكامل + الفلوس (docs/08 §73 بند 3): GET /admin/customers/:userId/orders (paginated).
interface CustomerOrderHistoryRow {
  order_id: string;
  order_number: string;
  order_status: string;
  service_name_ar: string;
  placed_at: string | null;
  total_amount_cents: number;
  payment_status: string;
  payment_method: string | null;
}

export default function CustomerDetailPage() {
  const { userId } = useParams<{ userId: string }>();
  const { isLoading, authedFetch, authedFetchPaginated } = useAuth();
  const router = useRouter();
  // رجوع حقيقي بيحافظ على حالة القايمة (docs/08 §63.ب6) بدل router.push اللي كان بيضيّعها.
  const goBack = useAdminBack('/customers');

  const [detail, setDetail] = useState<AdminCustomerResponseDto | null>(null);
  const [wallet, setWallet] = useState<AdminWalletDetailResponseDto | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);
  /** العميل لسه مالوش محفظة (مفيش حركة مالية) — حالة فاضية طبيعية مش خطأ. */
  const [walletMissing, setWalletMissing] = useState(false);
  const [profile360, setProfile360] = useState<Customer360Response | null>(null);
  const [profile360Error, setProfile360Error] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [blockReason, setBlockReason] = useState('');
  const [showBlockForm, setShowBlockForm] = useState(false);
  const [showLoyaltyForm, setShowLoyaltyForm] = useState(false);
  const [loyaltyPoints, setLoyaltyPoints] = useState('');
  const [isSavingLoyalty, setIsSavingLoyalty] = useState(false);
  // سجل الطلبات الكامل + الفلوس (docs/08 §73 بند 3) — بعكس current_and_upcoming_orders فوق
  // (ملخّص مصغّر، حالية/قادمة بس)، ده أي حالة، paginated.
  const [orderHistory, setOrderHistory] = useState<CustomerOrderHistoryRow[] | null>(null);
  const [orderHistoryTotal, setOrderHistoryTotal] = useState(0);
  const [orderHistoryPage, setOrderHistoryPage] = useState(1);
  const [orderHistoryError, setOrderHistoryError] = useState<string | null>(null);
  const orderHistoryPerPage = 20;

  function load() {
    authedFetch<AdminCustomerResponseDto>(`/admin/customers/${userId}`)
      .then(setDetail)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل بيانات العميل'));
  }

  function loadWallet() {
    authedFetch<AdminWalletDetailResponseDto>(`/admin/wallets/${userId}`)
      .then(setWallet)
      .catch((err) => {
        // 404 معناها «العميل ده لسه مالوش محفظة» مش عطل — المحافظ بتتعمل **كسول** عند أول
        // حركة مالية (`getOrCreateWallet`)، فعميل لسه مادفعش ولا كسب حاجة مالوش صف أصلاً.
        // عرضها كخطأ أحمر كان بيخلّي كل عميل جديد يبان كأن فيه حاجة مكسورة في حسابه.
        if (err instanceof ApiError && err.status === 404) {
          setWalletMissing(true);
          return;
        }
        setWalletError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل المحفظة');
      });
  }

  function load360() {
    authedFetch<Customer360Response>(`/admin/customers/${userId}/360`)
      .then(setProfile360)
      .catch((err) => setProfile360Error(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل النظرة التشغيلية'));
  }

  function loadOrderHistory(page: number) {
    authedFetchPaginated<CustomerOrderHistoryRow>(`/admin/customers/${userId}/orders?page=${page}&per_page=${orderHistoryPerPage}`)
      .then(({ items, meta }) => {
        setOrderHistory(items);
        setOrderHistoryTotal(meta.total ?? 0);
        setOrderHistoryPage(page);
      })
      .catch((err) => setOrderHistoryError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل سجل الطلبات'));
  }

  useEffect(() => {
    if (isLoading) return;
    load();
    loadWallet();
    load360();
    loadOrderHistory(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, userId]);
  // docs/08 §63.ب1 — تحديث حي: الباك-إند بيبثّ الأحداث دي أصلاً عبر AdminRealtimeGateway،
  // الصفحة دي كانت بتفوّتها فكانت محتاجة refresh يدوي.
  useAdminLiveRefresh(["orders", "payments"], () => load());

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

  const completionRate = detail.total_orders_count > 0
    ? Math.round((detail.completed_orders_count / detail.total_orders_count) * 100)
    : 0;

  return (
    <AppShell>
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
        description={
          <span>
            ملف العميل التشغيلي والمالي <span dir="ltr">{detail.phone_number}</span>
          </span>
        }
        actions={
          <Button variant="outline" onClick={goBack}>
            رجوع للقايمة
          </Button>
        }
      />

      {error && <p className="mb-4 text-destructive">{error}</p>}

      <ProfileSummary
        items={[
          {
            label: 'إجمالي الطلبات',
            value: detail.total_orders_count,
            hint: `${detail.completed_orders_count} مكتملة · ${detail.cancelled_orders_count} ملغاة`,
            icon: ClipboardList,
            tone: 'primary',
          },
          {
            label: 'نسبة الإكمال',
            value: `${completionRate}%`,
            hint: detail.total_orders_count ? 'من كل طلبات العميل' : 'لا توجد طلبات بعد',
            icon: CheckCircle2,
            tone: 'success',
          },
          {
            label: 'إجمالي الإنفاق',
            value: formatEgp(detail.total_spent_cents),
            hint: `الفئة: ${TIER_LABELS[detail.customer_tier]}`,
            icon: BadgeDollarSign,
            tone: 'warning',
          },
          {
            label: 'رصيد المحفظة',
            value: wallet ? formatEgp(wallet.wallet.balance_cents) : '…',
            hint: `${detail.loyalty_points_balance} نقطة ولاء`,
            icon: WalletCards,
            tone: wallet && wallet.wallet.balance_cents < 0 ? 'warning' : 'neutral',
          },
        ]}
      />

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
            {walletMissing && (
              <p className="text-muted-foreground">لسه مفيش محفظة — بتتفتح تلقائيًا مع أول حركة مالية.</p>
            )}
            {!wallet && !walletError && !walletMissing && <p className="text-muted-foreground">جاري التحميل…</p>}
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

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">نظرة تشغيلية 360°</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-5 text-sm">
            {profile360Error && <p className="text-destructive">{profile360Error}</p>}
            {!profile360 && !profile360Error && <p className="text-muted-foreground">جاري التحميل…</p>}
            {profile360 && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">
                    التقييم اللي بياخده: {profile360.ratings_received.average_rating ?? '—'} (
                    {profile360.ratings_received.total_count})
                  </Badge>
                </div>

                {/* docs/08 §68 — رأي الفنيين في العميل: للأدمن بس، العميل ما بيتبلّغش بيه خالص. */}
                <div>
                  <p className="mb-1 font-medium">تقييم الفنيين للعميل (طلب بطلب)</p>
                  <p className="mb-2 text-xs text-muted-foreground">
                    داخلي — العميل ما بيشوفش التقييم ده ولا بيوصله إشعار بيه.
                  </p>
                  {profile360.ratings_received.recent.length === 0 ? (
                    <p className="text-muted-foreground">لسه محدش قيّم العميل ده</p>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {profile360.ratings_received.recent.map((r) => (
                        <li key={r.rating_id} className="border-b pb-1 text-xs last:border-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link href={`/orders/${r.order_id}`} className="font-medium underline-offset-2 hover:underline">
                              {r.order_number}
                            </Link>
                            <Badge variant="secondary">{r.overall_rating} / 5</Badge>
                            <span className="text-muted-foreground">
                              {new Date(r.created_at).toLocaleDateString('ar-EG')}
                            </span>
                          </div>
                          {r.comment && <p className="mt-0.5 whitespace-normal text-muted-foreground">{r.comment}</p>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <p className="mb-2 font-medium">العناوين ({profile360.addresses.length})</p>
                  {profile360.addresses.length === 0 ? (
                    <p className="text-muted-foreground">مفيش عناوين مسجّلة</p>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {profile360.addresses.map((a) => (
                        <li key={a.id} className="flex items-center gap-2 border-b pb-1 text-xs last:border-0">
                          <span>
                            {a.label ? `${a.label} — ` : ''}
                            {a.street_name}
                            {a.building_number ? `، مبنى ${a.building_number}` : ''}
                          </span>
                          {a.is_default && <Badge variant="secondary">افتراضي</Badge>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <p className="mb-2 font-medium">طلبات حالية/قادمة ({profile360.current_and_upcoming_orders.length})</p>
                  {profile360.current_and_upcoming_orders.length === 0 ? (
                    <p className="text-muted-foreground">مفيش طلبات حالية</p>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {profile360.current_and_upcoming_orders.map((o) => (
                        <li key={o.order_id} className="flex items-center justify-between border-b pb-1 text-xs last:border-0">
                          <a href={`/orders/${o.order_id}`} className="underline">
                            {o.order_number} — {o.service_name_ar}
                          </a>
                          <span className="text-muted-foreground">{o.order_status}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <p className="mb-2 font-medium">
                    شكاوى رفعها العميل ({profile360.complaints_filed.open_count} مفتوحة من {profile360.complaints_filed.total_count})
                  </p>
                  {profile360.complaints_filed.recent.length === 0 ? (
                    <p className="text-muted-foreground">مفيش شكاوى</p>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {profile360.complaints_filed.recent.map((c) => (
                        <li key={c.id} className="flex items-center justify-between border-b pb-1 text-xs last:border-0">
                          <span>{c.complaint_number}</span>
                          <span className="text-muted-foreground">
                            {c.severity} · {c.status}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <p className="mb-2 font-medium">
                    شكاوى اتقالت على العميل ({profile360.complaints_against.open_count} مفتوحة من{' '}
                    {profile360.complaints_against.total_count})
                  </p>
                  {profile360.complaints_against.recent.length === 0 ? (
                    <p className="text-muted-foreground">مفيش شكاوى</p>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {profile360.complaints_against.recent.map((c) => (
                        <li key={c.id} className="flex items-center justify-between border-b pb-1 text-xs last:border-0">
                          <span>{c.complaint_number}</span>
                          <span className="text-muted-foreground">
                            {c.severity} · {c.status}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* سجل الطلبات الكامل + الفلوس (docs/08 §73 بند 3، بلاغ مالك صريح: "لو كتبت رقم تليفون،
            يظهرلي كل الطلبات اللي هو طلبها كلها، وكل طلب كان بقد إيه والفلوس دخلت إزاي") —
            بعكس "نظرة تشغيلية 360°" فوق (ملخّص مصغّر، حالية/قادمة بس)، ده أي حالة، paginated. */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">كل الطلبات ({orderHistoryTotal})</CardTitle>
          </CardHeader>
          <CardContent>
            {orderHistoryError && <p className="text-destructive">{orderHistoryError}</p>}
            {!orderHistory && !orderHistoryError && <p className="text-muted-foreground">جاري التحميل…</p>}
            {orderHistory && orderHistory.length === 0 && <p className="text-muted-foreground">مفيش طلبات لسه</p>}
            {orderHistory && orderHistory.length > 0 && (
              <div className="flex flex-col gap-2">
                {orderHistory.map((o) => (
                  <Link
                    key={o.order_id}
                    href={`/orders/${o.order_id}`}
                    className="flex flex-col gap-1 rounded-md border p-2 text-sm hover:border-primary sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <span className="font-medium">{o.order_number}</span>
                      <span className="text-muted-foreground"> — {o.service_name_ar}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{o.placed_at ? new Date(o.placed_at).toLocaleDateString('ar-EG-u-nu-latn') : '—'}</span>
                      <span>
                        {ORDER_STATUS_LABELS[o.order_status as keyof typeof ORDER_STATUS_LABELS] ?? o.order_status}
                      </span>
                      <span>{PAYMENT_STATUS_LABELS[o.payment_status] ?? o.payment_status}</span>
                      <span className="font-medium text-foreground">{formatEgp(o.total_amount_cents)}</span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
            {orderHistoryTotal > orderHistoryPerPage && (
              <div className="mt-3 flex items-center justify-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={orderHistoryPage <= 1}
                  onClick={() => loadOrderHistory(orderHistoryPage - 1)}
                >
                  السابق
                </Button>
                <span className="text-xs text-muted-foreground">
                  صفحة {orderHistoryPage} من {Math.ceil(orderHistoryTotal / orderHistoryPerPage)}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={orderHistoryPage >= Math.ceil(orderHistoryTotal / orderHistoryPerPage)}
                  onClick={() => loadOrderHistory(orderHistoryPage + 1)}
                >
                  التالي
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
