import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class ReassignOrderDto {
  @IsUUID()
  technician_id: string;

  // اختياري حتى تظل تكاملات الإدارة القديمة صالحة، لكنه يُحفظ في سجل التدقيق متى توفّر.
  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason?: string;
}
