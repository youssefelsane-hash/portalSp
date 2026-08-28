import { EventEmitter2 } from '@nestjs/event-emitter';
import { HttpStatus, Injectable, Inject, Optional } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AuditActorMeta, AuditLogService } from '../audit/audit-log.service';
import { randomUUID } from 'crypto';
import { safeExtensionForFile } from '../../common/storage/file-signature-validator';
import { STORAGE_SERVICE, StorageService } from '../../common/storage/storage.service';
import { uploadWithOrphanCleanup } from '../../common/storage/upload-with-orphan-cleanup.util';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import {
  INSTALLMENT_APPLICATION_SUBMITTED_EVENT,
  INSTALLMENTS_APPLICATION_REVIEWED_EVENT,
  InstallmentApplicationReviewedEvent,
  InstallmentApplicationSubmittedEvent,
} from '../../common/events/installment.events';
import { Order, OrderPaymentStatus } from '../orders/entities/order.entity';
import { SavedPaymentMethod } from '../payments/entities/saved-payment-method.entity';
import { CustomerProfilesService } from '../customers/customer-profiles.service';
import { PaymentPoliciesService } from '../payment-policies/payment-policies.service';
import {
  assertBreakdownInvariant,
  computeInstallmentBreakdown,
  isAmountWithinPlanLimits,
} from './installment-calculator';
import { InstallmentPlanDocumentRequirement } from './entities/installment-plan-document-requirement.entity';
import { InstallmentPlan } from './entities/installment-plan.entity';
import { InstallmentApplication } from './entities/installment-application.entity';
import { InstallmentApplicationStatus } from './entities/installment-status.enum';
import { SettingsService } from '../settings/settings.service';

/**
 * سبب عدم أهلية التقسيط لطلب (docs/08 §64.ز) — **كود** مش نص، عشان الواجهة تقرر تعرض إيه من غير
 * ما تطابق نصوص عربية (مطابقة نصية بتتكسر في صمت أول ما حد يعدّل صياغة رسالة).
 */
export type InstallmentIneligibilityReason =
  | 'disabled'
  | 'order_cancelled'
  | 'application_pending'
  | 'application_approved'
  | 'price_undetermined'
  | 'amount_out_of_range'
  | 'no_plans'
  // بَقّة حقيقية اتلقطت (docs/08 §82) — الطلب اتحصّل بالفعل (كاش أو إلكتروني)، مفيش معنى يتقسّط.
  | 'already_paid';

export interface InstallmentOrderOptions {
  eligible: boolean;
  reason_code: InstallmentIneligibilityReason | null;
  reason_ar: string | null;
  plans: Record<string, unknown>[];
}

export interface IncomingFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

/**
 * محرك التقسيط — طبقة الخطط/التقديمات/المراجعة/الجدولة. **التحصيل الفعلي والتأكيد في
 * PaymentsService** (نفس الـPayment Engine الموجود: provider registry + idempotency + webhook
 * authoritative) — مفيش تبعية دائرية ومفيش منطق دفع مكرر.
 *
 * **قرار مالي موثّق (مش تخمين)**: تحصيل الأقساط = مستحق العميل للمنصة (receivable)، بيتسجل
 * double-entry منفصل بنوع installment_collection. تسوية الفني/المزوّد فاضلة زي ما هي على مستوى
 * الطلب (settleAndComplete الحالية) — يعني **المنصة هي اللي بتحمل مخاطرة التمويل** في v1،
 * والفرق بين receivable/paid/platform/entitlement فضل ظاهر (README §النموذج المالي).
 */
@Injectable()
export class InstallmentsService {
  constructor(
    @InjectRepository(InstallmentPlan) private readonly plans: Repository<InstallmentPlan>,
    @InjectRepository(InstallmentApplication) private readonly applications: Repository<InstallmentApplication>,
    @InjectRepository(InstallmentPlanDocumentRequirement)
    private readonly docRequirements: Repository<InstallmentPlanDocumentRequirement>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly customerProfiles: CustomerProfilesService,
    private readonly paymentPolicies: PaymentPoliciesService,
    private readonly events: EventEmitter2,
    private readonly auditLog: AuditLogService,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
    @Optional() private readonly settingsService?: SettingsService,
  ) {}

