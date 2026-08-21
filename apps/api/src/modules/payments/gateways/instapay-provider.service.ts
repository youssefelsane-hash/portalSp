import { Injectable, OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SETTING_UPDATED_EVENT, SettingUpdatedEvent } from '../../../common/events/setting-updated.event';
import { SettingsService } from '../../settings/settings.service';
import {
  CaptureResult,
  CardSaveWebhookResult,
  ChargeTokenInput,
  ChargeTokenResult,
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentOperationNotSupportedError,
  PaymentProvider,
  PaymentStatusResult,
  ReconcileResult,
  RefundInput,
  RefundResult,
  VoidResult,
  WebhookVerificationResult,
} from './payment-provider.interface';

const IPA_ADDRESS_SETTING_KEY = 'payments.instapay.ipa_address';
const RECIPIENT_NAME_SETTING_KEY = 'payments.instapay.recipient_name';

/**
 * InstaPay — مسبق الدفع، **تأكيد يدوي بس** (ADR-0013 §7 من توجيه المالك 2026-08-14). مفيش
 * تكامل webhook تلقائي موثوق متاح لـInstaPay في مصر لأي منصة تجارية عادية دلوقتي — العميل بيحوّل
 * يدويًا لرقم/IPA معلن، وموظف Finance مُصرَّح له بس هو اللي بيأكّد الاستلام
 * (`POST /admin/payments/:id/confirm-instapay`، صلاحية `payments.confirm_manual` مخصوصة).
 * `createPayment()` هنا بترجّع تعليمات التحويل بس، مش رابط دفع فعلي — `payment_status` يفضل
 * `pending` لحد التأكيد الإداري.
 *
 * **عنوان IPA/اسم المستلم بقوا يتعدّلوا من `/admin/settings` مش env vars (§33، طلب مالك صريح
 * 2026-08-20)** — القيمتين دول نص تعليمات بيتعرض للعميل بس (مش سر)، فمناسبين لمخزن settings
 * الديناميكي، ومحتاجين يتغيّروا أحيانًا (تغيير حساب بنكي مثلاً) بلا إعادة نشر — بس لازم يفضلوا
 * محدودين لـ`super_admin` بس (`settings.manage`، migration 0023 — أصلاً super_admin بس افتراضيًا).
 * `isConfigured`/`ipaAddress`/`recipientName` بقوا mutable (مش `readonly`) — بيتحمّلوا أول مرة في
 * `onModuleInit()` وبيتحدّثوا لحظيًا لما `SettingsService.update()` يطلق `SETTING_UPDATED_EVENT`
 * (بلا restart للسيرفر). **قيد نطاق صريح**: الحدث ده in-process بس (EventEmitter2)، مش هيوصل
 * لأكتر من instance واحد لو النظام يوماً بقى multi-instance — راجع setting-updated.event.ts.
 */
@Injectable()
export class InstaPayProvider implements PaymentProvider, OnModuleInit {
  readonly providerKey = 'instapay';
  isConfigured = false;
  readonly supportsRefund = false; // استرداد InstaPay = wallet credit fallback، نفس الكاش
  readonly supportsVoid = false;
  readonly supportsCapture = false;
  readonly supportsTokenization = false;

  private ipaAddress: string | undefined;
  private recipientName: string | undefined;

  constructor(private readonly settingsService: SettingsService) {}

  async onModuleInit(): Promise<void> {
    await this.reload();
  }

  // async (بترجع الـPromise، مش void) عمداً — SettingsService.update() بينادي emitAsync()
  // بالظبط عشان ينتظر الدالة دي تخلّص قبل ما يرجّع نجاح الـPATCH للأدمن، صفر سباق race condition.
  @OnEvent(SETTING_UPDATED_EVENT)
  async handleSettingUpdated(event: SettingUpdatedEvent): Promise<void> {
    if (event.key !== IPA_ADDRESS_SETTING_KEY && event.key !== RECIPIENT_NAME_SETTING_KEY) return;
    await this.reload();
  }

