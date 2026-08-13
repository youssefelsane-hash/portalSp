import { IsOptional, IsString } from 'class-validator';

export class ApproveProgressionDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
