import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

export class AddCertificateDto {
  @IsString()
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  issuer_name?: string;

  @IsOptional()
  @IsDateString()
  issued_at?: string;
}
