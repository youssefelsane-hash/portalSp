import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/** نوع الرسالة — بيحدد الأيقونة/العنوان اللي الواجهة بتعرضهم، مش النص نفسه. */
export enum OrderCustomerNoticeType {
  /** الإدارة طلبت تفاصيل/صور إضافية قبل التسعير (`AssessmentTriageService.requestMoreInformation`). */
  INFO_REQUESTED = 'info_requested',
  /** الإدارة حوّلت الطلب لمعاينة في الموقع (`AssessmentTriageService.routeToOnsiteAssessment`). */
  ROUTED_TO_ONSITE_ASSESSMENT = 'routed_to_onsite_assessment',
}

/**
 * رسالة من الإدارة **للعميل** مربوطة بطلب (ADR-0071، بلاغ مالك 2026-09-04).
 *
 * الفرق عن `OrderInternalNote` جوه نفس المجلد: دي بتتعرض للعميل بالتعريف، والتانية مالهاش أي
 * وصول من بره الأدمن. والفرق عن الإشعار: الإشعار **حدث عابر** (بيتقري مرة، ممكن يتمسح، ممكن
 * مايوصلش أصلاً لو الإذن مرفوض) — ده مصدر دايم بيتقرا مع الطلب في أي وقت.
 *
 * قبل الجدول ده كان نص الأدمن بيروح لـ`audit_logs` (مسار أدمن) و`order_status_history.reason`
 * (مش معروض للعميل) وحدث الإشعار وبس — فالعميل يفتح الطلب ويلاقي «محتاجين تفاصيل أكتر» بلا أي
 * تفاصيل.
 */
@Entity('order_customer_notices')
export class OrderCustomerNotice {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @Column({
    name: 'notice_type',
    type: 'enum',
    enum: OrderCustomerNoticeType,
    enumName: 'order_customer_notice_type',
  })
  noticeType: OrderCustomerNoticeType;

  /** نص الأدمن بالحرف — **نفس** النص اللي بيروح في الإشعار، مصدر واحد مش نسختين. */
  @Column({ type: 'text' })
  message: string;

  /** للتدقيق بس — مابيتعرضش للعميل (خصوصية الموظفين، نفس قاعدة docs/08 §60.2). */
  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
