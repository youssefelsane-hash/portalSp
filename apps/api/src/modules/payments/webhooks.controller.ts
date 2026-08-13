import { Body, Controller, HttpCode, HttpStatus, Inject, Logger, Post, Query } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { PAYMENT_GATEWAY, PaymentGateway } from './gateways/payment-gateway.interface';
import { FAWRY_GATEWAY, FawryGateway } from './gateways/fawry-gateway.interface';
import { PaymentMethod } from './entities/payment.entity';
import { PaymentsService } from './payments.service';

/**
 * مسارات webhooks بوابات الدفع — @Public() عمداً (البوابة الخارجية مالهاش JWT عندنا)، الأمان
 * هنا بالكامل عبر التحقق من توقيع HMAC جوّه PaymentGateway.verifyAndParseWebhook()، مش عبر Guard.
 *
 * **بَقّة أمنية/تشغيلية حقيقية كانت هنا واتصلحت (مراجعة أمان شاملة 2026-08-13، P0-8)**: الكنترولر
 * كان بيرجع `200` **دايمًا** حتى لو `finalizeGatewayWebhook` رمى استثناء غير متوقّع (DB/Redis
 * واقع، خطأ داخلي عابر) — يعني لو Paymob/Fawry بعتوا نجاح والداتابيز وقعت لحظتها، كنا بنرجّع
 * "استلمت" للبوابة (فمتحاولش تاني) بينما الدفعة الحقيقية فضلت غير متسوّاة فعليًا. الفرق المهم:
 * - `verifyAndParseWebhook()` بترمي بس لو الحمولة نفسها غير قابلة للتحليل (توقيع/شكل غلط تمامًا)
 *   — إعادة إرسال نفس الحمولة الغلط مش هتصلح حاجة، فده لسه بيترجم لـ`200` (تجاهل واعي).
 * - `finalizeGatewayWebhook()` **مبقتش ترمي إلا لأخطاء داخلية غير متوقّعة فعلاً** — كل قرار واعي
 *   (توقيع غلط، مبلغ مش مطابق، دفعة already معالجة) بيرجع عادي من غيرها من غير استثناء. أي throw
 *   طالع منها دلوقتي بيتسيب يتصاعد لـNest، فيرجّع `5xx` حقيقي — البوابة بتشوفه "فشل تسليم" وتعيد
 *   المحاولة تلقائيًا (سلوكها القياسي)، بدل ما نكذب عليها بـ`200` كاذب.
 */
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly paymentsService: PaymentsService,
    @Inject(PAYMENT_GATEWAY) private readonly paymentGateway: PaymentGateway,
    @Inject(FAWRY_GATEWAY) private readonly fawryGateway: FawryGateway,
  ) {}

  @Public()
  @Post('paymob')
  @HttpCode(HttpStatus.OK)
  async handlePaymobWebhook(@Body() body: Record<string, unknown>, @Query('hmac') hmac: string | undefined) {
    let result: ReturnType<PaymentGateway['verifyAndParseWebhook']>;
    try {
      result = this.paymentGateway.verifyAndParseWebhook(body, hmac);
    } catch (err) {
      // حمولة غير قابلة للتحليل خالص — إعادة إرسالها مش هتصلح حاجة، تجاهل واعي بـ200.
      this.logger.error('فشل تحليل webhook Paymob (حمولة غير صالحة)', err instanceof Error ? err.stack : err);
      return { received: true };
    }

    // من هنا، أي throw معناه خطأ داخلي غير متوقّع جوّه finalizeGatewayWebhook — بيتصاعد لـNest
    // عمدًا (مش بيتلقّط) عشان يرجّع 5xx حقيقي ويخلي Paymob تعيد المحاولة تلقائيًا.
    await this.paymentsService.finalizeGatewayWebhook(
      result.externalEventId,
      result.eventType,
      this.paymentGateway.providerName,
      body,
      result.signatureValid,
      result.paymentId,
      result.succeeded,
      result.failureReason,
      result.gatewayTransactionId,
      PaymentMethod.CARD,
      result.amountCents,
    );
    return { received: true };
  }

  // بوابة تانية جنب Paymob — كود مرجعي FawryPay، توقيعها بييجي جوّه الـ body نفسه (`signature`)
  // مش query param زي Paymob، فمفيش @Query('hmac') هنا.
  @Public()
  @Post('fawry')
  @HttpCode(HttpStatus.OK)
  async handleFawryWebhook(@Body() body: Record<string, unknown>) {
    let result: ReturnType<FawryGateway['verifyAndParseWebhook']>;
    try {
      result = this.fawryGateway.verifyAndParseWebhook(body);
    } catch (err) {
      this.logger.error('فشل تحليل webhook Fawry (حمولة غير صالحة)', err instanceof Error ? err.stack : err);
      return { received: true };
    }

    await this.paymentsService.finalizeGatewayWebhook(
      result.externalEventId,
      result.eventType,
      this.fawryGateway.providerName,
      body,
      result.signatureValid,
      result.paymentId,
      result.succeeded,
      result.failureReason,
      result.gatewayTransactionId,
      PaymentMethod.FAWRY_REFERENCE,
      result.amountCents,
    );
    return { received: true };
  }
}
