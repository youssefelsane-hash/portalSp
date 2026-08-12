import { IsEnum, IsString, MaxLength, ValidateIf } from 'class-validator';
import { DomesticWorkerVerificationStatus } from '../entities/domestic-worker-profile.entity';

export class ReviewWorkerDto {
  @IsEnum([DomesticWorkerVerificationStatus.APPROVED, DomesticWorkerVerificationStatus.REJECTED])
  status: DomesticWorkerVerificationStatus.APPROVED | DomesticWorkerVerificationStatus.REJECTED;

  @ValidateIf((o) => o.status === DomesticWorkerVerificationStatus.REJECTED)
  @IsString()
  @MaxLength(500)
  notes?: string;
}
