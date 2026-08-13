import { Body, Controller, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { AttributeReferralDto } from './dto/attribute-referral.dto';
import { TechnicianReferralsService } from './technician-referrals.service';

// عميل موجود بالفعل بيستخدم كود ترشيح فني (مسح QR/إدخال يدوي بعد التسجيل، docs/11 §1) — عميل
// جديد بياخد نفس التأثير تلقائيًا عبر RegisterDto.technician_referral_code وقت التسجيل.
@Controller('me/technician-referral')
@Roles(UserType.CUSTOMER)
export class MeTechnicianReferralController {
  constructor(private readonly referralsService: TechnicianReferralsService) {}

  @Post()
  async attribute(@CurrentUser() user: JwtPayload, @Body() dto: AttributeReferralDto) {
    const attribution = await this.referralsService.attributeExistingCustomer(user.sub, dto.referral_code);
    return { technician_id: attribution.technicianId, attributed_at: attribution.attributedAt.toISOString() };
  }
}
