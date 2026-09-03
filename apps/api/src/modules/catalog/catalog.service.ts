import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { PricingEngineService } from '../pricing/pricing-engine.service';
import { buildPricingContext, PricingContext } from '../pricing/pricing-context';
import { PricingEvaluationResult } from '../pricing/pricing-formula.types';
import { SettingsService } from '../settings/settings.service';
import { TechnicianLevel, TechnicianPricingTier } from '../technicians/entities/technician-profile.entity';
import { ServiceAddon } from './entities/service-addon.entity';
import { ServiceCategory } from './entities/service-category.entity';
import { ServiceLevelPricing } from './entities/service-level-pricing.entity';
import { ServicePricingTierPricing } from './entities/service-pricing-tier-pricing.entity';
import { ServiceStandardData } from './entities/service-standard-data.entity';
import { PriceCertaintyMode, PricingModel, Service } from './entities/service.entity';
import { estimatedDisplayRange } from './estimated-display-range';
import { ServiceZonePricing, ZonePricingMode } from './entities/service-zone-pricing.entity';
import { BookingModeFilter } from './dto/list-services.dto';

export interface PriceEstimate {
  base_price_cents: number;
  inspection_fee_cents: number;
  surge_multiplier: number;
  level_price_multiplier: number;
  estimated_total_cents: number;
  /** رسوم الطوارئ الإضافية الصريحة (docs/08 §8) — 0 لو مش طلب طوارئ. منفصلة عن
   * estimated_total_cents عمداً عشان الحسابات واللقطة المالية وشاشة الأدمن.
   *
   * **مش بند بيتعرض للعميل** (بند 5/13): الواجهات بتستهلكها في الإجمالي بس. التعليق القديم هنا
   * كان بيقول العكس وبقى مضلّل بعد قرار المالك. */
  emergency_surcharge_cents: number;
  /** الوقت المعلن للعميل بالدقايق ("هيوصلك خلال X دقيقة") — رقم معلن بس، مش ETA محسوب. null لو مش طوارئ. */
  emergency_sla_minutes: number | null;
  /** حدود السعر التقديرية من معادلة pricing_model=formula (docs/08 §1) — null دايمًا لباقي
   * نماذج التسعير (fixed/hourly/per_unit/inspection_then_quote) لأنها مش جزء من صيغتها أصلاً. */
  min_price_cents: number | null;
  max_price_cents: number | null;
  /** **نطاق العرض** للعميل (ADR-0063، بند 10) — منفصل تمامًا عن حدود القصّ فوق. null لأي خدمة
   * مش `estimated_range`. */
  display_price_min_cents: number | null;
  display_price_max_cents: number | null;
  price_certainty_mode: PriceCertaintyMode;
  /** معرّف صف `service_pricing_evaluations` (تدقيق/snapshot تاريخي لمعادلة formula وقت الحساب) —
   * null لأي نموذج تسعير تاني. OrdersService.create() بيربطه بالطلب بعد ما يتأكّد فعلاً
   * (linkEvaluationToOrder) عشان السعر النهائي يفضل قابل للتتبّع حتى لو الأدمن غيّر القواعد بعدين. */
  /** مخرجات تشغيلية من معادلة formula (docs/01B §10 تكامل المحركات) — null لباقي النماذج.
   * OrdersService.create() بيستهلكهم لملء orders.required_technicians/assistants/days
   * لو مفيش مسار standard_data، وبوابة رفض الطوارئ غير المناسبة. */
  required_technicians?: number | null;
  required_assistants?: number | null;
  suitable_for_emergency?: boolean | null;
  pricing_evaluation_id: string | null;
  /** المدة المتوقعة بالأيام — بس لو معادلة formula بتحدد `estimated_duration_days` صراحة
   * (اختياري في FinalPriceFormulaPayload). null لباقي نماذج التسعير أو لو المعادلة مش بتحسبها
   * (الإنتاجية القائمة على service_standard_data منفصلة تمامًا، راجع estimateDuration() تحت). */
  estimated_duration_days: number | null;
  /** المدة التشغيلية بالدقايق الناتجة من المعادلة (ADR-0061 §1) — `null` يعني المعادلة مش بتحددها. */
  duration_minutes: number | null;
}

const EMERGENCY_SURCHARGE_PERCENTAGE_FALLBACK = 20;
const EMERGENCY_SLA_MINUTES_FALLBACK = 60;

