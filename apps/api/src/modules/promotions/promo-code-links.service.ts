import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { SettingsService } from '../settings/settings.service';
import { PromoCode } from './entities/promo-code.entity';
import { PromoCodeLinkAttribution } from './entities/promo-code-link-attribution.entity';
import { PromoCodeLinkHit, PromoLinkHitPlatform } from './entities/promo-code-link-hit.entity';
import { PromoCodeMarketingCommission } from './entities/promo-code-marketing-commission.entity';

const USER_AGENT_SCAN_LIMIT = 512;

export interface PromoCodeLinkStats {
  hits: number;
  signups: number;
  orders: number;
  completedOrders: number;
  grossRevenueCents: number;
  platformRevenueCents: number;
  accruedCommissionCents: number;
}

/**
 * الرابط العام لكود الخصم منفصل عن تطبيق الخصم نفسه عمدًا.
 *
 * الرابط يقيس الوصول ويأخذ العميل إلى رحلة الحجز مع الكود مملوءًا، لكن لا يطبق خصمًا من نفسه.
 * القرار المالي يظل في `PromoCodesService.validateAndApply()` داخل transaction إنشاء الطلب.
 */
@Injectable()
export class PromoCodeLinksService {
  private readonly logger = new Logger(PromoCodeLinksService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(PromoCode) private readonly promoCodes: Repository<PromoCode>,
    @InjectRepository(PromoCodeLinkHit) private readonly hits: Repository<PromoCodeLinkHit>,
    @InjectRepository(PromoCodeLinkAttribution) private readonly attributions: Repository<PromoCodeLinkAttribution>,
    @InjectRepository(PromoCodeMarketingCommission)
    private readonly commissions: Repository<PromoCodeMarketingCommission>,
    private readonly settings: SettingsService,
  ) {}

  async findActiveByCode(code: string): Promise<PromoCode | null> {
    const normalized = code?.trim().toUpperCase();
    if (!normalized) return null;
    return this.promoCodes.findOne({ where: { code: normalized, isActive: true, deletedAt: IsNull() } });
  }

