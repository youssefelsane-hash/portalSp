import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { ReferralsService } from './referrals.service';

/**
 * **نظرة الأدمن على «رشّح صحابك»** (docs/08 §165).
 *
 * البرنامج كان شغّال بالكامل من غير أي مسار أدمن، فالموظف مكانش قادر يجاوب «العميل ده رشّح
 * مين وخد إيه؟» ولا يراجع شكوى عن مكافأة ناقصة. قراءة بحتة — مفيش أي تعديل من هنا.
 *
 * `customers.view` مش صلاحية جديدة: الرد كله بيانات عملاء (اسم/تليفون/حالة)، فنفس البوابة
 * اللي بتحكم صفحة العميل بتحكمه.
 */
@Controller('admin/referrals')
@Roles(UserType.ADMIN)
export class AdminReferralsController {
  constructor(private readonly referralsService: ReferralsService) {}

  @Get('customers/:userId')
  @RequirePermission('customers.view')
  async overview(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.referralsService.adminReferralOverview(userId);
  }
}
