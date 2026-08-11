import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { AuditActorMeta, AuditLogService } from '../audit/audit-log.service';
import { TechniciansService } from '../technicians/technicians.service';
import { AssignTechnicianServiceDto } from './dto/assign-technician-service.dto';
import { CreateServiceAddonDto } from './dto/create-service-addon.dto';
import { CreateServiceCategoryDto } from './dto/create-service-category.dto';
import { CreateServiceDto } from './dto/create-service.dto';
import { CreateServiceStandardDataDto } from './dto/create-service-standard-data.dto';
import { RecordProductivityActualDto } from './dto/record-productivity-actual.dto';
import { UpdateServiceAddonDto } from './dto/update-service-addon.dto';
import { UpdateServiceCategoryDto } from './dto/update-service-category.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { UpdateServiceStandardDataDto } from './dto/update-service-standard-data.dto';
import { UpsertLevelPricingDto } from './dto/upsert-level-pricing.dto';
import { UpsertZonePricingDto } from './dto/upsert-zone-pricing.dto';
import { ServiceAddon } from './entities/service-addon.entity';
import { ServiceCategory } from './entities/service-category.entity';
import { ServiceLevelPricing } from './entities/service-level-pricing.entity';
import { ServiceProductivityActual } from './entities/service-productivity-actual.entity';
import { ServiceStandardData } from './entities/service-standard-data.entity';
import { Service } from './entities/service.entity';
import { ServiceZonePricing } from './entities/service-zone-pricing.entity';
import { TechnicianService } from './entities/technician-service.entity';

@Injectable()
export class AdminCatalogService {
  constructor(
    @InjectRepository(ServiceCategory) private readonly categories: Repository<ServiceCategory>,
    @InjectRepository(Service) private readonly services: Repository<Service>,
    @InjectRepository(ServiceZonePricing) private readonly zonePricing: Repository<ServiceZonePricing>,
    @InjectRepository(ServiceLevelPricing) private readonly levelPricing: Repository<ServiceLevelPricing>,
    @InjectRepository(ServiceAddon) private readonly addons: Repository<ServiceAddon>,
    @InjectRepository(ServiceStandardData) private readonly standardData: Repository<ServiceStandardData>,
    @InjectRepository(ServiceProductivityActual) private readonly productivityActuals: Repository<ServiceProductivityActual>,
    @InjectRepository(TechnicianService) private readonly technicianServices: Repository<TechnicianService>,
    private readonly techniciansService: TechniciansService,
    private readonly auditLog: AuditLogService,
  ) {}

  // ── الفئات ───────────────────────────────────────────────────────────

  listAllCategories(): Promise<ServiceCategory[]> {
    return this.categories.find({ order: { displayOrder: 'ASC' } });
  }

  private async findCategoryOrThrow(id: string): Promise<ServiceCategory> {
    const category = await this.categories.findOne({ where: { id } });
    if (!category) {
      throw new ApiException(ErrorCode.VAL_001, 'الفئة غير موجودة', HttpStatus.NOT_FOUND);
    }
    return category;
  }

