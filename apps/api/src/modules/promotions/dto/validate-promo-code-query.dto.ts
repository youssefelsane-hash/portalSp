import { IsUUID } from 'class-validator';

export class ValidatePromoCodeQueryDto {
  @IsUUID()
  service_id: string;

  @IsUUID()
  address_id: string;
}
