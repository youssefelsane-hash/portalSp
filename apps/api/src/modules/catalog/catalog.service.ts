import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { TechnicianLevel } from '../technicians/entities/technician-profile.entity';
import { ServiceAddon } from './entities/service-addon.entity';
import { ServiceCategory } from './entities/service-category.entity';
import { ServiceLevelPricing } from './entities/service-level-pricing.entity';
import { ServiceStandardData } from './entities/service-standard-data.entity';
import { Service } from './entities/service.entity';
import { ServiceZonePricing } from './entities/service-zone-pricing.entity';
import { BookingModeFilter } from './dto/list-services.dto';

export interface PriceEstimate {
  base_price_cents: number;
  inspection_fee_cents: number;
  surge_multiplier: number;
  level_price_multiplier: number;
  estimated_total_cents: number;
}

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
  ) {}

  findAddons(serviceId: string): Promise<ServiceAddon[]> {
    return this.addons.find({ where: { serviceId, isActive: true }, order: { displayOrder: 'ASC' } });
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
  async estimate(serviceId: string, zoneId?: string, technicianLevel?: TechnicianLevel): Promise<PriceEstimate> {
    const service = await this.findServiceOrThrow(serviceId);

    let levelMultiplier = 1;
    if (technicianLevel) {
      const levelRow = await this.levelPricing.findOne({
        where: { serviceId, technicianLevel, isActive: true },
      });
      if (levelRow) {
        levelMultiplier = Number(levelRow.priceMultiplier);
      }
    }

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
        return {
          base_price_cents: override.priceCents,
          inspection_fee_cents: override.inspectionFeeCents,
          surge_multiplier: surge,
          level_price_multiplier: levelMultiplier,
          estimated_total_cents: Math.round(override.priceCents * surge * levelMultiplier),
        };
      }
    }

    return {
      base_price_cents: service.basePriceCents,
      inspection_fee_cents: service.inspectionFeeCents,
      surge_multiplier: 1,
      level_price_multiplier: levelMultiplier,
      estimated_total_cents: Math.round(service.basePriceCents * levelMultiplier),
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
