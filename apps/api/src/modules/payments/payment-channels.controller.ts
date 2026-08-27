import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtPayload } from '../auth/types/authenticated-request';
import { UserType } from '../auth/entities/user.entity';
import { SettingsService } from '../settings/settings.service';
import { PaymentChannelResponseDto } from './dto/payments-response.dto';
import { PaymentMethod } from './entities/payment.entity';
import { PaymentProviderRegistry } from './gateways/payment-provider.registry';
import { PaymobProvider } from './gateways/paymob-provider.service';

/**
 * سبب عدم إتاحة طريقة دفع **بلغة العميل** (docs/08 §76-ز).
 *
 * بلاغ مالك صريح: «مش عايزين أي comment تدل إن الأدمن هو المفروض يشوفها». الأسباب القديمة
 * كانت مكتوبة لمشغّل النظام مش للعميل («الطريقة مقفولة من إعدادات الأدمن»، «بيانات تشغيل
 * الطريقة غير مكتملة»)، وواحد منها كان بيطبع أسماء متغيّرات إعداد Paymob الناقصة حرفيًا في
 * شاشة العميل — تسريب بنية تحتية مش بس صياغة وحشة.
 *
 * العميل مش محتاج يعرف **ليه** الطريقة مش شغّالة — ده مالوش أي أثر على قراره. محتاج يعرف
 * إنها مش متاحة وإن قدّامه بدائل. التشخيص كله بيروح لـ`admin_note` اللي بيتبعت للأدمن بس.
 */
const CUSTOMER_UNAVAILABLE_REASON = 'الطريقة دي مش متاحة دلوقتي — اختار طريقة تانية';

// Script 2 Part I (findings #46/#47/#48) — كان مفيش endpoint خالص يعرض للعميل أي طرق دفع مُفعّلة
// فعليًا في الباك-إند. الكلاينت (apps/customer-app) كان بيثبّت قايمة طرق دفع ثابتة في الكود، فلو
// Paymob/Fawry مش مُعدّين، العميل كان يقدر يختار طريقة الباك-إند هيرفضها في آخر خطوة (بعد ما
// يبدأ البحث عن فني). صفر أسرار بترجع هنا — isConfigured (boolean) بس.
@Controller('payment-channels')
@Roles(UserType.CUSTOMER, UserType.ADMIN)
export class PaymentChannelsController {
  constructor(
    private readonly registry: PaymentProviderRegistry,
    private readonly settingsService: SettingsService,
    private readonly paymobProvider: PaymobProvider,
  ) {}

  @Get()
  async list(@CurrentUser() user: JwtPayload): Promise<PaymentChannelResponseDto[]> {
    const isAdmin = user?.userType === UserType.ADMIN;
    // الكاش استثناء عمدًا: `CashProvider.isConfigured` ثابتة `true` دايمًا (مفيش بوابة خارجية
    // تتفحص)، لكن لازم تفضل قابلة للتعطيل من الأدمن برضه (`payments.cash_enabled`، بَقّة
    // تسليم كاش على طلب بلا فني، docs/08) — عكس باقي البوابات اللي isConfigured بتعكس وجود
    // بيانات اعتماد حقيقية بس.
    const [cashEnabled, cardEnabled, walletEnabled, instaPayEnabled, fawryEnabled, installmentsEnabled] =
      await Promise.all([
        this.settingsService.getBoolean('payments.cash_enabled', true),
        this.settingsService.getBoolean('payments.card_enabled', true),
        this.settingsService.getBoolean('payments.wallet_enabled', true),
        this.settingsService.getBoolean('payments.instapay_enabled', true),
        this.settingsService.getBoolean('payments.fawry_enabled', false),
        this.settingsService.getBoolean('payments.installments_enabled', true),
      ]);
    const enabledByMethod = new Map<PaymentMethod, boolean>([
      [PaymentMethod.CASH, cashEnabled],
      [PaymentMethod.CARD, cardEnabled],
      [PaymentMethod.WALLET, walletEnabled],
      [PaymentMethod.INSTAPAY, instaPayEnabled],
      [PaymentMethod.FAWRY_REFERENCE, fawryEnabled],
    ]);
    const channels: PaymentChannelResponseDto[] = this.registry.listAll().map((entry) => {
      const isEnabled = enabledByMethod.get(entry.method) ?? false;
      const isAvailable = isEnabled && entry.isConfigured;
      let adminNote: string | null = null;
      if (!isEnabled) adminNote = 'الطريقة مقفولة من إعدادات الأدمن';
      else if (!entry.isConfigured && entry.method === PaymentMethod.CARD) {
        const missing = this.paymobProvider.getConfigurationStatus().missingFields;
        adminNote = `إعداد Paymob غير مكتمل${missing.length ? `: ${missing.join(', ')}` : ''}`;
      } else if (!entry.isConfigured) adminNote = 'بيانات تشغيل الطريقة غير مكتملة';
      return {
        method: entry.method,
        is_enabled: isEnabled,
        is_configured: entry.isConfigured,
        is_available: isAvailable,
        unavailable_reason: isAvailable ? null : CUSTOMER_UNAVAILABLE_REASON,
        // الحقل ده بيتحذف تمامًا من رد العميل (مش بيترجع null) — أقل سطح تسريب ممكن.
        ...(isAdmin && adminNote ? { admin_note: adminNote } : {}),
      };
    });

    const paymobStatus = this.paymobProvider.getConfigurationStatus();
    const installmentAvailable = installmentsEnabled && paymobStatus.configured;
    const installmentAdminNote = !installmentsEnabled
      ? 'التقسيط مقفول من إعدادات الأدمن'
      : !paymobStatus.configured
        ? `التقسيط يحتاج Paymob مكتمل${paymobStatus.missingFields.length ? `: ${paymobStatus.missingFields.join(', ')}` : ''}`
        : null;
    channels.push({
      method: 'installment',
      is_enabled: installmentsEnabled,
      is_configured: paymobStatus.configured,
      is_available: installmentAvailable,
      unavailable_reason: installmentAvailable ? null : CUSTOMER_UNAVAILABLE_REASON,
      ...(isAdmin && installmentAdminNote ? { admin_note: installmentAdminNote } : {}),
    });
    return channels;
  }
}
