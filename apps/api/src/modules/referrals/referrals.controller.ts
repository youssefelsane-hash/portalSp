import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/types/authenticated-request';
import { MyReferralInfoResponseDto } from './dto/my-referral-info-response.dto';
import { ReferralsService } from './referrals.service';

// أي مستخدم مسجّل دخول (عميل أو فني) — نفس نمط GET /auth/me، مفيش @Roles هنا عمداً.
@Controller('me/referrals')
export class ReferralsController {
  constructor(private readonly referralsService: ReferralsService) {}

  @Get()
  async getMyReferralInfo(@CurrentUser() user: JwtPayload): Promise<MyReferralInfoResponseDto> {
    const info = await this.referralsService.getMyReferralInfo(user.sub);
    return {
      referral_code: info.referralCode,
      completed_referrals_count: info.completedReferralsCount,
      pending_referrals_count: info.pendingReferralsCount,
      required_referrals_per_reward: info.requiredReferralsPerReward,
      referrals_until_next_reward:
        info.requiredReferralsPerReward - (info.completedReferralsCount % info.requiredReferralsPerReward),
    };
  }
}
