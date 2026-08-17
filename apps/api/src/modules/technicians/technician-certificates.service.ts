import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { safeExtensionForFile } from '../../common/storage/file-signature-validator';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { STORAGE_SERVICE, StorageService } from '../../common/storage/storage.service';
import { AuditActorMeta, AuditLogService } from '../audit/audit-log.service';
import { AddCertificateDto } from './dto/add-certificate.dto';
import { ReviewCertificateDto } from './dto/review-certificate.dto';
import { DocumentReviewStatus } from './entities/technician-document.entity';
import { TechnicianCertificate } from './entities/technician-certificate.entity';
import { IncomingFile } from './technician-documents.service';

const MAX_CERTIFICATES_PER_TECHNICIAN = 20;

@Injectable()
export class TechnicianCertificatesService {
  constructor(
    @InjectRepository(TechnicianCertificate) private readonly certificates: Repository<TechnicianCertificate>,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
    private readonly auditLog: AuditLogService,
  ) {}

  async add(technicianId: string, dto: AddCertificateDto, file: IncomingFile): Promise<TechnicianCertificate> {
    const existingCount = await this.certificates.count({ where: { technicianId } });
    if (existingCount >= MAX_CERTIFICATES_PER_TECHNICIAN) {
      throw new ApiException(
        ErrorCode.VAL_001,
        `أقصى عدد شهادات/كورسات هو ${MAX_CERTIFICATES_PER_TECHNICIAN}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const key = `technician-certificates/${technicianId}/${randomUUID()}${safeExtensionForFile(file.buffer)}`;
    const fileUrl = await this.storage.save(key, file.buffer, file.mimetype);

    const certificate = this.certificates.create({
      technicianId,
      title: dto.title,
      issuerName: dto.issuer_name ?? null,
      issuedAt: dto.issued_at ?? null,
      fileUrl,
      storageKey: key,
      displayOrder: existingCount,
    });
    return this.certificates.save(certificate);
  }

  listForTechnician(technicianId: string): Promise<TechnicianCertificate[]> {
    return this.certificates.find({ where: { technicianId }, order: { displayOrder: 'ASC', createdAt: 'ASC' } });
  }

  /** للبروفايل العام — المعتمدة (approved) بس، عشان محدش يحط شهادة مزوّرة ما اتراجعتش لسه. */
  listApprovedForTechnician(technicianId: string): Promise<TechnicianCertificate[]> {
    return this.certificates.find({
      where: { technicianId, reviewStatus: DocumentReviewStatus.APPROVED },
      order: { displayOrder: 'ASC', createdAt: 'ASC' },
    });
  }

  async remove(technicianId: string, certificateId: string): Promise<void> {
    const certificate = await this.certificates.findOne({ where: { id: certificateId } });
    if (!certificate || certificate.technicianId !== technicianId) {
      throw new ApiException(ErrorCode.VAL_001, 'الشهادة غير موجودة', HttpStatus.NOT_FOUND);
    }
    await this.certificates.remove(certificate);
  }

  async findOwnedByTechnicianOrThrow(technicianId: string, certificateId: string): Promise<TechnicianCertificate> {
    const certificate = await this.certificates.findOne({ where: { id: certificateId, technicianId } });
    if (!certificate) {
      throw new ApiException(ErrorCode.VAL_001, 'الشهادة غير موجودة', HttpStatus.NOT_FOUND);
    }
    return certificate;
  }

  /** مراجعة أدمن — approve/reject نهائي، بنفس منطق مراجعة مستندات KYC (AdminTechniciansService.reviewDocument). */
  async review(
    adminUserId: string,
    technicianId: string,
    certificateId: string,
    dto: ReviewCertificateDto,
    meta?: AuditActorMeta,
  ): Promise<TechnicianCertificate> {
    const certificate = await this.certificates.findOne({ where: { id: certificateId, technicianId } });
    if (!certificate) {
      throw new ApiException(ErrorCode.VAL_001, 'الشهادة غير موجودة', HttpStatus.NOT_FOUND);
    }
    if (certificate.reviewStatus !== DocumentReviewStatus.PENDING) {
      throw new ApiException(ErrorCode.VAL_001, 'الشهادة دي اترجع عليها قبل كده', HttpStatus.CONFLICT);
    }

    const previousStatus = certificate.reviewStatus;
    certificate.reviewStatus = dto.review_status;
    certificate.rejectionReason = dto.review_status === DocumentReviewStatus.REJECTED ? (dto.rejection_reason ?? null) : null;
    certificate.reviewedByUserId = adminUserId;
    certificate.reviewedAt = new Date();
    await this.certificates.save(certificate);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'technician.certificate_reviewed',
      entityType: 'technician_certificate',
      entityId: certificate.id,
      oldValues: { review_status: previousStatus },
      newValues: { review_status: certificate.reviewStatus, rejection_reason: certificate.rejectionReason },
      meta,
    });

    return certificate;
  }
}
