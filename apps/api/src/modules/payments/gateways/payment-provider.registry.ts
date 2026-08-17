import { Injectable } from '@nestjs/common';
import { PaymentMethod } from '../entities/payment.entity';
import { CashProvider } from './cash-provider.service';
import { FawryProvider } from './fawry-provider.service';
import { InstaPayProvider } from './instapay-provider.service';
import { PaymentProvider } from './payment-provider.interface';
import { PaymobProvider } from './paymob-provider.service';
import { WalletProvider } from './wallet-provider.service';

/**
 * نقطة وحيدة لربط PaymentMethod بالـAdapter بتاعه (ADR-0013) — إضافة طريقة دفع جديدة مستقبلاً
 * (محفظة موبايل تانية، بنك مباشر، إلخ) = provider جديد + سطر هنا، صفر تعديل في payments.service.ts
 * نفسه. providerKey مستخدَم في webhooks.controller.ts لتوجيه الحدث لـProvider الصح حسب مسار الرابط.
 */
@Injectable()
export class PaymentProviderRegistry {
  private readonly byMethod: Map<PaymentMethod, PaymentProvider>;
  private readonly byProviderKey: Map<string, PaymentProvider>;

  constructor(
    private readonly paymobProvider: PaymobProvider,
    private readonly cashProvider: CashProvider,
    private readonly walletProvider: WalletProvider,
    private readonly instaPayProvider: InstaPayProvider,
    private readonly fawryProvider: FawryProvider,
  ) {
    this.byMethod = new Map<PaymentMethod, PaymentProvider>([
      [PaymentMethod.CARD, this.paymobProvider],
      [PaymentMethod.CASH, this.cashProvider],
      [PaymentMethod.WALLET, this.walletProvider],
      [PaymentMethod.INSTAPAY, this.instaPayProvider],
      [PaymentMethod.FAWRY_REFERENCE, this.fawryProvider],
    ]);
    this.byProviderKey = new Map(
      [this.paymobProvider, this.cashProvider, this.walletProvider, this.instaPayProvider, this.fawryProvider].map((p) => [
        p.providerKey,
        p,
      ]),
    );
  }

  getProvider(method: PaymentMethod): PaymentProvider {
    const provider = this.byMethod.get(method);
    if (!provider) {
      throw new Error(`مفيش PaymentProvider مسجّل لطريقة الدفع ${method}`);
    }
    return provider;
  }

  getByProviderKey(providerKey: string): PaymentProvider {
    const provider = this.byProviderKey.get(providerKey);
    if (!provider) {
      throw new Error(`مفيش PaymentProvider مسجّل بالمفتاح ${providerKey}`);
    }
    return provider;
  }

  /**
   * Script 2 Part I (findings #46/#47) — العميل كان بيشوف كل طرق الدفع في التطبيق بغض النظر عن
   * إعداد الباك-إند الفعلي (Paymob/Fawry ممكن يكونوا مش مُفعّلين)، فيختار طريقة الباك-إند
   * هيرفضها في آخر خطوة. صفر أسرار/إعدادات بترجع هنا عمدًا — isConfigured بس (boolean).
   */
  listAll(): { method: PaymentMethod; isConfigured: boolean }[] {
    return Array.from(this.byMethod.entries()).map(([method, provider]) => ({
      method,
      isConfigured: provider.isConfigured,
    }));
  }
}
