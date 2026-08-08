import { Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { CatalogService } from './catalog.service';
import { toServiceAddonResponseDto } from './dto/admin-catalog-response.dto';
import { EstimateQueryDto, ListServicesDto } from './dto/list-services.dto';
import { toServiceCategoryResponseDto, toServiceResponseDto } from './dto/service-response.dto';

@Controller()
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Public()
  @Get('service-categories')
  async listCategories() {
    const categories = await this.catalogService.findActiveCategories();
    return categories.map(toServiceCategoryResponseDto);
  }

  @Public()
  @Get('services')
  async listServices(@Query() query: ListServicesDto) {
    const services = await this.catalogService.findServices(query.category_id);
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
}
