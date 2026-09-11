import { HttpStatus, Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { Order, OrderPaymentStatus, OrderType } from '../orders/entities/order.entity';

export type OrderPriceIncreaseSource =
  | 'level_premium'
  | 'additional_work'
  | 'inspection_quote'
  /** تعديل سعر بعد تشخيص الفني وقبل تنفيذ الشغل — مختلف عن `additional_work` اللي بيحصل أثناء التنفيذ. */
  | 'diagnosis_revision'
  /**
   * رسم معاينة في الموقع اتضاف لما الإدارة حوّلت طلب «تقييم بالصور» لمعاينة على الأرض
   * (`AssessmentTriageService.routeToOnsiteAssessment`). الطلب اتعمل بإجمالي صفر، فالرسم ده
   * هو أول مبلغ حقيقي عليه — ولازم يعدّي من هنا زي أي زيادة، وإلا بيقع برّه النظام المالي.
   */
  | 'onsite_assessment_fee';

export interface OrderPriceIncrease {
  amountCents: number;
  source: OrderPriceIncreaseSource;
  includeInCommissionableBase: boolean;
  /**
   * The approved work value can differ from the amount newly owed. Assessment-fee credit is the
   * canonical example: a 700 EGP work quote with a 100 EGP credited inspection adds 600 EGP to
   * the order total, while the full 700 EGP remains the commissionable work value.
   */
  commissionableAmountCents?: number;
}

export interface OrderPriceIncreaseResult {
  previousTotalCents: number;
  newTotalCents: number;
  commissionableIncreaseCents: number;
  requiresSupplementalCollection: boolean;
}

export interface OrderPriceReplacementResult {
  previousTotalCents: number;
  newTotalCents: number;
  previousCommissionableBaseCents: number | null;
  newCommissionableBaseCents: number | null;
}

/**
 * The single write path for approved post-creation price increases.
 *
 * Existing successful payments and installment applications are immutable financial snapshots.
 * Increasing a paid order therefore creates an amount still due; it must never rewrite the old
 * payment or silently stretch an accepted installment plan. PaymentsService.amountOwedNow() derives
 * that supplemental obligation from the new total minus the preserved payment snapshots.
 */
@Injectable()
export class OrderFinancialFinalizationService {
  async increasePrice(
    manager: EntityManager,
    order: Order,
    adjustment: OrderPriceIncrease,
  ): Promise<OrderPriceIncreaseResult> {
    if (!Number.isSafeInteger(adjustment.amountCents) || adjustment.amountCents < 0) {
      throw new ApiException(ErrorCode.VAL_001, 'قيمة تعديل السعر غير صالحة', HttpStatus.BAD_REQUEST);
    }

    const previousTotalCents = order.totalAmountCents;
    const requestedCommissionableAmount = adjustment.commissionableAmountCents ?? adjustment.amountCents;
    if (!Number.isSafeInteger(requestedCommissionableAmount) || requestedCommissionableAmount < 0) {
      throw new ApiException(ErrorCode.VAL_001, 'قيمة وعاء العمولة غير صالحة', HttpStatus.BAD_REQUEST);
    }
    const commissionableIncreaseCents =
      adjustment.includeInCommissionableBase && order.commissionableBaseCents !== null
        ? requestedCommissionableAmount
        : 0;

    order.totalAmountCents += adjustment.amountCents;
    if (order.commissionableBaseCents !== null) {
      order.commissionableBaseCents += commissionableIncreaseCents;
    }
    await this.applyRevisitCommissionRate(manager, order, commissionableIncreaseCents);
    await manager.save(order);

    return {
      previousTotalCents,
      newTotalCents: order.totalAmountCents,
      commissionableIncreaseCents,
      requiresSupplementalCollection:
        adjustment.amountCents > 0 && order.paymentStatus === OrderPaymentStatus.PAID,
    };
  }

  /** Replaces an unpaid price before any gateway or installment obligation has started. */
  async replaceUncommittedPrice(
    manager: EntityManager,
    order: Order,
    newTotalCents: number,
  ): Promise<OrderPriceReplacementResult> {
    if (!Number.isSafeInteger(newTotalCents) || newTotalCents < 0) {
      throw new ApiException(ErrorCode.VAL_001, 'السعر الجديد غير صالح', HttpStatus.BAD_REQUEST);
    }
    if (order.depositAmountCents !== null && newTotalCents < order.depositAmountCents) {
      throw new ApiException(
        ErrorCode.ORDR_003,
        'السعر الجديد أقل من الإيداع المثبّت على الطلب',
        HttpStatus.CONFLICT,
      );
    }

    const [commitment] = await manager.query<
      { has_payment: boolean; has_installment_application: boolean }[]
    >(
      `SELECT
         EXISTS (
           SELECT 1 FROM payments
           WHERE order_id = $1
             AND payment_status IN ('pending','processing','succeeded','partially_refunded','refunded')
         ) AS has_payment,
         EXISTS (
           SELECT 1 FROM installment_applications
           WHERE order_id = $1 AND status IN ('pending_review','approved') AND deleted_at IS NULL
         ) AS has_installment_application`,
      [order.id],
    );
    if (commitment?.has_payment || commitment?.has_installment_application) {
      throw new ApiException(
        ErrorCode.ORDR_003,
        'بدأ التزام دفع على الطلب — استخدم مسار تحصيل إضافي أو استرداد بدل تعديل السعر مباشرة',
        HttpStatus.CONFLICT,
      );
    }

    const previousTotalCents = order.totalAmountCents;
    const previousCommissionableBaseCents = order.commissionableBaseCents;
    const deltaCents = newTotalCents - previousTotalCents;
    order.totalAmountCents = newTotalCents;
    if (order.commissionableBaseCents !== null) {
      order.commissionableBaseCents = Math.max(0, order.commissionableBaseCents + deltaCents);
    }
    await manager.save(order);

    return {
      previousTotalCents,
      newTotalCents,
      previousCommissionableBaseCents,
      newCommissionableBaseCents: order.commissionableBaseCents,
    };
  }

  /**
   * **بَقّة مالية حقيقية (بلاغ المالك 2026-09-11): «المنصة بتاخد صفر من كل شغل مدفوع بيتضاف
   * على إعادة الزيارة».**
   *
   * طلب إعادة الزيارة تحت الضمان بيتعمل بنسبة عمولة **صفر** مثبّتة على الصف
   * (`order-creation.service.ts`: `originalOrder ? 0 : service.commissionPercentage`). وده
   * **صح تمامًا للشغل المجاني نفسه**: المنصة بتتنازل عن عمولتها على إعادة شغلانة خدت عمولتها
   * مرة.
   *
   * بس النسبة دي **snapshot على الطلب**، فأول ما الفني يكتشف إنه محتاج قطعة غيار أو أجرة
   * إضافية والعميل يوافق، الشغل الجديد المدفوع ده بيدخل بنفس الصفر. الأرقام المتقاسة فعليًا
   * (`scripts/revisit-commission-audit.js`) على قطعة بـ300 ج.م وخدمة عمولتها 20%:
   *
   * | | قبل الإصلاح | المفروض |
   * |---|---|---|
   * | نصيب الفني | 300.00 ج.م | 240.00 ج.م |
   * | نصيب المنصة | **0.00 ج.م** | 60.00 ج.م |
   *
   * **ليه التصحيح آمن على الوعاء كله؟** لأن وعاء العمولة على طلب إعادة الزيارة بيبدأ من **صفر**
   * (كل مكوّناته صفر وقت الإنشاء، `order-creation.service.ts` §1527+) — يعني الوعاء مافيهوش غير
   * الشغل الجديد المدفوع. فتطبيق نسبة الخدمة على الوعاء كله = تطبيقها على الشغل الجديد بالظبط،
   * بلا أي مساس بالجزء المجاني.
   *
   * **ليه القراءة هنا مش من المستدعي؟** لأن ده مسار الكتابة الوحيد لأي زيادة سعر، فقراءة النسبة
   * جوّاه بتخلّي الإصلاح شامل لكل المسارات (بنود إضافية، عرض بعد المعاينة، مراجعة تشخيص،
   * زيادة مستوى) — ومش ممكن مسار جديد ينساها. SQL خام عمدًا: قراءة عمود واحد مش سبب كافٍ إن
   * طبقة مالية خالصة تعتمد على مستودع الكتالوج.
   *
   * الشرط مقيّد بـ**إعادة الزيارة تحديدًا** (مش أي طلب نسبته صفر): خدمة عمولتها صفر أصلاً، أو
   * طلب الأدمن صفّر عمولته بقرار، مالهمش أي علاقة بالاستثناء ده ومايتلمسوش.
   */
  private async applyRevisitCommissionRate(
    manager: EntityManager,
    order: Order,
    commissionableIncreaseCents: number,
  ): Promise<void> {
    if (commissionableIncreaseCents <= 0) return;
    if (order.orderType !== OrderType.REVISIT) return;
    if (order.commissionRateApplied === null) return;
    if (Number(order.commissionRateApplied) !== 0) return;

    const [row] = await manager.query<{ commission_percentage: string }[]>(
      `SELECT commission_percentage FROM services WHERE id = $1`,
      [order.serviceId],
    );
    const rate = Number(row?.commission_percentage);
    if (!Number.isFinite(rate) || rate <= 0 || rate > 100) return;

    order.commissionRateApplied = String(rate);
  }
}
