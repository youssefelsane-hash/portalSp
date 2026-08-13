// راجع OrdersService.getTechnicianCancellationPolicy() — بيستخدمه apps/technician-app قبل ما
// يعرض زرار "إلغاء" أصلاً (Show Cancel Order only when backend policy permits it)، بس الفرض
// الحقيقي بيحصل في technicianCancel() نفسها بغض النظر عن الواجهة.
export class TechnicianCancellationPolicyResponseDto {
  can_cancel: boolean;
  reason_if_not: string | null;
  window_expires_at: string | null;
}
