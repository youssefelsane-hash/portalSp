import { IsEnum } from 'class-validator';
import { TechnicianKind } from '../entities/technician-profile.entity';

/**
 * تحديد دور الشخص — فني كامل ولا مساعد (ADR-0050، docs/08 §94).
 *
 * قابل للتغيير في الاتجاهين: المساعد بيترقّى لفني لما ياخد خبرة (طلب مالك صريح)، والفني ممكن
 * يتحوّل لمساعد لو الأدمن شاف كده. مفيش `note` هنا بعكس علامة التوثيق — سبب القرار بيتسجّل في
 * `audit_logs` زي أي إجراء أدمن تاني، ومفيش عمود على الصف عشان مايبقاش فيه مصدرين للحقيقة.
 */
export class SetTechnicianKindDto {
  @IsEnum(TechnicianKind)
  kind: TechnicianKind;
}
