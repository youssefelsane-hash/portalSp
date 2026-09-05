import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { AuditContext, AuditMeta } from '../../common/decorators/audit-meta.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { CreateFeatureFlagDto } from './dto/create-feature-flag.dto';
import { toFeatureFlagResponseDto } from './dto/feature-flag-response.dto';
import { UpdateFeatureFlagDto } from './dto/update-feature-flag.dto';
import { FeatureFlagsService } from './feature-flags.service';

@Controller('admin/feature-flags')
@Roles(UserType.ADMIN)
export class AdminFeatureFlagsController {
  constructor(private readonly featureFlagsService: FeatureFlagsService) {}

  @Get()
  @RequirePermission('feature_flags.view')
  async list() {
    const flags = await this.featureFlagsService.list();
    return flags.map(toFeatureFlagResponseDto);
  }

  @Get(':key')
  @RequirePermission('feature_flags.view')
  async getOne(@Param('key') key: string) {
    return toFeatureFlagResponseDto(await this.featureFlagsService.findOrThrow(key));
  }

  @Post()
  @RequirePermission('feature_flags.manage')
  async create(@CurrentUser() admin: JwtPayload, @Body() dto: CreateFeatureFlagDto, @AuditContext() audit: AuditMeta) {
    return toFeatureFlagResponseDto(await this.featureFlagsService.create(admin.sub, dto, audit));
  }

  @Patch(':key')
  @RequirePermission('feature_flags.manage')
  async update(
    @CurrentUser() admin: JwtPayload,
    @Param('key') key: string,
    @Body() dto: UpdateFeatureFlagDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return toFeatureFlagResponseDto(await this.featureFlagsService.update(admin.sub, key, dto, audit));
  }

  @Delete(':key')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('feature_flags.manage')
  async delete(@CurrentUser() admin: JwtPayload, @Param('key') key: string, @AuditContext() audit: AuditMeta) {
    await this.featureFlagsService.delete(admin.sub, key, audit);
    return { key, deleted: true };
  }
}
