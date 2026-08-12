import { IsOptional, IsUUID } from 'class-validator';

// العميل بيستخدمها على طلب awaiting_technician_reselection — لو requested_technician_id
// اتبعت، أول جولة مطابقة هتحاول تعرض عليه حصريًا (نفس آلية "إعادة الحجز" الموجودة أصلاً في
// matching.service.ts). لو مش متبعت، بث عادي لأي فني مؤهّل.
export class RequestRematchDto {
  @IsOptional()
  @IsUUID()
  requested_technician_id?: string;
}