// محرك الإنتاجية (docs/06 §3.3-§3.6) — بيرجع تقدير المدة اللي المفروض تتعرض على العميل، والتكلفة
// الداخلية اللي **مش** المفروض تتعرض له (§3.6 صريح) — الفصل ده متعمّد على مستوى النوع نفسه، مش
// بس التوثيق، عشان أي كولر يضطر يتعامل مع الحقلين بوضوح مين عام ومين داخلي.
export interface DurationEstimate {
  estimated_days: number;
  unit_ar: string;
  execution_type_ar: string;
  assigned_technicians: number;
  assigned_assistants: number;
}

export interface DurationEstimateWithInternalCost extends DurationEstimate {
  internal_labor_cost_cents: number;
  assistant_daily_wage_cents: number | null;
}

@Injectable()
export class CatalogService {
  constructor(
    @InjectRepository(ServiceCategory) private readonly categories: Repository<ServiceCategory>,
    @InjectRepository(Service) private readonly services: Repository<Service>,
    @InjectRepository(ServiceZonePricing) private readonly zonePricing: Repository<ServiceZonePricing>,
    @InjectRepository(ServiceLevelPricing) private readonly levelPricing: Repository<ServiceLevelPricing>,
    @InjectRepository(ServiceAddon) private readonly addons: Repository<ServiceAddon>,
    @InjectRepository(ServiceStandardData) private readonly standardData: Repository<ServiceStandardData>,
    private readonly settingsService: SettingsService,
    private readonly pricingEngineService: PricingEngineService,
    // docs/08 §36.24، ADR-0025 — آخر بند عمدًا (نفس نمط orderTeamService في orders.service.ts)
    // عشان ياخد أقل بلاست-رديوس ممكن على الاختبارات القديمة الكتير اللي بتبني CatalogService بـpositional args.
    @InjectRepository(ServicePricingTierPricing) private readonly pricingTierPricing: Repository<ServicePricingTierPricing>,
  ) {}

  /**
   * مضاعف السعر النهائي — فئة تسعير الفني (docs/08 §36.24، ADR-0025) لو موجودة وفيها صف نشط،
   * وإلا fallback كامل لتسعير المستوى التشغيلي القديم (service_level_pricing)، وإلا 1 لو مفيش أي
   * صف. **صفر كسر لأي مسار موجود** — technicianPricingTier باراميتر جديد اختياري بالكامل.
   */
  /** عام عمدًا (docs/08 §60.3): المطابقة محتاجاه بعد التعيين عشان تحسب فرق سعر الفني المميّز.
   * مصدر واحد للمضاعف — مفيش نسخة تانية من نفس البحث في موديول تاني. */
  async resolveLevelPriceMultiplier(
    serviceId: string,
    technicianLevel?: TechnicianLevel,
    technicianPricingTier?: TechnicianPricingTier,
  ): Promise<number> {
    if (technicianPricingTier) {
      const tierRow = await this.pricingTierPricing.findOne({
        where: { serviceId, pricingTier: technicianPricingTier, isActive: true },
      });
      if (tierRow) return Number(tierRow.priceMultiplier);
    }
    if (technicianLevel) {
      const levelRow = await this.levelPricing.findOne({ where: { serviceId, technicianLevel, isActive: true } });
      if (levelRow) return Number(levelRow.priceMultiplier);
    }
    return 1;
  }

  findAddons(serviceId: string): Promise<ServiceAddon[]> {
    return this.addons.find({ where: { serviceId, isActive: true }, order: { displayOrder: 'ASC' } });
  }

  // محرك الإنتاجية (docs/06 §3.1-§3.6) — كانت فجوة موثّقة صراحة: estimateDuration() تحت محتاجة
  // standard_data_id، بس مفيش endpoint عام يخلي العميل يعرف الـid ده أصلاً أو نوع التنفيذ/الوحدة
  // بتاعته. القيم الداخلية (أجور، إنتاجية، حد أدنى عمالة) مُستبعدة عمدًا (docs/06 §3.6 صريح:
  // "مش المفروض تتعرض للعميل") — بس execution_type_ar/unit_ar عشان يعرف يملا الفورم صح.
  findStandardDataForService(serviceId: string): Promise<ServiceStandardData[]> {
    return this.standardData.find({
      where: { serviceId, isActive: true },
      order: { displayOrder: 'ASC' },
    });
  }

  // مُستخدمة وقت إنشاء الطلب (orders.service.ts) — العميل بيختار إضافات جاهزة من كتالوج الخدمة
  // نفسها. بترمي واضح لو أي id مش موجود/مش نشط/بتاع خدمة تانية، بدل ما تتجاهله بصمت — إضافة
  // بسعرها متجاهلة بصمت معناها العميل مدفوعش عن حاجة طلبها فعلاً.
  async findAddonsByIds(serviceId: string, addonIds: string[]): Promise<ServiceAddon[]> {
    if (addonIds.length === 0) return [];
    const found = await this.addons.find({ where: { id: In(addonIds), serviceId, isActive: true } });
    if (found.length !== addonIds.length) {
      throw new ApiException(ErrorCode.VAL_001, 'إضافة واحدة أو أكتر مش متاحة لهذه الخدمة', HttpStatus.BAD_REQUEST);
    }
    return found;
  }

