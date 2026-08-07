import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { AuditContext, AuditMeta } from '../../common/decorators/audit-meta.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { UpdateSettingDto } from '../settings/dto/update-setting.dto';
import { toSettingResponseDto } from '../settings/dto/setting-response.dto';
import { SettingsService } from '../settings/settings.service';

@Controller('admin/settings')
@Roles(UserType.ADMIN)
export class AdminSettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  async list(@Query('group') group?: string) {
    const settings = await this.settingsService.list(group);
    return settings.map(toSettingResponseDto);
  }

  @Get(':key')
  async getOne(@Param('key') key: string) {
    return toSettingResponseDto(await this.settingsService.getOrThrow(key));
  }

  @Patch(':key')
  @RequirePermission('settings.manage')
  async update(
    @CurrentUser() admin: JwtPayload,
    @Param('key') key: string,
    @Body() dto: UpdateSettingDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return toSettingResponseDto(await this.settingsService.update(admin.sub, key, dto.value, audit));
  }
}
