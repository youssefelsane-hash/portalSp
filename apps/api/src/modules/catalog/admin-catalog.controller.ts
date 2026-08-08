import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { AuditContext, AuditMeta } from '../../common/decorators/audit-meta.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { AdminCatalogService } from './admin-catalog.service';
import {
  toAdminServiceCategoryResponseDto,
  toAdminServiceResponseDto,
  toServiceAddonResponseDto,
  toServiceLevelPricingResponseDto,
} from './dto/admin-catalog-response.dto';
import { AssignTechnicianServiceDto } from './dto/assign-technician-service.dto';
import { CreateServiceAddonDto } from './dto/create-service-addon.dto';
import { CreateServiceCategoryDto } from './dto/create-service-category.dto';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceAddonDto } from './dto/update-service-addon.dto';
import { UpdateServiceCategoryDto } from './dto/update-service-category.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { UpsertLevelPricingDto } from './dto/upsert-level-pricing.dto';
import { UpsertZonePricingDto } from './dto/upsert-zone-pricing.dto';

@Controller('admin')
@Roles(UserType.ADMIN)
export class AdminCatalogController {
  constructor(private readonly adminCatalogService: AdminCatalogService) {}

  // ── الفئات ───────────────────────────────────────────────────────────

  @Get('service-categories')
  async listCategories() {
    const categories = await this.adminCatalogService.listAllCategories();
    return categories.map(toAdminServiceCategoryResponseDto);
  }

  @Post('service-categories')
  @RequirePermission('catalog.manage')
  async createCategory(
    @CurrentUser() admin: JwtPayload,
    @Body() dto: CreateServiceCategoryDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return toAdminServiceCategoryResponseDto(await this.adminCatalogService.createCategory(admin.sub, dto, audit));
  }

  @Patch('service-categories/:id')
  @RequirePermission('catalog.manage')
  async updateCategory(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceCategoryDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return toAdminServiceCategoryResponseDto(await this.adminCatalogService.updateCategory(admin.sub, id, dto, audit));
  }

  @Delete('service-categories/:id')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('catalog.manage')
  async deleteCategory(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @AuditContext() audit: AuditMeta,
  ) {
    await this.adminCatalogService.deleteCategory(admin.sub, id, audit);
    return { id, deleted: true };
  }

  // ── الخدمات ──────────────────────────────────────────────────────────

  @Get('services')
  async listServices(@Query('category_id') categoryId?: string) {
    const services = await this.adminCatalogService.listAllServices(categoryId);
    return services.map(toAdminServiceResponseDto);
  }

  @Post('services')
  @RequirePermission('catalog.manage')
  async createService(@CurrentUser() admin: JwtPayload, @Body() dto: CreateServiceDto, @AuditContext() audit: AuditMeta) {
    return toAdminServiceResponseDto(await this.adminCatalogService.createService(admin.sub, dto, audit));
  }

  @Patch('services/:id')
  @RequirePermission('catalog.manage')
  async updateService(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return toAdminServiceResponseDto(await this.adminCatalogService.updateService(admin.sub, id, dto, audit));
  }

  @Delete('services/:id')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('catalog.manage')
  async deleteService(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @AuditContext() audit: AuditMeta,
  ) {
    await this.adminCatalogService.deleteService(admin.sub, id, audit);
    return { id, deleted: true };
  }

  // ── تسعير حسب المنطقة ───────────────────────────────────────────────

  @Get('services/:id/zone-pricing')
  listZonePricing(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminCatalogService.listZonePricing(id);
  }

  @Put('services/:id/zone-pricing')
  @RequirePermission('catalog.manage')
  upsertZonePricing(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertZonePricingDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return this.adminCatalogService.upsertZonePricing(admin.sub, id, dto, audit);
  }

  @Delete('services/zone-pricing/:pricingId')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('catalog.manage')
  async deactivateZonePricing(
    @CurrentUser() admin: JwtPayload,
    @Param('pricingId', ParseUUIDPipe) pricingId: string,
    @AuditContext() audit: AuditMeta,
  ) {
    await this.adminCatalogService.deactivateZonePricing(admin.sub, pricingId, audit);
    return { id: pricingId, deactivated: true };
  }

  // ── الفنيين المؤهلين ─────────────────────────────────────────────────

  @Get('services/:id/technicians')
  listEligibleTechnicians(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminCatalogService.listEligibleTechnicians(id);
  }

  @Post('services/:id/technicians')
  @RequirePermission('catalog.manage')
  assignTechnician(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignTechnicianServiceDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return this.adminCatalogService.assignTechnician(admin.sub, id, dto, audit);
  }

  @Delete('services/:id/technicians/:technicianId')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('catalog.manage')
  async removeTechnician(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('technicianId', ParseUUIDPipe) technicianId: string,
    @AuditContext() audit: AuditMeta,
  ) {
    await this.adminCatalogService.removeTechnician(admin.sub, id, technicianId, audit);
    return { technician_id: technicianId, removed: true };
  }

  // ── تسعير حسب مستوى الفني ────────────────────────────────────────────

  @Get('services/:id/level-pricing')
  async listLevelPricing(@Param('id', ParseUUIDPipe) id: string) {
    const rows = await this.adminCatalogService.listLevelPricing(id);
    return rows.map(toServiceLevelPricingResponseDto);
  }

  @Put('services/:id/level-pricing')
  @RequirePermission('catalog.manage')
  async upsertLevelPricing(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertLevelPricingDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return toServiceLevelPricingResponseDto(await this.adminCatalogService.upsertLevelPricing(admin.sub, id, dto, audit));
  }

  @Delete('services/level-pricing/:pricingId')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('catalog.manage')
  async deactivateLevelPricing(
    @CurrentUser() admin: JwtPayload,
    @Param('pricingId', ParseUUIDPipe) pricingId: string,
    @AuditContext() audit: AuditMeta,
  ) {
    await this.adminCatalogService.deactivateLevelPricing(admin.sub, pricingId, audit);
    return { id: pricingId, deactivated: true };
  }

  // ── الإضافات الاختيارية ──────────────────────────────────────────────

  @Get('services/:id/addons')
  async listAddons(@Param('id', ParseUUIDPipe) id: string) {
    const rows = await this.adminCatalogService.listAddons(id);
    return rows.map(toServiceAddonResponseDto);
  }

  @Post('services/:id/addons')
  @RequirePermission('catalog.manage')
  async createAddon(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateServiceAddonDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return toServiceAddonResponseDto(await this.adminCatalogService.createAddon(admin.sub, id, dto, audit));
  }

  @Patch('services/addons/:addonId')
  @RequirePermission('catalog.manage')
  async updateAddon(
    @CurrentUser() admin: JwtPayload,
    @Param('addonId', ParseUUIDPipe) addonId: string,
    @Body() dto: UpdateServiceAddonDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return toServiceAddonResponseDto(await this.adminCatalogService.updateAddon(admin.sub, addonId, dto, audit));
  }

  @Delete('services/addons/:addonId')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('catalog.manage')
  async deleteAddon(
    @CurrentUser() admin: JwtPayload,
    @Param('addonId', ParseUUIDPipe) addonId: string,
    @AuditContext() audit: AuditMeta,
  ) {
    await this.adminCatalogService.deleteAddon(admin.sub, addonId, audit);
    return { id: addonId, deleted: true };
  }
}