  findActiveCategories(): Promise<ServiceCategory[]> {
    return this.categories.find({ where: { isActive: true }, order: { displayOrder: 'ASC' } });
  }

  /**
   * «الأكثر طلبًا» — **من عدد الطلبات الحقيقي** (docs/08 §77-E2).
   *
   * **الفجوة اللي بتتقفل هنا**: القسم ده كان بيعرض الفئات اللي الأدمن علّم عليها `is_featured`
   * يدويًا. يعني العنوان بيقول «الأكثر طلبًا» والمصدر «اللي الأدمن اختاره» — وعد بيتقال
   * للعميل والنظام مش بينفّذه. نفس فئة البَقّة اللي اتصلحت في §75/§76 أكتر من مرة: الاسم
   * بيقول حاجة والقياس بيقول حاجة تانية.
   *
   * **الفترة المتحركة (`windowDays`) مقصودة**: «الأكثر طلبًا» على مدى تاريخ المنصة كله بيتجمّد
   * بعد شهور — الفئات القديمة بتفضل في الصدارة للأبد ومحدش يقدر يوصل لفئة جديدة رايجة. النافذة
   * بتخلّي القسم يعكس الطلب **دلوقتي**.
   *
   * **الرجوع لـ`is_featured` مقصود كمان**: منصة جديدة عندها صفر طلبات مكتملة. عرض قسم فاضي
   * أسوأ بكتير من عرض اختيار الأدمن كبذرة أولية لحد ما بيانات حقيقية تتكوّن.
   */
  async findMostRequestedCategories(limit = 8): Promise<ServiceCategory[]> {
    const windowDays = await this.settingsService.getNumber('catalog.most_requested_window_days', 90);
    const safeWindow = Math.max(7, Math.min(365, Math.floor(windowDays)));

    // `categories.manager` مش `@InjectDataSource()` عمدًا: نفس الاتصال بالظبط، **وبصفر تغيير
    // في الـconstructor**. التعليق على آخر بند في الـconstructor فوق بيحذّر من ده حرفيًا —
    // إضافة بند جديد بتكسر 19 spec بتبني الخدمة بـpositional args. القاعدة العامة: لو محتاج
    // استعلام خام في خدمة عندها repository أصلاً، استخدم `manager` بتاعه.
    const rows = await this.categories.manager.query<{ category_id: string }[]>(
      `SELECT s.category_id, COUNT(*) AS orders_count
         FROM orders o
         JOIN services s ON s.id = o.service_id
         JOIN service_categories sc ON sc.id = s.category_id
        WHERE o.created_at >= now() - ($1 || ' days')::interval
          AND o.deleted_at IS NULL
          -- الطلبات الملغاة مستبعدة عمدًا: طلب اتلغى مش دليل طلب على الخدمة، وأحيانًا بيبقى
          -- دليل العكس (السعر مش مناسب، مفيش فني). عدّه كان هيرفع فئات فاشلة للصدارة.
          AND o.order_status NOT IN ('cancelled_by_customer', 'cancelled_by_technician',
                                     'cancelled_by_system', 'expired', 'draft')
          AND sc.is_active = true AND sc.deleted_at IS NULL
        GROUP BY s.category_id
        ORDER BY COUNT(*) DESC
        LIMIT $2`,
      [safeWindow, limit],
    );

    if (rows.length === 0) {
      // صفر طلبات في النافذة — بذرة الأدمن هي كل اللي عندنا.
      return this.categories.find({
        where: { isActive: true, isFeatured: true },
        order: { displayOrder: 'ASC' },
        take: limit,
      });
    }

    const ids = rows.map((r) => r.category_id);
    const categories = await this.categories.find({ where: { id: In(ids), isActive: true } });
    // ترتيب النتيجة بترتيب العدّ — `find` بـ`In` مبيحافظش على ترتيب المصفوفة.
    const byId = new Map(categories.map((c) => [c.id, c]));
    return ids.map((id) => byId.get(id)).filter((c): c is ServiceCategory => c !== undefined);
  }

