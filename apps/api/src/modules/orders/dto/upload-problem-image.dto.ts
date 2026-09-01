import { IsUUID } from 'class-validator';

export class UploadProblemImageDto {
  @IsUUID()
  service_id: string;
}
