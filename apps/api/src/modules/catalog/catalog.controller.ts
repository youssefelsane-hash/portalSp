import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { resolveAvatarUrl } from '../../common/storage/resolve-avatar-url';
import { STORAGE_SERVICE, StorageService } from '../../common/storage/storage.service';
import { toTechnicianBookingListItemResponseDto } from '../technicians/dto/technician-booking-list-response.dto';
import { TechniciansService } from '../technicians/technicians.service';
import { CatalogService } from './catalog.service';
import { toServiceAddonResponseDto } from './dto/admin-catalog-response.dto';
import { EstimateDurationDto } from './dto/estimate-duration.dto';
import { EstimateQueryDto, ListServicesDto, SearchServicesDto } from './dto/list-services.dto';
import { ListTechniciansForServiceDto } from './dto/list-technicians-for-service.dto';
import { toServiceCategoryResponseDto, toServiceResponseDto } from './dto/service-response.dto';
import { PricingModel } from './entities/service.entity';
import { toStandardDataResponseDto } from './dto/standard-data-response.dto';

@Controller()
export class CatalogController {
  constructor(
    private readonly catalogService: CatalogService,
    private readonly techniciansService: TechniciansService,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
  ) {}

  @Public()
  @Get('service-categories')
  async listCategories() {
    const categories = await this.catalogService.findActiveCategories();
    return categories.map(toServiceCategoryResponseDto);
  }

  @Public()
  @Get('services')
  async listServices(@Query() query: ListServicesDto) {
    const services = await this.catalogService.findServices(query.category_id, query.booking_mode);
    return services.map(toServiceResponseDto);
  }

  // Script 3 §7/§12 — لازم تتسجّل قبل services/:id (وإلا "search" هتتفسّر كـid وترفض بـUUID
  // parse error). بحث بلغة طبيعية بسيطة (aliases/substring) — راجع catalogService.searchServices().
  @Public()
  @Get('services/search')
  async searchServices(@Query() query: SearchServicesDto) {
    const services = await this.catalogService.searchServices(query.q);
    return services.map(toServiceResponseDto);
  }

  @Public()
  @Get('services/:id')
  async getService(@Param('id', ParseUUIDPipe) id: string) {
    return toServiceResponseDto(await this.catalogService.findServiceOrThrow(id));
  }

  @Public()
  @Post('services/:id/estimate')
  async estimate(@Param('id', ParseUUIDPipe) id: string, @Query() query: EstimateQueryDto) {
    return this.catalogService.estimate(
      id,
      query.zone_id,
      query.technician_level,
      query.booking_mode === 'emergency',
      query.field_values,
      query.pricing_tier,
      query.duration_hours,
    );
  }

  @Public()
  @Get('services/:id/addons')
  async listAddons(@Param('id', ParseUUIDPipe) id: string) {
    const addons = await this.catalogService.findAddons(id);
    return addons.map(toServiceAddonResponseDto);
  }

  // محرك الإنتاجية (docs/06 §3.1-§3.6) — كانت فجوة موثّقة صراحة: estimate-duration تحت محتاجة
  // standard_data_id، بس مفيش endpoint عام يخلي العميل يعرف الـid ده أصلاً. اتقفلت.
  @Public()
  @Get('services/:id/standard-data')
  async listStandardData(@Param('id', ParseUUIDPipe) id: string) {
    const rows = await this.catalogService.findStandardDataForService(id);
    return rows.map(toStandardDataResponseDto);
  }

  // محرك الإنتاجية (docs/06 §3.3-§3.5) — المدة المتوقعة بس، **من غير أي تكلفة داخلية** (§3.6
  // صريح إنها مش المفروض تتعرض للعميل). standard_data_id لازم يبقى بتاع نفس الخدمة (:id) —
  // بيترفض 404 واضح لو مش كده، مش بس افتراض ضمني.
  @Public()
  @Post('services/:id/estimate-duration')
  async estimateDuration(@Param('id', ParseUUIDPipe) id: string, @Body() dto: EstimateDurationDto) {
    const result = await this.catalogService.estimateDuration(
      id,
      dto.standard_data_id,
      dto.requested_units,
      dto.assigned_technicians,
      dto.assigned_assistants,
    );
    return {
      estimated_days: result.estimated_days,
      unit_ar: result.unit_ar,
      execution_type_ar: result.execution_type_ar,
      assigned_technicians: result.assigned_technicians,
      assigned_assistants: result.assigned_assistants,
    };
  }

