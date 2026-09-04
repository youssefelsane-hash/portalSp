
type AuthedFetch = <T>(path: string, options?: RequestInit) => Promise<T>;

/**
 * طبقة بيانات "حسابي" على الويب (docs/08 §101).
 *
 * السبب: تطبيق العميل عنده ١٣ بند في شاشة الحساب، والويب كان عنده **الاسم والتليفون والإيميل
 * وبس** — يعني عميل بيستخدم الويب مكانش يقدر يشوف محفظته ولا ضماناته ولا شكاويه ولا يوقف حجز
 * متكرر. كل الـendpoints دي موجودة وشغّالة في الباك-إند من زمان؛ الفجوة كانت في الواجهة بس.
 *
 * كل الأنواع هنا مطابقة لـDTOs الباك-إند بالحرف — مفيش أي تحويل أو إعادة تسمية، عشان أي تغيير
 * في العقد يبان كخطأ TypeScript فورًا بدل ما يفضل صامت لحد ما المستخدم يشوف خانة فاضية.
 */

// ── المحفظة ─────────────────────────────────────────────────────────────────
export interface WalletResponseDto {
  balance_cents: number;
  pending_balance_cents: number;
  reserved_balance_cents: number;
  total_earned_cents: number;
  total_withdrawn_cents: number;
  currency_code: string;
  is_frozen: boolean;
}

export interface WalletTransactionResponseDto {
  id: string;
  transaction_number: string;
  direction: 'credit' | 'debit';
  transaction_type: string;
  amount_cents: number;
  description_ar: string | null;
  created_at: string;
}

export const fetchWallet = (authedFetch: AuthedFetch) => authedFetch<WalletResponseDto>('/wallet');
export const fetchWalletTransactions = (authedFetch: AuthedFetch) =>
  authedFetch<WalletTransactionResponseDto[]>('/wallet/transactions');

/** تسميات عربية لأنواع حركات المحفظة — نفس المعاني المستخدمة في تطبيق العميل. */
export const WALLET_TX_LABELS_AR: Record<string, string> = {
  order_earning: 'أرباح طلب',
  commission_deduction: 'عمولة المنصة',
  topup: 'شحن رصيد',
  withdrawal: 'سحب',
  refund: 'استرداد',
  penalty: 'خصم',
  bonus: 'مكافأة',
  referral_reward: 'مكافأة ترشيح',
  installment_collection: 'تحصيل قسط',
  adjustment: 'تسوية يدوية',
};

// ── نقاط الولاء ─────────────────────────────────────────────────────────────
export interface LoyaltyBalanceDto {
  points_balance: number;
}

export interface LoyaltyTransactionDto {
  id: string;
  points_amount: number;
  direction: 'earn' | 'redeem' | string;
  source: string;
  balance_after: number;
  expires_at: string | null;
  created_at: string;
}

export const fetchLoyaltyBalance = (authedFetch: AuthedFetch) => authedFetch<LoyaltyBalanceDto>('/loyalty/balance');
export const fetchLoyaltyTransactions = (authedFetch: AuthedFetch) =>
  authedFetch<LoyaltyTransactionDto[]>('/loyalty/transactions');

// ── المفضّلة ────────────────────────────────────────────────────────────────
export interface FavoriteTechnicianDto {
  technician_id: string;
  full_name: string;
  avatar_url: string | null;
  average_rating: string;
  total_ratings_count: number;
  completed_orders_count: number;
  favorited_at: string;
}

// المسار الحقيقي `me/favorites/technicians` مش `/favorites` — اتأكد بنداء حي على الـAPI
// (كان بيرجّع 404 بينما كل الباقي بيرجّع 401، وده الفرق اللي كشف الغلط قبل ما يوصل للمستخدم).
export const fetchFavorites = (authedFetch: AuthedFetch) =>
  authedFetch<FavoriteTechnicianDto[]>('/me/favorites/technicians');
export const removeFavorite = (authedFetch: AuthedFetch, technicianId: string) =>
  authedFetch<null>(`/me/favorites/technicians/${technicianId}`, { method: 'DELETE' });

