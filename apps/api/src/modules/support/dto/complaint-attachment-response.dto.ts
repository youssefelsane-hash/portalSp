import { ComplaintAttachment } from '../entities/complaint-attachment.entity';

export interface ComplaintAttachmentResponseDto {
  id: string;
  file_url: string;
  file_type: string | null;
  uploaded_by_user_id: string;
  created_at: string;
}

export function toComplaintAttachmentResponseDto(attachment: ComplaintAttachment): ComplaintAttachmentResponseDto {
  return {
    id: attachment.id,
    file_url: attachment.fileUrl,
    file_type: attachment.fileType,
    uploaded_by_user_id: attachment.uploadedByUserId,
    created_at: attachment.createdAt.toISOString(),
  };
}
