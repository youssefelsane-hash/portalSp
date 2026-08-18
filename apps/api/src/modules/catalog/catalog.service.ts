import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { PricingEngineService } from '../pricing/pricing-engine.service';
import { SettingsService } from '../settings/settings.service';
import { TechnicianLevel } from '../technicians/entities/technician-profile.entity';
import { ServiceAddon } from './entities/service-addon.entity';
import { ServiceCategory } from './entities/service-category.entity';
import { ServiceLevelPricing } from './entities/service-level-pricing.entity';
import { ServiceStandardData } from './entities/service-standard-data.entity';
import { PricingModel, Service } from './entities/service.entity';
import { ServiceZonePricing } from './entities/service-zone-pricing.entity';
import { BookingModeFilter } from './dto/list-services.dto';

export interface PriceEstimate {
  base_price_cents: number;
  inspection_fee_cents: number;
  surge_multiplier: number;
  level_price_multiplier: number;
  estimated_total_cents: number;
  /** رسوم الطوارئ الإضافية الصريحة (docs/08 §8) — 0 لو مش طلب طوارئ. منفصلة عن estimated_total_cents
   * عمداً (نفس فلسفة inspection_fee_cents) عشان تتعرض للعميل كبند واضح، مش مدموجة في السعر. */
  emergency_surcharge_cents: number;
  /** الوقت المعلن للعميل بالدقايق ("هيوصلك خلال X دقيقة") — رقم معلن بس، مش ETA محسوب. null لو مش طوارئ. */
  emergency_sla_minutes: number | null;
  /** حدود السعر التقديرية من معادلة pricing_model=formula (docs/08 §1) — null دايمًا لباقي
   * نماذج التسعير (fixed/hourly/per_unit/inspection_then_quote) لأنها مش جزء من صيغتها أصلاً. */
  min_price_cents: number | null;
  max_price_cents: number | null;
  /** معرّف صف `service_pricing_evaluations` (تدقيق/snapshot تاريخي لمعادلة formula وقت الحساب) —
   * null لأي نموذج تسعير تاني. OrdersService.create() بيربطه بالطلب بعد ما يتأكّد فعلاً
   * (linkEvaluationToOrder) عشان السعر النهائي يفضل قابل للتتبّع حتى لو الأدمن غيّر القواعد بعدين. */
  pricing_evaluation_id: string | null;
  /** المدة المتوقعة بالأيام — بس لو معادلة formula بتحدد `estimated_duration_days` صراحة
   * (اختياري في FinalPriceFormulaPayload). null لباقي نماذج التسعير أو لو المعادلة مش بتحسبها
   * (الإنتاجية القائمة على service_standard_data منفصلة تمامًا، راجع estimateDuration() تحت). */
  estimated_duration_days: number | null;
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
  ) {}

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
  ): Promise<PriceEstimate> {
    const service = await this.findServiceOrThrow(serviceId);

    // محرك التسعير الديناميكي (docs/08 §1، ADR-0001) — مسار مستقل بالكامل عن باقي نماذج
    // التسعير (مفيش تركيب مع zone override — المعادلة نفسها مسؤولة عن عوامل السعر اللي العميل
    // حددها في الفورم الديناميكي). كانت فجوة موثّقة صراحة: كان بيتفادى استدعاء PricingEngineService
    // خالص ويستخدم service.basePriceCents (صفر لأي خدمة formula) — اتقفلت.
    //
    // **بَقّة حقيقية اتلقطت واتصلحت (مراجعة مستخدم دقيقة)**: level_price_multiplier كان مقفول
    // على 1 هنا دايمًا، حتى لو technicianLevel اتبعت فعليًا (من estimate-duration/preview/create
    // بعد ما فني معروف) — يعني قرار "كل فني بيظهر بسعره النهائي حسب رتبته" (docs/08) كان مطبّق
    // على كل نماذج التسعير إلا formula بالتحديد. الإصلاح: نفس بحث service_level_pricing
    // المستخدم في باقي الفروع تحت، والمضاعف بيتطبّق على ناتج المعادلة (result.priceCents) بعد
    // حسابها — مش جزء من المعادلة نفسها (الفني مش من مدخلات الفورم اللي العميل بيملاها).
    if (service.pricingModel === PricingModel.FORMULA) {
      const result = await this.pricingEngineService.evaluate(serviceId, fieldValues ?? {});
      let formulaLevelMultiplier = 1;
      if (technicianLevel) {
        const levelRow = await this.levelPricing.findOne({
          where: { serviceId, technicianLevel, isActive: true },
        });
        if (levelRow) {
          formulaLevelMultiplier = Number(levelRow.priceMultiplier);
        }
      }
      const formulaTotalCents = Math.round(result.priceCents * formulaLevelMultiplier);
      const [emergencySurchargePercentage, emergencySlaMinutes] = isEmergency
        ? await Promise.all([
            this.settingsService.getNumber('pricing.emergency_surcharge_percentage', EMERGENCY_SURCHARGE_PERCENTAGE_FALLBACK),
            this.settingsService.getNumber('emergency.sla_minutes', EMERGENCY_SLA_MINUTES_FALLBACK),
          ])
        : [0, null];
      return {
        base_price_cents: result.priceCents,
        inspection_fee_cents: service.inspectionFeeCents,
        surge_multiplier: 1,
        level_price_multiplier: formulaLevelMultiplier,
        estimated_total_cents: formulaTotalCents,
        emergency_surcharge_cents: Math.round((formulaTotalCents * emergencySurchargePercentage) / 100),
        emergency_sla_minutes: emergencySlaMinutes,
        min_price_cents: result.minPriceCents,
        max_price_cents: result.maxPriceCents,
        pricing_evaluation_id: result.evaluationId,
        estimated_duration_days: result.estimatedDurationDays,
      };
    }

    let levelMultiplier = 1;
    if (technicianLevel) {
      const levelRow = await this.levelPricing.findOne({
        where: { serviceId, technicianLevel, isActive: true },
      });
      if (levelRow) {
        levelMultiplier = Number(levelRow.priceMultiplier);
      }
    }

    // رسوم الطوارئ الإضافية الصريحة (docs/08 §8) — orders.surge_amount_cents كان عمود راكد
    // من migration 0007 الأولى، بيتفعّل هنا. منفصلة عن commission.emergency_adjustment_percentage
    // (عمولة داخلية بين المنصة والفني) — دي رسوم على العميل نفسه، معروضة قبل التأكيد.
    const [emergencySurchargePercentage, emergencySlaMinutes] = isEmergency
      ? await Promise.all([
          this.settingsService.getNumber('pricing.emergency_surcharge_percentage', EMERGENCY_SURCHARGE_PERCENTAGE_FALLBACK),
          this.settingsService.getNumber('emergency.sla_minutes', EMERGENCY_SLA_MINUTES_FALLBACK),
        ])
      : [0, null];

    if (zoneId) {
      // تاريخ سريان (docs/06 §3.10) — ممكن يكون فيه أكتر من صف لنفس (خدمة، منطقة) بمدى سريان
      // مختلف (تخطيط سعر مستقبلي)؛ الساري فعليًا هو الصف اللي validFrom <= الآن < validUntil
      // (أو validUntil=NULL). valid_from/valid_until كانت أعمدة خامدة من أول يوم (migration
      // 0006) — أول استخدام حقيقي هنا.
      const now = new Date();
      const override = await this.zonePricing
        .createQueryBuilder('p')
        .where('p.service_id = :serviceId', { serviceId })
        .andWhere('p.service_zone_id = :zoneId', { zoneId })
        .andWhere('p.is_active = true')
        .andWhere('p.valid_from <= :now', { now })
        .andWhere('(p.valid_until IS NULL OR p.valid_until > :now)', { now })
        .orderBy('p.valid_from', 'DESC')
        .getOne();
      if (override) {
        const surge = Number(override.surgeMultiplier);
        const estimatedTotalCents = Math.round(override.priceCents * surge * levelMultiplier);
        return {
          base_price_cents: override.priceCents,
          inspection_fee_cents: override.inspectionFeeCents,
          surge_multiplier: surge,
          level_price_multiplier: levelMultiplier,
          estimated_total_cents: estimatedTotalCents,
          emergency_surcharge_cents: Math.round((estimatedTotalCents * emergencySurchargePercentage) / 100),
          emergency_sla_minutes: emergencySlaMinutes,
          min_price_cents: null,
          max_price_cents: null,
          pricing_evaluation_id: null,
          estimated_duration_days: null,
        };
      }
    }

    const estimatedTotalCents = Math.round(service.basePriceCents * levelMultiplier);
    return {
      base_price_cents: service.basePriceCents,
      inspection_fee_cents: service.inspectionFeeCents,
      surge_multiplier: 1,
      level_price_multiplier: levelMultiplier,
      estimated_total_cents: estimatedTotalCents,
      emergency_surcharge_cents: Math.round((estimatedTotalCents * emergencySurchargePercentage) / 100),
      emergency_sla_minutes: emergencySlaMinutes,
      min_price_cents: null,
      max_price_cents: null,
      pricing_evaluation_id: null,
      estimated_duration_days: null,
    };
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
    };
  }
}
