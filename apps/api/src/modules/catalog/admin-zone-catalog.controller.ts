import { Body, Controller, Get, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { AuditContext, AuditMeta } from '../../common/decorators/audit-meta.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { SetZoneCatalogAvailabilityDto } from './dto/set-zone-catalog-availability.dto';
import { ZoneCatalogAvailabilityService } from './zone-catalog-availability.service';

@Controller('admin/service-zones/:zoneId/catalog-availability')
@Roles(UserType.ADMIN)
export class AdminZoneCatalogController {
  constructor(private readonly availability: ZoneCatalogAvailabilityService) {}

  @Get()
  @RequirePermission('geo.view')
  list(@Param('zoneId', ParseUUIDPipe) zoneId: string) {
    return this.availability.listForZone(zoneId);
  }

  @Put()
  @RequirePermission('geo.manage')
  set(
    @CurrentUser() admin: JwtPayload,
    @Param('zoneId', ParseUUIDPipe) zoneId: string,
    @Body() dto: SetZoneCatalogAvailabilityDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return this.availability.setOverride(admin.sub, zoneId, dto, audit);
  }
}
