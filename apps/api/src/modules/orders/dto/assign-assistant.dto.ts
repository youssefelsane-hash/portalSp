import { IsUUID } from 'class-validator';

export class AssignAssistantDto {
  @IsUUID()
  technician_id: string;
}
