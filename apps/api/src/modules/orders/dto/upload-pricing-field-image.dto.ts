import { IsUUID } from 'class-validator';

export class UploadPricingFieldImageDto {
  @IsUUID()
  service_id: string;

  @IsUUID()
  field_id: string;
}
