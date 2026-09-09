import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { SettingsService } from '../settings/settings.service';
import { PromoCode } from './entities/promo-code.entity';
import { PromoCodeLinkAttribution } from './entities/promo-code-link-attribution.entity';
import { PromoCodeLinkHit, PromoLinkHitPlatform } from './entities/promo-code-link-hit.entity';

const USER_AGENT_SCAN_LIMIT = 512;

export interface PromoCodeLinkStats {
  hits: number;
  signups: number;
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
    @InjectRepository(PromoCode) private readonly promoCodes: Repository<PromoCode>,
    @InjectRepository(PromoCodeLinkHit) private readonly hits: Repository<PromoCodeLinkHit>,
    @InjectRepository(PromoCodeLinkAttribution) private readonly attributions: Repository<PromoCodeLinkAttribution>,
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
  async resolveDestination(platform: PromoLinkHitPlatform, code: string): Promise<string> {
    const [android, ios, landing] = await Promise.all([
      this.settings.getString('marketing.android_store_url', ''),
      this.settings.getString('marketing.ios_store_url', ''),
      this.settings.getString('marketing.web_landing_url', ''),
    ]);
    const fallback = landing.trim() || process.env.CUSTOMER_WEB_URL || process.env.WEB_APP_URL || '/';
    const storeUrl = platform === 'android' ? android.trim() : platform === 'ios' ? ios.trim() : '';
    const target = storeUrl || fallback;
    return code ? appendPromoLinkCode(target, code) : target;
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
      { promo_code_id: string; hits: string; signups: string }[]
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
       )
       SELECT p.id AS promo_code_id, COALESCE(h.hits, 0) AS hits, COALESCE(s.signups, 0) AS signups
         FROM promo_codes p
         LEFT JOIN hit_stats h ON h.promo_code_id = p.id
         LEFT JOIN signup_stats s ON s.promo_code_id = p.id
        WHERE p.id = ANY($1::uuid[])`,
      [promoCodeIds],
    );
    return new Map(rows.map((row) => [row.promo_code_id, { hits: Number(row.hits), signups: Number(row.signups) }]));
  }

  /** رابط قصير ثابت قابل للطباعة، والدومين فقط هو الذي يتبدل بين البيئات. */
  shareUrl(code: string): string {
    const base = process.env.PUBLIC_BASE_URL || process.env.API_PUBLIC_URL || process.env.CUSTOMER_WEB_URL || '';
    return `${base.replace(/\/+$/, '')}/p/${encodeURIComponent(code)}`;
  }

}

/** يضيف الكود كوسم رحلة؛ صفحة العميل تلتقطه وتملأه فقط بعد تحقق API عند الحجز. */
export function appendPromoLinkCode(target: string, code: string): string {
  if (!target || target === '/') return `/?p=${encodeURIComponent(code)}`;
  const separator = target.includes('?') ? '&' : '?';
  return `${target}${separator}p=${encodeURIComponent(code)}`;
}
