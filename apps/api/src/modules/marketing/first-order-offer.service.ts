import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { DataSource } from 'typeorm';
import { PLATFORM_SYSTEM_USER_ID } from '../payments/entities/wallet.entity';
import { DiscountType } from '../promotions/entities/promo-code.entity';
import { PromoCodesService } from '../promotions/promo-codes.service';
import { SettingsService } from '../settings/settings.service';

export const FIRST_ORDER_OFFER_ENABLED_KEY = 'marketing.first_order_offer_enabled';
export const FIRST_ORDER_DISCOUNT_CENTS_KEY = 'marketing.first_order_discount_cents';
export const FIRST_ORDER_MIN_ORDER_CENTS_KEY = 'marketing.first_order_min_order_cents';
export const FIRST_ORDER_VALIDITY_DAYS_KEY = 'marketing.first_order_validity_days';
export const FIRST_ORDER_MESSAGE_KEY = 'marketing.first_order_message_ar';

export interface FirstOrderOfferResult {
  code: string;
  discountCents: number;
  minOrderCents: number;
  validUntil: Date;
  messageAr: string;
}

/**
 * **عرض خصم أول طلب** (docs/08 §135-و، ADR-0082).
 *
 * طلب المالك بالحرف: «أول طلب هتاخد عليه خصم مية جنيه بحد أدنى مثلاً ٣٠٠ جنيه… الكلام ده كله
 * المفروض يكون دايناميك عند الأدمين».
 *
 * ## ليه بيتبني فوق `promo_codes` مش جنبه
 *
 * `promo_codes` عنده بالفعل **كل** اللي العرض محتاجه: `min_order_amount_cents`،
 * `new_customers_only`، `restricted_to_user_id` (الكود مقفول على صاحبه، مش سرّ ممكن يتشارك)،
 * صلاحية بتاريخين، وميزانية. أي «جدول عروض» جديد كان هيكرر محرك تحقق كامل — وأخطر من كده،
 * كان هيخلّي فيه **مسارين للخصم** على نفس الطلب. فالعرض هنا مجرد **إصدار كود شخصي**،
 * والتحقق والخصم والاسترداد كلهم بيعدّوا على نفس المسار الموجود بلا أي سطر جديد.
 *
 * ## القرارات
 *
 * - **مقفول افتراضيًا**: العرض بيصرف فلوس حقيقية، فتشغيله لازم يكون قرار صريح من الأدمن مش
 *   نتيجة migration (نفس مبدأ `support.enabled`).
 * - **كود واحد لكل مستخدم**: `restricted_to_user_id` + `usage_limit_total = 1`. إعادة نداء
 *   الدالة لنفس المستخدم بترجّع الكود القائم مش كود تاني — التسجيل ممكن يتعاد (استرداد
 *   حدث، إعادة محاولة) والفلوس مش المفروض تتضاعف.
 * - **الفشل مايوقفش التسجيل**: أي عطل هنا بيترمي للمنادي كـ`null`. عميل مقدرش يسجّل بسبب
 *   عرض ترويجي = خسارة أكبر بما لا يقاس من عرض مافاتش.
 */
@Injectable()
export class FirstOrderOfferService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly settings: SettingsService,
    private readonly promoCodes: PromoCodesService,
  ) {}

  /** إعدادات العرض الحالية — مصدر واحد للقراءة عشان الرسالة والكود مايختلفوش. */
  async currentOffer(): Promise<{
    enabled: boolean;
    discountCents: number;
    minOrderCents: number;
    validityDays: number;
    messageTemplateAr: string;
  }> {
    const [enabled, discountCents, minOrderCents, validityDays, messageTemplateAr] = await Promise.all([
      this.settings.getBoolean(FIRST_ORDER_OFFER_ENABLED_KEY, false),
      this.settings.getNumber(FIRST_ORDER_DISCOUNT_CENTS_KEY, 10_000),
      this.settings.getNumber(FIRST_ORDER_MIN_ORDER_CENTS_KEY, 30_000),
      this.settings.getNumber(FIRST_ORDER_VALIDITY_DAYS_KEY, 30),
      this.settings.getString(FIRST_ORDER_MESSAGE_KEY, ''),
    ]);
    return {
      enabled,
      discountCents: Math.max(0, Math.round(discountCents)),
      minOrderCents: Math.max(0, Math.round(minOrderCents)),
      validityDays: Math.max(1, Math.round(validityDays)),
      messageTemplateAr: messageTemplateAr,
    };
  }

  /** `{discount}` و`{min_order}` بيتبدّلوا بالقيم الفعلية وقت الإرسال — فتغيير المبلغ مايسيبش نص قديم بيكذب. */
  renderMessage(templateAr: string, discountCents: number, minOrderCents: number): string {
    const egp = (cents: number) => String(Math.round(cents / 100));
    const template =
      templateAr.trim().length > 0
        ? templateAr
        : 'معاك خصم {discount} ج.م على أول طلب — بحد أدنى {min_order} ج.م.';
    return template.split('{discount}').join(egp(discountCents)).split('{min_order}').join(egp(minOrderCents));
  }

  /**
   * بيصدر (أو يرجّع) كود عرض أول طلب لعميل. بيرجّع `null` لو العرض مقفول أو قيمته صفر.
   */
  async issueForCustomer(userId: string): Promise<FirstOrderOfferResult | null> {
    const offer = await this.currentOffer();
    if (!offer.enabled || offer.discountCents <= 0) return null;

    const existing = await this.dataSource.query<
      { code: string; min_order_amount_cents: number; discount_value: string; valid_until: Date }[]
    >(
      `SELECT code, min_order_amount_cents, discount_value, valid_until
         FROM promo_codes
        WHERE restricted_to_user_id = $1
          AND deleted_at IS NULL
          AND code LIKE 'FIRST%'
        ORDER BY created_at DESC
        LIMIT 1`,
      [userId],
    );
    if (existing.length > 0) {
      const row = existing[0];
      const discountCents = Math.round(Number(row.discount_value) * 100);
      return {
        code: row.code,
        discountCents,
        minOrderCents: Number(row.min_order_amount_cents),
        validUntil: new Date(row.valid_until),
        messageAr: this.renderMessage(offer.messageTemplateAr, discountCents, Number(row.min_order_amount_cents)),
      };
    }

    const now = new Date();
    const validUntil = new Date(now.getTime() + offer.validityDays * 86_400_000);
    const code = `FIRST${randomBytes(4).toString('hex').toUpperCase()}`;

    const promo = await this.promoCodes.create(PLATFORM_SYSTEM_USER_ID, {
      code,
      name_ar: `عرض أول طلب — ${Math.round(offer.discountCents / 100)} ج.م`,
      discount_type: DiscountType.FIXED_AMOUNT,
      discount_value: offer.discountCents / 100,
      min_order_amount_cents: offer.minOrderCents,
      usage_limit_total: 1,
      usage_limit_per_user: 1,
      // الاتنين مع بعض مقصودين: `new_customers_only` بيحمي لو الكود اتسرّب لحساب قديم،
      // و`restricted_to_user_id` بيقفله على صاحبه أصلاً.
      new_customers_only: true,
      valid_from: now.toISOString(),
      valid_until: validUntil.toISOString(),
      restricted_to_user_id: userId,
    });

    return {
      code: promo.code,
      discountCents: offer.discountCents,
      minOrderCents: offer.minOrderCents,
      validUntil,
      messageAr: this.renderMessage(offer.messageTemplateAr, offer.discountCents, offer.minOrderCents),
    };
  }
}
