import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { AuditContext, AuditMeta } from '../../common/decorators/audit-meta.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { toTechnicianLevelConfigResponseDto } from './dto/technician-level-config-response.dto';
import { UpdateTechnicianLevelConfigDto } from './dto/update-technician-level-config.dto';
import { TechnicianLevel } from './entities/technician-profile.entity';
import { TechnicianLevelsService } from './technician-levels.service';

// سياسة مستويات الفنيين (عمولة/أولوية/حد قرار/أهلية قيادة فريق) — بدون أي تعديل كود.
@Controller('admin/technician-levels')
@Roles(UserType.ADMIN)
export class AdminTechnicianLevelsController {
  constructor(private readonly levelsService: TechnicianLevelsService) {}

  @Get()
  async list() {
    return (await this.levelsService.list()).map(toTechnicianLevelConfigResponseDto);
  }

  @Patch(':level')
  @RequirePermission('technician_levels.manage')
  async update(
    @CurrentUser() admin: JwtPayload,
    @Param('level') level: TechnicianLevel,
    @Body() dto: UpdateTechnicianLevelConfigDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return toTechnicianLevelConfigResponseDto(await this.levelsService.update(admin.sub, level, dto, audit));
  }
}
