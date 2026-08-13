// دالة نقية (pure) بتحدد وقت بدء بث المطابقة الفعلي لطلب مجدول — ADR-0009 بند 1-2 (P0-9).
// مفصولة عن OrdersService.create() عمدًا عشان تتاخد بذاتها كوحدة اختبار من غير الحاجة لتجهيز
// كل الاعتماديات التقيلة بتاعة create() (catalog, pricing, wallets, geo, ...).
export interface DispatchDeferralInput {
  /** الطلب فيه schedule_slot_id صريح؟ لو true، البث فوري دايمًا بغض النظر عن بُعد الموعد. */
  scheduleSlotBooked: boolean;
  /** orders.scheduled_at بعد كل الحسابات (سلوت أو dto.scheduled_at الحر) — null يعني طلب فوري. */
  scheduledAt: Date | null;
  /** matching.deferred_dispatch_lead_hours من الإعدادات. */
  leadHours: number;
  now?: Date;
}

/**
 * بترجع الوقت اللي بث المطابقة المفروض يبدأ فيه فعليًا، أو `undefined` لو البث المفروض يحصل فورًا
 * (طلب فوري، أو مجدول لكن قريب من الموعد ضمن leadHours، أو فيه schedule_slot_id صريح).
 */
export function computeDispatchDeferredUntil(input: DispatchDeferralInput): Date | undefined {
  if (input.scheduleSlotBooked || !input.scheduledAt) return undefined;

  const now = input.now ?? new Date();
  const dispatchAt = new Date(input.scheduledAt.getTime() - input.leadHours * 60 * 60 * 1000);
  return dispatchAt.getTime() > now.getTime() ? dispatchAt : undefined;
}
