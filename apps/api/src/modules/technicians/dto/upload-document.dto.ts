import { IsDateString, IsEnum, IsOptional } from 'class-validator';
import { TechnicianDocumentType } from '../entities/technician-document.entity';

export class UploadDocumentDto {
  @IsEnum(TechnicianDocumentType)
  document_type: TechnicianDocumentType;

  @IsOptional()
  @IsDateString()
  expires_at?: string;
}
