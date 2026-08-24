import { Body, Controller, Get, HttpStatus, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtPayload } from '../auth/types/authenticated-request';
import { UserType } from '../auth/entities/user.entity';
import { WarrantyPlan } from './entities/project-milestone.entity';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { AuditLogService } from '../audit/audit-log.service';

@Controller('admin/warranty-plans')
@Roles(UserType.ADMIN)
export class AdminWarrantyPlansController {
  constructor(
    @InjectRepository(WarrantyPlan) private readonly plans: Repository<WarrantyPlan>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly auditLog: AuditLogService,
  ) {}

  @Get()
  @RequirePermission('warranty.view')
  async list() {
    return this.plans.find({ order: { createdAt: 'DESC' } });
  }

  @Post()
  @RequirePermission('warranty.manage')
  async create(@CurrentUser() admin: JwtPayload, @Body() dto: Record<string, unknown>) {
    const nameAr = String(dto.name_ar ?? '').trim();
    const coverageMonths = Number(dto.coverage_months ?? 12);
    const maxClaims = Number(dto.max_claims ?? 1);
    const warrantyType = String(dto.warranty_type ?? 'extended_workmanship');
    const pricingModel = String(dto.pricing_model ?? 'fixed');
    const priceValue = Number(dto.price_value ?? 0);
    if (!nameAr || !Number.isInteger(coverageMonths) || coverageMonths < 1 || coverageMonths > 120) {
      throw new ApiException(ErrorCode.VAL_001, 'اسم الخطة ومدة تغطية من 1 إلى 120 شهرًا مطلوبان', HttpStatus.BAD_REQUEST);
    }
    if (!Number.isInteger(maxClaims) || maxClaims < 1 || !Number.isFinite(priceValue) || priceValue < 0) {
      throw new ApiException(ErrorCode.VAL_001, 'بيانات التسعير وعدد المطالبات غير صحيحة', HttpStatus.BAD_REQUEST);
    }
    if (!['workmanship', 'extended_workmanship'].includes(warrantyType) || !['fixed', 'percentage'].includes(pricingModel)) {
      throw new ApiException(ErrorCode.VAL_001, 'نوع الضمان أو التسعير غير صحيح', HttpStatus.BAD_REQUEST);
    }
    return this.dataSource.transaction(async (manager) => {
      const plan = manager.create(WarrantyPlan, {
        slug: String(dto.slug ?? `wp-${Date.now()}`).trim(),
        nameAr,
        warrantyType,
        targetServiceId: dto.target_service_id ? String(dto.target_service_id) : null,
        targetCategoryId: dto.target_category_id ? String(dto.target_category_id) : null,
        pricingModel,
        priceValue: String(priceValue),
        coverageMonths,
        maxCoverageCents: dto.max_coverage_cents ? Number(dto.max_coverage_cents) : null,
        maxClaims,
        termsAr: dto.terms_ar ? String(dto.terms_ar) : null,
        exclusionsAr: dto.exclusions_ar ? String(dto.exclusions_ar) : null,
      });
      const saved = await manager.save(plan);
      await this.auditLog.record({
        actorUserId: admin.sub,
        actorRole: 'admin',
        action: 'warranty_plan.created',
        entityType: 'warranty_plan',
        entityId: saved.id,
        newValues: { name_ar: saved.nameAr, coverage_months: saved.coverageMonths, max_claims: saved.maxClaims },
      }, manager);
      return saved;
    });
  }

  @Patch(':id')
  @RequirePermission('warranty.manage')
  async update(@CurrentUser() admin: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: Record<string, unknown>) {
    return this.dataSource.transaction(async (manager) => {
      const plan = await manager
        .createQueryBuilder(WarrantyPlan, 'plan')
        .setLock('pessimistic_write')
        .where('plan.id = :id', { id })
        .getOne();
      if (!plan) throw new ApiException(ErrorCode.VAL_001, 'خطة الضمان غير موجودة', HttpStatus.NOT_FOUND);
      const oldValues = {
        name_ar: plan.nameAr,
        is_active: plan.isActive,
        price_value: plan.priceValue,
        terms_ar: plan.termsAr,
        exclusions_ar: plan.exclusionsAr,
      };
      if (dto.name_ar !== undefined) {
        const name = String(dto.name_ar).trim();
        if (!name) throw new ApiException(ErrorCode.VAL_001, 'اسم الخطة مطلوب', HttpStatus.BAD_REQUEST);
        plan.nameAr = name;
      }
      if (dto.is_active !== undefined) plan.isActive = Boolean(dto.is_active);
      if (dto.price_value !== undefined) {
        const price = Number(dto.price_value);
        if (!Number.isFinite(price) || price < 0) {
          throw new ApiException(ErrorCode.VAL_001, 'سعر الضمان غير صحيح', HttpStatus.BAD_REQUEST);
        }
        plan.priceValue = String(price);
      }
      if (dto.terms_ar !== undefined) plan.termsAr = String(dto.terms_ar) || null;
      if (dto.exclusions_ar !== undefined) plan.exclusionsAr = String(dto.exclusions_ar) || null;
      plan.version += 1;
      const saved = await manager.save(plan);
      await this.auditLog.record({
        actorUserId: admin.sub,
        actorRole: 'admin',
        action: 'warranty_plan.updated',
        entityType: 'warranty_plan',
        entityId: saved.id,
        oldValues,
        newValues: { ...dto, version: saved.version },
      }, manager);
      return saved;
    });
  }
}
