import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { toTechnicianBookingListItemResponseDto } from '../technicians/dto/technician-booking-list-response.dto';
import { TechniciansService } from '../technicians/technicians.service';
import { CatalogService } from './catalog.service';
import { toServiceAddonResponseDto } from './dto/admin-catalog-response.dto';
import { EstimateDurationDto } from './dto/estimate-duration.dto';
import { EstimateQueryDto, ListServicesDto } from './dto/list-services.dto';
import { ListTechniciansForServiceDto } from './dto/list-technicians-for-service.dto';
import { toServiceCategoryResponseDto, toServiceResponseDto } from './dto/service-response.dto';
import { PricingModel } from './entities/service.entity';
import { toStandardDataResponseDto } from './dto/standard-data-response.dto';

@Controller()
export class CatalogController {
  constructor(
    private readonly catalogService: CatalogService,
    private readonly techniciansService: TechniciansService,
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
    );
    const service = await this.catalogService.findServiceOrThrow(id);
    const isEmergency = query.booking_mode === 'emergency';
    // خدمات formula بيتجاهل مستوى الفني تمامًا (level_price_multiplier ثابت 1 دايمًا في
    // catalogService.estimate()'s FORMULA branch) وبتحتاج field_values مش متاحة هنا (فورم
    // ديناميكي، مش جزء من الفلترة/الاختيار قبل الحجز) — استدعاء estimate() هنا كان هيرفض بـ
    // VAL_001 لأي حقل formula إجباري. final_price_cents = null صراحة لخدمات formula.
    const withPricing =
      service.pricingModel === PricingModel.FORMULA
        ? items.map((item) => ({ item, estimate: null }))
        : await Promise.all(
            items.map(async (item) => {
              const estimate = await this.catalogService.estimate(id, zoneId, item.currentLevel, isEmergency);
              return { item, estimate };
            }),
          );
    return withPricing.map(({ item, estimate }) => toTechnicianBookingListItemResponseDto(item, estimate));
  }
}
