import { StorageService } from '../../../common/storage/storage.service';
import { TechnicianCertificate } from '../entities/technician-certificate.entity';

export interface CertificateResponseDto {
  id: string;
  title: string;
  issuer_name: string | null;
  issued_at: string | null;
  file_url: string;
  review_status: string;
  rejection_reason: string | null;
  reviewed_at: string | null;
  created_at: string;
}

// §24 — نفس نمط toTechnicianDocumentResponseDto (getUrl(key) طازة لو storageKey موجود، migration
// 0110): كانت فجوة موثّقة صراحة، نفس بَقّة presigned URL بتموت بعد 7 أيام اللي اتصلحت لـ3 جداول
// تانية (order_media/technician_documents/complaint_attachments) بس اتسيبت هنا عمدًا وقتها.
export async function toCertificateResponseDto(
  certificate: TechnicianCertificate,
  storage: StorageService,
): Promise<CertificateResponseDto> {
  return {
    id: certificate.id,
    title: certificate.title,
    issuer_name: certificate.issuerName,
    issued_at: certificate.issuedAt,
    file_url: certificate.storageKey ? await storage.getUrl(certificate.storageKey) : certificate.fileUrl,
    review_status: certificate.reviewStatus,
    rejection_reason: certificate.rejectionReason,
    reviewed_at: certificate.reviewedAt ? certificate.reviewedAt.toISOString() : null,
    created_at: certificate.createdAt.toISOString(),
  };
}

/** نسخة عامة تتعرض للعميل — المعتمدة (approved) بس، وبدون تفاصيل المراجعة الداخلية. */
export interface PublicCertificateResponseDto {
  id: string;
  title: string;
  issuer_name: string | null;
  issued_at: string | null;
  file_url: string;
}

export async function toPublicCertificateResponseDto(
  certificate: TechnicianCertificate,
  storage: StorageService,
): Promise<PublicCertificateResponseDto> {
  return {
    id: certificate.id,
    title: certificate.title,
    issuer_name: certificate.issuerName,
    issued_at: certificate.issuedAt,
    file_url: certificate.storageKey ? await storage.getUrl(certificate.storageKey) : certificate.fileUrl,
  };
}
