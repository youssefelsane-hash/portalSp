import { Injectable, Logger } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { CatalogService } from '../catalog/catalog.service';
import { Order } from '../orders/entities/order.entity';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { SettingsService } from '../settings/settings.service';
import { CommissionBaseService } from './commission-base.service';

/** الفرق بيتضاف للطلب كسطر "فني مميّز" (طلب المالك)، ولا الشركة بتتحمّله. */
export const AUTO_MATCH_LEVEL_PREMIUM_SETTING = 'pricing.auto_match_level_premium';
const CHARGE = 'charge';

@Injectable()
export class LevelPremiumService {
  private readonly logger = new Logger(LevelPremiumService.name);

  constructor(
    private readonly catalogService: CatalogService,
    private readonly settingsService: SettingsService,
    private readonly commissionBaseService: CommissionBaseService,
  ) {}

  /**
   * بيطبّق فرق سعر مستوى الفني بعد ما المطابقة **التلقائية** تعيّن فني (docs/08 §60.3).
   *
   * ليه ده موجود أصلاً: `OrdersService.create()` بيسعّر بمضاعف مستوى = 1 لما العميل يسيب
   * المطابقة تختار (الفني مش معروف بعد). فلو المطابقة عيّنت فني مستواه أعلى، مستواه ما كانش
   * بيأثر في السعر خالص — عكس الاختيار اليدوي بالظبط. المالك وصف ده حرفيًا وطلب إن الفرق يبان
   * كسطر مستقل مكتوب جنبه "premium".
   *
   * بيتخطّى بالكامل (بيرجّع 0) لو:
   * - الفني كان معروف وقت الحجز (`requestedTechnicianId`) — الفرق داخل السعر أصلاً، وإضافته
   *   تاني يبقى تحصيل مزدوج.
   * - مستوى الفني مالوش مضاعف (= 1).
   * - السياسة `absorb` — الشركة بتتحمّل الفرق والسعر ما يتغيّرش.
   *
   * الفرق بيدخل وعاء العمولة لو السياسة سامحة (`include_level_premium`، افتراضيًا `true`) —
   * قرار المالك الصريح إن مستوى الفني بيزوّد فلوس **الفني**، مش الشركة.
   */
  async applyOnAutoAssignment(
    manager: EntityManager,
    order: Order,
    technician: Pick<TechnicianProfile, 'currentLevel' | 'pricingTier'>,
  ): Promise<number> {
    if (order.requestedTechnicianId) return 0;
    if (order.estimatedPriceCents === null || order.estimatedPriceCents <= 0) return 0;
    // حارس ضد التحصيل المزدوج: الطلب ممكن يتعيّن أكتر من مرة (الفني الأول لغى وأعيد التوزيع،
    // أو الأدمن أعاد التعيين). من غير الحارس ده كل تعيين جديد كان هيضيف فرق تاني فوق القديم.
    // الفرق الأول بيفضل هو الساري — العميل شاف السعر ده واتعامل عليه.
    if (order.levelPremiumCents > 0) return 0;

    const policy = await this.settingsService.getString(AUTO_MATCH_LEVEL_PREMIUM_SETTING, CHARGE);
    if (policy !== CHARGE) return 0;

    const multiplier = await this.catalogService.resolveLevelPriceMultiplier(
      order.serviceId,
      technician.currentLevel,
      technician.pricingTier ?? undefined,
    );
    if (!(multiplier > 1)) return 0;

    const premiumCents = Math.round(order.estimatedPriceCents * (multiplier - 1));
    if (premiumCents <= 0) return 0;

    order.levelPremiumCents = premiumCents;
    order.totalAmountCents += premiumCents;

    // ADR-0037 — الفرق ده من نصيب الفني (مستواه هو اللي كسبه)، فبيكبّر وعاء العمولة كمان.
    // `null` = طلب قبل migration 0192، بيفضل null (السلوك القديم وقت التسوية).
    if (order.commissionableBaseCents !== null) {
      const basePolicy = await this.commissionBaseService.getPolicy();
      if (basePolicy.includeLevelPremium) {
        order.commissionableBaseCents += premiumCents;
      }
    }

    await manager.save(order);
    this.logger.log(
      `فرق فني مميّز على الطلب ${order.orderNumber}: ${premiumCents} قرش (مضاعف ${multiplier})`,
    );
    return premiumCents;
  }
}
