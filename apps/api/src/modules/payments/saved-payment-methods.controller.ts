import { Controller, Delete, Get, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { CustomerProfilesService } from '../customers/customer-profiles.service';
import { SavedPaymentMethodsService } from './saved-payment-methods.service';
import { toSavedPaymentMethodResponseDto } from './dto/payments-response.dto';

// وسائل الدفع المحفوظة بتاعة العميل نفسه بس — قايمة/تعيين افتراضي/حذف. صفر endpoint لإضافة كارت
// يدويًا هنا عمداً (docs/08 §21) — الحفظ بيحصل تلقائيًا عبر ويب-هوك حفظ الكارت وقت الدفع الأول،
// مش عبر إدخال بيانات كارت مباشرة عندنا (نفس مبدأ "أبداً رقم كارت خام في قاعدة بياناتنا").
@Controller('payment-methods')
@Roles(UserType.CUSTOMER)
export class SavedPaymentMethodsController {
  constructor(
    private readonly savedPaymentMethods: SavedPaymentMethodsService,
    private readonly customerProfiles: CustomerProfilesService,
  ) {}

  @Get()
  async list(@CurrentUser() user: JwtPayload) {
    const profile = await this.customerProfiles.findByUserIdOrThrow(user.sub);
    const methods = await this.savedPaymentMethods.listForCustomer(profile.id);
    return methods.map(toSavedPaymentMethodResponseDto);
  }

  @Patch(':id/default')
  async setDefault(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    const profile = await this.customerProfiles.findByUserIdOrThrow(user.sub);
    const method = await this.savedPaymentMethods.setDefault(user.sub, profile.id, id);
    return toSavedPaymentMethodResponseDto(method);
  }

  @Delete(':id')
  async revoke(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    const profile = await this.customerProfiles.findByUserIdOrThrow(user.sub);
    await this.savedPaymentMethods.revoke(profile.id, id);
    return { revoked: true };
  }
}
