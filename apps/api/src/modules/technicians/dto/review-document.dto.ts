import { IsEnum, IsString, MaxLength, ValidateIf } from 'class-validator';
import { DocumentReviewStatus } from '../entities/technician-document.entity';

export class ReviewDocumentDto {
  // pending مرفوض هنا عمداً — المراجعة قرار نهائي approve/reject بس، الـ pending حالة أولية مش قرار.
  @IsEnum([DocumentReviewStatus.APPROVED, DocumentReviewStatus.REJECTED])
  review_status: DocumentReviewStatus.APPROVED | DocumentReviewStatus.REJECTED;

  @ValidateIf((o) => o.review_status === DocumentReviewStatus.REJECTED)
  @IsString()
  @MaxLength(500)
  rejection_reason?: string;
}
