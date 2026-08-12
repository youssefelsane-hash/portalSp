import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CancelWorkerBookingDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
