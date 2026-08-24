import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtPayload } from '../auth/types/authenticated-request';
import { UserType } from '../auth/entities/user.entity';
import { WarrantyPlan } from './entities/project-milestone.entity';

@Controller('admin/warranty-plans')
@Roles(UserType.ADMIN)
export class AdminWarrantyPlansController {
  constructor(
    @InjectRepository(WarrantyPlan) private readonly plans: Repository<WarrantyPlan>,
  ) {}

  @Get()
  @RequirePermission('warranty.view')
  async list() {
    return this.plans.find({ order: { createdAt: 'DESC' } });
  }

  @Post()
  @RequirePermission('warranty.manage')
  async create(@CurrentUser() admin: JwtPayload, @Body() dto: Record<string, unknown>) {
    const plan = this.plans.create({
      slug: String(dto.slug ?? `wp-${Date.now()}`),
      nameAr: String(dto.name_ar ?? ''),
      warrantyType: String(dto.warranty_type ?? 'extended_workmanship'),
      targetServiceId: dto.target_service_id ? String(dto.target_service_id) : null,
      targetCategoryId: dto.target_category_id ? String(dto.target_category_id) : null,
      pricingModel: String(dto.pricing_model ?? 'fixed'),
      priceValue: String(dto.price_value ?? 0),
      coverageMonths: Number(dto.coverage_months ?? 12),
      maxCoverageCents: dto.max_coverage_cents ? Number(dto.max_coverage_cents) : null,
      maxClaims: Number(dto.max_claims ?? 1),
      termsAr: dto.terms_ar ? String(dto.terms_ar) : null,
      exclusionsAr: dto.exclusions_ar ? String(dto.exclusions_ar) : null,
    });
    return this.plans.save(plan);
  }

  @Patch(':id')
  @RequirePermission('warranty.manage')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: Record<string, unknown>) {
    const plan = await this.plans.findOne({ where: { id } });
    if (!plan) throw new Error('خطة الضمان غير موجودة');
    if (dto.name_ar !== undefined) plan.nameAr = String(dto.name_ar);
    if (dto.is_active !== undefined) plan.isActive = Boolean(dto.is_active);
    if (dto.price_value !== undefined) plan.priceValue = String(dto.price_value);
    if (dto.terms_ar !== undefined) plan.termsAr = String(dto.terms_ar);
    if (dto.exclusions_ar !== undefined) plan.exclusionsAr = String(dto.exclusions_ar);
    return this.plans.save(plan);
  }
}
