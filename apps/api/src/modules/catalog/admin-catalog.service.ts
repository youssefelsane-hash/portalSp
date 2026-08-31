import { HttpStatus, Inject, Injectable } from '@nestjs/common';
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
import { UpsertPricingTierPricingDto } from './dto/upsert-pricing-tier-pricing.dto';
import { UpsertZonePricingDto } from './dto/upsert-zone-pricing.dto';
import { ServiceAddon } from './entities/service-addon.entity';
import { ServiceCategory } from './entities/service-category.entity';
import { ServiceLevelPricing } from './entities/service-level-pricing.entity';
import { ServicePricingTierPricing } from './entities/service-pricing-tier-pricing.entity';
import { ServiceProductivityActual } from './entities/service-productivity-actual.entity';
import { ServiceStandardData } from './entities/service-standard-data.entity';
import { PricingModel, Service } from './entities/service.entity';
import { ServiceZonePricing, ZonePricingMode } from './entities/service-zone-pricing.entity';
import { TechnicianService, TechnicianServiceVerificationStatus } from './entities/technician-service.entity';
import { randomUUID } from 'node:crypto';
import { STORAGE_SERVICE, StorageService } from '../../common/storage/storage.service';
import { uploadWithOrphanCleanup } from '../../common/storage/upload-with-orphan-cleanup.util';
import { BrandingFileValidationError, validateBrandingFile } from '../branding/branding-file-validator';
import { connectPricingTimeline, findPricingTimelineNeighbors, lockPricingTimeline } from '../pricing/pricing-timeline';

