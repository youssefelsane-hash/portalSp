import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FindOptionsWhere, In, Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import {
  TECHNICIAN_VERIFICATION_CHANGED_EVENT,
  TechnicianVerificationChangedEvent,
} from '../../common/events/technician-verification-changed.event';
import { AuditActorMeta, AuditLogService } from '../audit/audit-log.service';
import { User } from '../auth/entities/user.entity';
import { ListTechniciansQueryDto } from './dto/list-technicians-query.dto';
import { ReviewDocumentDto } from './dto/review-document.dto';
import { DocumentReviewStatus, TechnicianDocument } from './entities/technician-document.entity';
import { TechnicianProfile, TechnicianVerificationStatus } from './entities/technician-profile.entity';
import { canTransitionVerification } from './technician-verification-state-machine';

export interface TechnicianWithUser {
  profile: TechnicianProfile;
  user: User;
}

@Injectable()
export class AdminTechniciansService {
  constructor(
    @InjectRepository(TechnicianProfile) private readonly technicianProfiles: Repository<TechnicianProfile>,
    @InjectRepository(TechnicianDocument) private readonly documents: Repository<TechnicianDocument>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly events: EventEmitter2,
    private readonly auditLog: AuditLogService,
  ) {}

  private async attachUsers(profiles: TechnicianProfile[]): Promise<TechnicianWithUser[]> {
    if (profiles.length === 0) return [];
    const users = await this.users.find({ where: { id: In(profiles.map((p) => p.userId)) } });
    const usersById = new Map(users.map((u) => [u.id, u]));
    return profiles.map((profile) => {
      const user = usersById.get(profile.userId);
      if (!user) {
        // ميقدرش يحصل فعلياً (user_id FK NOT NULL على users) — دفاعي بس عشان مانرميش undefined على المستهلك
        throw new ApiException(ErrorCode.VAL_001, 'بيانات المستخدم مش متاحة لهذا الفني', HttpStatus.INTERNAL_SERVER_ERROR);
      }
      return { profile, user };
    });
  }

  async list(
    query: ListTechniciansQueryDto,
  ): Promise<{ items: TechnicianWithUser[]; meta: { page: number; per_page: number; total: number } }> {
    const page = query.page ?? 1;
    const perPage = query.per_page ?? 20;
    const where: FindOptionsWhere<TechnicianProfile> = {};
    if (query.verification_status) where.verificationStatus = query.verification_status;
    if (query.level) where.currentLevel = query.level;

    const [profiles, total] = await this.technicianProfiles.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * perPage,
      take: perPage,
    });

    return { items: await this.attachUsers(profiles), meta: { page, per_page: perPage, total } };
  }

  private async findProfileOrThrow(technicianProfileId: string): Promise<TechnicianProfile> {
    const profile = await this.technicianProfiles.findOne({ where: { id: technicianProfileId } });
    if (!profile) {
      throw new ApiException(ErrorCode.VAL_001, 'بروفايل الفني غير موجود', HttpStatus.NOT_FOUND);
    }
    return profile;
  }

  async getDetail(
    technicianProfileId: string,
  ): Promise<{ profile: TechnicianProfile; user: User; documents: TechnicianDocument[] }> {
    const profile = await this.findProfileOrThrow(technicianProfileId);
    const [{ user }] = await this.attachUsers([profile]);
    const documents = await this.documents.find({
      where: { technicianId: technicianProfileId },
      order: { createdAt: 'DESC' },
    });
    return { profile, user, documents };
  }

  private async transitionVerification(
    technicianProfileId: string,
    adminUserId: string,
    to: TechnicianVerificationStatus,
    notes: string | null,
    meta?: AuditActorMeta,
  ): Promise<TechnicianProfile> {
    const profile = await this.findProfileOrThrow(technicianProfileId);
    if (!canTransitionVerification(profile.verificationStatus, to)) {
      throw new ApiException(
        ErrorCode.VAL_001,
        `مينفعش تنقل حالة اعتماد الفني من ${profile.verificationStatus} لـ ${to}`,
        HttpStatus.CONFLICT,
      );
    }

    const previousStatus = profile.verificationStatus;
    profile.verificationStatus = to;
    profile.verificationNotes = notes;
    if (to === TechnicianVerificationStatus.APPROVED) {
      profile.approvedAt = new Date();
      profile.approvedByUserId = adminUserId;
      // لو الفني كان معلّق (suspended) واتاعتمد تاني، لازم يقدر يشتغل من غير ما يعيد ضبط توفره يدوياً
    }
    await this.technicianProfiles.save(profile);

    this.events.emit(
      TECHNICIAN_VERIFICATION_CHANGED_EVENT,
      new TechnicianVerificationChangedEvent(profile.id, profile.userId, previousStatus, to, notes),
    );

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: `technician.verification_${to}`,
      entityType: 'technician_profile',
      entityId: profile.id,
      oldValues: { verification_status: previousStatus },
      newValues: { verification_status: to, notes },
      meta,
    });

    return profile;
  }

  async approve(adminUserId: string, technicianProfileId: string, meta?: AuditActorMeta): Promise<TechnicianWithUser> {
    const profile = await this.transitionVerification(
      technicianProfileId,
      adminUserId,
      TechnicianVerificationStatus.APPROVED,
      null,
      meta,
    );
    const [withUser] = await this.attachUsers([profile]);
    return withUser;
  }

  async reject(
    adminUserId: string,
    technicianProfileId: string,
    reason: string,
    meta?: AuditActorMeta,
  ): Promise<TechnicianWithUser> {
    const profile = await this.transitionVerification(
      technicianProfileId,
      adminUserId,
      TechnicianVerificationStatus.REJECTED,
      reason,
      meta,
    );
    const [withUser] = await this.attachUsers([profile]);
    return withUser;
  }

  async reviewDocument(
    adminUserId: string,
    technicianProfileId: string,
    documentId: string,
    dto: ReviewDocumentDto,
    meta?: AuditActorMeta,
  ): Promise<TechnicianDocument> {
    const document = await this.documents.findOne({ where: { id: documentId, technicianId: technicianProfileId } });
    if (!document) {
      throw new ApiException(ErrorCode.VAL_001, 'المستند غير موجود', HttpStatus.NOT_FOUND);
    }
    if (document.reviewStatus !== DocumentReviewStatus.PENDING) {
      throw new ApiException(ErrorCode.VAL_001, 'المستند ده اترجع عليه قبل كده', HttpStatus.CONFLICT);
    }

    const previousStatus = document.reviewStatus;
    document.reviewStatus = dto.review_status;
    document.rejectionReason = dto.review_status === DocumentReviewStatus.REJECTED ? (dto.rejection_reason ?? null) : null;
    document.reviewedByUserId = adminUserId;
    document.reviewedAt = new Date();
    await this.documents.save(document);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'technician.document_reviewed',
      entityType: 'technician_document',
      entityId: document.id,
      oldValues: { review_status: previousStatus },
      newValues: { review_status: document.reviewStatus, rejection_reason: document.rejectionReason },
      meta,
    });

    return document;
  }
}