  /**
   * الخدمات النهائية الأكثر طلبًا، لا أقسامها العامة. الصفحة الرئيسية تستخدم هذه القائمة
   * لعرض «تصليح حنفية» مثلًا بدل «سباكة»، ثم تفتح مسار حجز الخدمة مباشرة.
   */
  async findMostRequestedServices(limit = 8): Promise<Service[]> {
    const windowDays = await this.settingsService.getNumber('catalog.most_requested_window_days', 90);
    const safeWindow = Math.max(7, Math.min(365, Math.floor(windowDays)));

    const rows = await this.services.manager.query<{ service_id: string }[]>(
      `SELECT s.id AS service_id, COUNT(*) AS orders_count
         FROM orders o
         JOIN services s ON s.id = o.service_id
         JOIN service_categories sc ON sc.id = s.category_id
        WHERE o.created_at >= now() - ($1 || ' days')::interval
          AND o.deleted_at IS NULL
          AND o.order_status NOT IN ('cancelled_by_customer', 'cancelled_by_technician',
                                     'cancelled_by_system', 'expired', 'draft')
          AND s.is_active = true AND s.deleted_at IS NULL
          AND sc.is_active = true AND sc.deleted_at IS NULL
        GROUP BY s.id
        ORDER BY COUNT(*) DESC, MAX(o.created_at) DESC
        LIMIT $2`,
      [safeWindow, limit],
    );

    const rankedIds = rows.map((row) => row.service_id);
    const ids = rankedIds.length > 0
      ? rankedIds
      : (
          await this.services.manager.query<{ service_id: string }[]>(
            `SELECT s.id AS service_id
               FROM services s
               JOIN service_categories sc ON sc.id = s.category_id
              WHERE s.is_active = true AND s.deleted_at IS NULL
                AND sc.is_active = true AND sc.deleted_at IS NULL
              ORDER BY sc.display_order ASC, s.display_order ASC, s.created_at ASC
              LIMIT $1`,
            [limit],
          )
        ).map((row) => row.service_id);

    if (ids.length === 0) return [];
    const services = await this.services.find({ where: { id: In(ids), isActive: true } });
    const byId = new Map(services.map((service) => [service.id, service]));
    return ids.map((id) => byId.get(id)).filter((service): service is Service => service !== undefined);
  }

  findServices(categoryId?: string, bookingMode?: BookingModeFilter): Promise<Service[]> {
    const bookingModeFilter =
      bookingMode === 'individual'
        ? { allowsIndividual: true }
        : bookingMode === 'team'
          ? { allowsTeam: true }
          : bookingMode === 'emergency'
            ? { allowsEmergency: true }
            : {};
    return this.services.find({
      where: { isActive: true, ...(categoryId ? { categoryId } : {}), ...bookingModeFilter },
      order: { displayOrder: 'ASC' },
    });
  }

  // Script 3 §7/§12 — بحث بلغة طبيعية بسيطة (aliases/synonyms/substring، مش AI). العميل بيكتب
  // "المياه بتنزل من تحت الحوض" فمش لازم يعرف مصطلح "سباكة" أصلاً. ILIKE substring على الاسم/
  // الوصف + مطابقة على search_keywords (migration 0129) — مطابقة الاسم المباشرة أولاً، بعدين
  // الكلمات المفتاحية. حد أقصى 20 نتيجة (بند 67 — مفيش batch عملاقة).
  // بحث بلغة طبيعية بلا AI (docs/16 §7) — العميل بيكتب جملة كاملة ("المياه بتنزل من تحت الحوض")
  // مش كلمة مفتاحية واحدة، فمطابقة الجملة كلها كـsubstring واحد ضد كلمات مفتاحية قصيرة ("تسريب
  // حوض") كانت بترجع صفر نتائج فعليًا (بَقّة حقيقية اتلقطت وقت اختبار حي بمتصفح — راجع docs/16
  // للتفاصيل). الحل: نفصّل الجملة لكلمات ونطابق أي خدمة بتحتوي أي كلمة منها، ونرتّب حسب عدد
  // الكلمات المتطابقة تنازليًا (أكتر تطابق = أعلى) — مطابقة بسيطة صراحةً، مش فهم لغوي حقيقي.
  async searchServices(query: string): Promise<Service[]> {
    const trimmed = query.trim();
    if (trimmed.length < 2) return [];
    // شيل "ال" التعريف من أول الكلمة لو موجودة — "الحوض" لازم يطابق كلمة مفتاحية "حوض" (نفس
    // الكلمة بالمعنى، بَقّة حقيقية اتلقطت وقت اختبار حي: "الحوض" ماكانتش بتطابق "حوض" كـsubstring).
    const stripArticle = (w: string) => (w.startsWith('ال') && w.length > 3 ? w.slice(2) : w);
    const rawWords = trimmed
      .split(/\s+/)
      .filter((w) => w.length >= 2)
      .slice(0, 8);
    const words = rawWords.length > 0 ? rawWords : [trimmed];
    const searchWords = Array.from(new Set(words.flatMap((w) => [w, stripArticle(w)])));

    const qb = this.services.createQueryBuilder('service').where('service.is_active = true');

    const matchConditions = searchWords.map((word, i) => {
      const key = `searchWord${i}`;
      qb.setParameter(key, `%${word}%`);
      return `(service.name_ar ILIKE :${key} OR service.short_description_ar ILIKE :${key} OR EXISTS (SELECT 1 FROM unnest(service.search_keywords) kw WHERE kw ILIKE :${key}))`;
    });

    qb.andWhere(`(${matchConditions.join(' OR ')})`);
    qb.addSelect(`(${matchConditions.map((c) => `(CASE WHEN ${c} THEN 1 ELSE 0 END)`).join(' + ')})`, 'match_score');
    qb.setParameter('prefixPattern', `${trimmed}%`);
    qb.addSelect('(service.name_ar ILIKE :prefixPattern)', 'is_prefix_match');

    return qb
      .orderBy('is_prefix_match', 'DESC')
      .addOrderBy('match_score', 'DESC')
      .addOrderBy('service.display_order', 'ASC')
      .limit(20)
      .getMany();
  }

