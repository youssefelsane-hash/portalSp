import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateTechnicianRescheduleRequestDto {
  @IsUUID()
  new_slot_id: string;

  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason: string;
}
