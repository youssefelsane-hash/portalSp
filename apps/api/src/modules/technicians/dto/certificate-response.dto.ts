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

export function toCertificateResponseDto(certificate: TechnicianCertificate): CertificateResponseDto {
  return {
    id: certificate.id,
    title: certificate.title,
    issuer_name: certificate.issuerName,
    issued_at: certificate.issuedAt,
    file_url: certificate.fileUrl,
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

export function toPublicCertificateResponseDto(certificate: TechnicianCertificate): PublicCertificateResponseDto {
  return {
    id: certificate.id,
    title: certificate.title,
    issuer_name: certificate.issuerName,
    issued_at: certificate.issuedAt,
    file_url: certificate.fileUrl,
  };
}
