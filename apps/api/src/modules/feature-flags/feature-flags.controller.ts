import { Controller, Get, Param, Query } from '@nestjs/common';
import { IsOptional, IsUUID } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/types/authenticated-request';
import { FeatureFlagsService } from './feature-flags.service';

class CheckFeatureFlagQueryDto {
  @IsOptional()
  @IsUUID()
  zone_id?: string;
}

// مفيش @Public() هنا عمداً — لازم مستخدم مسجّل دخول عشان نقدر نطبّق enabled_for_user_ids/rollout
// الصح. فلاج مش موجود = false، مش خطأ — الكلاينت مايحتاجش يتعامل مع 404 لميزة لسه معملهاش فلاج.
@Controller('feature-flags')
export class FeatureFlagsController {
  constructor(private readonly featureFlagsService: FeatureFlagsService) {}

  @Get(':key/check')
  async check(@CurrentUser() user: JwtPayload, @Param('key') key: string, @Query() query: CheckFeatureFlagQueryDto) {
    const enabled = await this.featureFlagsService.isEnabledForUser(key, user.sub, query.zone_id);
    return { key, enabled };
  }
}
