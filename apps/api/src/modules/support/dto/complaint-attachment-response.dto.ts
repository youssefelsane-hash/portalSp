import { StorageService } from '../../../common/storage/storage.service';
import { ComplaintAttachment } from '../entities/complaint-attachment.entity';

export interface ComplaintAttachmentResponseDto {
  id: string;
  file_url: string;
  file_type: string | null;
  uploaded_by_user_id: string;
  created_at: string;
}

// docs/08 §19 بند 9 — نفس نمط toOrderMediaResponseDto (getUrl(key) طازة لو storageKey موجود).
export async function toComplaintAttachmentResponseDto(
  attachment: ComplaintAttachment,
  storage: StorageService,
): Promise<ComplaintAttachmentResponseDto> {
  return {
    id: attachment.id,
    file_url: attachment.storageKey ? await storage.getUrl(attachment.storageKey) : attachment.fileUrl,
    file_type: attachment.fileType,
    uploaded_by_user_id: attachment.uploadedByUserId,
    created_at: attachment.createdAt.toISOString(),
  };
}
