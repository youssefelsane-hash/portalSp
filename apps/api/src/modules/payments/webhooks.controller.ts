import { Body, Controller, HttpCode, HttpStatus, Inject, Logger, Post, Query } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { PAYMENT_GATEWAY, PaymentGateway } from './gateways/payment-gateway.interface';
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
      );
    } catch (err) {
      // بنسجّل ونرجع 200 برضه — الخطأ اتسجّل في webhook_events.error_message بالفعل جوّه
      // finalizeGatewayWebhook، وإعادة محاولة تلقائية من البوابة مش هتصلح خطأ داخلي عندنا.
      this.logger.error('فشل معالجة webhook Paymob', err instanceof Error ? err.stack : err);
    }
    return { received: true };
  }
}
