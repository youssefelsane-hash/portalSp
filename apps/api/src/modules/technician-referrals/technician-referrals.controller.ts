import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { TechniciansService } from '../technicians/technicians.service';
import { toTechnicianReferralSummaryResponseDto } from './dto/technician-referral-response.dto';
import { TechnicianReferralsService } from './technician-referrals.service';

// ملخّص ترشيح QR الفني الشخصي (docs/11 §1) — الكود نفسه هو technician_code الموجود بالفعل.
@Controller('technician/referrals')
@Roles(UserType.TECHNICIAN)
export class TechnicianReferralsController {
  constructor(
    private readonly referralsService: TechnicianReferralsService,
    private readonly techniciansService: TechniciansService,
  ) {}

  @Get()
  async getMySummary(@CurrentUser() user: JwtPayload) {
    const profile = await this.techniciansService.findByUserIdOrThrow(user.sub);
    const summary = await this.referralsService.getTechnicianSummary(profile.id);
    return toTechnicianReferralSummaryResponseDto(summary);
  }
}
