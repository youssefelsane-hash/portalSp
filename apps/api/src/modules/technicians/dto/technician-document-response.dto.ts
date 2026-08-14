import { StorageService } from '../../../common/storage/storage.service';
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

// docs/08 §19 بند 9 — نفس نمط toOrderMediaResponseDto (getUrl(key) طازة لو storageKey موجود).
export async function toTechnicianDocumentResponseDto(
  document: TechnicianDocument,
  storage: StorageService,
): Promise<TechnicianDocumentResponseDto> {
  return {
    id: document.id,
    document_type: document.documentType,
    file_url: document.storageKey ? await storage.getUrl(document.storageKey) : document.fileUrl,
    review_status: document.reviewStatus,
    rejection_reason: document.rejectionReason,
    reviewed_at: document.reviewedAt ? document.reviewedAt.toISOString() : null,
    expires_at: document.expiresAt,
    created_at: document.createdAt.toISOString(),
  };
}
