import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min } from 'class-validator';
import { ComplaintCategory, ComplaintResolutionType } from '../entities/complaint.entity';

export class FileComplaintDto {
  @IsOptional()
  @IsUUID()
  order_id?: string;

  @IsEnum(ComplaintCategory)
  category: ComplaintCategory;

  @IsString()
  @Length(3, 200)
  title: string;

  @IsString()
  @Length(10, 3000)
  description: string;
}

export class AddComplaintMessageDto {
  @IsString()
  @MaxLength(2000)
  message: string;

  @IsOptional()
  @IsBoolean()
  is_internal_note?: boolean;
}

export class ResolveComplaintDto {
  @IsEnum(ComplaintResolutionType)
  resolution_type: ComplaintResolutionType;

  @IsString()
  @MaxLength(1000)
  resolution_notes: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000_00)
  compensation_cents?: number;
}

export class RejectComplaintDto {
  @IsString()
  @MaxLength(1000)
  resolution_notes: string;
}
