import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { AuditContext, AuditMeta } from '../../common/decorators/audit-meta.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { AdminCampaignsService } from './admin-campaigns.service';
import { CampaignsService } from './campaigns.service';
import { CreateCampaignDto, UpdateCampaignDto } from './dto/campaign.dto';
import { toCampaignResponseDto } from './dto/campaign-response.dto';

/**
 * إدارة الحملات التسويقية (ADR-0046) — «الأدمن يبقى عنده access ويقول إيه اللي يظهر وإيه اللي
 * ما يظهرش». صلاحية واحدة `campaigns.manage`.
 */
@Controller('admin/campaigns')
@Roles(UserType.ADMIN)
export class AdminCampaignsController {
  constructor(
    private readonly adminCampaigns: AdminCampaignsService,
    private readonly campaigns: CampaignsService,
  ) {}

  @Get()
  @RequirePermission('campaigns.manage')
  async list() {
    const rows = await this.adminCampaigns.list();
    return {
      items: rows.map(toCampaignResponseDto),
      // الواجهة بتعرضها للأدمن وهو بيكتب القالب — من غيرها هيخمّن أسماء المتغيّرات.
      available_variables: this.adminCampaigns.availableVariables(),
    };
  }

  @Post()
  @RequirePermission('campaigns.manage')
  async create(@CurrentUser() admin: JwtPayload, @Body() dto: CreateCampaignDto, @AuditContext() audit: AuditMeta) {
    const campaign = await this.adminCampaigns.create(admin.sub, dto, audit);
    return toCampaignResponseDto({ campaign, sends30d: 0, lastSentAt: null, previewTitle: '', previewBody: '', unknownVariables: [] });
  }

  @Patch(':id')
  @RequirePermission('campaigns.manage')
  async update(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCampaignDto,
    @AuditContext() audit: AuditMeta,
  ) {
    const campaign = await this.adminCampaigns.update(admin.sub, id, dto, audit);
    return toCampaignResponseDto({ campaign, sends30d: 0, lastSentAt: null, previewTitle: '', previewBody: '', unknownVariables: [] });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('campaigns.manage')
  async remove(@CurrentUser() admin: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @AuditContext() audit: AuditMeta) {
    await this.adminCampaigns.remove(admin.sub, id, audit);
    return { deleted: true };
  }

  /**
   * تشغيل دورة فورًا بدل ما الأدمن يستنى الـ5 دقايق — بيفيد وقت الاختبار وبعد أي تعديل على
   * القوالب. نفس الـsweep بالحرف، بكل الحواجز، مش مسار مختصر.
   */
  @Post('run-sweep')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('campaigns.manage')
  async runSweep() {
    return { sent: await this.campaigns.sweep() };
  }
}