  private async assertInstallmentsEnabled(): Promise<void> {
    const enabled = await this.settingsService?.getBoolean('payments.installments_enabled', true) ?? true;
    if (!enabled) {
      throw new ApiException(ErrorCode.VAL_001, 'التقسيط متوقف مؤقتًا من إعدادات الإدارة', HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  // ===================== الخطط (أدمن) =====================

  async createPlan(
    adminUserId: string,
    dto: {
      name_ar: string;
      installment_count: number;
      interval_days?: number;
      financing_percentage?: number;
      fixed_fee_cents?: number;
      down_payment_percentage?: number;
      min_order_amount_cents?: number | null;
      max_order_amount_cents?: number | null;
      allowed_provider?: string;
      document_requirements?: { doc_type: string; label_ar: string; is_required?: boolean; display_order?: number }[];
    },
    meta?: AuditActorMeta,
  ): Promise<InstallmentPlan> {
    if (dto.min_order_amount_cents != null && dto.max_order_amount_cents != null && dto.min_order_amount_cents > dto.max_order_amount_cents) {
      throw new ApiException(ErrorCode.VAL_001, 'الحد الأدنى أكبر من الأقصى', HttpStatus.BAD_REQUEST);
    }
    return this.dataSource.transaction(async (manager) => {
      const plan = await manager.save(
        manager.create(InstallmentPlan, {
          nameAr: dto.name_ar,
          installmentCount: dto.installment_count,
          intervalDays: dto.interval_days ?? 30,
          financingPercentage: String(dto.financing_percentage ?? 0),
          fixedFeeCents: dto.fixed_fee_cents ?? 0,
          downPaymentPercentage: String(dto.down_payment_percentage ?? 0),
          minOrderAmountCents: dto.min_order_amount_cents ?? null,
          maxOrderAmountCents: dto.max_order_amount_cents ?? null,
          allowedProvider: dto.allowed_provider ?? 'paymob',
          isActive: true,
        }),
      );
      for (const req of dto.document_requirements ?? []) {
        await manager.save(
          manager.create(InstallmentPlanDocumentRequirement, {
            planId: plan.id,
            docType: req.doc_type,
            labelAr: req.label_ar,
            isRequired: req.is_required ?? true,
            displayOrder: req.display_order ?? 0,
          }),
        );
      }
      await this.auditLog.record({
        actorUserId: adminUserId,
        actorRole: 'admin',
        action: 'installment_plan.created',
        entityType: 'installment_plan',
        entityId: plan.id,
        newValues: { name_ar: plan.nameAr, count: plan.installmentCount },
        meta,
      }, manager);
      return plan;
    });
  }

  async updatePlan(adminUserId: string, planId: string, dto: Record<string, unknown>, meta?: AuditActorMeta): Promise<InstallmentPlan> {
    return this.dataSource.transaction(async (manager) => {
      const plan = await manager
        .createQueryBuilder(InstallmentPlan, 'plan')
        .setLock('pessimistic_write')
        .where('plan.id = :planId', { planId })
        .getOne();
      if (!plan) throw new ApiException(ErrorCode.VAL_001, 'خطة التقسيط غير موجودة', HttpStatus.NOT_FOUND);
      const oldValues = {
        name_ar: plan.nameAr,
        interval_days: plan.intervalDays,
        financing_percentage: plan.financingPercentage,
        down_payment_percentage: plan.downPaymentPercentage,
        fixed_fee_cents: plan.fixedFeeCents,
        min_order_amount_cents: plan.minOrderAmountCents,
        max_order_amount_cents: plan.maxOrderAmountCents,
        is_active: plan.isActive,
      };
      // Existing applications retain their immutable snapshots; these fields affect new applications only.
      const map: Record<string, keyof InstallmentPlan> = {
        name_ar: 'nameAr',
        interval_days: 'intervalDays',
        is_active: 'isActive',
      };
      for (const [dtoKey, entityKey] of Object.entries(map)) {
        if (dto[dtoKey] !== undefined) (plan as unknown as Record<string, unknown>)[entityKey] = dto[dtoKey];
      }
      if (dto.financing_percentage !== undefined) plan.financingPercentage = String(dto.financing_percentage);
      if (dto.down_payment_percentage !== undefined) plan.downPaymentPercentage = String(dto.down_payment_percentage);
      if (dto.fixed_fee_cents !== undefined) plan.fixedFeeCents = Number(dto.fixed_fee_cents);
      if (dto.min_order_amount_cents !== undefined) plan.minOrderAmountCents = dto.min_order_amount_cents as number | null;
      if (dto.max_order_amount_cents !== undefined) plan.maxOrderAmountCents = dto.max_order_amount_cents as number | null;
      if (plan.minOrderAmountCents != null && plan.maxOrderAmountCents != null && plan.minOrderAmountCents > plan.maxOrderAmountCents) {
        throw new ApiException(ErrorCode.VAL_001, 'الحد الأدنى أكبر من الأقصى', HttpStatus.BAD_REQUEST);
      }
      await manager.save(plan);
      await this.auditLog.record({
        actorUserId: adminUserId,
        actorRole: 'admin',
        action: 'installment_plan.updated',
        entityType: 'installment_plan',
        entityId: plan.id,
        oldValues,
        newValues: { ...dto },
        meta,
      }, manager);
      return plan;
    });
  }

  async listPlans(): Promise<InstallmentPlan[]> {
    return this.plans.find({ order: { createdAt: 'DESC' } });
  }

  async listServicesForPlan(planId: string): Promise<{ id: string; name_ar: string; slug: string }[]> {
    return this.dataSource.query(
      `SELECT s.id, s.name_ar, s.slug FROM services s
       JOIN service_installment_plans sp ON sp.service_id = s.id
       WHERE sp.plan_id = $1 AND s.is_active`,
      [planId],
    );
  }

  async setPlanForService(adminUserId: string, serviceId: string, planId: string, enabled: boolean, meta?: AuditActorMeta): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      if (enabled) {
        await manager.query(
          `INSERT INTO service_installment_plans (service_id, plan_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [serviceId, planId],
        );
      } else {
        await manager.query(`DELETE FROM service_installment_plans WHERE service_id = $1 AND plan_id = $2`, [
          serviceId,
          planId,
        ]);
      }
      await this.auditLog.record({
        actorUserId: adminUserId,
        actorRole: 'admin',
        action: enabled ? 'installment_plan.enabled_for_service' : 'installment_plan.disabled_for_service',
        entityType: 'service',
        entityId: serviceId,
        newValues: { plan_id: planId, enabled },
        meta,
      }, manager);
    });
  }

  async listPlansForService(serviceId: string): Promise<Record<string, unknown>[]> {
    if (!(await this.settingsService?.getBoolean('payments.installments_enabled', true) ?? true)) return [];
    // raw query عمدًا مع أسماء snake_case مطابقة للرد المتوقع في الواجهات
    return this.dataSource.query(
      `SELECT p.id, p.name_ar, p.installment_count, p.interval_days,
              p.financing_percentage::float AS financing_percentage,
              p.fixed_fee_cents,
              p.down_payment_percentage::float AS down_payment_percentage,
              p.min_order_amount_cents, p.max_order_amount_cents,
              p.requires_saved_card, p.allowed_provider
       FROM installment_plans p
       JOIN service_installment_plans sp ON sp.plan_id = p.id
       WHERE sp.service_id = $1 AND p.is_active = true AND p.deleted_at IS NULL`,
      [serviceId],
    );
  }

  /**
   * أهلية التقسيط **لطلب بعينه** (docs/08 §64.ز).
   *
   * بلاغ المالك: «التقسيط… بيكون معلق فوق في تفاصيل الطلب على الرغم إنك لو اخترت أي خطة بيقولك
   * التقسيط مش متاح».
   *
   * السبب: `listPlansForService()` بترد على سؤال «الخدمة دي عليها خطط؟» — سؤال مختلف تمامًا عن
   * «الطلب ده ينفع يتقسّط؟». كل قيود الأهلية الحقيقية (مبلغ الطلب داخل حدود الخطة، الطلب مش
   * متلغي، السعر اتحدد أصلاً، مفيش تقديم نشط) كانت بتتفحص **بس** وقت التقديم — فالبانر بيفضل
   * معلق والرفض بييجي بعد ما العميل يختار ويوافق على الشروط.
   *
   * الميثود دي بتنقل **نفس** قيود `submitApplication()` بالحرف لقبل العرض. أي قيد جديد هناك
   * لازم ينزل هنا كمان، وإلا البَقّة بترجع.
   */
  async listOptionsForOrder(
    userId: string,
    orderId: string,
  ): Promise<InstallmentOrderOptions> {
    const enabled = (await this.settingsService?.getBoolean('payments.installments_enabled', true)) ?? true;
    if (!enabled) {
      return { eligible: false, reason_code: 'disabled', reason_ar: 'التقسيط متوقف مؤقتًا', plans: [] };
    }

    const profile = await this.customerProfiles.findByUserIdOrThrow(userId);
    const order = await this.dataSource.getRepository(Order).findOne({
      where: { id: orderId, customerId: profile.id },
    });
    if (!order) {
      throw new ApiException(ErrorCode.VAL_001, 'الطلب غير موجود', HttpStatus.NOT_FOUND);
    }

    if (['cancelled_by_customer', 'cancelled_by_system', 'cancelled_by_technician'].includes(order.orderStatus)) {
      return { eligible: false, reason_code: 'order_cancelled', reason_ar: 'الطلب ده متلغي', plans: [] };
    }

    // بَقّة حقيقية اتلقطت (docs/08 §82، بلاغ مالك بلقطة شاشة لطلب مقبول ومعيّن له فني بالفعل):
    // القيد الوحيد فوق كان حالة الطلب (order_status)، وده مش كافي — طلب مقبول ومعيّن له فني بالفعل
    // ولسه من غير أي تحصيل (paymentStatus=unpaid) لازم يفضل مؤهّل (التقسيط مش مربوط بمرحلة معيّنة
    // من دورة الطلب، installments/README.md §"الجدولة دورة حياة منفصلة"). لكن طلب **اتحصّل بالفعل**
    // (كاش أو إلكتروني) مفيش أي معنى يعرضله يقسّط مبلغ اتحصّل خلاص.
    if (
      [OrderPaymentStatus.PAID, OrderPaymentStatus.PARTIALLY_REFUNDED, OrderPaymentStatus.REFUNDED].includes(
        order.paymentStatus,
      )
    ) {
      return { eligible: false, reason_code: 'already_paid', reason_ar: 'الطلب ده اتحصّل بالفعل', plans: [] };
    }

    const [existingActive] = await this.dataSource.query<{ status: string }[]>(
      `SELECT status FROM installment_applications
       WHERE order_id = $1 AND status IN ('pending_review','approved') AND deleted_at IS NULL LIMIT 1`,
      [orderId],
    );
    if (existingActive) {
      const approved = existingActive.status === 'approved';
      return {
        eligible: false,
        reason_code: approved ? 'application_approved' : 'application_pending',
        reason_ar: approved ? 'التقسيط متفعّل على الطلب ده بالفعل' : 'طلب التقسيط بتاعك تحت المراجعة',
        plans: [],
      };
    }

    const priceCents = order.totalAmountCents - order.discountAmountCents;
    if (priceCents <= 0) {
      // نفس تفرقة §64.ب: «لسه ما اتحددش» مش «صفر».
      return { eligible: false, reason_code: 'price_undetermined', reason_ar: 'سعر الطلب لسه ما اتحددش', plans: [] };
    }

    const all = await this.listPlansForService(order.serviceId);
    const eligiblePlans = all.filter((plan) =>
      isAmountWithinPlanLimits(priceCents, {
        minOrderAmountCents: (plan.min_order_amount_cents as number | null) ?? null,
        maxOrderAmountCents: (plan.max_order_amount_cents as number | null) ?? null,
      }),
    );
    if (eligiblePlans.length === 0) {
      return all.length === 0
        ? { eligible: false, reason_code: 'no_plans', reason_ar: null, plans: [] }
        : {
            eligible: false,
            reason_code: 'amount_out_of_range',
            reason_ar: 'مبلغ الطلب مش في حدود أي خطة تقسيط متاحة',
            plans: [],
          };
    }
    return { eligible: true, reason_code: null, reason_ar: null, plans: eligiblePlans };
  }

  /** الخطة + متطلبات المستندات — للعميل قبل التقديم ولواجهة الأدمن. */
  async getPlanWithRequirements(planId: string): Promise<{ plan: InstallmentPlan; requirements: InstallmentPlanDocumentRequirement[] }> {
    const plan = await this.plans.findOne({ where: { id: planId, isActive: true } });
    if (!plan) throw new ApiException(ErrorCode.VAL_001, 'خطة التقسيط غير موجودة', HttpStatus.NOT_FOUND);
    const requirements = await this.docRequirements.find({ where: { planId }, order: { displayOrder: 'ASC' } });
    return { plan, requirements };
  }

  // ===================== تقديم طلب العميل =====================

  /**
   * تقديم طلب تقسيط — **طلب مراجعة مش موافقة**. الحساب authoritative من الباك-إند بالكامل:
   * العميل مايبعتش غير اختياراته (خطة/وسيلة دفع/قبول شروط) وأي مبلغ محسوب عنده يتجاهل تمامًا.
   */
  async submitApplication(params: {
    userId: string;
    orderId: string;
    planId: string;
    paymentMethodId?: string;
    acceptedPolicyVersionIds: string[];
  }): Promise<InstallmentApplication> {
    await this.assertInstallmentsEnabled();
    const profile = await this.customerProfiles.findByUserIdOrThrow(params.userId);

    // الخطة ومتطلباتها قبل فتح الـtransaction (قراءات مستقلة)
    const { plan } = await this.getPlanWithRequirements(params.planId);

    let createdOrderNumber = '';
    return this.dataSource.transaction(async (manager) => {
      // طلب واحد ليه application نشط واحد — الفحص جوّه نفس القفل، والـpartial unique index
      // في 0177 بيقفل السباق على مستوى DB كخط أخير.
      const [existingActive] = await manager.query<{ id: string }[]>(
        `SELECT id FROM installment_applications WHERE order_id = $1 AND status IN ('pending_review','approved') AND deleted_at IS NULL LIMIT 1`,
        [params.orderId],
      );
      if (existingActive) {
        throw new ApiException(ErrorCode.VAL_001, 'الطلب ده عليه تقديم تقسيط نشط بالفعل', HttpStatus.CONFLICT);
      }

      // قفل تشاؤمي على الطلب — السعر authoritative وقت اللحظة دي بالظبط
      const order = await manager
        .createQueryBuilder(Order, 'o')
        .setLock('pessimistic_write')
        .where('o.id = :orderId AND o.customer_id = :customerId', { orderId: params.orderId, customerId: profile.id })
        .getOne();
      if (!order) throw new ApiException(ErrorCode.VAL_001, 'الطلب غير موجود', HttpStatus.NOT_FOUND);
      if (['cancelled_by_customer', 'cancelled_by_system', 'cancelled_by_technician'].includes(order.orderStatus)) {
        throw new ApiException(ErrorCode.VAL_001, 'مينفعش تقسيط طلب متلغي', HttpStatus.BAD_REQUEST);
      }
      // نفس قيد listOptionsForOrder() فوق بالحرف (docs/08 §82) — لازم ينزل هنا كمان (الدالة دي
      // مصدر الحقيقة الفعلي، listOptionsForOrder() بس بتعكسه قبل العرض).
      if (
        [OrderPaymentStatus.PAID, OrderPaymentStatus.PARTIALLY_REFUNDED, OrderPaymentStatus.REFUNDED].includes(
          order.paymentStatus,
        )
      ) {
        throw new ApiException(ErrorCode.VAL_001, 'الطلب ده اتحصّل بالفعل — مينفعش يتقسّط', HttpStatus.BAD_REQUEST);
      }
      const priceCents = order.totalAmountCents - order.discountAmountCents;
      if (priceCents <= 0) {
        throw new ApiException(ErrorCode.VAL_001, 'مفيش مبلغ صالح للتقسيط على الطلب ده', HttpStatus.BAD_REQUEST);
      }
      if (!plan.isActive) {
        throw new ApiException(ErrorCode.VAL_001, 'خطة التقسيط غير موجودة', HttpStatus.NOT_FOUND);
      }
      const linked = await manager.query<{ exists: boolean }[]>(
        `SELECT EXISTS(SELECT 1 FROM service_installment_plans WHERE service_id = $1 AND plan_id = $2) AS exists`,
        [order.serviceId, plan.id],
      );
      if (!linked[0]?.exists) {
        throw new ApiException(ErrorCode.VAL_001, 'خطة التقسيط دي مش متاحة لهذه الخدمة', HttpStatus.BAD_REQUEST);
      }
      if (!isAmountWithinPlanLimits(priceCents, { minOrderAmountCents: plan.minOrderAmountCents, maxOrderAmountCents: plan.maxOrderAmountCents })) {
        throw new ApiException(ErrorCode.VAL_001, 'مبلغ الطلب خارج حدود أهلية خطة التقسيط دي', HttpStatus.BAD_REQUEST);
      }

      // وسيلة الدفع المحفوظة (tokenized) — شرط التحصيل التلقائي؛ مرجع provider بس.
      let savedMethod: SavedPaymentMethod | null = null;
      if (plan.requiresSavedCard) {
        if (!params.paymentMethodId) {
          throw new ApiException(ErrorCode.VAL_001, 'لازم تختار بطاقة محفوظة للتحصيل التلقائي', HttpStatus.BAD_REQUEST);
        }
        savedMethod = await manager.getRepository(SavedPaymentMethod).findOne({
          where: { id: params.paymentMethodId, customerId: profile.id, isRevoked: false },
        });
        if (!savedMethod) throw new ApiException(ErrorCode.VAL_001, 'وسيلة الدفع غير موجودة', HttpStatus.NOT_FOUND);
        if (savedMethod.provider !== plan.allowedProvider) {
          throw new ApiException(ErrorCode.VAL_001, 'وسيلة الدفع لازم تكون من بوابة الدفع المدعومة للخطة', HttpStatus.BAD_REQUEST);
        }
      }

      // قبول الشروط — إجباري من الباك-إند: السياسات الإجبارية المطبقة على الخدمة دي بتتجاب من
      // PaymentPoliciesService، وأي نسخة ناقصة/مش مطابقة = رفض واضح.
      const requiredPolicies = await this.paymentPolicies.listRequiredForCheckout({
        appliesTo: 'installment',
        serviceId: order.serviceId,
      });
      const acceptedSet = new Set(params.acceptedPolicyVersionIds);
      for (const required of requiredPolicies) {
        if (!acceptedSet.has(required.currentVersionId)) {
          throw new ApiException(ErrorCode.VAL_001, `لازم توافق على الشروط: ${required.titleAr}`, HttpStatus.BAD_REQUEST);
        }
      }
      const installmentPolicyVersion = requiredPolicies[0]?.currentVersionId ?? null;

      // ===== الحساب المرجعي — المصدر الوحيد للمبالغ، والثابت مفروض قبل أي كتابة =====
      const breakdown = computeInstallmentBreakdown(priceCents, {
        installmentCount: plan.installmentCount,
        financingPercentage: Number(plan.financingPercentage),
        fixedFeeCents: plan.fixedFeeCents,
        downPaymentPercentage: Number(plan.downPaymentPercentage),
      });
      assertBreakdownInvariant(breakdown);

      const firstDueAt = new Date(Date.now() + plan.intervalDays * 24 * 60 * 60 * 1000);
      createdOrderNumber = order.orderNumber;

      const saved = await manager.save(
        manager.create(InstallmentApplication, {
          orderId: order.id,
          customerId: profile.id,
          planId: plan.id,
          status: InstallmentApplicationStatus.PENDING_REVIEW,
          servicePriceCents: breakdown.servicePriceCents,
          financingPercentage: String(plan.financingPercentage),
          fixedFeeCents: plan.fixedFeeCents,
          financingFeeCents: breakdown.financingFeeCents,
          totalFinancedCents: breakdown.totalFinancedCents,
          downPaymentPercentage: String(plan.downPaymentPercentage),
          downPaymentCents: breakdown.downPaymentCents,
          financedBalanceCents: breakdown.financedBalanceCents,
          installmentCount: plan.installmentCount,
          regularInstallmentCents: breakdown.regularInstallmentAmountCents,
          finalInstallmentCents: breakdown.installmentAmountsCents[breakdown.installmentAmountsCents.length - 1],
          intervalDays: plan.intervalDays,
          firstDueAt,
          paymentMethodId: savedMethod?.id ?? null,
          allowedProvider: plan.allowedProvider,
          acceptedPolicyVersionId: installmentPolicyVersion,
        }),
      );
      for (const versionId of params.acceptedPolicyVersionIds) {
        await manager.query(
          `INSERT INTO payment_policy_acceptances (policy_version_id, user_id, context_type, context_id)
           VALUES ($1,$2,'installment_application',$3)`,
          [versionId, params.userId, saved.id],
        );
      }
      await this.auditLog.record({
        actorUserId: params.userId,
        actorRole: 'customer',
        action: 'installment_application.submitted',
        entityType: 'installment_application',
        entityId: saved.id,
        newValues: {
          order_id: saved.orderId,
          plan_id: saved.planId,
          total_financed_cents: saved.totalFinancedCents,
          installments: saved.installmentCount,
        },
      }, manager);
      return saved;
    }).then((application: InstallmentApplication) => {

      this.events.emit(
        INSTALLMENT_APPLICATION_SUBMITTED_EVENT,
        new InstallmentApplicationSubmittedEvent(
          application.id,
          application.orderId,
          application.customerId,
          createdOrderNumber,
          application.totalFinancedCents,
        ),
      );
      return application;
    });
  }

  /** رفع مستند KYC على طلب التقديم — نفس حماية technician-documents (MIME+magic bytes+key خاص). */
  async uploadDocument(userId: string, applicationId: string, docType: string, file: IncomingFile): Promise<string> {
    const profile = await this.customerProfiles.findByUserIdOrThrow(userId);
    const application = await this.applications.findOne({
      where: { id: applicationId, customerId: profile.id },
    });
    if (!application) throw new ApiException(ErrorCode.VAL_001, 'طلب التقسيط غير موجود', HttpStatus.NOT_FOUND);
    if (application.status !== InstallmentApplicationStatus.PENDING_REVIEW) {
      throw new ApiException(ErrorCode.VAL_001, 'مينفعش ترفع مستندات على طلب مش في مرحلة المراجعة', HttpStatus.BAD_REQUEST);
    }
    const key = `installment-documents/${application.id}/${randomUUID()}${safeExtensionForFile(file.buffer)}`;
    return uploadWithOrphanCleanup(this.storage, key, file.buffer, file.mimetype, () =>
      this.dataSource.query(
        `INSERT INTO installment_application_documents (application_id, doc_type, storage_key, mime_type, file_size_bytes, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [application.id, docType, key, file.mimetype, file.size, userId],
      ).then((r: { id: string }[]) => r[0].id),
    );
  }

  async cancelApplication(userId: string, applicationId: string): Promise<void> {
    const profile = await this.customerProfiles.findByUserIdOrThrow(userId);
    await this.dataSource.transaction(async (manager) => {
      const app = await manager
        .createQueryBuilder(InstallmentApplication, 'a')
        .setLock('pessimistic_write')
        .where('a.id = :id AND a.customer_id = :cid', { id: applicationId, cid: profile.id })
        .getOne();
      if (!app) throw new ApiException(ErrorCode.VAL_001, 'طلب التقسيط غير موجود', HttpStatus.NOT_FOUND);
      if (app.status !== InstallmentApplicationStatus.PENDING_REVIEW) {
        throw new ApiException(ErrorCode.VAL_001, 'بتقدر تلغي التقديم وهو في انتظار المراجعة بس', HttpStatus.CONFLICT);
      }
      app.status = InstallmentApplicationStatus.CANCELLED;
      await manager.save(app);
      await this.auditLog.record({
        actorUserId: userId,
        actorRole: 'customer',
        action: 'installment_application.cancelled',
        entityType: 'installment_application',
        entityId: applicationId,
      }, manager);
    });
  }

  // ===================== لوحة العميل =====================

  async customerDashboard(userId: string) {
    const profile = await this.customerProfiles.findByUserIdOrThrow(userId);
    const apps = await this.applications.find({
      where: { customerId: profile.id },
      order: { submittedAt: 'DESC' },
    });
    const result = [];
    for (const app of apps) {
      const rows = await this.dataSource.query<
        { id: string; sequence_number: number; due_at: Date; amount_cents: number; status: string; paid_at: Date | null; last_error: string | null }[]
      >(
        `SELECT id, sequence_number, due_at, amount_cents, status::text AS status, paid_at, last_error
         FROM installments WHERE application_id = $1 ORDER BY sequence_number ASC`,
        [app.id],
      );
      const now = Date.now();
      const withDerived = rows.map((r) => ({
        ...r,
        overdue: r.status === 'scheduled' && new Date(r.due_at).getTime() < now,
        days_overdue: r.status === 'scheduled' ? Math.max(0, Math.floor((now - new Date(r.due_at).getTime()) / 86_400_000)) : 0,
      }));
      const paid = withDerived.filter((r) => r.status === 'paid').reduce((s, r) => s + Number(r.amount_cents), 0);
      result.push({
        application: app,
        installments: withDerived,
        summary: {
          total_financed_cents: app.totalFinancedCents,
          paid_cents: paid,
          remaining_cents: app.totalFinancedCents - paid,
          next_installment: withDerived.find((r) => r.status === 'scheduled') ?? null,
          has_overdue: withDerived.some((r) => r.overdue),
        },
      });
    }
    return result;
  }

  // ===================== مراجعة الأدمن =====================

  async adminListApplications(status: string | undefined, page: number, perPage: number) {
    const offset = (page - 1) * perPage;
    const where = status ? `WHERE a.status = $1` : `WHERE ($1::varchar IS NULL OR a.status = $1)`;
    const param = status ?? null;
    const items = await this.dataSource.query(
      `SELECT a.*, u.full_name AS customer_full_name, u.phone_number AS customer_phone,
              o.order_number, s.name_ar AS service_name_ar, p.name_ar AS plan_name_ar
       FROM installment_applications a
       JOIN customer_profiles cp ON cp.id = a.customer_id
       JOIN users u ON u.id = cp.user_id
       JOIN orders o ON o.id = a.order_id
       JOIN services s ON s.id = o.service_id
       JOIN installment_plans p ON p.id = a.plan_id
       ${where}
       ORDER BY a.submitted_at DESC
       LIMIT $2 OFFSET $3`,
      [param, perPage, offset],
    );
    const [{ total }] = await this.dataSource.query<{ total: string }[]>(
      `SELECT COUNT(*)::text AS total FROM installment_applications a ${where}`,
      [param],
    );
    return { items, total: Number(total) };
  }

  async adminApplicationDetail(applicationId: string) {
    const [row] = await this.dataSource.query<Record<string, unknown>[]>(
      `SELECT a.*, u.full_name AS customer_full_name, u.phone_number AS customer_phone, u.email AS customer_email,
              o.order_number, o.total_amount_cents AS order_total_cents, s.name_ar AS service_name_ar,
              p.name_ar AS plan_name_ar, pm.masked_pan, pm.card_brand
       FROM installment_applications a
       JOIN customer_profiles cp ON cp.id = a.customer_id
       JOIN users u ON u.id = cp.user_id
       JOIN orders o ON o.id = a.order_id
       JOIN services s ON s.id = o.service_id
       JOIN installment_plans p ON p.id = a.plan_id
       LEFT JOIN payment_methods pm ON pm.id = a.payment_method_id
       WHERE a.id = $1`,
      [applicationId],
    );
    if (!row) throw new ApiException(ErrorCode.VAL_001, 'طلب التقسيط غير موجود', HttpStatus.NOT_FOUND);
    const schedule = await this.adminScheduleRows(applicationId);
    const documents = await this.dataSource.query<{ id: string; doc_type: string; created_at: Date }[]>(
      `SELECT id, doc_type, created_at FROM installment_application_documents
       WHERE application_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC`,
      [applicationId],
    );
    return { application: row, schedule, documents };
  }

  private async adminScheduleRows(applicationId: string) {
    const now = Date.now();
    const rows = await this.dataSource.query<
      { id: string; sequence_number: number; due_at: Date; amount_cents: number; status: string; attempt_count: number; paid_at: Date | null; last_error: string | null; payment_id: string | null }[]
    >(
      `SELECT id, sequence_number, due_at, amount_cents, status::text AS status, attempt_count, paid_at, last_error, payment_id
       FROM installments WHERE application_id = $1 ORDER BY sequence_number ASC`,
      [applicationId],
    );
    return rows.map((r) => ({
      ...r,
      days_overdue:
        r.status === 'scheduled' ? Math.max(0, Math.floor((now - new Date(r.due_at).getTime()) / 86_400_000)) : 0,
    }));
  }

  /**
   * اعتماد/رفض بقرار أدمن مخوّل — قفل صف واحد + حالة pending فقط (اعتماد مزدوج من أدمنين =
   * أول واحد يكسب والتاني 409). الموافقة بتنشئ الجدولة في **نفس** transaction.
   */
  async reviewApplication(
    adminUserId: string,
    applicationId: string,
    decision: { approve: boolean; reason?: string; notes?: string },
    meta?: AuditActorMeta,
  ): Promise<InstallmentApplication> {
    const result = await this.dataSource.transaction(async (manager) => {
      const app = await manager
        .createQueryBuilder(InstallmentApplication, 'a')
        .setLock('pessimistic_write')
        .where('a.id = :id', { id: applicationId })
        .getOne();
      if (!app) throw new ApiException(ErrorCode.VAL_001, 'طلب التقسيط غير موجود', HttpStatus.NOT_FOUND);
      if (app.status !== InstallmentApplicationStatus.PENDING_REVIEW) {
        throw new ApiException(ErrorCode.VAL_001, 'الطلب اتراجع بالفعل — حدث تاني سبقك', HttpStatus.CONFLICT);
      }
      app.reviewedBy = adminUserId;
      app.reviewedAt = new Date();
      app.reviewNotes = decision.notes ?? null;

      if (!decision.approve) {
        if (!decision.reason?.trim()) {
          throw new ApiException(ErrorCode.VAL_001, 'سبب الرفض إجباري', HttpStatus.BAD_REQUEST);
        }
        app.status = InstallmentApplicationStatus.REJECTED;
        app.rejectionReason = decision.reason;
        await manager.save(app);
        await this.auditLog.record({
          actorUserId: adminUserId,
          actorRole: 'admin',
          action: 'installment_application.rejected',
          entityType: 'installment_application',
          entityId: app.id,
          newValues: { reason: decision.reason },
          meta,
        }, manager);
        return app;
      }

      app.status = InstallmentApplicationStatus.APPROVED;
      app.activatedAt = new Date();
      await manager.save(app);

      // الجدولة: صف 0 = المقدم (لو > 0، مستحق فورًا)، ثم N قسط كل interval_days.
      // الثابت الحاكم مفروض هنا كدفاع أخير — مجموع الصفوف === الإجمالي الممول.
      const amounts: { seq: number; amount: number; dueAt: Date }[] = [];
      if (app.downPaymentCents > 0) {
        amounts.push({ seq: 0, amount: app.downPaymentCents, dueAt: new Date() });
      }
      const base = app.financedBalanceCents;
      const regular = app.regularInstallmentCents;
      const finalAmt = app.finalInstallmentCents;
      for (let i = 1; i <= app.installmentCount; i += 1) {
        const amount = i === app.installmentCount ? finalAmt : regular;
        amounts.push({
          seq: i,
          amount,
          dueAt: new Date(app.firstDueAt.getTime() + (i - 1) * app.intervalDays * 24 * 60 * 60 * 1000),
        });
      }
      const sum = amounts.reduce((s, a) => s + a.amount, 0);
      if (sum !== app.totalFinancedCents || amounts.some((a) => a.amount <= 0)) {
        throw new Error(
          `انتهاك ثابت الجدولة عند الاعتماد: مجموع ${sum} ≠ ممول ${app.totalFinancedCents} — الاعتماد اترفض بأمان`,
        );
      }
      for (const row of amounts) {
        await manager.query(
          `INSERT INTO installments (application_id, sequence_number, due_at, amount_cents)
           VALUES ($1,$2,$3,$4)`,
          [app.id, row.seq, row.dueAt, row.amount],
        );
      }
      await this.auditLog.record({
        actorUserId: adminUserId,
        actorRole: 'admin',
        action: 'installment_application.approved',
        entityType: 'installment_application',
        entityId: app.id,
        newValues: { total_financed_cents: app.totalFinancedCents, schedule_rows: amounts.length },
        meta,
      }, manager);
      return app;
    });

    this.events.emit(
      INSTALLMENTS_APPLICATION_REVIEWED_EVENT,
      new InstallmentApplicationReviewedEvent(result.id, result.orderId, result.customerId, decision.approve, decision.reason ?? null),
    );
    return result;
  }

  // ===================== مستندات الأدمن =====================

  /** صف المستند للتحقق + بناء رابط مؤقت — الفتح نفسه بيتسجل audit من الكولر. */
  async getApplicationDocument(
    documentId: string,
  ): Promise<[{ storage_key: string; doc_type: string; application_id: string }]> {
    const rows = await this.dataSource.query<Record<string, unknown>[]>(
      `SELECT storage_key, doc_type, application_id FROM installment_application_documents
       WHERE id = $1 AND deleted_at IS NULL`,
      [documentId],
    );
    if (rows.length === 0) throw new ApiException(ErrorCode.VAL_001, 'المستند غير موجود', HttpStatus.NOT_FOUND);
    return [rows[0] as { storage_key: string; doc_type: string; application_id: string }];
  }

  /** كل فتح لمستند حساس بيتسجل — مين فتح وإمتى (WHO/WHAT/WHY في audit log). */
  async auditDocumentAccess(adminUserId: string, documentId: string): Promise<void> {
    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'installment_document.viewed',
      entityType: 'installment_application_document',
      entityId: documentId,
    });
  }

  // ===================== تجميعات الأدمن للجدولة =====================

  async adminScheduleOverview(filter: 'active' | 'due' | 'overdue' | 'completed', page: number, perPage: number) {
    const offset = (page - 1) * perPage;
    const having =
      filter === 'active'
        ? `HAVING COUNT(*) FILTER (WHERE i.status NOT IN ('paid','refunded','cancelled')) > 0`
        : filter === 'completed'
          ? `HAVING COUNT(*) FILTER (WHERE i.status NOT IN ('paid','refunded','cancelled')) = 0`
          : '';
    const rows = await this.dataSource.query(
      `SELECT a.id AS application_id, a.order_id, a.customer_id, u.full_name AS customer_full_name,
              u.phone_number AS customer_phone, o.order_number, a.total_financed_cents,
              COALESCE(SUM(i.amount_cents) FILTER (WHERE i.status = 'paid'), 0)::int AS paid_cents,
              COUNT(i.id) FILTER (WHERE i.status = 'scheduled')::int AS scheduled_count,
              COUNT(i.id) FILTER (WHERE i.status = 'failed')::int AS failed_count,
              MIN(i.due_at) FILTER (WHERE i.status = 'scheduled') AS next_due_at
       FROM installment_applications a
       JOIN installments i ON i.application_id = a.id
       JOIN customer_profiles cp ON cp.id = a.customer_id
       JOIN users u ON u.id = cp.user_id
       JOIN orders o ON o.id = a.order_id
       WHERE a.status = 'approved'
       GROUP BY a.id, a.order_id, a.customer_id, u.full_name, u.phone_number, o.order_number, a.total_financed_cents
       ${having}
       ORDER BY next_due_at NULLS LAST
       LIMIT $1 OFFSET $2`,
      [perPage, offset],
    );
    const filtered =
      filter === 'overdue'
        ? rows.filter(
            (r: { failed_count: number; next_due_at: string | null }) =>
              r.failed_count > 0 || (r.next_due_at && new Date(r.next_due_at) < new Date()),
          )
        : rows;
    return { items: filtered, total: filtered.length };
  }
}
