import { HttpStatus, Injectable } from '@nestjs/common';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { SettingsService } from '../settings/settings.service';
import { PaymentMethod } from './entities/payment.entity';

/**
 * **مفاتيح إيقاف وسائل الدفع — مصدر حقيقة واحد للعرض والتنفيذ** (ج-١٨).
 *
 * ## البَقّة اللي بيقفلها (اتقاست حيًا في تدقيق ج-١٨)
 *
 * `payments.wallet_enabled` و`payments.card_enabled` و`payments.instapay_enabled` كانوا
 * **مقروءين في مكان واحد بس**: `PaymentChannelsController.list()` — وهو الـendpoint اللي
 * بيقول للتطبيق «اعرض إيه من الأزرار».
 *
 * يعني إقفال المفتاح كان **بيخفي الزرار وبس**. مسار التنفيذ نفسه (`POST /orders/:id/pay-with-*`)
 * ماكانش بيفحص أي حاجة، فالدفع كان بيعدّي عادي من:
 * - كلاينت بينادي الـendpoint مباشرةً،
 * - تطبيق شايل قايمة قنوات قديمة في الكاش،
 * - أو أي واجهة تانية مش بتسأل `/payment-channels` أصلاً.
 *
 * الأثر العملي أسوأ من غياب المفتاح: وقت حادثة («وقّف الدفع بالمحفظة **دلوقتي**») المالك
 * بيقفل المفتاح، ولوحة الأدمن بتقول `enabled=false`، **والفلوس بتفضل تتحرّك**. مفتاح طوارئ
 * بيكدب أخطر من مفتاح مش موجود، لأن المالك بيبني عليه قرار ويبطّل يدوّر على حل تاني.
 *
 * قيس حي (ج-١٨ `ر-٢/ب`): المفتاح `false` والدفع رجّع `201` وخصم فعلاً.
 *
 * ## ليه حارس مشترك مش فحص متكرر في كل endpoint
 *
 * الخريطة بين «المفتاح» و«طريقة الدفع» كانت موجودة أصلاً في `PaymentChannelsController`.
 * نسخها في مسار التنفيذ كان هيعمل **نسختين بتفرقوا بمرور الوقت** — وسيلة دفع جديدة تتضاف
 * لواحدة وتُنسى في التانية، وده بالظبط شكل البَقّة دي من الأول. الكنترولر والتنفيذ بينادوا
 * `isEnabled()` هنا، فالخريطة واحدة.
 *
 * **الكاش مقصود**: `SettingsService` عنده كاش محلي + Redis، والتغيير من
 * `PATCH /admin/settings/:key` بيبطّلهم فورًا — فالإيقاف بيسري بلا إعادة تشغيل (اتقاس في
 * ج-١٨ `ر-٢/ج`).
 */
@Injectable()
export class PaymentMethodAvailabilityGuard {
  /**
   * المفتاح المسؤول عن كل وسيلة، وقيمته الافتراضية.
   *
   * `FAWRY_REFERENCE` افتراضيه `false` (مش أولوية V1، ADR-0013) — عكس الباقي.
   *
   * `Partial` عمدًا: الوسايل اللي مالهاش مفتاح إيقاف (`BANK_TRANSFER`، `CORPORATE_CREDIT` —
   * مسارات يدوية بموافقة بشرية أصلاً) بتعدّي. الغياب هنا معناه «مفيش مفتاح»، مش «مقفولة».
   */
  private static readonly SWITCHES: Partial<Record<PaymentMethod, { key: string; fallback: boolean }>> = {
    [PaymentMethod.CASH]: { key: 'payments.cash_enabled', fallback: true },
    [PaymentMethod.CARD]: { key: 'payments.card_enabled', fallback: true },
    [PaymentMethod.WALLET]: { key: 'payments.wallet_enabled', fallback: true },
    [PaymentMethod.INSTAPAY]: { key: 'payments.instapay_enabled', fallback: true },
    [PaymentMethod.FAWRY_REFERENCE]: { key: 'payments.fawry_enabled', fallback: false },
  };

  private static readonly LABELS_AR: Partial<Record<PaymentMethod, string>> = {
    [PaymentMethod.CASH]: 'الدفع كاش',
    [PaymentMethod.CARD]: 'الدفع بالبطاقة',
    [PaymentMethod.WALLET]: 'الدفع من المحفظة',
    [PaymentMethod.INSTAPAY]: 'الدفع بـInstaPay',
    [PaymentMethod.FAWRY_REFERENCE]: 'الدفع بكود فوري',
  };

  constructor(private readonly settings: SettingsService) {}

  async isEnabled(method: PaymentMethod): Promise<boolean> {
    const sw = PaymentMethodAvailabilityGuard.SWITCHES[method];
    if (!sw) return true;
    return this.settings.getBoolean(sw.key, sw.fallback);
  }

  /** بيتنادى من **مسار التنفيذ** — القرار الحاسم، مش قايمة العرض. */
  async assertEnabled(method: PaymentMethod): Promise<void> {
    if (await this.isEnabled(method)) return;
    const label = PaymentMethodAvailabilityGuard.LABELS_AR[method] ?? 'وسيلة الدفع دي';
    // **الرسالة بتدلّ على بديل**: الإيقاف بيخص وسيلة واحدة والباقي شغّال، والعميل لازم يعرف
    // كده صراحةً بدل ما يفتكر إن الدفع كله واقع ويسيب الطلب.
    throw new ApiException(
      ErrorCode.SYS_002,
      `${label} متوقّف مؤقتًا — جرّب وسيلة دفع تانية من قايمة الطرق المتاحة، أو حاول تاني بعد شوية`,
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}
