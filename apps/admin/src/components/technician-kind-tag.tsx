import { Badge } from '@/components/ui/badge';
import {
  TECHNICIAN_KIND_CODES,
  TECHNICIAN_KIND_LABELS,
  technicianKindBadgeClass,
  type TechnicianKindCode,
} from '@/lib/technician-labels';

/**
 * رمز الدور جنب الاسم في شاشات الأدمن (docs/08 §107) — `FN` فني، `HF` مساعد.
 *
 * طلب مالك مباشر: «جنب كل اسم يبقى فيه رمز مميز… الرمز ده مايبانش لحد غير للأدمن». الحصر
 * مضمون بحكم المكان مش بحكم شرط عرض: `technician_kind` مابيتسربش أصلاً من أي endpoint عام
 * (الإثراء إداري بحت — `attachAdminRoleMetadata()`)، فمفيش نسخة من الرمز ده في تطبيق العميل
 * أو الفني أو الويب.
 *
 * `title` بيوضّح الاختصار بالعربي عند الوقوف عليه — الرمز لوحده مايكفيش لحد بيشوف الشاشة أول مرة.
 */
export function TechnicianKindTag({ kind, className }: { kind: TechnicianKindCode; className?: string }) {
  return (
    <Badge
      variant="outline"
      title={TECHNICIAN_KIND_LABELS[kind]}
      className={`${technicianKindBadgeClass(kind)} font-mono text-[10px] tracking-wider ${className ?? ''}`}
    >
      {TECHNICIAN_KIND_CODES[kind]}
    </Badge>
  );
}
