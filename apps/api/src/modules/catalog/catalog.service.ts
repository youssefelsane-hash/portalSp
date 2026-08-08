import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { TechnicianLevel } from '../technicians/entities/technician-profile.entity';
import { ServiceAddon } from './entities/service-addon.entity';
import { ServiceCategory } from './entities/service-category.entity';
import { ServiceLevelPricing } from './entities/service-level-pricing.entity';
import { Service } from './entities/service.entity';
import { ServiceZonePricing } from './entities/service-zone-pricing.entity';

export interface PriceEstimate {
  base_price_cents: number;
  inspection_fee_cents: number;
  surge_multiplier: number;
  level_price_multiplier: number;
  estimated_total_cents: number;
}

@Injectable()
export class CatalogService {
  constructor(
    @InjectRepository(ServiceCategory) private readonly categories: Repository<ServiceCategory>,
    @InjectRepository(Service) private readonly services: Repository<Service>,
    @InjectRepository(ServiceZonePricing) private readonly zonePricing: Repository<ServiceZonePricing>,
    @InjectRepository(ServiceLevelPricing) private readonly levelPricing: Repository<ServiceLevelPricing>,
    @InjectRepository(ServiceAddon) private readonly addons: Repository<ServiceAddon>,
  ) {}

  findAddons(serviceId: string): Promise<ServiceAddon[]> {
    return this.addons.find({ where: { serviceId, isActive: true }, order: { displayOrder: 'ASC' } });
  }

  findActiveCategories(): Promise<ServiceCategory[]> {
    return this.categories.find({ where: { isActive: true }, order: { displayOrder: 'ASC' } });
  }

  findServices(categoryId?: string): Promise<Service[]> {
    return this.services.find({
      where: { isActive: true, ...(categoryId ? { categoryId } : {}) },
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
      const override = await this.zonePricing.findOne({
        where: { serviceId, serviceZoneId: zoneId, isActive: true },
      });
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
}