  private async reload(): Promise<void> {
    this.ipaAddress = (await this.settingsService.getString(IPA_ADDRESS_SETTING_KEY, '')) || undefined;
    this.recipientName = (await this.settingsService.getString(RECIPIENT_NAME_SETTING_KEY, '')) || undefined;
    this.isConfigured = Boolean(this.ipaAddress && this.recipientName);
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    if (!this.isConfigured) {
      throw new PaymentOperationNotSupportedError(this.providerKey, 'createPayment — عنوان IPA مش مُعدّ');
    }
    // نافذة التأكيد اليدوي قابلة للتحكم من الأدمن (ADR-0013 §7 + §13) — مش رقم دائم مُخترع، ده
    // نفس الرقم اللي notifications.action_required (§13) هيستخدمه لإيقاف التذكيرات بعد انتهاء الصلاحية.
    const windowHours = await this.settingsService.getNumber('payments.instapay_confirmation_window_hours', 24);
    const expiresAt = new Date(Date.now() + windowHours * 60 * 60 * 1000);
    return {
      kind: 'reference',
      // بَقّة حقيقية اتلقطت من صاحب المشروع (2026-08-21): الشاشة كانت بتعرض `input.paymentId`
      // (UUID داخلي، `payments.id`) كـ"الكود اللي لازم تذكره وقت التحويل" — بينما نص التعليمات
      // تحت ده بالظبط كان بيطلب من العميل يكتب `input.orderNumber` (رقم الطلب/الحجز القصير
      // القابل للقراءة) في ملاحظة التحويل الفعلية. قيمتين مختلفتين تمامًا، والعميل عمليًا مستحيل
      // يكتب UUID كامل في خانة ملاحظة تحويل بنكي قصيرة أصلاً. `referenceCode` هنا عرض للعميل بس
      // (لا يتخزّن — `payments.gateway_reference` بياخد `providerReference` تحت منفصل تمامًا)،
      // فتغييره آمن 100%: بقى نفس `orderNumber` المكتوب في التعليمات بالحرف — العميل يقدر ينسخه
      // ويحطّه في التحويل، وموظف الـFinance في `/instapay-confirmations` (عمود "الطلب") يقدر
      // يتحقق منه مباشرة بمقارنته بنفس القيمة دي.
      referenceCode: input.orderNumber,
      instructionsAr:
        `حوّل ${(input.amountCents / 100).toFixed(2)} ج.م عبر InstaPay لـ ${this.ipaAddress} ` +
        `(${this.recipientName}) — واكتب رقم طلبك ${input.orderNumber} في ملاحظة التحويل. ` +
        `هيتم تأكيد الدفع خلال وقت قصير من فريق الدعم.`,
      providerReference: input.paymentId,
      expiresAt,
    };
  }

  verifyWebhook(): WebhookVerificationResult {
    throw new PaymentOperationNotSupportedError(this.providerKey, 'verifyWebhook — تأكيد InstaPay يدوي بس، مفيش webhook');
  }

  getPaymentStatus(_providerReference: string): Promise<PaymentStatusResult> {
    throw new PaymentOperationNotSupportedError(this.providerKey, 'getPaymentStatus — تأكيد يدوي بس');
  }

  refund(_input: RefundInput): Promise<RefundResult> {
    throw new PaymentOperationNotSupportedError(this.providerKey, 'refund');
  }

  void(_providerReference: string): Promise<VoidResult> {
    throw new PaymentOperationNotSupportedError(this.providerKey, 'void');
  }

  capture(_providerReference: string, _amountCents: number): Promise<CaptureResult> {
    throw new PaymentOperationNotSupportedError(this.providerKey, 'capture');
  }

  reconcile(_providerReference: string): Promise<ReconcileResult> {
    throw new PaymentOperationNotSupportedError(this.providerKey, 'reconcile — تأكيد يدوي بس');
  }

  chargeToken(_input: ChargeTokenInput): Promise<ChargeTokenResult> {
    throw new PaymentOperationNotSupportedError(this.providerKey, 'chargeToken — مفيش وسيلة دفع محفوظة لـInstaPay');
  }

  verifyCardSaveWebhook(): CardSaveWebhookResult | null {
    return null;
  }
}
