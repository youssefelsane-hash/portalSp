import { IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class CreateCompanyDto {
  @IsString()
  @Length(2, 160)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  commercial_registration_number?: string;
}
