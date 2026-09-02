import { IsOptional, IsUUID } from 'class-validator';

// العميل بيستخدمها على طلب awaiting_technician_reselection — لو requested_technician_id
// اتبعت، أول جولة مطابقة هتحاول تعرض عليه حصريًا (نفس آلية "إعادة الحجز" الموجودة أصلاً في
// matching.service.ts). لو مش متبعت، بث عادي لأي فني مؤهّل.
export class RequestRematchDto {
  @IsOptional()
  @IsUUID()
  requested_technician_id?: string;

  /**
   * ADR-0065 §3 — تذكرة معاينة **جديدة** للفني البديل. **إجباري** لأي طلب سعره مربوط بمنفّذ
   * بعينه (`orders.booking_context_hash` مش null): الفني البديل ممكن يكون مستوى أغلى، فإرجاع
   * الطلب للتوزيع بنفس الفاتورة القديمة كان بيبقى زيادة سعر صامتة عكس اتجاهها.
   *
   * اختياري بالكامل لأي طلب قديم مش مربوط (مسار إلغاء الفني الأصلي، docs/10) — صفر تغيير في سلوكه.
   */
  @IsOptional()
  @IsUUID()
  match_preview_id?: string;
}
