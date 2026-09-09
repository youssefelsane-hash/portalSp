/**
 * عقد إسناد التسويق (ADR-0082، docs/08 §135) — الشكل اللي
 * `apps/api/src/modules/marketing` بيرجّعه و`apps/admin` بيقراه.
 */

export const MARKETING_CHANNELS = [
  'poster',
  'influencer',
  'facebook',
  'whatsapp',
  'doorman',
  'referral',
  'partner',
  'other',
] as const;
export type MarketingChannel = (typeof MARKETING_CHANNELS)[number];

export const MARKETING_CHANNEL_LABELS_AR: Record<MarketingChannel, string> = {
  poster: 'ملصقات',
  influencer: 'إنفلونسر',
  facebook: 'فيسبوك',
  whatsapp: 'واتساب',
  doorman: 'بوابين',
  referral: 'ترشيحات',
  partner: 'شركاء',
  other: 'غير ذلك',
};

export interface MarketingSourceDto {
  id: string;
  code: string;
  name_ar: string;
  channel: MarketingChannel;
  region_label: string | null;
  notes: string | null;
  is_active: boolean;
  payout_per_completed_order_cents: number;
  payout_contact_name: string | null;
  payout_contact_phone: string | null;
  /** الرابط الجاهز للطباعة تحت QR — بيتبني وقت القراءة مش متخزّن. */
  share_url: string;
  created_at: string;
}

/** الأرقام المشتركة بين صف المصدر وصف القناة. */
interface MarketingMetrics {
  /** **زيارات مش أشخاص** — مفيش أي معرّف للزائر بقرار خصوصية (ADR-0082 §4). */
  hits: number;
  signups: number;
  orders: number;
  completed_orders: number;
  gross_revenue_cents: number;
  platform_revenue_cents: number;
  spend_cents: number;
  /** `null` = مفيش مقام (مش صفر) — «CAC صفر» بيتقري كأن الاكتساب ببلاش. */
  cac_cents: number | null;
  average_order_cents: number | null;
}

export interface MarketingSourcePerformanceRow extends MarketingMetrics {
  source_id: string;
  code: string;
  name_ar: string;
  channel: MarketingChannel;
  region_label: string | null;
  is_active: boolean;
  accrued_commission_cents: number;
}

export interface MarketingChannelPerformanceRow extends MarketingMetrics {
  channel: MarketingChannel;
  sources: number;
}

export interface MarketingSourcePerformanceReport {
  from: string;
  to: string;
  sources: MarketingSourcePerformanceRow[];
}

export interface MarketingChannelPerformanceReport {
  from: string;
  to: string;
  channels: MarketingChannelPerformanceRow[];
}

export const MARKETING_COMMISSION_STATUS_LABELS_AR: Record<string, string> = {
  accrued: 'مستحق',
  paid: 'مدفوع',
  cancelled: 'ملغي',
};

export interface MarketingCommissionDto {
  id: string;
  sourceId: string;
  orderId: string;
  customerUserId: string;
  amountCents: number;
  status: string;
  accruedAt: string;
  paidAt: string | null;
}
