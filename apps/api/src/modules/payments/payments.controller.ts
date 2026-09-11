import { BadRequestException, Controller, Get, Headers, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { isProductionLikeEnv } from '../../config/env.validation';
import { PaymentsService } from './payments.service';
import { PaymentMethodAvailabilityGuard } from './payment-method-availability.guard';
import { PaymentMethod } from './entities/payment.entity';
import {
  CardPaymentResponseDto,
  FawryReferenceResponseDto,
  InstaPayReferenceResponseDto,
  toInstaPayReferenceResponseDto,
  toPaymentResponseDto,
} from './dto/payments-response.dto';

/**
 * **سقف بدء الدفع أضيق من الافتراضي عمدًا (ج-٩)**.
 *
 * `Idempotency-Key` بيمنع الدفع المزدوج بنفس المفتاح (P0-4) — بس مابيمنعش **سيل** محاولات
 * بمفاتيح مختلفة. وكل محاولة بطاقة بتفتح جلسة عند البوابة الخارجية: بتكلّف فلوس، وبتعدّ في
 * حصّتنا عندهم، وسيل منها بيرفع نسبة الفشل عندهم فيتعامل معانا كتاجر مشبوه.
 *
 * ٢٠/دقيقة أوسع من أي عميل حقيقي (بيدفع مرة، وممكن يعيد المحاولة كام مرة لو النت وحش) وأضيق
 * من إساءة مفيدة. السقف على مستوى الكنترولر عشان يشمل **كل** طرق الدفع مع بعض — التقسيم كان
 * هيسيب المهاجم يدوّر بين الطرق ويضاعف حصّته.
 */
/**
 * سقف الدفع — ٢٠/دقيقة، **ومستحيل يترفع في staging/production**.
 *
 * السبب إن ده متغيّر أصلاً: أدوات التدقيق المالي (`scripts/financial-idempotency-audit.js`)
 * شغلها إنها تبعت **عشر محاولات دفع متزامنة** وتتأكد إن واحدة بس بتعدّي. السقف الثابت كان
 * بيرجّع 429 لكل العشرة، فالتدقيق مكانش بيقيس الـidempotency أصلاً — كان بيقيس الـthrottle.
 * والأسوأ إن التدقيق كان بيرسب دايمًا، فرسوبه بقى «طبيعي» ومحدش بيبصله.
 *
 * الحارس هنا هو اللي بيخلّي ده آمن: `isProductionLikeEnv` بيتجاهل المتغيّر تمامًا في أي بيئة
 * حقيقية، فالسقف الإنتاجي ثابت بالكود مهما كانت البيئة.
 */
const PAYMENT_THROTTLE_LIMIT = isProductionLikeEnv(process.env.NODE_ENV)
  ? 20
  : parseInt(process.env.PAYMENTS_THROTTLE_LIMIT ?? '20', 10);

@Controller('orders')
@Roles(UserType.CUSTOMER)
@Throttle({ default: { limit: PAYMENT_THROTTLE_LIMIT, ttl: 60_000 } })
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    // مفاتيح إيقاف وسائل الدفع (ج-١٨) — كانت مقروءة في قايمة العرض بس، فإقفال المفتاح كان
    // بيخفي الزرار والفلوس تفضل تتحرّك من أي كلاينت بينادي الـendpoint مباشرةً.
    private readonly methodAvailability: PaymentMethodAvailabilityGuard,
  ) {}

  @Post(':id/pay-with-wallet')
  async payWithWallet(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    // كل عملية دفع لازم Idempotency-Key — docs/01-master-plan.md §1.4، عشان retry من الشبكة
    // ميعملش دفعتين لنفس الطلب. مش اختياري.
    if (!idempotencyKey || idempotencyKey.trim().length === 0) {
      throw new BadRequestException('Idempotency-Key header مطلوب');
    }

    await this.methodAvailability.assertEnabled(PaymentMethod.WALLET);

    const payment = await this.paymentsService.payWithWallet(user.sub, id, idempotencyKey.trim());
    return toPaymentResponseDto(payment);
  }

  @Post(':id/pay-with-card')
  async payWithCard(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ): Promise<CardPaymentResponseDto> {
    if (!idempotencyKey || idempotencyKey.trim().length === 0) {
      throw new BadRequestException('Idempotency-Key header مطلوب');
    }

    await this.methodAvailability.assertEnabled(PaymentMethod.CARD);

    const { payment, redirectUrl } = await this.paymentsService.payWithCard(user.sub, id, idempotencyKey.trim());
    return { payment: toPaymentResponseDto(payment), redirect_url: redirectUrl };
  }

  @Post(':id/pay-with-fawry-reference')
  async payWithFawryReference(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ): Promise<FawryReferenceResponseDto> {
    if (!idempotencyKey || idempotencyKey.trim().length === 0) {
      throw new BadRequestException('Idempotency-Key header مطلوب');
    }

    await this.methodAvailability.assertEnabled(PaymentMethod.FAWRY_REFERENCE);

    const { payment, referenceNumber, expiresAt } = await this.paymentsService.payWithFawryReference(
      user.sub,
      id,
      idempotencyKey.trim(),
    );
    return {
      payment: toPaymentResponseDto(payment),
      reference_number: referenceNumber,
      expires_at: expiresAt ? expiresAt.toISOString() : null,
    };
  }

  /**
   * InstaPay — مسبق الدفع، تأكيد يدوي بس (ADR-0013 §7). بيرجّع تعليمات التحويل بالعربي؛
   * `payment_status` يفضل `pending` والطلب `PENDING_PAYMENT` (لو دفع قبل توزيع) لحد ما موظف
   * Finance يأكّد الاستلام عبر `POST /admin/payments/:id/confirm-instapay`.
   */
  @Post(':id/pay-with-instapay')
  async payWithInstaPay(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ): Promise<InstaPayReferenceResponseDto> {
    if (!idempotencyKey || idempotencyKey.trim().length === 0) {
      throw new BadRequestException('Idempotency-Key header مطلوب');
    }

    await this.methodAvailability.assertEnabled(PaymentMethod.INSTAPAY);

    const details = await this.paymentsService.payWithInstaPay(user.sub, id, idempotencyKey.trim());
    return toInstaPayReferenceResponseDto(details);
  }

  /**
   * **استئناف شاشة التحويل** (طلب مالك 2026-09-11: «لو شخص طلع من صفحة الدفع وعايز يدخل تاني،
   * أو طلع من التطبيق خالص وراح على InstaPay وبعدين رجع عشان ياخد الرقم copy»).
   *
   * ده سلوك InstaPay **الطبيعي** مش حالة شاذة: العميل لازم يسيب تطبيقنا ويفتح تطبيق البنك.
   * من غير المسار ده، الرجوع كان معناه إعادة نداء `pay-with-instapay` (كتابة، وبتطلب
   * `Idempotency-Key`) — فالتطبيق كان مضطر يخزّن الرد أو يخاطر بدفعة تانية.
   *
   * **قراءة بحتة**: بترجّع تفاصيل الدفعة المعلّقة القايمة بالفعل، مابتنشئش دفعة جديدة
   * ومابتغيّرش أي حالة، فالعميل يقدر يفتح ويقفل الشاشة قد ما يحب بأمان.
   */
  @Get(':id/instapay-transfer')
  async getInstaPayTransfer(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<InstaPayReferenceResponseDto> {
    return toInstaPayReferenceResponseDto(await this.paymentsService.getInstaPayTransfer(user.sub, id));
  }

  /**
   * بَقّة حقيقية اتلقطت — العميل مكانش عنده أي طريقة يسجّل بيها "أنا حوّلت الفلوس فعلاً" غير
   * polling محلي بلا أثر على السيرفر (شاشة InstaPay في customer-app كانت بتسأل GET على الطلب
   * 5 مرات بس، مفيش أي POST). بيسجّل `customer_confirmed_transfer_at` — مش تأكيد نهائي للدفع
   * (ده لسه بيتم بس عبر `confirmInstaPayPayment` من الأدمن)، بس بيفرّق للأدمن بين دفعة محدش
   * لمسها ودفعة العميل بيدّعي إنه حوّلها.
   */
  @Post(':id/confirm-instapay-transfer')
  async confirmInstaPayTransfer(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    const payment = await this.paymentsService.confirmInstaPayTransferByCustomer(user.sub, id);
    return toPaymentResponseDto(payment);
  }
}
