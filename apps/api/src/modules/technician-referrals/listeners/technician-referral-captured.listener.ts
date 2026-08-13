import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { TECHNICIAN_REFERRAL_CAPTURED_EVENT, TechnicianReferralCapturedEvent } from '../../../common/events/technician-referral-captured.event';
import { TechnicianReferralsService } from '../technician-referrals.service';

@Injectable()
export class TechnicianReferralCapturedListener {
  constructor(private readonly referralsService: TechnicianReferralsService) {}

  @OnEvent(TECHNICIAN_REFERRAL_CAPTURED_EVENT)
  async handle(event: TechnicianReferralCapturedEvent): Promise<void> {
    await this.referralsService.captureAtRegistration(event.customerUserId, event.referralToken);
  }
}
