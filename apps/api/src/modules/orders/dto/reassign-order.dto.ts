import { IsUUID } from 'class-validator';

export class ReassignOrderDto {
  @IsUUID()
  technician_id: string;
}
