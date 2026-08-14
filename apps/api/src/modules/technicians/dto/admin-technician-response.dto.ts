import { StorageService } from '../../../common/storage/storage.service';
import { User } from '../../auth/entities/user.entity';
import { TechnicianProfile } from '../entities/technician-profile.entity';
import { TechnicianDocumentResponseDto, toTechnicianDocumentResponseDto } from './technician-document-response.dto';
import { TechnicianDocument } from '../entities/technician-document.entity';
import { CertificateResponseDto, toCertificateResponseDto } from './certificate-response.dto';
import { TechnicianCertificate } from '../entities/technician-certificate.entity';

export interface AdminTechnicianResponseDto {
  id: string;
  user_id: string;
  full_name: string;
  phone_number: string;
  technician_code: string;
  years_of_experience: number;
  current_level: string;
  quality_score: number;
  average_rating: number;
  total_ratings_count: number;
  completed_orders_count: number;
  cancelled_orders_count: number;
  verification_status: string;
  is_available: boolean;
  is_on_duty: boolean;
  created_at: string;
  assistant_link_status: string;
  assistant_technician_id: string | null;
}

export function toAdminTechnicianResponseDto(profile: TechnicianProfile, user: User): AdminTechnicianResponseDto {
  return {
    id: profile.id,
    user_id: profile.userId,
    full_name: user.fullName,
    phone_number: user.phoneNumber,
    technician_code: profile.technicianCode,
    years_of_experience: profile.yearsOfExperience,
    current_level: profile.currentLevel,
    quality_score: Number(profile.qualityScore),
    average_rating: Number(profile.averageRating),
    total_ratings_count: profile.totalRatingsCount,
    completed_orders_count: profile.completedOrdersCount,
    cancelled_orders_count: profile.cancelledOrdersCount,
    verification_status: profile.verificationStatus,
    is_available: profile.isAvailable,
    is_on_duty: profile.isOnDuty,
    created_at: profile.createdAt.toISOString(),
    assistant_link_status: profile.assistantLinkStatus,
    assistant_technician_id: profile.assistantTechnicianId,
  };
}

export interface AdminTechnicianDetailResponseDto extends AdminTechnicianResponseDto {
  documents: TechnicianDocumentResponseDto[];
  // الشهادات (docs/08) — كانت فجوة UI موثّقة صراحة: POST .../certificates/:certificateId/review
  // كان جاهز ومختبر بلا أي شاشة أدمن تعرض الشهادات pending أصلاً (الأدمن كان محتاج curl/Postman).
  certificates: CertificateResponseDto[];
}

// docs/08 §19 بند 9 — الأدمن (بس مش الفني) هو الطرف الوحيد اللي بيقرا roots المستندات دي كتلة
// واحدة، فأصبحت async عشان توليد رابط طازة لكل مستند عن طريق getUrl(key) بدل file_url الثابت.
export async function toAdminTechnicianDetailResponseDto(
  profile: TechnicianProfile,
  user: User,
  documents: TechnicianDocument[],
  certificates: TechnicianCertificate[],
  storage: StorageService,
): Promise<AdminTechnicianDetailResponseDto> {
  return {
    ...toAdminTechnicianResponseDto(profile, user),
    documents: await Promise.all(documents.map((d) => toTechnicianDocumentResponseDto(d, storage))),
    certificates: certificates.map(toCertificateResponseDto),
  };
}
