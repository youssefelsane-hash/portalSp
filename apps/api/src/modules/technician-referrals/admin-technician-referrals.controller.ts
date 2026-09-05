import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { AdminListReferralBonusesQueryDto } from './dto/admin-list-referral-bonuses-query.dto';
import { toTechnicianReferralBonusResponseDto, toTechnicianReferralSummaryResponseDto } from './dto/technician-referral-response.dto';
import { TechnicianReferralsService } from './technician-referrals.service';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';

// نظرة عامة إدارية على ترشيح QR الفني (docs/11 §1) — قراءة بس، مفتوحة لأي أدمن (نفس فلسفة
// PermissionsGuard: مفيش فعل مُغيّر هنا يحتاج صلاحية دقيقة).
@Controller('admin/technician-referrals')
@Roles(UserType.ADMIN)
export class AdminTechnicianReferralsController {
  constructor(private readonly referralsService: TechnicianReferralsService) {}

  @Get()
  @RequirePermission('technician_referrals.view')
  async list(@Query() query: AdminListReferralBonusesQueryDto) {
    const { items, meta } = await this.referralsService.listForAdmin({
      technicianId: query.technician_id,
      status: query.status,
      from: query.from,
      to: query.to,
      page: query.page ?? 1,
      perPage: query.per_page ?? 20,
    });
    return { items: items.map(toTechnicianReferralBonusResponseDto), meta };
  }

  @Get('technicians/:id')
  @RequirePermission('technician_referrals.view')
  async getTechnicianSummary(@Param('id', ParseUUIDPipe) id: string) {
    const summary = await this.referralsService.getTechnicianSummary(id);
    return toTechnicianReferralSummaryResponseDto(summary);
  }
}