@Injectable()
export class AdminCatalogService {
  constructor(
    @InjectRepository(ServiceCategory)
    private readonly categories: Repository<ServiceCategory>,
    @InjectRepository(Service) private readonly services: Repository<Service>,
    @InjectRepository(ServiceZonePricing)
    private readonly zonePricing: Repository<ServiceZonePricing>,
    @InjectRepository(ServiceLevelPricing)
    private readonly levelPricing: Repository<ServiceLevelPricing>,
    @InjectRepository(ServicePricingTierPricing)
    private readonly pricingTierPricing: Repository<ServicePricingTierPricing>,
    @InjectRepository(ServiceAddon)
    private readonly addons: Repository<ServiceAddon>,
    @InjectRepository(ServiceStandardData)
    private readonly standardData: Repository<ServiceStandardData>,
    @InjectRepository(ServiceProductivityActual)
    private readonly productivityActuals: Repository<ServiceProductivityActual>,
    @InjectRepository(TechnicianService)
    private readonly technicianServices: Repository<TechnicianService>,
    private readonly techniciansService: TechniciansService,
    private readonly auditLog: AuditLogService,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
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
    const existing = await this.categories.findOne({
      where: { slug: dto.slug },
    });
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
      coverImageUrl: dto.cover_image_url ?? null,
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

  /**
   * رفع صورة فئة (docs/08 §98، بلاغ مالك: «الصورة بتتحط فقط أثناء إنشاء الفئة… ما بقاش فيه
   * إمكانية إنك ترجع تعدل»).
   *
   * السبب الحقيقي للبلاغ: الحقول كانت **روابط نصية بس** — مفيش أي مكان في المنصة يرفع صورة فئة
   * ويطلّع رابط، فالأدمن عمليًا مقدرش يغيّرها بعد ما يتحطّ الرابط الأولاني. الرفع الفعلي هو اللي
   * بيقفل الفجوة، مش مجرد شاشة تعديل.
   *
   * **إعادة استخدام `validateBrandingFile()` بالحرف** (ADR-0014): MIME معلَن + magic bytes حقيقية
   * + تطابقهم + حجم + أبعاد، ومفيش SVG خالص (وعاء تنفيذ سكربت). صورة فئة بتتعرض لكل عملاء المنصة
   * زي البراندنج بالظبط، فمفيش سبب لمعايير أضعف — ولا لنسخة تانية من نفس المنطق.
   */
  async uploadCategoryMedia(
    adminUserId: string,
    id: string,
    slot: 'icon' | 'cover',
    file: { buffer: Buffer; mimetype: string; size: number },
    meta?: AuditActorMeta,
  ): Promise<ServiceCategory> {
    const category = await this.findCategoryOrThrow(id);
    try {
      validateBrandingFile(file.buffer, file.mimetype, file.size);
    } catch (err) {
      if (err instanceof BrandingFileValidationError) {
        throw new ApiException(ErrorCode.VAL_001, err.message, HttpStatus.BAD_REQUEST);
      }
      throw err;
    }

    const extension = file.mimetype === 'image/png' ? 'png' : file.mimetype === 'image/webp' ? 'webp' : 'jpg';
    const key = `service-categories/${id}/${slot}/${randomUUID()}.${extension}`;
    const previousUrl = slot === 'icon' ? category.iconUrl : category.coverImageUrl;

    // `fileUrl` جاي من `storage.save()` نفسها — نفس اللي كل مسارات الرفع التانية بتخزّنه، فمفيش
    // نداء `getUrl()` زيادة ولا احتمال إن الاتنين يختلفوا.
    const saved = await uploadWithOrphanCleanup(this.storage, key, file.buffer, file.mimetype, async (fileUrl) => {
      if (slot === 'icon') category.iconUrl = fileUrl;
      else category.coverImageUrl = fileUrl;
      return this.categories.save(category);
    });

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'service_category.media_uploaded',
      entityType: 'service_category',
      entityId: category.id,
      oldValues: { slot, url: previousUrl },
      newValues: {
        slot,
        url: slot === 'icon' ? saved.iconUrl : saved.coverImageUrl,
      },
      meta,
    });
    return saved;
  }

  /**
   * مسح صورة فئة (docs/08 §98) — كانت **مستحيلة** حتى مع شاشة التعديل الموجودة: الواجهة بتبعت
   * `undefined` للخانة الفاضية، و`JSON.stringify` بيشيل المفتاح خالص، فالـPATCH ما بيغيّرش حاجة.
   * endpoint صريح أوضح من الاعتماد على إن الواجهة تبعت `null` صح.
   */
  async clearCategoryMedia(adminUserId: string, id: string, slot: 'icon' | 'cover', meta?: AuditActorMeta): Promise<ServiceCategory> {
    const category = await this.findCategoryOrThrow(id);
    const previousUrl = slot === 'icon' ? category.iconUrl : category.coverImageUrl;
    if (slot === 'icon') category.iconUrl = null;
    else category.coverImageUrl = null;
    const saved = await this.categories.save(category);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'service_category.media_cleared',
      entityType: 'service_category',
      entityId: category.id,
      oldValues: { slot, url: previousUrl },
      newValues: { slot, url: null },
      meta,
    });
    return saved;
  }

  async updateCategory(adminUserId: string, id: string, dto: UpdateServiceCategoryDto, meta?: AuditActorMeta): Promise<ServiceCategory> {
    const category = await this.findCategoryOrThrow(id);
    const oldValues = {
      name_ar: category.nameAr,
      is_active: category.isActive,
    };

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
    if (dto.cover_image_url !== undefined) category.coverImageUrl = dto.cover_image_url;
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
    const servicesUsingIt = await this.services.count({
      where: { categoryId: id },
    });
    if (servicesUsingIt > 0) {
      throw new ApiException(ErrorCode.VAL_001, 'مينفعش تمسح فئة فيها خدمات — عطّلها أو انقل الخدمات الأول', HttpStatus.CONFLICT);
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

  // أوضاع التوقيت الأربعة (ADR-0032) — تحقق واضح على مستوى التطبيق قبل ما يوصل لـCHECK constraint
  // الخام على الـDB (chk_services_scheduling_mode_exclusive)، عشان الأدمن ياخد رسالة عربية مفهومة
  // بدل خطأ Postgres خام.
  private assertSchedulingModeExclusive(modes: {
    requiresPreciseSchedule: boolean;
    requiresStartTimeOnly: boolean;
    requiresHoursOnly: boolean;
    requiresStartAndEnd: boolean;
  }): void {
    const activeCount = [modes.requiresPreciseSchedule, modes.requiresStartTimeOnly, modes.requiresHoursOnly, modes.requiresStartAndEnd].filter(Boolean).length;
    if (activeCount > 1) {
      throw new ApiException(
        ErrorCode.VAL_001,
        'وضع توقيت واحد بس يقدر يكون فعّال لكل خدمة (دقة وقت / بداية بس / عدد ساعات بس / بداية ونهاية)',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private async findServiceOrThrow(id: string): Promise<Service> {
    const service = await this.services.findOne({ where: { id } });
    if (!service) {
      throw new ApiException(ErrorCode.VAL_001, 'الخدمة غير موجودة', HttpStatus.NOT_FOUND);
    }
    return service;
  }

  private assertQuantityConfiguration(config: {
    min: number | null;
    max: number | null;
    step: number | null;
  }): void {
    if (config.min !== null && config.max !== null && config.max < config.min) {
      throw new ApiException(
        ErrorCode.VAL_001,
        'أكبر كمية لازم تكون أكبر من أو تساوي أقل كمية',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  async createService(adminUserId: string, dto: CreateServiceDto, meta?: AuditActorMeta): Promise<Service> {
    await this.findCategoryOrThrow(dto.category_id);
    const existing = await this.services.findOne({ where: { slug: dto.slug } });
    if (existing) {
      throw new ApiException(ErrorCode.VAL_001, 'الـ slug ده مستخدم قبل كده', HttpStatus.CONFLICT);
    }
    // سياسة إيداع (ADR-0027) — deposit_percentage إجباري لو deposit_required=true، نفس القيد
    // المفروض على الـDB (migration 0164 CHECK) بس بترجع رسالة واضحة بدل خطأ DB خام.
    if (dto.deposit_required && dto.deposit_percentage === undefined) {
      throw new ApiException(ErrorCode.VAL_001, 'نسبة الإيداع مطلوبة لو الخدمة محتاجة إيداع', HttpStatus.BAD_REQUEST);
    }
    this.assertSchedulingModeExclusive({
      requiresPreciseSchedule: dto.requires_precise_schedule ?? false,
      requiresStartTimeOnly: dto.requires_start_time_only ?? false,
      requiresHoursOnly: dto.requires_hours_only ?? false,
      requiresStartAndEnd: dto.requires_start_and_end ?? false,
    });
    this.assertQuantityConfiguration({
      min: dto.quantity_min ?? null,
      max: dto.quantity_max ?? null,
      step: dto.quantity_step ?? null,
    });

    const service = this.services.create({
      categoryId: dto.category_id,
      nameAr: dto.name_ar,
      nameEn: dto.name_en ?? null,
      slug: dto.slug,
      shortDescriptionAr: dto.short_description_ar ?? null,
      fullDescriptionAr: dto.full_description_ar ?? null,
      iconUrl: dto.icon_url ?? null,
      featuredIconUrl: dto.featured_icon_url ?? null,
      featuredNameAr: dto.featured_name_ar ?? null,
      pricingModel: dto.pricing_model,
      basePriceCents: dto.base_price_cents,
      inspectionFeeCents: dto.inspection_fee_cents ?? 0,
      minPriceCents: dto.min_price_cents ?? null,
      maxPriceCents: dto.max_price_cents ?? null,
      unitNameAr: dto.unit_name_ar ?? null,
      quantityMin: dto.quantity_min == null ? null : String(dto.quantity_min),
      quantityMax: dto.quantity_max == null ? null : String(dto.quantity_max),
      quantityStep: dto.quantity_step == null ? null : String(dto.quantity_step),
      quantityPrecision: dto.quantity_precision ?? 2,
      estimatedDurationMinutes: dto.estimated_duration_minutes ?? null,
      warrantyDays: dto.warranty_days ?? 0,
      requiresPhotos: dto.requires_photos ?? false,
      allowsScheduling: dto.allows_scheduling ?? true,
      allowsEmergency: dto.allows_emergency ?? false,
      isPromotable: dto.is_promotable ?? false,
      allowsIndividual: dto.allows_individual ?? true,
      allowsTeam: dto.allows_team ?? false,
      cashAllowed: dto.cash_allowed ?? true,
      depositRequired: dto.deposit_required ?? false,
      depositPercentage: dto.deposit_percentage !== undefined ? String(dto.deposit_percentage) : null,
      allowsDateRangeBooking: dto.allows_date_range_booking ?? true,
      allowsRecurringBooking: dto.allows_recurring_booking ?? false,
      showUnavailableProviders: dto.show_unavailable_providers ?? false,
      requiresPreciseSchedule: dto.requires_precise_schedule ?? false,
      requiresStartTimeOnly: dto.requires_start_time_only ?? false,
      requiresHoursOnly: dto.requires_hours_only ?? false,
      requiresStartAndEnd: dto.requires_start_and_end ?? false,
      minTechnicianLevel: dto.min_technician_level,
      displayOrder: dto.display_order ?? 0,
      launchPhase: dto.launch_phase ?? 1,
      searchKeywords: dto.search_keywords ?? [],
    });
    await this.services.save(service);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'service.created',
      entityType: 'service',
      entityId: service.id,
      newValues: {
        name_ar: service.nameAr,
        slug: service.slug,
        base_price_cents: service.basePriceCents,
      },
      meta,
    });
    return service;
  }

  async updateService(adminUserId: string, id: string, dto: UpdateServiceDto, meta?: AuditActorMeta): Promise<Service> {
    const service = await this.findServiceOrThrow(id);
    const oldValues = {
      base_price_cents: service.basePriceCents,
      is_active: service.isActive,
    };

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
    if (dto.featured_icon_url !== undefined) service.featuredIconUrl = dto.featured_icon_url;
    if (dto.featured_name_ar !== undefined) service.featuredNameAr = dto.featured_name_ar;
    if (dto.pricing_model !== undefined) service.pricingModel = dto.pricing_model;
    if (dto.base_price_cents !== undefined) service.basePriceCents = dto.base_price_cents;
    if (dto.inspection_fee_cents !== undefined) service.inspectionFeeCents = dto.inspection_fee_cents;
    if (dto.min_price_cents !== undefined) service.minPriceCents = dto.min_price_cents;
    if (dto.max_price_cents !== undefined) service.maxPriceCents = dto.max_price_cents;
    if (dto.unit_name_ar !== undefined) service.unitNameAr = dto.unit_name_ar;
    if (dto.quantity_min !== undefined) service.quantityMin = dto.quantity_min === null ? null : String(dto.quantity_min);
    if (dto.quantity_max !== undefined) service.quantityMax = dto.quantity_max === null ? null : String(dto.quantity_max);
    if (dto.quantity_step !== undefined) service.quantityStep = dto.quantity_step === null ? null : String(dto.quantity_step);
    if (dto.quantity_precision !== undefined) service.quantityPrecision = dto.quantity_precision;
    if (dto.estimated_duration_minutes !== undefined) service.estimatedDurationMinutes = dto.estimated_duration_minutes;
    if (dto.warranty_days !== undefined) service.warrantyDays = dto.warranty_days;
    if (dto.requires_photos !== undefined) service.requiresPhotos = dto.requires_photos;
    if (dto.allows_scheduling !== undefined) service.allowsScheduling = dto.allows_scheduling;
    if (dto.allows_emergency !== undefined) service.allowsEmergency = dto.allows_emergency;
    if (dto.is_promotable !== undefined) service.isPromotable = dto.is_promotable;
    if (dto.allows_individual !== undefined) service.allowsIndividual = dto.allows_individual;
    if (dto.allows_team !== undefined) service.allowsTeam = dto.allows_team;
    if (dto.cash_allowed !== undefined) service.cashAllowed = dto.cash_allowed;
    // سياسة إيداع (ADR-0027) — لو الأدمن قفل deposit_required صراحة، نمسح النسبة القديمة (مفيش
    // معنى لنسبة إيداع محفوظة لخدمة مبقتش محتاجة إيداع). نفس القيد على الإنشاء: مينفعش
    // deposit_required=true بدون نسبة، سواء الجاية دلوقتي أو المحفوظة أصلاً.
    if (dto.deposit_percentage !== undefined) service.depositPercentage = String(dto.deposit_percentage);
    if (dto.deposit_required !== undefined) {
      service.depositRequired = dto.deposit_required;
      if (!dto.deposit_required && dto.deposit_percentage === undefined) service.depositPercentage = null;
    }
    if (service.depositRequired && service.depositPercentage === null) {
      throw new ApiException(ErrorCode.VAL_001, 'نسبة الإيداع مطلوبة لو الخدمة محتاجة إيداع', HttpStatus.BAD_REQUEST);
    }
    if (dto.allows_date_range_booking !== undefined) service.allowsDateRangeBooking = dto.allows_date_range_booking;
    if (dto.allows_recurring_booking !== undefined) service.allowsRecurringBooking = dto.allows_recurring_booking;
    if (dto.show_unavailable_providers !== undefined) service.showUnavailableProviders = dto.show_unavailable_providers;
    if (dto.requires_precise_schedule !== undefined) service.requiresPreciseSchedule = dto.requires_precise_schedule;
    if (dto.requires_start_time_only !== undefined) service.requiresStartTimeOnly = dto.requires_start_time_only;
    if (dto.requires_hours_only !== undefined) service.requiresHoursOnly = dto.requires_hours_only;
    if (dto.requires_start_and_end !== undefined) service.requiresStartAndEnd = dto.requires_start_and_end;
    this.assertSchedulingModeExclusive({
      requiresPreciseSchedule: service.requiresPreciseSchedule,
      requiresStartTimeOnly: service.requiresStartTimeOnly,
      requiresHoursOnly: service.requiresHoursOnly,
      requiresStartAndEnd: service.requiresStartAndEnd,
    });
    this.assertQuantityConfiguration({
      min: service.quantityMin === null ? null : Number(service.quantityMin),
      max: service.quantityMax === null ? null : Number(service.quantityMax),
      step: service.quantityStep === null ? null : Number(service.quantityStep),
    });
    if (dto.min_technician_level !== undefined) service.minTechnicianLevel = dto.min_technician_level;
    if (dto.display_order !== undefined) service.displayOrder = dto.display_order;
    if (dto.launch_phase !== undefined) service.launchPhase = dto.launch_phase;
    if (dto.search_keywords !== undefined) service.searchKeywords = dto.search_keywords;
    if (dto.is_active !== undefined) service.isActive = dto.is_active;
    await this.services.save(service);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'service.updated',
      entityType: 'service',
      entityId: service.id,
      oldValues,
      newValues: {
        base_price_cents: service.basePriceCents,
        is_active: service.isActive,
      },
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
    return this.zonePricing.find({
      where: { serviceId },
      order: { createdAt: 'DESC' },
    });
  }

  // تاريخ سريان (docs/06 §3.10، docs/07 الجزء د) — تعديل بأثر فوري (valid_from غير مبعوت أو
  // <= الآن) بيعدّل الصف الساري حالياً في مكانه (upsert زي زمان). جدولة سعر مستقبلي (valid_from
  // في المستقبل) بتقفل الصف الساري الحالي عند نفس اللحظة (valid_until) وتفتح صف جديد منفصل —
  // الاتنين يتحفظوا كتاريخ، مش بيتكتب فوق بعضه.
  async upsertZonePricing(adminUserId: string, serviceId: string, dto: UpsertZonePricingDto, meta?: AuditActorMeta): Promise<ServiceZonePricing> {
    const service = await this.findServiceOrThrow(serviceId);
    const now = new Date();
    const validFrom = dto.valid_from ? new Date(dto.valid_from) : now;
    const isFutureScheduling = validFrom.getTime() > now.getTime();

    // docs/08 §36.22-23، ADR-0024 — بالظبط واحد من price_cents/modifier_percentage مطلوب حسب
    // الوضع (نفس فرض الداتابيز، بس هنا برسالة عربية واضحة للأدمن قبل ما يوصل لخطأ constraint خام).
    const mode = dto.pricing_mode ?? ZonePricingMode.OVERRIDE;
    if (
      mode === ZonePricingMode.OVERRIDE &&
      (service.pricingModel === PricingModel.FORMULA || service.pricingModel === PricingModel.INSPECTION_THEN_QUOTE)
    ) {
      throw new ApiException(
        ErrorCode.VAL_001,
        'الاستبدال المطلق غير واضح لهذا النوع من التسعير — استخدم تعديلًا بالنسبة المئوية',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (mode === ZonePricingMode.OVERRIDE && dto.price_cents === undefined) {
      throw new ApiException(ErrorCode.VAL_001, 'وضع الاستبدال الثابت محتاج price_cents', HttpStatus.BAD_REQUEST);
    }
    if (mode === ZonePricingMode.PERCENTAGE && dto.modifier_percentage === undefined) {
      throw new ApiException(ErrorCode.VAL_001, 'وضع المُعدِّل النسبي محتاج modifier_percentage', HttpStatus.BAD_REQUEST);
    }

    const { pricing, isNew } = await this.zonePricing.manager.transaction(async (manager) => {
      await lockPricingTimeline(manager, `zone-pricing:${serviceId}:${dto.service_zone_id}`);
      const repository = manager.getRepository(ServiceZonePricing);
      const timeline = await repository
        .createQueryBuilder('p')
        .where('p.service_id = :serviceId', { serviceId })
        .andWhere('p.service_zone_id = :serviceZoneId', { serviceZoneId: dto.service_zone_id })
        .andWhere('p.is_active = true')
        .orderBy('p.valid_from', 'ASC')
        .getMany();
      const current = [...timeline]
        .reverse()
        .find((entry) => entry.validFrom <= now && (!entry.validUntil || entry.validUntil > now)) ?? null;

      let nextPricing: ServiceZonePricing;
      let created = false;
      if (!isFutureScheduling && current) {
        nextPricing = current;
      } else {
        const neighbors = findPricingTimelineNeighbors(timeline, validFrom);
        const validUntil = connectPricingTimeline(neighbors, validFrom);
        if (neighbors.predecessor) await repository.save(neighbors.predecessor);
        nextPricing = neighbors.exact ?? repository.create({
          serviceId,
          serviceZoneId: dto.service_zone_id,
          validFrom,
          validUntil,
        });
        nextPricing.validUntil = validUntil;
        created = neighbors.exact === null;
      }

      if (mode === ZonePricingMode.OVERRIDE) {
        nextPricing.pricingMode = ZonePricingMode.OVERRIDE;
        nextPricing.priceCents = dto.price_cents!;
        nextPricing.modifierPercentage = null;
      } else {
        nextPricing.pricingMode = ZonePricingMode.PERCENTAGE;
        nextPricing.modifierPercentage = String(dto.modifier_percentage);
        nextPricing.priceCents = null;
        // A percentage row must not retain a hidden legacy multiplier.
        nextPricing.surgeMultiplier = '1';
      }
      if (dto.inspection_fee_cents !== undefined) nextPricing.inspectionFeeCents = dto.inspection_fee_cents;
      if (mode === ZonePricingMode.OVERRIDE && dto.surge_multiplier !== undefined) {
        nextPricing.surgeMultiplier = String(dto.surge_multiplier);
      }
      return { pricing: await repository.save(nextPricing), isNew: created };
    });

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: isNew ? 'service_zone_pricing.created' : 'service_zone_pricing.updated',
      entityType: 'service_zone_pricing',
      entityId: pricing.id,
      newValues: {
        pricing_mode: pricing.pricingMode,
        price_cents: pricing.priceCents,
        modifier_percentage: pricing.modifierPercentage,
        service_zone_id: pricing.serviceZoneId,
        valid_from: pricing.validFrom,
      },
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

  // ── الفنيين المؤهلين (قديم — خدمة-بخدمة، مش المصدر الحقيقي للأهلية) ────
  // §29 (طلب مالك صريح 2026-08-20): المسار المعتمد لأهلية الفني بقى الفئة/التخصص
  // (technician_categories، راجع technicians/technician-categories.service.ts + كارت
  // "التخصصات" في apps/admin's /technicians/[id]). الدوال التلاتة دي بتقرا/تكتب technician_services
  // مباشرة **بس** — فني معتمد بالفئة فقط (بلا صف technician_services مباشر لنفس الخدمة) مش هيظهر
  // هنا خالص، رغم إنه فعليًا مؤهّل وهيتوزّعله الطلب حقيقةً (matching.service.ts's findEligibleTechnicians
  // بيطبّق شرط "OR فئة معتمدة"، مش الاستعلام ده). **بَقّة حقيقية اتلقطت من بلاغ المالك المباشر
  // (2026-08-20)**: كارت أدمن قديم في /catalog/services/:id كان بيعرض النتيجة الضيّقة دي كـ"الفنيين
  // المؤهلين" بلا أي إشارة إنها مش المصدر الحقيقي — الأدمن يضيف فئة لفني، يفتح صفحة الخدمة، يلاقي
  // "مفيش فنيين مؤهلين"، ويفتكر إن الفئة مش شغالة رغم إنها شغالة فعليًا. الكارت اتشال من apps/admin
  // (راجع docs/08 §30) — الدوال دي فاضلة هنا بس عمدًا (زي technician_services نفسها) عشان استخدام
  // نادر عبر API مباشر لو احتاجه حد، **مش لعرضها كمصدر أهلية تاني في أي واجهة جديدة**. المصدر
  // الحقيقي الوحيد للأهلية: technicians.service.ts's listForServiceBooking() (العميل + إعادة تعيين
  // الأدمن) وmatching.service.ts's findEligibleTechnicians() (التوزيع الفعلي).

  listEligibleTechnicians(serviceId: string): Promise<TechnicianService[]> {
    return this.technicianServices.find({
      where: { serviceId },
      order: { createdAt: 'DESC' },
    });
  }

  async assignTechnician(adminUserId: string, serviceId: string, dto: AssignTechnicianServiceDto, meta?: AuditActorMeta): Promise<TechnicianService> {
    await this.findServiceOrThrow(serviceId);
    await this.techniciansService.findByProfileIdOrThrow(dto.technician_id);

    const existing = await this.technicianServices.findOne({
      where: { serviceId, technicianId: dto.technician_id },
    });
    // تعيين مباشر من الأدمن = اعتماد فوري (نفس السلوك التاريخي، صفر تغيير على المسار ده). لو
    // الفني كان له تصريح ذاتي معلّق/مرفوض/موقوف لنفس الخدمة (Script 4 §2-7)، الأدمن يقدر
    // يعتمده مباشرة من هنا بدل ما يوصله لطريق مسدود — نفس الصف بيترقّى، مش تكرار.
    if (existing) {
      if (existing.verificationStatus === TechnicianServiceVerificationStatus.APPROVED) {
        throw new ApiException(ErrorCode.VAL_001, 'الفني ده متأهّل للخدمة دي بالفعل', HttpStatus.CONFLICT);
      }
      const previousStatus = existing.verificationStatus;
      if (dto.skill_level) existing.skillLevel = dto.skill_level;
      existing.verificationStatus = TechnicianServiceVerificationStatus.APPROVED;
      existing.isActive = true;
      existing.rejectionReason = null;
      existing.reviewedByUserId = adminUserId;
      existing.reviewedAt = new Date();
      await this.technicianServices.save(existing);

      await this.auditLog.record({
        actorUserId: adminUserId,
        actorRole: 'admin',
        action: 'technician_service.assigned',
        entityType: 'service',
        entityId: serviceId,
        oldValues: {
          technician_id: dto.technician_id,
          verification_status: previousStatus,
        },
        newValues: {
          technician_id: dto.technician_id,
          skill_level: existing.skillLevel,
          verification_status: existing.verificationStatus,
        },
        meta,
      });
      return existing;
    }

    const assignment = this.technicianServices.create({
      serviceId,
      technicianId: dto.technician_id,
      skillLevel: dto.skill_level,
      verificationStatus: TechnicianServiceVerificationStatus.APPROVED,
      isActive: true,
      isSelfDeclared: false,
      reviewedByUserId: adminUserId,
      reviewedAt: new Date(),
    });
    await this.technicianServices.save(assignment);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'technician_service.assigned',
      entityType: 'service',
      entityId: serviceId,
      newValues: {
        technician_id: dto.technician_id,
        skill_level: assignment.skillLevel,
      },
      meta,
    });
    return assignment;
  }

  async removeTechnician(adminUserId: string, serviceId: string, technicianId: string, meta?: AuditActorMeta): Promise<void> {
    const result = await this.technicianServices.delete({
      serviceId,
      technicianId,
    });
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
    return this.levelPricing.find({
      where: { serviceId },
      order: { technicianLevel: 'ASC' },
    });
  }

  async upsertLevelPricing(adminUserId: string, serviceId: string, dto: UpsertLevelPricingDto, meta?: AuditActorMeta): Promise<ServiceLevelPricing> {
    await this.findServiceOrThrow(serviceId);

    let pricing = await this.levelPricing.findOne({
      where: { serviceId, technicianLevel: dto.technician_level },
    });
    const isNew = !pricing;
    if (!pricing) {
      pricing = this.levelPricing.create({
        serviceId,
        technicianLevel: dto.technician_level,
      });
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
      newValues: {
        technician_level: pricing.technicianLevel,
        price_multiplier: pricing.priceMultiplier,
      },
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

  // ── فئة تسعير الفني (docs/08 §36.24، ADR-0025) — منفصلة عن تسعير المستوى فوق ───────────

  listPricingTierPricing(serviceId: string): Promise<ServicePricingTierPricing[]> {
    return this.pricingTierPricing.find({
      where: { serviceId },
      order: { pricingTier: 'ASC' },
    });
  }

  async upsertPricingTierPricing(
    adminUserId: string,
    serviceId: string,
    dto: UpsertPricingTierPricingDto,
    meta?: AuditActorMeta,
  ): Promise<ServicePricingTierPricing> {
    await this.findServiceOrThrow(serviceId);

    let pricing = await this.pricingTierPricing.findOne({
      where: { serviceId, pricingTier: dto.pricing_tier },
    });
    const isNew = !pricing;
    if (!pricing) {
      pricing = this.pricingTierPricing.create({
        serviceId,
        pricingTier: dto.pricing_tier,
      });
    }
    pricing.priceMultiplier = String(dto.price_multiplier);
    pricing.isActive = true;
    await this.pricingTierPricing.save(pricing);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: isNew ? 'service_pricing_tier_pricing.created' : 'service_pricing_tier_pricing.updated',
      entityType: 'service_pricing_tier_pricing',
      entityId: pricing.id,
      newValues: {
        pricing_tier: pricing.pricingTier,
        price_multiplier: pricing.priceMultiplier,
      },
      meta,
    });
    return pricing;
  }

  async deactivatePricingTierPricing(adminUserId: string, id: string, meta?: AuditActorMeta): Promise<void> {
    const pricing = await this.pricingTierPricing.findOne({ where: { id } });
    if (!pricing) {
      throw new ApiException(ErrorCode.VAL_001, 'تسعير فئة الفني غير موجود', HttpStatus.NOT_FOUND);
    }
    pricing.isActive = false;
    await this.pricingTierPricing.save(pricing);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'service_pricing_tier_pricing.deactivated',
      entityType: 'service_pricing_tier_pricing',
      entityId: pricing.id,
      meta,
    });
  }

  // ── الإضافات الاختيارية ──────────────────────────────────────────────

  listAddons(serviceId: string): Promise<ServiceAddon[]> {
    return this.addons.find({
      where: { serviceId },
      order: { displayOrder: 'ASC' },
    });
  }

  async createAddon(adminUserId: string, serviceId: string, dto: CreateServiceAddonDto, meta?: AuditActorMeta): Promise<ServiceAddon> {
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

  async updateAddon(adminUserId: string, id: string, dto: UpdateServiceAddonDto, meta?: AuditActorMeta): Promise<ServiceAddon> {
    const addon = await this.findAddonOrThrow(id);
    const oldValues = {
      name_ar: addon.nameAr,
      price_cents: addon.priceCents,
      is_active: addon.isActive,
    };

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
      newValues: {
        name_ar: addon.nameAr,
        price_cents: addon.priceCents,
        is_active: addon.isActive,
      },
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
    return this.standardData.find({
      where: { serviceId },
      order: { displayOrder: 'ASC' },
    });
  }

  async createStandardData(adminUserId: string, serviceId: string, dto: CreateServiceStandardDataDto, meta?: AuditActorMeta): Promise<ServiceStandardData> {
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
      newValues: {
        execution_type_ar: row.executionTypeAr,
        productivity_per_day: row.productivityPerDay,
      },
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

  async updateStandardData(adminUserId: string, id: string, dto: UpdateServiceStandardDataDto, meta?: AuditActorMeta): Promise<ServiceStandardData> {
    const row = await this.findStandardDataOrThrow(id);
    const oldValues = {
      productivity_per_day: row.productivityPerDay,
      is_active: row.isActive,
    };

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
      newValues: {
        productivity_per_day: row.productivityPerDay,
        is_active: row.isActive,
      },
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
