import { IsUUID } from 'class-validator';

export class ListTechniciansForServiceDto {
  @IsUUID()
  address_id: string;
}
