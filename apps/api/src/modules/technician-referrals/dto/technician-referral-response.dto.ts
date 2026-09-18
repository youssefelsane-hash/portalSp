import { TechnicianReferralBonus } from '../entities/technician-referral-bonus.entity';
import { TechnicianReferralSummary } from '../technician-referrals.service';

export interface TechnicianReferralBonusResponseDto {
  id: string;
  technician_id: string;
  customer_user_id: string;
  order_id: string;
  bonus_amount_cents: number;
  status: string;
  rejection_reason: string | null;
  credited_at: string | null;
  revoked_at: string | null;
  revoked_reason: string | null;
  created_at: string;
}

export function toTechnicianReferralBonusResponseDto(bonus: TechnicianReferralBonus): TechnicianReferralBonusResponseDto {
  return {
    id: bonus.id,
    technician_id: bonus.technicianId,
    customer_user_id: bonus.customerUserId,
    order_id: bonus.orderId,
    bonus_amount_cents: bonus.bonusAmountCents,
    status: bonus.status,
    rejection_reason: bonus.rejectionReason,
    credited_at: bonus.creditedAt?.toISOString() ?? null,
    revoked_at: bonus.revokedAt?.toISOString() ?? null,
    revoked_reason: bonus.revokedReason,
    created_at: bonus.createdAt.toISOString(),
  };
}

export interface TechnicianReferralSummaryResponseDto {
  referral_token: string;
  /**
   * الرابط العام اللي الـQR بيشفّره (docs/08 §165) — نفس دور `share_url` في أكواد الخصم.
   *
   * الـQR كان بيشفّر التوكن الخام، فالعميل اللي بيصوّره بكاميرا الموبايل العادية بيشوف نص
   * زي `TECH-000004` ومايعرفش يعمل بيه إيه. الرابط بيحوّله للمتجر أو لصفحة الهبوط بالكود جاهز.
   */
  share_url: string;
  attributed_customers_count: number;
  qualifying_orders_count: number;
  total_credited_cents: number;
  total_revoked_cents: number;
  total_rejected_cents: number;
  recent_bonuses: TechnicianReferralBonusResponseDto[];
}

export function toTechnicianReferralSummaryResponseDto(summary: TechnicianReferralSummary): TechnicianReferralSummaryResponseDto {
  return {
    referral_token: summary.referralToken,
    share_url: technicianReferralShareUrl(summary.referralToken),
    attributed_customers_count: summary.attributedCustomersCount,
    qualifying_orders_count: summary.qualifyingOrdersCount,
    total_credited_cents: summary.totalCreditedCents,
    total_revoked_cents: summary.totalRevokedCents,
    total_rejected_cents: summary.totalRejectedCents,
    recent_bonuses: summary.recentBonuses.map(toTechnicianReferralBonusResponseDto),
  };
}

/**
 * رابط QR ترشيح الفني — **نفس بناء `PromoCodeLinksService.shareUrl()` بالحرف**: الدومين من
 * البيئة والمسار القصير ثابت، عشان الكود المطبوع/المعروض يفضل صالح لو الوجهة اتغيّرت.
 */
export function technicianReferralShareUrl(token: string): string {
  const base = process.env.PUBLIC_BASE_URL || process.env.API_PUBLIC_URL || process.env.CUSTOMER_WEB_URL || '';
  return `${base.replace(/\/+$/, '')}/t/${encodeURIComponent(token)}`;
}
