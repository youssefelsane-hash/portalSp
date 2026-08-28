import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/** حجب خدمة عن فني (ADR-0049، docs/08 §86). */
export class ExcludeTechnicianServiceDto {
  @IsUUID()
  service_id: string;

  /** سبب الحجب — للأدمن بس، الفني مابيشوفوش (ADR-0049). */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