  async findServiceOrThrow(id: string): Promise<Service> {
    const service = await this.services.findOne({ where: { id, isActive: true } });
    if (!service) {
      throw new ApiException(ErrorCode.VAL_001, 'الخدمة غير موجودة', HttpStatus.NOT_FOUND);
    }
    return service;
  }

  /**
   * قراءة خدمة **للعرض على طلب قائم** — بتتجاهل `is_active` و`deleted_at` عمدًا، وبترجّع `null`
   * بدل ما ترمي.
   *
   * ليه موجودة (بَقّة حقيقية، docs/08 §64.أ): `findServiceOrThrow()` فوق بتفلتر `isActive: true`
   * (وTypeORM بتستبعد المحذوف soft-delete تلقائيًا). المسار ده صح تمامًا **قبل** إنشاء طلب — ما
   * ينفعش عميل يحجز خدمة متوقفة. لكنه كان مستخدم كمان في تحويل الطلب لـDTO عند الفني، فأي طلب
   * خدمته اتوقفت/اتحذفت بعد إنشائه كان بيرمي 404 «الخدمة غير موجودة» — والنتيجة إن **شاشة الفني
   * الرئيسية كلها بتبقى فاضية إلا من رسالة الخطأ**، وكل أفعال التنفيذ (رايح/وصلت/بدأت/خلصت)
   * بترجع 404 كمان. طلب قائم لازم يفضل معروض ومنفَّذ مهما اتغيّر الكتالوج بعده — اسم الخدمة
   * بيانات تاريخية، مش بوابة صلاحية.
   */
  async findServiceForDisplay(id: string): Promise<Service | null> {
    return this.services.findOne({ where: { id }, withDeleted: true });
  }

