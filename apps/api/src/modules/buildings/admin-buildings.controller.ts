import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { BuildingsService } from './buildings.service';
import { CreateBuildingDto } from './dto/create-building.dto';
import { UpdateBuildingDto } from './dto/update-building.dto';
import { toBuildingWithSubscriptionStatusDto } from './dto/building-response.dto';

// نظام العمائر (docs/08 §13، ADR-0003) — إدارة الأدمن بالكامل.
@Controller('admin/buildings')
@Roles(UserType.ADMIN)
export class AdminBuildingsController {
  constructor(private readonly buildingsService: BuildingsService) {}

  @Get()
  @RequirePermission('buildings.view')
  async list() {
    const buildings = await this.buildingsService.list();
    const counts = await this.buildingsService.getCurrentMonthOrdersCountBulk(buildings.map((b) => b.id));
    return buildings.map((b) => toBuildingWithSubscriptionStatusDto(b, counts.get(b.id) ?? 0));
  }

  @Get(':id')
  @RequirePermission('buildings.view')
  async getOne(@Param('id', ParseUUIDPipe) id: string) {
    const building = await this.buildingsService.findByIdOrThrow(id);
    return toBuildingWithSubscriptionStatusDto(building, await this.buildingsService.getCurrentMonthOrdersCount(building.id));
  }

  @Post()
  @RequirePermission('buildings.manage')
  async create(@Body() dto: CreateBuildingDto) {
    const building = await this.buildingsService.create(dto);
    return toBuildingWithSubscriptionStatusDto(building, 0);
  }

  @Patch(':id')
  @RequirePermission('buildings.manage')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBuildingDto) {
    const building = await this.buildingsService.update(id, dto);
    return toBuildingWithSubscriptionStatusDto(building, await this.buildingsService.getCurrentMonthOrdersCount(building.id));
  }

  // JSON عادي (data URI) بدل صورة خام — نفس نمط عقد الـ API {success,data,...} في باقي النظام،
  // مفيش داعي نتجاوز الـ response pipeline لصورة صغيرة. apps/admin يعرضها مباشرة بـ<img src=...>.
  @Get(':id/qr')
  @RequirePermission('buildings.view')
  async getQrCode(@Param('id', ParseUUIDPipe) id: string) {
    const building = await this.buildingsService.findByIdOrThrow(id);
    const qrDataUri = await this.buildingsService.generateQrPngDataUri(building);
    return { building_code: building.code, qr_data_uri: qrDataUri };
  }
}
