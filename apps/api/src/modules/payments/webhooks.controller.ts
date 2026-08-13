import { Body, Controller, HttpCode, HttpStatus, Inject, Logger, Post, Query } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { PAYMENT_GATEWAY, PaymentGateway } from './gateways/payment-gateway.interface';
import { FAWRY_GATEWAY, FawryGateway } from './gateways/fawry-gateway.interface';
import { PaymentMethod } from './entities/payment.entity';
import { PaymentsService } from './payments.service';

/**
 * مسارات webhooks بوابات الدفع — @Public() عمداً (البوابة الخارجية مالهاش JWT عندنا)، الأمان
 * هنا بالكامل عبر التحقق من توقيع HMAC جوّه PaymentGateway.verifyAndParseWebhook()، مش عبر Guard.
 * دايماً بيرجع 200 حتى لو الحدث اترفض/اتجاهل (بوابات الدفع بتعتبر أي رد غير 2xx = "فشل التسليم"
 * وتعيد المحاولة كذا مرة — مفيش داعي نخليها تعيد إرسال حدث احنا فعلاً معالجينه أو رافضينه بوعي).
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
    try {
      const result = this.paymentGateway.verifyAndParseWebhook(body, hmac);
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
    } catch (err) {
      // بنسجّل ونرجع 200 برضه — الخطأ اتسجّل في webhook_events.error_message بالفعل جوّه
      // finalizeGatewayWebhook، وإعادة محاولة تلقائية من البوابة مش هتصلح خطأ داخلي عندنا.
      this.logger.error('فشل معالجة webhook Paymob', err instanceof Error ? err.stack : err);
    }
    return { received: true };
  }

  // بوابة تانية جنب Paymob — كود مرجعي FawryPay، توقيعها بييجي جوّه الـ body نفسه (`signature`)
  // مش query param زي Paymob، فمفيش @Query('hmac') هنا.
  @Public()
  @Post('fawry')
  @HttpCode(HttpStatus.OK)
  async handleFawryWebhook(@Body() body: Record<string, unknown>) {
    try {
      const result = this.fawryGateway.verifyAndParseWebhook(body);
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
    } catch (err) {
      this.logger.error('فشل معالجة webhook Fawry', err instanceof Error ? err.stack : err);
    }
    return { received: true };
  }
}
