import { IsUUID } from 'class-validator';

export class RescheduleOrderDto {
  @IsUUID()
  new_slot_id: string;
}