  // ملحوظة: `technicianLevel` اختياري ومُستخدم بس لمعاينة السعر (`POST /services/:id/estimate`) —
  // مسار إنشاء الطلب الفعلي (`orders.service.ts`) بيستدعي الدالة دي من غير المعامل ده لأن الفني
  // مش معروف لسه وقت الإنشاء (لسه في searching_technician). تطبيق المضاعف تلقائياً على السعر
  // الفعلي للطلب بعد ما فني معيّن يقبله محتاج قرار عمل (إعادة تسعير بعد ما العميل شاف تقدير التاني)
  // مش موجود في القاموس، فمش هنخترعه — فجوة موثّقة في catalog/README.md.
  async estimate(
    serviceId: string,
    zoneId?: string,
    technicianLevel?: TechnicianLevel,
    isEmergency = false,
    fieldValues?: Record<string, string | number | boolean>,
    // docs/08 §36.24، ADR-0025 — آخر باراميتر عمدًا (نفس مبدأ append-only في constructor فوق) —
    // اختياري بالكامل، صفر كسر لأي كولر موجود.
    technicianPricingTier?: TechnicianPricingTier,
    // دقة الوقت (ADR-0031 Slice B/H) — قدرة عامة كانت موجودة أصلاً كـPricingModel.HOURLY على
    // Service من قبل السيشن ده، لكن estimate() ماكانش فيها أي فرع مخصوص ليها (فجوة موثّقة
    // صراحة في orders/README.md، اتقفلت هنا). base_price_cents بقى معناه "سعر الساعة" لخدمة
    // hourly، مش سعر ثابت. append-only زي باقي الباراميترات الاختيارية فوق — صفر كسر لأي كولر
    // موجود، وأي خدمة hourly من غير durationHours (زي "تنظيف شهري/إقامة" في migration 0170،
    // requires_precise_schedule=false) بترجع للسلوك القديم بالحرف (base_price_cents كسعر ثابت).
    durationHours?: number,
    // خدمات "بالوحدة" لازم تضرب سعر الوحدة في الكمية اللي العميل أكدها. append-only عشان أي
    // caller قديم يفضل بنفس سلوك الوحدة الواحدة، بينما OrdersService يفرض وجودها للحجز الحقيقي.
    pricingQuantity?: number,
    // ADR-0042 / docs/08 §64.و — معامل سعر الشركة. **بديل** عن مضاعف المستوى/الفئة مش فوقه:
    // حجز الشركة مالوش مستوى فني أصلاً (§62.2)، فالخانة دي فاضية والمعامل بياخدها. تركيب
    // الاتنين كان هيبقى تحصيل مزدوج على نفس المعنى. append-only زي كل الباراميترات فوق.
    companyPriceMultiplier?: number,
    pricingContextInput?: PricingContext,
  ): Promise<PriceEstimate> {
    const service = await this.findServiceOrThrow(serviceId);
    const pricingContext = pricingContextInput ?? buildPricingContext({
      quantity: pricingQuantity,
      durationHours,
      serviceFieldValues: fieldValues,
      zoneId,
      isEmergency,
      technicianLevel,
    });
    // ADR-0060 §1 — مفيش «مدخل مطلوب لكل طريقة» تاني: أي حقل الحساب محتاجه بقى حقل في الفورم
    // الديناميكي، والمحرك نفسه بيرفض لو حقل إجباري ناقص (`validateAndNormalizeFieldValues`).
    // الفحص اللي كان هنا كان بيتفرّع على `pricing_model` بمعرفة متكررة — وده اللي طلّع بلاغ
    // «لازم تحدد عدد الوحدات» لخدمة شهرية مفيش شاشة بتطلب منها كمية أصلاً (docs/08 §113).

    // docs/08 §108-G — بَقّة حقيقية اتكشفت: تسعير المناطق (service_zone_pricing) كان بيتحقق
    // بس **جوّه** فرع الأسعار الثابتة/بالساعة/بالوحدة، بعد return مبكر لخدمات formula (السطر
    // تحت). يعني أي خدمة formula (المحرك الديناميكي، §1 — أهم حاجة في المشروع) كانت زون
    // برايسينج ليها **صفر تأثير خالص**، مهما اتظبطت من الأدمن — مش "نسب غلط" (زي البَقّة اللي
    // 594346e صلحها جزئيًا جوّه الفرع القديم)، دي "معدومة التأثير" بالكامل. الاستعلام اتنقل
    // هنا عشان يتقرا **مرة واحدة** ويتستخدم في الفرعين (formula وغيره)، بدل تكرار.
    const now = new Date();
    const zoneOverride = zoneId
      ? await this.zonePricing
          .createQueryBuilder('p')
          .where('p.service_id = :serviceId', { serviceId })
          .andWhere('p.service_zone_id = :zoneId', { zoneId })
          .andWhere('p.is_active = true')
          .andWhere('p.valid_from <= :now', { now })
          .andWhere('(p.valid_until IS NULL OR p.valid_until > :now)', { now })
          .orderBy('p.valid_from', 'DESC')
          .getOne()
      : null;

    // مسار حساب واحد بس (ADR-0060 §1). `inspection_then_quote` مش بتمرّ منه أصلاً — مفيش سعر
    // خدمة وقت الحجز، رسم الكشف بس (بيتضاف تحت كـ`inspection_fee_cents`).
    const result: PricingEvaluationResult & { evaluationId: string | null } = service.pricingModel === PricingModel.INSPECTION_THEN_QUOTE
      ? {
          evaluationId: null,
          priceCents: 0,
          durationMinutes: null,
          minPriceCents: null,
          maxPriceCents: null,
          estimatedDurationDays: null,
          requiredTechnicians: null,
          requiredAssistants: null,
          requiresAssistant: null,
          suitableForEmergency: null,
        }
      : await this.pricingEngineService.evaluate(serviceId, fieldValues ?? {}, undefined, pricingContext);

    // الاستبدال المطلق لسعر المنطقة كان مرفوض أصلاً لـ`formula` و`inspection_then_quote`
    // (السعر مش «سعر وحدة» يتضرب في كمية معروفة). بعد ADR-0060 مفيش غير الاتنين دول، يعني
    // الوضع ده بقى مرفوض دايمًا — النسبة المئوية هي طريقة تسعير المناطق الوحيدة.
    if (zoneOverride?.pricingMode === ZonePricingMode.OVERRIDE) {
      throw new ApiException(
        ErrorCode.VAL_001,
        'الاستبدال المطلق لسعر المنطقة مش مدعوم — استخدم نسبة مئوية',
        HttpStatus.CONFLICT,
      );
    }

    const levelMultiplier = companyPriceMultiplier ??
      (await this.resolveLevelPriceMultiplier(serviceId, technicianLevel, technicianPricingTier));
    const [emergencySurchargePercentage, emergencySlaMinutes] = isEmergency
      ? await Promise.all([
          this.settingsService.getNumber('pricing.emergency_surcharge_percentage', EMERGENCY_SURCHARGE_PERCENTAGE_FALLBACK),
          this.settingsService.getNumber('emergency.sla_minutes', EMERGENCY_SLA_MINUTES_FALLBACK),
        ])
      : [0, null];

    let zoneAdjustedBaseCents = result.priceCents;
    let surgeMultiplier = 1;
    let inspectionFeeCents = service.inspectionFeeCents;
    if (zoneOverride) {
      inspectionFeeCents = zoneOverride.inspectionFeeCents;
      // OVERRIDE اترفض فوق، فالباقي نسبة مئوية بس.
      zoneAdjustedBaseCents = Math.round(result.priceCents * (1 + Number(zoneOverride.modifierPercentage) / 100));
    }

    let estimatedTotalCents = Math.round(zoneAdjustedBaseCents * surgeMultiplier * levelMultiplier);
    const effectiveMinPrice = [service.minPriceCents, result.minPriceCents]
      .filter((value): value is number => value !== null)
      .reduce<number | null>((maximum, value) => maximum === null ? value : Math.max(maximum, value), null);
    const effectiveMaxPrice = [service.maxPriceCents, result.maxPriceCents]
      .filter((value): value is number => value !== null)
      .reduce<number | null>((minimum, value) => minimum === null ? value : Math.min(minimum, value), null);
    if (effectiveMinPrice !== null && effectiveMaxPrice !== null && effectiveMinPrice > effectiveMaxPrice) {
      throw new ApiException(ErrorCode.VAL_001, 'حدود سعر الخدمة متعارضة وتحتاج مراجعة من الإدارة', HttpStatus.CONFLICT);
    }
    if (effectiveMinPrice !== null) estimatedTotalCents = Math.max(estimatedTotalCents, effectiveMinPrice);
    if (effectiveMaxPrice !== null) estimatedTotalCents = Math.min(estimatedTotalCents, effectiveMaxPrice);

    const emergencyBaseCents = estimatedTotalCents + inspectionFeeCents;
    return {
      base_price_cents: zoneAdjustedBaseCents,
      inspection_fee_cents: inspectionFeeCents,
      surge_multiplier: surgeMultiplier,
      level_price_multiplier: levelMultiplier,
      estimated_total_cents: estimatedTotalCents,
      emergency_surcharge_cents: Math.round((emergencyBaseCents * emergencySurchargePercentage) / 100),
      emergency_sla_minutes: emergencySlaMinutes,
      min_price_cents: effectiveMinPrice,
      max_price_cents: effectiveMaxPrice,
      // بند 10/29 — النطاق المعروض للعميل، **منفصل** عن حدود القصّ فوق. كان بيترجع في معاينة
      // الطلب بس، فشاشات الحجز اللي بتقرا من التقدير ده ماكانش عندها منه حاجة تعرضها —
      // وcustomer-app كان بيعرض حدود القصّ مكانه، وده اللي البند 29 بيمنعه بالنص.
      // نفس الدالة الواحدة اللي معاينة الطلب بتستخدمها، مش حساب موازي.
      ...estimatedDisplayRange(service, estimatedTotalCents),
      price_certainty_mode: service.priceCertaintyMode,
      pricing_evaluation_id: result.evaluationId,
      estimated_duration_days: result.estimatedDurationDays,
      duration_minutes: result.durationMinutes,
      required_technicians: result.requiredTechnicians,
      required_assistants: result.requiredAssistants,
      suitable_for_emergency: result.suitableForEmergency,
    };
  }