  detectPlatform(userAgent: string | undefined): PromoLinkHitPlatform {
    const ua = (userAgent ?? '').slice(0, USER_AGENT_SCAN_LIMIT).toLowerCase();
    if (!ua) return 'other';
    if (ua.includes('android')) return 'android';
    if (/iphone|ipad|ipod/.test(ua)) return 'ios';
    if (/mozilla|chrome|safari|firefox|edg\//.test(ua)) return 'web';
    return 'other';
  }

  /** نفس الوجهة الذكية لمصادر التسويق؛ الروابط المطبوعة لا ترتبط بمتجر أو دومين ثابت. */
  async resolveDestination(platform: PromoLinkHitPlatform, code: string, shouldPrefillDiscount = true): Promise<string> {
    const [android, ios, landing] = await Promise.all([
      this.settings.getString('marketing.android_store_url', ''),
      this.settings.getString('marketing.ios_store_url', ''),
      this.settings.getString('marketing.web_landing_url', ''),
    ]);
    const fallback = landing.trim() || process.env.CUSTOMER_WEB_URL || process.env.WEB_APP_URL || '/';
    const storeUrl = platform === 'android' ? android.trim() : platform === 'ios' ? ios.trim() : '';
    const target = storeUrl || fallback;
    return code ? appendPromoLinkCode(target, code, shouldPrefillDiscount) : target;
  }

  /** فشل القياس لا يحق له إيقاف التحويل؛ العميل يصل دائمًا إلى الرحلة. */
  async recordHit(promoCodeId: string, platform: PromoLinkHitPlatform): Promise<void> {
    try {
      await this.hits.insert({ promoCodeId, platform });
    } catch (err) {
      this.logger.warn(`فشل تسجيل زيارة رابط كود خصم ${promoCodeId}: ${err instanceof Error ? err.message : err}`);
    }
  }

  /** أول رابط صالح يصل للمستخدم الجديد يكسب، بلا منع تسجيل ولا قيد على كود الحجز لاحقًا. */
  async attributeUser(userId: string, code: string | undefined): Promise<boolean> {
    if (!code?.trim()) return false;
    try {
      const promo = await this.findActiveByCode(code);
      if (!promo) return false;
      const result = await this.attributions
        .createQueryBuilder()
        .insert()
        .values({ userId, promoCodeId: promo.id })
        .orIgnore()
        .execute();
      return (result.identifiers?.[0]?.id ?? null) !== null;
    } catch (err) {
      this.logger.warn(`فشل إسناد مستخدم لرابط كود خصم ${code}: ${err instanceof Error ? err.message : err}`);
      return false;
    }
  }

  async linkStatsForPromoCodes(promoCodeIds: string[]): Promise<Map<string, PromoCodeLinkStats>> {
    if (promoCodeIds.length === 0) return new Map();
    const rows = await this.promoCodes.query<
      {
        promo_code_id: string;
        hits: string;
        signups: string;
        orders: string;
        completed_orders: string;
        gross_revenue_cents: string;
        platform_revenue_cents: string;
        accrued_commission_cents: string;
      }[]
    >(
      `WITH hit_stats AS (
         SELECT promo_code_id, COUNT(*)::int AS hits
           FROM promo_code_link_hits
          WHERE promo_code_id = ANY($1::uuid[])
          GROUP BY promo_code_id
       ), signup_stats AS (
         SELECT promo_code_id, COUNT(*)::int AS signups
           FROM promo_code_link_attributions
          WHERE promo_code_id = ANY($1::uuid[])
          GROUP BY promo_code_id
       ), order_stats AS (
         SELECT a.promo_code_id,
                COUNT(*)::int AS orders,
                COUNT(*) FILTER (WHERE o.order_status = 'completed')::int AS completed_orders,
                COALESCE(SUM(o.total_amount_cents) FILTER (WHERE o.order_status = 'completed'), 0)::bigint AS gross_revenue_cents,
                COALESCE(SUM(o.platform_commission_cents) FILTER (WHERE o.order_status = 'completed'), 0)::bigint AS platform_revenue_cents
           FROM orders o
           JOIN customer_profiles cp ON cp.id = o.customer_id
           JOIN promo_code_link_attributions a ON a.user_id = cp.user_id
          WHERE o.deleted_at IS NULL AND a.promo_code_id = ANY($1::uuid[])
          GROUP BY a.promo_code_id
       ), accrued_stats AS (
         SELECT promo_code_id, COALESCE(SUM(amount_cents), 0)::bigint AS accrued_commission_cents
           FROM promo_code_marketing_commissions
          WHERE status = 'accrued' AND promo_code_id = ANY($1::uuid[])
          GROUP BY promo_code_id
       )
       SELECT p.id AS promo_code_id, COALESCE(h.hits, 0) AS hits, COALESCE(s.signups, 0) AS signups,
              COALESCE(o.orders, 0) AS orders, COALESCE(o.completed_orders, 0) AS completed_orders,
              COALESCE(o.gross_revenue_cents, 0) AS gross_revenue_cents,
              COALESCE(o.platform_revenue_cents, 0) AS platform_revenue_cents,
              COALESCE(c.accrued_commission_cents, 0) AS accrued_commission_cents
         FROM promo_codes p
         LEFT JOIN hit_stats h ON h.promo_code_id = p.id
         LEFT JOIN signup_stats s ON s.promo_code_id = p.id
         LEFT JOIN order_stats o ON o.promo_code_id = p.id
         LEFT JOIN accrued_stats c ON c.promo_code_id = p.id
        WHERE p.id = ANY($1::uuid[])`,
      [promoCodeIds],
    );
    return new Map(
      rows.map((row) => [
        row.promo_code_id,
        {
          hits: Number(row.hits),
          signups: Number(row.signups),
          orders: Number(row.orders),
          completedOrders: Number(row.completed_orders),
          grossRevenueCents: Number(row.gross_revenue_cents),
          platformRevenueCents: Number(row.platform_revenue_cents),
          accruedCommissionCents: Number(row.accrued_commission_cents),
        },
      ]),
    );
  }

  /** أول طلب مكتمل فقط للعميل المنسوب، وبـUNIQUE(order_id) ضد تكرار أحداث الحالة. */
  async accrueCommissionForOrder(orderId: string): Promise<void> {
    const rows = await this.dataSource.query<{ promo_code_id: string; customer_user_id: string; amount_cents: number }[]>(
      `SELECT p.id AS promo_code_id, a.user_id AS customer_user_id, p.payout_per_completed_order_cents AS amount_cents
         FROM orders o
         JOIN customer_profiles cp ON cp.id = o.customer_id
         JOIN promo_code_link_attributions a ON a.user_id = cp.user_id
         JOIN promo_codes p ON p.id = a.promo_code_id AND p.deleted_at IS NULL
        WHERE o.id = $1 AND p.payout_per_completed_order_cents > 0
          AND NOT EXISTS (
            SELECT 1 FROM promo_code_marketing_commissions c
             WHERE c.customer_user_id = a.user_id AND c.status <> 'cancelled'
          )`,
      [orderId],
    );
    const row = rows[0];
    if (!row) return;
    await this.commissions
      .createQueryBuilder()
      .insert()
      .values({
        promoCodeId: row.promo_code_id,
        orderId,
        customerUserId: row.customer_user_id,
        amountCents: Number(row.amount_cents),
      })
      .orIgnore()
      .execute();
  }

  async cancelCommissionForOrder(orderId: string): Promise<void> {
    await this.commissions.update({ orderId, status: 'accrued' }, { status: 'cancelled' });
  }

  listCommissions(status?: string): Promise<PromoCodeMarketingCommission[]> {
    return this.commissions.find({
      where: status ? { status: status as PromoCodeMarketingCommission['status'] } : {},
      order: { accruedAt: 'DESC' },
      take: 500,
    });
  }

  async markCommissionsPaid(ids: string[], adminUserId: string, note?: string): Promise<number> {
    if (ids.length === 0) return 0;
    const result = await this.dataSource.query<{ id: string }[]>(
      `UPDATE promo_code_marketing_commissions
          SET status = 'paid', paid_at = now(), paid_by_user_id = $2, payment_note = $3, updated_at = now()
        WHERE id = ANY($1::uuid[]) AND status = 'accrued'
        RETURNING id`,
      [ids, adminUserId, note ?? null],
    );
    return result.length;
  }

  /** رابط قصير ثابت قابل للطباعة، والدومين فقط هو الذي يتبدل بين البيئات. */
  shareUrl(code: string): string {
    const base = process.env.PUBLIC_BASE_URL || process.env.API_PUBLIC_URL || process.env.CUSTOMER_WEB_URL || '';
    return `${base.replace(/\/+$/, '')}/p/${encodeURIComponent(code)}`;
  }
}

/** يضيف الكود كوسم رحلة؛ صفحة العميل تلتقطه وتملأه فقط بعد تحقق API عند الحجز. */
export function appendPromoLinkCode(target: string, code: string, shouldPrefillDiscount = true): string {
  const params = `p=${encodeURIComponent(code)}&pd=${shouldPrefillDiscount ? '1' : '0'}`;
  if (!target || target === '/') return `/?${params}`;
  const separator = target.includes('?') ? '&' : '?';
  return `${target}${separator}${params}`;
}
