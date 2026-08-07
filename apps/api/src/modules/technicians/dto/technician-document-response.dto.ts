import { TechnicianDocument } from '../entities/technician-document.entity';

export interface TechnicianDocumentResponseDto {
  id: string;
  document_type: string;
  file_url: string;
  review_status: string;
  rejection_reason: string | null;
  reviewed_at: string | null;
  expires_at: string | null;
  created_at: string;
}

export function toTechnicianDocumentResponseDto(document: TechnicianDocument): TechnicianDocumentResponseDto {
  return {
    id: document.id,
    document_type: document.documentType,
    file_url: document.fileUrl,
    review_status: document.reviewStatus,
    rejection_reason: document.rejectionReason,
    reviewed_at: document.reviewedAt ? document.reviewedAt.toISOString() : null,
    expires_at: document.expiresAt,
    created_at: document.createdAt.toISOString(),
  };
}