// ── الإشعارات ───────────────────────────────────────────────────────────────
export interface NotificationDto {
  id: string;
  notification_type: string;
  title_ar: string;
  body_ar: string;
  /** `null` = لسه مش مقروء. **مفيش حقل `is_read`** — اتأكد بنداء حي على الـAPI. */
  read_at: string | null;
  deep_link: string | null;
  reference_type: string | null;
  reference_id: string | null;
  created_at: string;
}

export const fetchNotifications = (authedFetch: AuthedFetch) =>
  apiFetchListVia<NotificationDto>(authedFetch, '/notifications');
export const markAllNotificationsRead = (authedFetch: AuthedFetch) =>
  authedFetch<null>('/notifications/read-all', { method: 'PATCH' });

// ── الضمانات ────────────────────────────────────────────────────────────────
export interface MyWarrantyDto {
  id: string;
  order_id: string | null;
  order_number: string | null;
  name_ar: string;
  coverage_days: number | null;
  coverage_months: number | null;
  starts_at: string;
  expires_at: string;
  claims_used: number;
  max_claims: number | null;
  claim_status: string | null;
}

export const fetchMyWarranties = (authedFetch: AuthedFetch) => apiFetchListVia<MyWarrantyDto>(authedFetch, '/me/warranties');

// ── الحجوزات المتكررة ───────────────────────────────────────────────────────
export interface RecurringOrderDto {
  id: string;
  service_id: string;
  service_name_ar?: string | null;
  frequency: string;
  next_run_at: string | null;
  is_active: boolean;
  created_at: string;
}

export const fetchRecurringOrders = (authedFetch: AuthedFetch) =>
  apiFetchListVia<RecurringOrderDto>(authedFetch, '/me/recurring-orders');
export const cancelRecurringOrder = (authedFetch: AuthedFetch, id: string) =>
  authedFetch<null>(`/me/recurring-orders/${id}`, { method: 'DELETE' });

// ── الترشيحات ───────────────────────────────────────────────────────────────
export interface MyReferralsDto {
  referral_code: string | null;
  completed_referrals_count: number;
  pending_referrals_count: number;
  required_referrals_per_reward: number;
  referrals_until_next_reward: number;
}

export const fetchMyReferrals = (authedFetch: AuthedFetch) => authedFetch<MyReferralsDto>('/me/referrals');

// ── المشاريع ────────────────────────────────────────────────────────────────
export interface MyProjectDto {
  id: string;
  project_number: string;
  name_ar: string;
  status: string;
  approved_quote_total_cents: number | null;
  budget_estimate_cents: number | null;
  created_at: string;
}

export const fetchMyProjects = (authedFetch: AuthedFetch) => apiFetchListVia<MyProjectDto>(authedFetch, '/me/projects');

// ── الشكاوى ─────────────────────────────────────────────────────────────────
export interface ComplaintDto {
  id: string;
  complaint_number: string;
  title: string;
  complaint_status: string;
  order_id: string | null;
  created_at: string;
}

export const fetchMyComplaints = (authedFetch: AuthedFetch) => apiFetchListVia<ComplaintDto>(authedFetch, '/complaints');

// ── وسائل الدفع المحفوظة ────────────────────────────────────────────────────
export interface PaymentMethodDto {
  id: string;
  provider: string;
  card_brand: string | null;
  masked_pan: string | null;
  is_default: boolean;
  created_at: string;
}

export const fetchPaymentMethods = (authedFetch: AuthedFetch) =>
  apiFetchListVia<PaymentMethodDto>(authedFetch, '/payment-methods');
export const deletePaymentMethod = (authedFetch: AuthedFetch, id: string) =>
  authedFetch<null>(`/payment-methods/${id}`, { method: 'DELETE' });

/**
 * الباك-إند بيلفّ كل رد في `{ success, data, meta }`، والقوايم أحيانًا بترجع `{ items: [] }`
 * جوّه `data`. `authedFetch` بترجّع `data` خام، فالمساعد ده بيطبّع الشكلين لمصفوفة واحدة —
 * نفس منطق `apiFetchList` بالظبط بس على المسار المُوثَّق.
 */
async function apiFetchListVia<T>(authedFetch: AuthedFetch, path: string): Promise<T[]> {
  const data = await authedFetch<unknown>(path);
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === 'object' && Array.isArray((data as { items?: unknown }).items)) {
    return (data as { items: T[] }).items;
  }
  return [];
}
