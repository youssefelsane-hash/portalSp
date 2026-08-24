import { Column, CreateDateColumn, DeleteDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

// حالة طلب التقسيط — التقديم **طلب مراجعة** مش موافقة ذاتية: pending_review لحد ما أدمن مخوّل
// يعتمد/يرفض. approved = العقد والجدولة نشطة (الصفوف بتتعمل في نفس transaction الموافقة).
export enum InstallmentApplicationStatus {
  PENDING_REVIEW = 'pending_review',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  CANCELLED = 'cancelled',
}

// حالة القسط — مصغّرة عمدًا: due/overdue حالات محسوبة من due_at vs now مش مخزنة
// (الحالات المخزنة بس اللي عملية فعلية بتغيرها). راجع installments.entity.ts.
export enum InstallmentStatus {
  SCHEDULED = 'scheduled',
  PROCESSING = 'processing',
  PAID = 'paid',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  REFUNDED = 'refunded',
}
