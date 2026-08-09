import { IsEnum } from 'class-validator';
import { ComplaintSeverity } from '../entities/complaint.entity';

export class UpdateComplaintSeverityDto {
  @IsEnum(ComplaintSeverity)
  severity: ComplaintSeverity;
}
