import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RejectAssignmentDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  reason_code?: string;
}
