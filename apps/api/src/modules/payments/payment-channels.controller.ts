import { Controller, Get } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { SettingsService } from '../settings/settings.service';
import { PaymentChannelResponseDto } from './dto/payments-response.dto';
import { PaymentMethod } from './entities/payment.entity';
import { PaymentProviderRegistry } from './gateways/payment-provider.registry';

// Script 2 Part I (findings #46/#47/#48) — كان مفيش endpoint خالص يعرض للعميل أي طرق دفع مُفعّلة
// فعليًا في الباك-إند. الكلاينت (apps/customer-app) كان بيثبّت قايمة طرق دفع ثابتة في الكود، فلو
// Paymob/Fawry مش مُعدّين، العميل كان يقدر يختار طريقة الباك-إند هيرفضها في آخر خطوة (بعد ما
// يبدأ البحث عن فني). صفر أسرار بترجع هنا — isConfigured (boolean) بس.
@Controller('payment-channels')
@Roles(UserType.CUSTOMER)
export class PaymentChannelsController {
  constructor(
    private readonly registry: PaymentProviderRegistry,
    private readonly settingsService: SettingsService,
  ) {}

  @Get()
  async list(): Promise<PaymentChannelResponseDto[]> {
    // الكاش استثناء عمدًا: `CashProvider.isConfigured` ثابتة `true` دايمًا (مفيش بوابة خارجية
    // تتفحص)، لكن لازم تفضل قابلة للتعطيل من الأدمن برضه (`payments.cash_enabled`، بَقّة
    // تسليم كاش على طلب بلا فني، docs/08) — عكس باقي البوابات اللي isConfigured بتعكس وجود
    // بيانات اعتماد حقيقية بس.
    const cashEnabled = await this.settingsService.getBoolean('payments.cash_enabled', true);
    return this.registry.listAll().map((entry) => ({
      method: entry.method,
      is_available: entry.method === PaymentMethod.CASH ? entry.isConfigured && cashEnabled : entry.isConfigured,
    }));
  }
}
