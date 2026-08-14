import { BadRequestException, Controller, Delete, Get, Param, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { AuditContext, AuditMeta } from '../../common/decorators/audit-meta.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { RequireStepUp } from '../../common/decorators/require-step-up.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { MAX_BRANDING_FILE_SIZE_BYTES } from './branding-file-validator';
import { BrandingAssetTypeParamDto } from './dto/branding-asset-type-param.dto';
import { BrandingService } from './branding.service';

/**
 * إدارة البراندنج (ADR-0014) — صلاحية مخصوصة `branding.manage` + Step-Up (ADR-0011) على أي كتابة،
 * تغيير البراندنج العام لمنصة كاملة قرار حساس بما يكفي إنه يستاهل نفس حماية refunds.issue.
 */
@Controller('admin/branding')
@Roles(UserType.ADMIN)
@RequirePermission('branding.manage')
export class AdminBrandingController {
  constructor(private readonly brandingService: BrandingService) {}

  @Get()
  async list() {
    return this.brandingService.getAdminPayload();
  }

  @Post(':assetType')
  @RequireStepUp()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_BRANDING_FILE_SIZE_BYTES },
    }),
  )
  async upload(
    @CurrentUser() user: JwtPayload,
    @Param() params: BrandingAssetTypeParamDto,
    @UploadedFile() file: Express.Multer.File,
    @AuditContext() audit: AuditMeta,
  ) {
    if (!file) {
      throw new BadRequestException('لازم ترفع ملف');
    }
    await this.brandingService.upload(user.sub, params.assetType, file, audit);
    return this.brandingService.getAdminPayload();
  }

  @Delete(':assetType')
  @RequireStepUp()
  async remove(@CurrentUser() user: JwtPayload, @Param() params: BrandingAssetTypeParamDto, @AuditContext() audit: AuditMeta) {
    await this.brandingService.remove(user.sub, params.assetType, audit);
    return this.brandingService.getAdminPayload();
  }
}
