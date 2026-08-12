import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsEnum, IsInt, IsOptional, IsString, Min, MaxLength } from 'class-validator';
import { DomesticWorkerSpecialty } from '../entities/domestic-worker-profile.entity';

export class UpdateWorkerProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  bio?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  years_of_experience?: number;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @ArrayUnique()
  @IsEnum(DomesticWorkerSpecialty, { each: true })
  specialties?: DomesticWorkerSpecialty[];

  @IsOptional()
  @IsInt()
  @Min(0)
  hourly_rate_cents?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  monthly_rate_cents?: number;
}
