import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { AuditContext, AuditMeta } from '../../common/decorators/audit-meta.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { RequireStepUp } from '../../common/decorators/require-step-up.decorator';
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
  @RequirePermission('settings.manage')
  async list(@Query('group') group?: string) {
    const settings = await this.settingsService.list(group);
    return settings.map(toSettingResponseDto);
  }

  @Get(':key')
  @RequirePermission('settings.manage')
  async getOne(@Param('key') key: string) {
    return toSettingResponseDto(await this.settingsService.getOrThrow(key));
  }

  // بَقّة أمنية حقيقية اتلقطت واتصلحت (تدقيق جاهزية الإطلاق النهائي، 2026-08-14): settings.manage
  // مُدرجة في MFA_REQUIRED_PERMISSIONS بس @RequireStepUp() متضافتش — نفس الفئة اللي اتصلحت لـ
  // wallets.adjust/orders.adjust_price/payments.confirm_manual.
  @Patch(':key')
  @RequirePermission('settings.manage')
  @RequireStepUp()
  async update(
    @CurrentUser() admin: JwtPayload,
    @Param('key') key: string,
    @Body() dto: UpdateSettingDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return toSettingResponseDto(await this.settingsService.update(admin.sub, key, dto.value, audit));
  }
}