  private assertQuantityConstraints(service: Service, quantity: number): void {
    const min = service.quantityMin === null ? null : Number(service.quantityMin);
    const max = service.quantityMax === null ? null : Number(service.quantityMax);
    const step = service.quantityStep === null ? null : Number(service.quantityStep);
    if (min !== null && quantity < min) {
      throw new ApiException(ErrorCode.VAL_001, `أقل كمية للخدمة هي ${min}`, HttpStatus.BAD_REQUEST);
    }
    if (max !== null && quantity > max) {
      throw new ApiException(ErrorCode.VAL_001, `أكبر كمية للخدمة هي ${max}`, HttpStatus.BAD_REQUEST);
    }

    const precisionScale = 10 ** service.quantityPrecision;
    if (Math.abs(quantity * precisionScale - Math.round(quantity * precisionScale)) > 1e-7) {
      throw new ApiException(
        ErrorCode.VAL_001,
        service.quantityPrecision === 0
          ? 'الكمية لازم تكون رقمًا صحيحًا بدون كسور'
          : `الكمية تسمح بحد أقصى ${service.quantityPrecision} رقم بعد العلامة`,
        HttpStatus.BAD_REQUEST,
      );
    }
    if (step !== null) {
      const offset = (quantity - (min ?? 0)) / step;
      if (Math.abs(offset - Math.round(offset)) > 1e-7) {
        throw new ApiException(
          ErrorCode.VAL_001,
          `الكمية لازم تزيد بخطوات ${step}${min === null ? '' : ` بداية من ${min}`}`,
          HttpStatus.BAD_REQUEST,
        );
      }
    }
  }

