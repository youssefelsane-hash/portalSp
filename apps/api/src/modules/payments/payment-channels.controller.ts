import { Controller, Get } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { PaymentChannelResponseDto } from './dto/payments-response.dto';
import { PaymentProviderRegistry } from './gateways/payment-provider.registry';

// Script 2 Part I (findings #46/#47/#48) — كان مفيش endpoint خالص يعرض للعميل أي طرق دفع مُفعّلة
// فعليًا في الباك-إند. الكلاينت (apps/customer-app) كان بيثبّت قايمة طرق دفع ثابتة في الكود، فلو
// Paymob/Fawry مش مُعدّين، العميل كان يقدر يختار طريقة الباك-إند هيرفضها في آخر خطوة (بعد ما
// يبدأ البحث عن فني). صفر أسرار بترجع هنا — isConfigured (boolean) بس.
@Controller('payment-channels')
@Roles(UserType.CUSTOMER)
export class PaymentChannelsController {
  constructor(private readonly registry: PaymentProviderRegistry) {}

  @Get()
  list(): PaymentChannelResponseDto[] {
    return this.registry.listAll().map((entry) => ({ method: entry.method, is_available: entry.isConfigured }));
  }
}
