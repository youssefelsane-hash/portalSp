import { Injectable, Logger } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { CatalogService } from '../catalog/catalog.service';
import { Order } from '../orders/entities/order.entity';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { SettingsService } from '../settings/settings.service';
import { CommissionBaseService } from './commission-base.service';
import { OrderFinancialFinalizationService } from './order-financial-finalization.service';

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
    private readonly orderFinancials: OrderFinancialFinalizationService,
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
   * - العميل اختار **شركة** (`requestedTechnicianCompanyId`) — docs/08 §62.2. ده كان بَقّة حقيقية:
   *   حجز الشركة `requestedTechnicianId = null`، فلما المطابقة تعيّن عضو مستواه أعلى كان الفرق
   *   بيتضاف **بعد** ما العميل أكّد على سعر تاني — نفس "مفاجأة السعر" اللي §60.3 نفسها بتمنعها.
   *   منطق §60.3 أصلاً عن "العميل ساب المطابقة تختار"، والعميل هنا اختار بإيده.
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
    if (order.requestedTechnicianCompanyId) return 0;
    return this.applyPremium(manager, order, technician, order.estimatedPriceCents);
  }

  /**
   * **ADR-0066 §3** — العميل اختار منفّذ **بعد** ما السعر اتحدد من عرض معتمد (تقييم بالصور).
   *
   * الفرق عن `applyOnAutoAssignment()` فوق مش في القاعدة، في **مين مؤهّل يمر**: هناك الشرط إن
   * الفني ماكانش معروف وقت الحجز (وإلا مستواه داخل السعر أصلاً)، وهنا الفني **بيتحدد دلوقتي**
   * وقيمة العرض مالهاش مضاعف مستوى من الأساس (الأدمن سعّر شغلانة مش سعّر فني).
   *
   * الأساس هنا هو `totalAmountCents` مش `estimatedPriceCents`: عرض التقييم بيتضاف عبر
   * `increasePrice()` فبيقع على الإجمالي، و`estimatedPriceCents` بتفضل صفر لطلب التقييم.
   *
   * الحارس ضد التحصيل المزدوج نفسه (`levelPremiumCents > 0`) — مشترك في `applyPremium()`.
   */
  async applyOnProviderSelection(
    manager: EntityManager,
    order: Order,
    technician: Pick<TechnicianProfile, 'currentLevel' | 'pricingTier'>,
  ): Promise<number> {
    if (order.requestedTechnicianCompanyId) return 0;
    return this.applyPremium(manager, order, technician, order.totalAmountCents);
  }

  /** القاعدة نفسها — المدخل الوحيد اللي بيفرق بين المسارين هو الأساس اللي الفرق بيتحسب عليه. */
  private async applyPremium(
    manager: EntityManager,
    order: Order,
    technician: Pick<TechnicianProfile, 'currentLevel' | 'pricingTier'>,
    baseCents: number | null,
  ): Promise<number> {
    if (baseCents === null || baseCents <= 0) return 0;
    // حارس ضد التحصيل المزدوج: الطلب ممكن يتعيّن أكتر من مرة (الفني الأول لغى وأعيد التوزيع،
    // أو الأدمن أعاد التعيين). من غير الحارس ده كل تعيين جديد كان هيضيف فرق تاني فوق القديم.
    // الفرق الأول بيفضل هو الساري — العميل شاف السعر ده واتعامل عليه. لو المنفّذ نفسه اتغيّر،
    // الفرق بيترجّع أولاً (ADR-0066 §4) فالحارس ده مايمنعش فرق المنفّذ الجديد.
    if (order.levelPremiumCents > 0) return 0;

    const policy = await this.settingsService.getString(AUTO_MATCH_LEVEL_PREMIUM_SETTING, CHARGE);
    if (policy !== CHARGE) return 0;

    const multiplier = await this.catalogService.resolveLevelPriceMultiplier(
      order.serviceId,
      technician.currentLevel,
      technician.pricingTier ?? undefined,
    );
    if (!(multiplier > 1)) return 0;

    const premiumCents = Math.round(baseCents * (multiplier - 1));
    if (premiumCents <= 0) return 0;

    order.levelPremiumCents = premiumCents;

    // ADR-0037 — الفرق ده من نصيب الفني (مستواه هو اللي كسبه)، فبيكبّر وعاء العمولة كمان.
    // `null` = طلب قبل migration 0192، بيفضل null (السلوك القديم وقت التسوية).
    const basePolicy = await this.commissionBaseService.getPolicy();
    const financialResult = await this.orderFinancials.increasePrice(manager, order, {
      amountCents: premiumCents,
      source: 'level_premium',
      includeInCommissionableBase: basePolicy.includeLevelPremium,
    });
    this.logger.log(
      `فرق فني مميّز على الطلب ${order.orderNumber}: ${premiumCents} قرش (مضاعف ${multiplier})` +
        (financialResult.requiresSupplementalCollection ? ' — تحصيل إضافي بعد الدفعة الأصلية' : ''),
    );
    return premiumCents;
  }

  /**
   * **ADR-0066 §4 — ترجيع الفرق لما المنفّذ يتغيّر.**
   *
   * الحارس في `applyPremium()` بيمنع التحصيل المزدوج، لكن من غير الترجيع ده كان هيمنع كمان فرق
   * **المنفّذ الجديد** ويسيب الطلب على فرق القديم — تسعير غلط في الاتجاه التاني.
   *
   * بيمر على `replaceUncommittedPrice()` اللي بيرفض من نفسه لو بدأ أي التزام دفع فعلي، فالترجيع
   * مسموح بس في المرحلة اللي مفيش فيها فلوس اتحركت — وده بالظبط وضع الطلب قبل التوزيع.
   */
  async reverseOnProviderLost(manager: EntityManager, order: Order): Promise<number> {
    const premiumCents = order.levelPremiumCents;
    if (premiumCents <= 0) return 0;
    order.levelPremiumCents = 0;
    await this.orderFinancials.replaceUncommittedPrice(manager, order, order.totalAmountCents - premiumCents);
    this.logger.log(`فرق فني مميّز اترجّع من الطلب ${order.orderNumber}: ${premiumCents} قرش (المنفّذ اتغيّر)`);
    return premiumCents;
  }
}
