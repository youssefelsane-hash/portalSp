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
    return this.catalogService.estimate(id, query.zone_id, query.technician_level);
  }

  @Public()
  @Get('services/:id/addons')
  async listAddons(@Param('id', ParseUUIDPipe) id: string) {
    const addons = await this.catalogService.findAddons(id);
    return addons.map(toServiceAddonResponseDto);
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
  @Public()
  @Get('services/:id/technicians')
  async listTechniciansForService(@Param('id', ParseUUIDPipe) id: string, @Query() query: ListTechniciansForServiceDto) {
    const items = await this.techniciansService.listForServiceBooking(id, query.address_id);
    return items.map(toTechnicianBookingListItemResponseDto);
  }
}