  // محرك الإنتاجية (docs/06 §3.3-§3.6، docs/07 الجزء ج) — المدة = المساحة/الوحدات المطلوبة ÷
  // الإنتاجية القياسية، معدّلة بنسبة عدد الصنايعية الفعلي المُعيَّن مقابل الحد الأدنى (§3.4:
  // "عدد الصنايعية يزيد، أيام الشغل تقل"). **قرار موثّق صراحة**: المصدر الأصلي (docs/06 §3.3)
  // بيدي مثال واحد بس محدد (فرد+مساعدين اتنين = إنتاجية أعلى)، ومش بيدّي صيغة عامة لتأثير كل
  // صنايعي/مساعد إضافي ("طبعا ليها حسابات، الحساب مش موجود حاليا" — كلام المالك بالحرف). القرار
  // هنا: نموذج خطي بسيط (الإنتاجية بتتناسب طردياً مع عدد الصنايعية المُعيَّن مقابل الحد الأدنى)
  // — مش قيمة مُختلَقة، لكنه تبسيط موثّق صراحة كقرار عمل قابل للمراجعة، مش الصيغة النهائية
  // المؤكدة. التقريب دايماً لأعلى (Math.ceil) زي مثال المصدر بالحرف (8.3 يوم → "9 أيام").
  async estimateDuration(
    serviceId: string,
    standardDataId: string,
    requestedUnits: number,
    assignedTechnicians?: number,
    assignedAssistants?: number,
  ): Promise<DurationEstimateWithInternalCost> {
    if (requestedUnits <= 0) {
      throw new ApiException(ErrorCode.VAL_001, 'المساحة/الكمية المطلوبة لازم تكون أكبر من صفر', HttpStatus.BAD_REQUEST);
    }
    const row = await this.standardData.findOne({ where: { id: standardDataId, serviceId, isActive: true } });
    if (!row) {
      throw new ApiException(ErrorCode.VAL_001, 'البيانات القياسية غير موجودة لهذه الخدمة', HttpStatus.NOT_FOUND);
    }

    const technicians = assignedTechnicians ?? row.minTechnicians;
    const assistants = assignedAssistants ?? row.minAssistants;
    // §3.4: "يمنع إرسال عدد عمالة أقل من اللازم" — الحد الأدنى إجباري، مش اقتراح.
    if (technicians < row.minTechnicians || assistants < row.minAssistants) {
      throw new ApiException(
        ErrorCode.VAL_001,
        `الشغلانة دي محتاجة ${row.minTechnicians} صنايعي + ${row.minAssistants} مساعد على الأقل`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const baseProductivity = Number(row.productivityPerDay);
    const effectiveProductivity = baseProductivity * (technicians / row.minTechnicians);
    const estimatedDays = Math.ceil(requestedUnits / effectiveProductivity);

    const technicianCostCents = row.technicianDailyWageCents * technicians;
    const assistantCostCents = (row.assistantDailyWageCents ?? 0) * assistants;
    const internalLaborCostCents = (technicianCostCents + assistantCostCents) * estimatedDays;

    return {
      estimated_days: estimatedDays,
      unit_ar: row.unitAr,
      execution_type_ar: row.executionTypeAr,
      assigned_technicians: technicians,
      assigned_assistants: assistants,
      internal_labor_cost_cents: internalLaborCostCents,
      assistant_daily_wage_cents: row.assistantDailyWageCents,
    };
  }
}
