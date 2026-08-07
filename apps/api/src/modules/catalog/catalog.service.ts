import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { ServiceCategory } from './entities/service-category.entity';
import { Service } from './entities/service.entity';
import { ServiceZonePricing } from './entities/service-zone-pricing.entity';

export interface PriceEstimate {
  base_price_cents: number;
  inspection_fee_cents: number;
  surge_multiplier: number;
  estimated_total_cents: number;
}

@Injectable()
export class CatalogService {
  constructor(
    @InjectRepository(ServiceCategory) private readonly categories: Repository<ServiceCategory>,
    @InjectRepository(Service) private readonly services: Repository<Service>,
    @InjectRepository(ServiceZonePricing) private readonly zonePricing: Repository<ServiceZonePricing>,
  ) {}

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

  async estimate(serviceId: string, zoneId?: string): Promise<PriceEstimate> {
    const service = await this.findServiceOrThrow(serviceId);

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
          estimated_total_cents: Math.round(override.priceCents * surge),
        };
      }
    }

    return {
      base_price_cents: service.basePriceCents,
      inspection_fee_cents: service.inspectionFeeCents,
      surge_multiplier: 1,
      estimated_total_cents: service.basePriceCents,
    };
  }
}
