import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { AuditContext, AuditMeta } from '../../common/decorators/audit-meta.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { AdminGeoService } from './admin-geo.service';
import { toAdminAreaResponseDto, toAdminCityResponseDto, toAdminServiceZoneResponseDto } from './dto/admin-geo-response.dto';
import { CreateAreaDto } from './dto/create-area.dto';
import { CreateCityDto } from './dto/create-city.dto';
import { CreateServiceZoneDto } from './dto/create-service-zone.dto';
import { SetServiceZoneBoundaryDto } from './dto/set-service-zone-boundary.dto';
import { UpdateAreaDto } from './dto/update-area.dto';
import { UpdateCityDto } from './dto/update-city.dto';
import { UpdateServiceZoneDto } from './dto/update-service-zone.dto';

// إدارة المدن/المناطق/نطاقات الخدمة بدون أي تعديل كود — القراءة مفتوحة لأي أدمن، التعديل محتاج geo.manage.
@Controller('admin')
@Roles(UserType.ADMIN)
export class AdminGeoController {
  constructor(private readonly adminGeoService: AdminGeoService) {}

  @Get('cities')
  async listCities() {
    return (await this.adminGeoService.listCities()).map(toAdminCityResponseDto);
  }

  @Post('cities')
  @RequirePermission('geo.manage')
  async createCity(@CurrentUser() admin: JwtPayload, @Body() dto: CreateCityDto, @AuditContext() audit: AuditMeta) {
    return toAdminCityResponseDto(await this.adminGeoService.createCity(admin.sub, dto, audit));
  }

  @Patch('cities/:id')
  @RequirePermission('geo.manage')
  async updateCity(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCityDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return toAdminCityResponseDto(await this.adminGeoService.updateCity(admin.sub, id, dto, audit));
  }

  @Delete('cities/:id')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('geo.manage')
  async deleteCity(@CurrentUser() admin: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @AuditContext() audit: AuditMeta) {
    await this.adminGeoService.deleteCity(admin.sub, id, audit);
    return null;
  }

  @Get('areas')
  async listAreas(@Query('city_id') cityId?: string) {
    return (await this.adminGeoService.listAreas(cityId)).map(toAdminAreaResponseDto);
  }

  @Post('areas')
  @RequirePermission('geo.manage')
  async createArea(@CurrentUser() admin: JwtPayload, @Body() dto: CreateAreaDto, @AuditContext() audit: AuditMeta) {
    return toAdminAreaResponseDto(await this.adminGeoService.createArea(admin.sub, dto, audit));
  }

  @Patch('areas/:id')
  @RequirePermission('geo.manage')
  async updateArea(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAreaDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return toAdminAreaResponseDto(await this.adminGeoService.updateArea(admin.sub, id, dto, audit));
  }

  @Delete('areas/:id')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('geo.manage')
  async deleteArea(@CurrentUser() admin: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @AuditContext() audit: AuditMeta) {
    await this.adminGeoService.deleteArea(admin.sub, id, audit);
    return null;
  }

  @Get('service-zones')
  async listServiceZones(@Query('city_id') cityId?: string) {
    return (await this.adminGeoService.listServiceZones(cityId)).map(toAdminServiceZoneResponseDto);
  }

  @Post('service-zones')
  @RequirePermission('geo.manage')
  async createServiceZone(@CurrentUser() admin: JwtPayload, @Body() dto: CreateServiceZoneDto, @AuditContext() audit: AuditMeta) {
    return toAdminServiceZoneResponseDto(await this.adminGeoService.createServiceZone(admin.sub, dto, audit));
  }

  @Patch('service-zones/:id')
  @RequirePermission('geo.manage')
  async updateServiceZone(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceZoneDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return toAdminServiceZoneResponseDto(await this.adminGeoService.updateServiceZone(admin.sub, id, dto, audit));
  }

  @Delete('service-zones/:id')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('geo.manage')
  async deleteServiceZone(@CurrentUser() admin: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @AuditContext() audit: AuditMeta) {
    await this.adminGeoService.deleteServiceZone(admin.sub, id, audit);
    return null;
  }

  // مضلّع النطاق الجغرافي (boundary) — كان فجوة موثّقة، اتقفلت. مسار منفصل عن PATCH العادي
  // عمداً لأن البيانات شكلها مختلف تماماً (مصفوفة نقط، مش حقول scalar).
  @Put('service-zones/:id/boundary')
  @RequirePermission('geo.manage')
  async setServiceZoneBoundary(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetServiceZoneBoundaryDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return toAdminServiceZoneResponseDto(await this.adminGeoService.setServiceZoneBoundary(admin.sub, id, dto, audit));
  }
}