  // اختيار الفني قبل الحجز (docs/08 §3) — بدل ما العميل يسيب auto-match بس، يشوف قايمة فنيين
  // حقيقية مؤهلين للخدمة دي في منطقته، مرتبة بالتقييم ثم القرب الجغرافي ثم عدد الطلبات المكتملة.
  // مضاعف سعر مستوى الفني (docs/08 — "السعر النهائي معروف قبل التأكيد، مفيش زيادة مفاجئة بعده")
  // — كل فني مرشّح بيرجع رتبته والسعر النهائي المحسوب فعليًا بمستواه هو، مش رقم عام واحد. بيستخدم
  // نفس CatalogService.estimate() اللي POST /orders هتستخدمه بالحرف لو العميل اختار الفني ده —
  // مفيش محرك تسعير تاني مكرر.
  @Public()
  @Get('services/:id/technicians')
  async listTechniciansForService(@Param('id', ParseUUIDPipe) id: string, @Query() query: ListTechniciansForServiceDto) {
    const { zoneId, items } = await this.techniciansService.listForServiceBooking(
      id,
      query.address_id,
      query.exclude_technician_id,
      query.scheduled_at ? new Date(query.scheduled_at) : null,
      query.booking_mode === 'team',
    );
    // ADR-0031 — avatar_storage_key (لو موجود) هو المصدر المعتمد، بيتفك لرابط طازة هنا قبل الرد
    // (presigned S3 URLs بتنتهي، مش نستخدم avatarUrl الخام مباشرة). صفر أثر لو مفيش صور معتمدة أصلاً.
    await Promise.all(
      items.map(async (item) => {
        item.avatarUrl = await resolveAvatarUrl(this.storage, item.avatarUrl, item.avatarStorageKey);
      }),
    );
    const service = await this.catalogService.findServiceOrThrow(id);
    const isEmergency = query.booking_mode === 'emergency';
    // خدمات formula محتاجة field_values عشان estimate() تقدر تحسب سعر أصلاً (المعادلة نفسها
    // بتحتاج مدخلات الفورم الديناميكي) — لو العميل ملاها بالفعل قبل الوصول لشاشة اختيار الفني
    // (field_values اتبعتت)، بقى نقدر نحسب final_price_cents حقيقي لكل فني حسب مستواه بالظبط
    // زي باقي نماذج التسعير (كانت فجوة موثّقة صراحة، اتقفلت مع bug مضاعف مستوى الفني نفسه في
    // catalogService.estimate()'s FORMULA branch). لو لسه مالهاش field_values، بترجع null صراحة
    // بدل ما ترفض الطلب كله بـVAL_001 لأي حقل formula إجباري.
    const withPricing =
      service.pricingModel === PricingModel.FORMULA && !query.field_values
        ? items.map((item) => ({ item, estimate: null }))
        : await Promise.all(
            items.map(async (item) => {
              // الشركات (docs/08 §62.2) — السعر بيتحسب زي أي مرشّح تاني، بس **بمضاعف مستوى = 1**.
              // ده مش تقريب ولا تخمين: `OrdersService.create()` لما بيتبعتله requested_technician_
              // company_id بيسيب knownTechnicianLevel = undefined (مفيش فني محدد بعد)، يعني بيسعّر
              // بالأساس بالظبط. فالرقم اللي بيتعرض هنا هو حرفيًا اللي هيتحصّل.
              //
              // كان راجع null قبل كده بحجة "مفيش فني محدد" — والنتيجة إن العميل يشوف شركة من غير
              // أي سعر ويعدّيها. حارس فرق المستوى في LevelPremiumService بيستثني حجوزات الشركات
              // عشان الوعد ده يفضل صحيح بعد التوزيع كمان.
              const estimate = await this.catalogService.estimate(
                id,
                zoneId,
                item.isCompany ? undefined : item.currentLevel,
                isEmergency,
                query.field_values,
                item.isCompany ? undefined : item.pricingTier,
                query.duration_hours,
                undefined,
                // ADR-0042 — الشركة بتتسعّر بمعاملها هي بدل مضاعف المستوى (اللي مالوش معنى هنا).
                item.isCompany ? item.companyPriceMultiplier : undefined,
              );
              return { item, estimate };
            }),
          );
    // فرز يدوي بسيط (Script 6 Part 8) — منفصل عمداً عن ترتيب "الأنسب" الافتراضي (recommended،
    // من listForServiceBooking نفسها بمحرك التوصية بالمرحلتين). لما العميل يختار فرز صريح،
    // بيعيد ترتيب نفس القايمة المؤهلة (المرحلة 1 لسه سارية) — مش استعلام جديد.
    const sorted = [...withPricing];
    if (query.sort === 'lowest_price') {
      // نفس صيغة toTechnicianBookingListItemResponseDto's final_price_cents بالحرف — مصدر
      // الحقيقة الوحيد لـ"السعر النهائي"، مش رقم تاني بيتحسب من جديد هنا.
      const finalPriceOf = (estimate: (typeof withPricing)[number]['estimate']) =>
        estimate ? estimate.estimated_total_cents + estimate.inspection_fee_cents + estimate.emergency_surcharge_cents : Number.POSITIVE_INFINITY;
      sorted.sort((a, b) => finalPriceOf(a.estimate) - finalPriceOf(b.estimate));
    } else if (query.sort === 'highest_rating') {
      sorted.sort((a, b) => b.item.averageRating - a.item.averageRating);
    }

    return sorted.map(({ item, estimate }) => toTechnicianBookingListItemResponseDto(item, estimate));
  }
}