  async createCategory(adminUserId: string, dto: CreateServiceCategoryDto, meta?: AuditActorMeta): Promise<ServiceCategory> {
    if (dto.parent_category_id) {
      await this.findCategoryOrThrow(dto.parent_category_id);
    }
    const existing = await this.categories.findOne({ where: { slug: dto.slug } });
    if (existing) {
      throw new ApiException(ErrorCode.VAL_001, 'الـ slug ده مستخدم قبل كده', HttpStatus.CONFLICT);
    }

    const category = this.categories.create({
      parentCategoryId: dto.parent_category_id ?? null,
      nameAr: dto.name_ar,
      nameEn: dto.name_en,
      slug: dto.slug,
      descriptionAr: dto.description_ar ?? null,
      iconUrl: dto.icon_url ?? null,
      displayOrder: dto.display_order ?? 0,
      isFeatured: dto.is_featured ?? false,
      launchPhase: dto.launch_phase ?? 1,
    });
    await this.categories.save(category);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'service_category.created',
      entityType: 'service_category',
      entityId: category.id,
      newValues: { name_ar: category.nameAr, slug: category.slug },
      meta,
    });
    return category;
  }

  async updateCategory(
    adminUserId: string,
    id: string,
    dto: UpdateServiceCategoryDto,
    meta?: AuditActorMeta,
  ): Promise<ServiceCategory> {
    const category = await this.findCategoryOrThrow(id);
    const oldValues = { name_ar: category.nameAr, is_active: category.isActive };

    if (dto.parent_category_id !== undefined) {
      if (dto.parent_category_id === id) {
        throw new ApiException(ErrorCode.VAL_001, 'الفئة مينفعش تكون أب لنفسها', HttpStatus.BAD_REQUEST);
      }
      if (dto.parent_category_id) await this.findCategoryOrThrow(dto.parent_category_id);
      category.parentCategoryId = dto.parent_category_id ?? null;
    }
    if (dto.name_ar !== undefined) category.nameAr = dto.name_ar;
    if (dto.name_en !== undefined) category.nameEn = dto.name_en;
    if (dto.slug !== undefined) category.slug = dto.slug;
    if (dto.description_ar !== undefined) category.descriptionAr = dto.description_ar;
    if (dto.icon_url !== undefined) category.iconUrl = dto.icon_url;
    if (dto.display_order !== undefined) category.displayOrder = dto.display_order;
    if (dto.is_featured !== undefined) category.isFeatured = dto.is_featured;
    if (dto.launch_phase !== undefined) category.launchPhase = dto.launch_phase;
    if (dto.is_active !== undefined) category.isActive = dto.is_active;
    await this.categories.save(category);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'service_category.updated',
      entityType: 'service_category',
      entityId: category.id,
      oldValues,
      newValues: { name_ar: category.nameAr, is_active: category.isActive },
      meta,
    });
    return category;
  }

  async deleteCategory(adminUserId: string, id: string, meta?: AuditActorMeta): Promise<void> {
    const category = await this.findCategoryOrThrow(id);
    const servicesUsingIt = await this.services.count({ where: { categoryId: id } });
    if (servicesUsingIt > 0) {
      throw new ApiException(
        ErrorCode.VAL_001,
        'مينفعش تمسح فئة فيها خدمات — عطّلها أو انقل الخدمات الأول',
        HttpStatus.CONFLICT,
      );
    }
    await this.categories.softDelete(id);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'service_category.deleted',
      entityType: 'service_category',
      entityId: category.id,
      oldValues: { name_ar: category.nameAr },
      meta,
    });
  }

  // ── الخدمات ──────────────────────────────────────────────────────────

  listAllServices(categoryId?: string): Promise<Service[]> {
    return this.services.find({
      where: categoryId ? { categoryId } : {},
      order: { displayOrder: 'ASC' },
    });
  }

  private async findServiceOrThrow(id: string): Promise<Service> {
    const service = await this.services.findOne({ where: { id } });
    if (!service) {
      throw new ApiException(ErrorCode.VAL_001, 'الخدمة غير موجودة', HttpStatus.NOT_FOUND);
    }
    return service;
  }

  async createService(adminUserId: string, dto: CreateServiceDto, meta?: AuditActorMeta): Promise<Service> {
    await this.findCategoryOrThrow(dto.category_id);
    const existing = await this.services.findOne({ where: { slug: dto.slug } });
    if (existing) {
      throw new ApiException(ErrorCode.VAL_001, 'الـ slug ده مستخدم قبل كده', HttpStatus.CONFLICT);
    }

    const service = this.services.create({
      categoryId: dto.category_id,
      nameAr: dto.name_ar,
      nameEn: dto.name_en ?? null,
      slug: dto.slug,
      shortDescriptionAr: dto.short_description_ar ?? null,
      fullDescriptionAr: dto.full_description_ar ?? null,
      iconUrl: dto.icon_url ?? null,
      pricingModel: dto.pricing_model,
      basePriceCents: dto.base_price_cents,
      inspectionFeeCents: dto.inspection_fee_cents ?? 0,
      minPriceCents: dto.min_price_cents ?? null,
      maxPriceCents: dto.max_price_cents ?? null,
      unitNameAr: dto.unit_name_ar ?? null,
      estimatedDurationMinutes: dto.estimated_duration_minutes ?? null,
      warrantyDays: dto.warranty_days ?? 0,
      requiresPhotos: dto.requires_photos ?? false,
      allowsScheduling: dto.allows_scheduling ?? true,
      allowsEmergency: dto.allows_emergency ?? false,
      allowsIndividual: dto.allows_individual ?? true,
      allowsTeam: dto.allows_team ?? false,
      minTechnicianLevel: dto.min_technician_level,
      commissionPercentage: dto.commission_percentage !== undefined ? String(dto.commission_percentage) : undefined,
      displayOrder: dto.display_order ?? 0,
      launchPhase: dto.launch_phase ?? 1,
    });
    await this.services.save(service);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'service.created',
      entityType: 'service',
      entityId: service.id,
      newValues: { name_ar: service.nameAr, slug: service.slug, base_price_cents: service.basePriceCents },
      meta,
    });
    return service;
  }

  async updateService(adminUserId: string, id: string, dto: UpdateServiceDto, meta?: AuditActorMeta): Promise<Service> {
    const service = await this.findServiceOrThrow(id);
    const oldValues = { base_price_cents: service.basePriceCents, is_active: service.isActive };

    if (dto.category_id !== undefined) {
      await this.findCategoryOrThrow(dto.category_id);
      service.categoryId = dto.category_id;
    }
    if (dto.name_ar !== undefined) service.nameAr = dto.name_ar;
    if (dto.name_en !== undefined) service.nameEn = dto.name_en;
    if (dto.slug !== undefined) service.slug = dto.slug;
    if (dto.short_description_ar !== undefined) service.shortDescriptionAr = dto.short_description_ar;
    if (dto.full_description_ar !== undefined) service.fullDescriptionAr = dto.full_description_ar;
    if (dto.icon_url !== undefined) service.iconUrl = dto.icon_url;
    if (dto.pricing_model !== undefined) service.pricingModel = dto.pricing_model;
    if (dto.base_price_cents !== undefined) service.basePriceCents = dto.base_price_cents;
    if (dto.inspection_fee_cents !== undefined) service.inspectionFeeCents = dto.inspection_fee_cents;
    if (dto.min_price_cents !== undefined) service.minPriceCents = dto.min_price_cents;
    if (dto.max_price_cents !== undefined) service.maxPriceCents = dto.max_price_cents;
    if (dto.unit_name_ar !== undefined) service.unitNameAr = dto.unit_name_ar;
    if (dto.estimated_duration_minutes !== undefined) service.estimatedDurationMinutes = dto.estimated_duration_minutes;
    if (dto.warranty_days !== undefined) service.warrantyDays = dto.warranty_days;
    if (dto.requires_photos !== undefined) service.requiresPhotos = dto.requires_photos;
    if (dto.allows_scheduling !== undefined) service.allowsScheduling = dto.allows_scheduling;
    if (dto.allows_emergency !== undefined) service.allowsEmergency = dto.allows_emergency;
    if (dto.allows_individual !== undefined) service.allowsIndividual = dto.allows_individual;
    if (dto.allows_team !== undefined) service.allowsTeam = dto.allows_team;
    if (dto.min_technician_level !== undefined) service.minTechnicianLevel = dto.min_technician_level;
    if (dto.commission_percentage !== undefined) service.commissionPercentage = String(dto.commission_percentage);
    if (dto.display_order !== undefined) service.displayOrder = dto.display_order;
    if (dto.launch_phase !== undefined) service.launchPhase = dto.launch_phase;
    if (dto.is_active !== undefined) service.isActive = dto.is_active;
    await this.services.save(service);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'service.updated',
      entityType: 'service',
      entityId: service.id,
      oldValues,
      newValues: { base_price_cents: service.basePriceCents, is_active: service.isActive },
      meta,
    });
    return service;
  }

  async deleteService(adminUserId: string, id: string, meta?: AuditActorMeta): Promise<void> {
    const service = await this.findServiceOrThrow(id);
    await this.services.softDelete(id);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'service.deleted',
      entityType: 'service',
      entityId: service.id,
      oldValues: { name_ar: service.nameAr, slug: service.slug },
      meta,
    });
  }

  // ── تسعير حسب المنطقة ───────────────────────────────────────────────

  listZonePricing(serviceId: string): Promise<ServiceZonePricing[]> {
    return this.zonePricing.find({ where: { serviceId }, order: { createdAt: 'DESC' } });
  }

  /** الصف الساري فعليًا دلوقتي (validFrom <= الآن < validUntil أو validUntil=NULL). */
  private findCurrentZonePricing(serviceId: string, serviceZoneId: string): Promise<ServiceZonePricing | null> {
    const now = new Date();
    return this.zonePricing
      .createQueryBuilder('p')
      .where('p.service_id = :serviceId', { serviceId })
      .andWhere('p.service_zone_id = :serviceZoneId', { serviceZoneId })
      .andWhere('p.is_active = true')
      .andWhere('p.valid_from <= :now', { now })
      .andWhere('(p.valid_until IS NULL OR p.valid_until > :now)', { now })
      .orderBy('p.valid_from', 'DESC')
      .getOne();
  }

  // تاريخ سريان (docs/06 §3.10، docs/07 الجزء د) — تعديل بأثر فوري (valid_from غير مبعوت أو
  // <= الآن) بيعدّل الصف الساري حالياً في مكانه (upsert زي زمان). جدولة سعر مستقبلي (valid_from
  // في المستقبل) بتقفل الصف الساري الحالي عند نفس اللحظة (valid_until) وتفتح صف جديد منفصل —
  // الاتنين يتحفظوا كتاريخ، مش بيتكتب فوق بعضه.
  async upsertZonePricing(
    adminUserId: string,
    serviceId: string,
    dto: UpsertZonePricingDto,
    meta?: AuditActorMeta,
  ): Promise<ServiceZonePricing> {
    await this.findServiceOrThrow(serviceId);
    const now = new Date();
    const validFrom = dto.valid_from ? new Date(dto.valid_from) : now;
    const isFutureScheduling = validFrom.getTime() > now.getTime();

    const current = await this.findCurrentZonePricing(serviceId, dto.service_zone_id);

    let pricing: ServiceZonePricing;
    let isNew: boolean;
    if (isFutureScheduling) {
      // جدولة سعر مستقبلي — الصف الحالي (لو موجود) بيتقفل عند لحظة السريان الجديدة، مش بيتلمس تاني.
      if (current) {
        current.validUntil = validFrom;
        await this.zonePricing.save(current);
      }
      pricing = this.zonePricing.create({ serviceId, serviceZoneId: dto.service_zone_id, validFrom, validUntil: null });
      isNew = true;
    } else if (current) {
      pricing = current;
      isNew = false;
    } else {
      pricing = this.zonePricing.create({ serviceId, serviceZoneId: dto.service_zone_id, validFrom, validUntil: null });
      isNew = true;
    }

    pricing.priceCents = dto.price_cents;
    if (dto.inspection_fee_cents !== undefined) pricing.inspectionFeeCents = dto.inspection_fee_cents;
    if (dto.surge_multiplier !== undefined) pricing.surgeMultiplier = String(dto.surge_multiplier);
    await this.zonePricing.save(pricing);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: isNew ? 'service_zone_pricing.created' : 'service_zone_pricing.updated',
      entityType: 'service_zone_pricing',
      entityId: pricing.id,
      newValues: { price_cents: pricing.priceCents, service_zone_id: pricing.serviceZoneId, valid_from: pricing.validFrom },
      meta,
    });
    return pricing;
  }

  async deactivateZonePricing(adminUserId: string, id: string, meta?: AuditActorMeta): Promise<void> {
    const pricing = await this.zonePricing.findOne({ where: { id } });
    if (!pricing) {
      throw new ApiException(ErrorCode.VAL_001, 'تسعير المنطقة غير موجود', HttpStatus.NOT_FOUND);
    }
    pricing.isActive = false;
    await this.zonePricing.save(pricing);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'service_zone_pricing.deactivated',
      entityType: 'service_zone_pricing',
      entityId: pricing.id,
      meta,
    });
  }

  // ── الفنيين المؤهلين ─────────────────────────────────────────────────

  listEligibleTechnicians(serviceId: string): Promise<TechnicianService[]> {
    return this.technicianServices.find({ where: { serviceId }, order: { createdAt: 'DESC' } });
  }

  async assignTechnician(
    adminUserId: string,
    serviceId: string,
    dto: AssignTechnicianServiceDto,
    meta?: AuditActorMeta,
  ): Promise<TechnicianService> {
    await this.findServiceOrThrow(serviceId);
    await this.techniciansService.findByProfileIdOrThrow(dto.technician_id);

    const existing = await this.technicianServices.findOne({
      where: { serviceId, technicianId: dto.technician_id },
    });
    if (existing) {
      throw new ApiException(ErrorCode.VAL_001, 'الفني ده متأهّل للخدمة دي بالفعل', HttpStatus.CONFLICT);
    }

    const assignment = this.technicianServices.create({
      serviceId,
      technicianId: dto.technician_id,
      skillLevel: dto.skill_level,
    });
    await this.technicianServices.save(assignment);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'technician_service.assigned',
      entityType: 'service',
      entityId: serviceId,
      newValues: { technician_id: dto.technician_id, skill_level: assignment.skillLevel },
      meta,
    });
    return assignment;
  }

  async removeTechnician(adminUserId: string, serviceId: string, technicianId: string, meta?: AuditActorMeta): Promise<void> {
    const result = await this.technicianServices.delete({ serviceId, technicianId });
    if (!result.affected) {
      throw new ApiException(ErrorCode.VAL_001, 'الفني ده مش متأهّل للخدمة دي أصلاً', HttpStatus.NOT_FOUND);
    }

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'technician_service.removed',
      entityType: 'service',
      entityId: serviceId,
      oldValues: { technician_id: technicianId },
      meta,
    });
  }

  // ── تسعير حسب مستوى الفني ────────────────────────────────────────────

  listLevelPricing(serviceId: string): Promise<ServiceLevelPricing[]> {
    return this.levelPricing.find({ where: { serviceId }, order: { technicianLevel: 'ASC' } });
  }

  async upsertLevelPricing(
    adminUserId: string,
    serviceId: string,
    dto: UpsertLevelPricingDto,
    meta?: AuditActorMeta,
  ): Promise<ServiceLevelPricing> {
    await this.findServiceOrThrow(serviceId);

    let pricing = await this.levelPricing.findOne({
      where: { serviceId, technicianLevel: dto.technician_level },
    });
    const isNew = !pricing;
    if (!pricing) {
      pricing = this.levelPricing.create({ serviceId, technicianLevel: dto.technician_level });
    }
    pricing.priceMultiplier = String(dto.price_multiplier);
    pricing.isActive = true;
    await this.levelPricing.save(pricing);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: isNew ? 'service_level_pricing.created' : 'service_level_pricing.updated',
      entityType: 'service_level_pricing',
      entityId: pricing.id,
      newValues: { technician_level: pricing.technicianLevel, price_multiplier: pricing.priceMultiplier },
      meta,
    });
    return pricing;
  }

  async deactivateLevelPricing(adminUserId: string, id: string, meta?: AuditActorMeta): Promise<void> {
    const pricing = await this.levelPricing.findOne({ where: { id } });
    if (!pricing) {
      throw new ApiException(ErrorCode.VAL_001, 'تسعير المستوى غير موجود', HttpStatus.NOT_FOUND);
    }
    pricing.isActive = false;
    await this.levelPricing.save(pricing);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'service_level_pricing.deactivated',
      entityType: 'service_level_pricing',
      entityId: pricing.id,
      meta,
    });
  }

  // ── الإضافات الاختيارية ──────────────────────────────────────────────

  listAddons(serviceId: string): Promise<ServiceAddon[]> {
    return this.addons.find({ where: { serviceId }, order: { displayOrder: 'ASC' } });
  }

  async createAddon(
    adminUserId: string,
    serviceId: string,
    dto: CreateServiceAddonDto,
    meta?: AuditActorMeta,
  ): Promise<ServiceAddon> {
    await this.findServiceOrThrow(serviceId);

    const addon = this.addons.create({
      serviceId,
      nameAr: dto.name_ar,
      nameEn: dto.name_en ?? null,
      priceCents: dto.price_cents,
      durationMinutes: dto.duration_minutes ?? null,
      displayOrder: dto.display_order ?? 0,
    });
    await this.addons.save(addon);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'service_addon.created',
      entityType: 'service_addon',
      entityId: addon.id,
      newValues: { name_ar: addon.nameAr, price_cents: addon.priceCents },
      meta,
    });
    return addon;
  }

  private async findAddonOrThrow(id: string): Promise<ServiceAddon> {
    const addon = await this.addons.findOne({ where: { id } });
    if (!addon) {
      throw new ApiException(ErrorCode.VAL_001, 'الإضافة غير موجودة', HttpStatus.NOT_FOUND);
    }
    return addon;
  }

  async updateAddon(
    adminUserId: string,
    id: string,
    dto: UpdateServiceAddonDto,
    meta?: AuditActorMeta,
  ): Promise<ServiceAddon> {
    const addon = await this.findAddonOrThrow(id);
    const oldValues = { name_ar: addon.nameAr, price_cents: addon.priceCents, is_active: addon.isActive };

    if (dto.name_ar !== undefined) addon.nameAr = dto.name_ar;
    if (dto.name_en !== undefined) addon.nameEn = dto.name_en;
    if (dto.price_cents !== undefined) addon.priceCents = dto.price_cents;
    if (dto.duration_minutes !== undefined) addon.durationMinutes = dto.duration_minutes;
    if (dto.display_order !== undefined) addon.displayOrder = dto.display_order;
    if (dto.is_active !== undefined) addon.isActive = dto.is_active;
    await this.addons.save(addon);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'service_addon.updated',
      entityType: 'service_addon',
      entityId: addon.id,
      oldValues,
      newValues: { name_ar: addon.nameAr, price_cents: addon.priceCents, is_active: addon.isActive },
      meta,
    });
    return addon;
  }

  async deleteAddon(adminUserId: string, id: string, meta?: AuditActorMeta): Promise<void> {
    const addon = await this.findAddonOrThrow(id);
    await this.addons.softDelete(id);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'service_addon.deleted',
      entityType: 'service_addon',
      entityId: addon.id,
      oldValues: { name_ar: addon.nameAr },
      meta,
    });
  }

  // ── البيانات القياسية ومحرك الإنتاجية (docs/06 §3.1-§3.6، docs/07 الجزء ج) ───────────

  listStandardData(serviceId: string): Promise<ServiceStandardData[]> {
    return this.standardData.find({ where: { serviceId }, order: { displayOrder: 'ASC' } });
  }

  async createStandardData(
    adminUserId: string,
    serviceId: string,
    dto: CreateServiceStandardDataDto,
    meta?: AuditActorMeta,
  ): Promise<ServiceStandardData> {
    await this.findServiceOrThrow(serviceId);

    const row = this.standardData.create({
      serviceId,
      executionTypeAr: dto.execution_type_ar ?? 'عام',
      unitAr: dto.unit_ar,
      technicianDailyWageCents: dto.technician_daily_wage_cents,
      assistantDailyWageCents: dto.assistant_daily_wage_cents ?? null,
      productivityPerDay: String(dto.productivity_per_day),
      minTechnicians: dto.min_technicians ?? 1,
      minAssistants: dto.min_assistants ?? 0,
      displayOrder: dto.display_order ?? 0,
    });
    await this.standardData.save(row);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'service_standard_data.created',
      entityType: 'service_standard_data',
      entityId: row.id,
      newValues: { execution_type_ar: row.executionTypeAr, productivity_per_day: row.productivityPerDay },
      meta,
    });
    return row;
  }

  private async findStandardDataOrThrow(id: string): Promise<ServiceStandardData> {
    const row = await this.standardData.findOne({ where: { id } });
    if (!row) {
      throw new ApiException(ErrorCode.VAL_001, 'البيانات القياسية غير موجودة', HttpStatus.NOT_FOUND);
    }
    return row;
  }

  async updateStandardData(
    adminUserId: string,
    id: string,
    dto: UpdateServiceStandardDataDto,
    meta?: AuditActorMeta,
  ): Promise<ServiceStandardData> {
    const row = await this.findStandardDataOrThrow(id);
    const oldValues = { productivity_per_day: row.productivityPerDay, is_active: row.isActive };

    if (dto.execution_type_ar !== undefined) row.executionTypeAr = dto.execution_type_ar;
    if (dto.unit_ar !== undefined) row.unitAr = dto.unit_ar;
    if (dto.technician_daily_wage_cents !== undefined) row.technicianDailyWageCents = dto.technician_daily_wage_cents;
    if (dto.assistant_daily_wage_cents !== undefined) row.assistantDailyWageCents = dto.assistant_daily_wage_cents;
    if (dto.productivity_per_day !== undefined) row.productivityPerDay = String(dto.productivity_per_day);
    if (dto.min_technicians !== undefined) row.minTechnicians = dto.min_technicians;
    if (dto.min_assistants !== undefined) row.minAssistants = dto.min_assistants;
    if (dto.display_order !== undefined) row.displayOrder = dto.display_order;
    if (dto.is_active !== undefined) row.isActive = dto.is_active;
    await this.standardData.save(row);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'service_standard_data.updated',
      entityType: 'service_standard_data',
      entityId: row.id,
      oldValues,
      newValues: { productivity_per_day: row.productivityPerDay, is_active: row.isActive },
      meta,
    });
    return row;
  }

  async deleteStandardData(adminUserId: string, id: string, meta?: AuditActorMeta): Promise<void> {
    const row = await this.findStandardDataOrThrow(id);
    await this.standardData.softDelete(id);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'service_standard_data.deleted',
      entityType: 'service_standard_data',
      entityId: row.id,
      oldValues: { execution_type_ar: row.executionTypeAr },
      meta,
    });
  }

  // ── أساس محرك الإنتاجية الذاتي التعلّم (docs/06 §3.9، docs/07 الجزء د) — مرحلة 1: تسجيل بس ──

  listProductivityActuals(standardDataId: string): Promise<ServiceProductivityActual[]> {
    return this.productivityActuals.find({
      where: { serviceStandardDataId: standardDataId },
      order: { createdAt: 'DESC' },
    });
  }

  async recordProductivityActual(
    adminUserId: string,
    standardDataId: string,
    dto: RecordProductivityActualDto,
    meta?: AuditActorMeta,
  ): Promise<ServiceProductivityActual> {
    await this.findStandardDataOrThrow(standardDataId);

    const row = this.productivityActuals.create({
      serviceStandardDataId: standardDataId,
      orderId: dto.order_id ?? null,
      actualUnits: String(dto.actual_units),
      actualDays: String(dto.actual_days),
      actualTechnicians: dto.actual_technicians,
      actualAssistants: dto.actual_assistants,
      notes: dto.notes ?? null,
      recordedByUserId: adminUserId,
    });
    await this.productivityActuals.save(row);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'service_productivity_actual.recorded',
      entityType: 'service_productivity_actual',
      entityId: row.id,
      newValues: { actual_units: row.actualUnits, actual_days: row.actualDays },
      meta,
    });
    return row;
  }
}
