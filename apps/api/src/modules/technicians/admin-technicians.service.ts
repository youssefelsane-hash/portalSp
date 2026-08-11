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
import { GeoService } from '../geo/geo.service';
import { AssignTechnicianZoneDto } from './dto/assign-technician-zone.dto';
import { ChangeTechnicianLevelDto } from './dto/change-technician-level.dto';
import { ListTechniciansQueryDto } from './dto/list-technicians-query.dto';
import { ReviewDocumentDto } from './dto/review-document.dto';
import { DocumentReviewStatus, TechnicianDocument } from './entities/technician-document.entity';
import { TechnicianLevelChangeType, TechnicianLevelHistory } from './entities/technician-level-history.entity';
import { TechnicianAssistantLinkStatus, TechnicianProfile, TechnicianVerificationStatus } from './entities/technician-profile.entity';
import { TechnicianZone } from './entities/technician-zone.entity';
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
    @InjectRepository(TechnicianLevelHistory) private readonly levelHistory: Repository<TechnicianLevelHistory>,
    @InjectRepository(TechnicianZone) private readonly technicianZones: Repository<TechnicianZone>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly events: EventEmitter2,
    private readonly auditLog: AuditLogService,
    private readonly geoService: GeoService,
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

  // كانت فجوة موثّقة (§13.7): مفيش endpoint لتعليق فني معتمد. الـ state machine
  // (technician-verification-state-machine.ts) كانت أصلاً بتسمح بـ APPROVED→SUSPENDED
  // وSUSPENDED→APPROVED/REJECTED من زمان — بس مفيش method/route كانت بتستخدمها. الفني
  // المُعلَّق بيتشال أوتوماتيك من الـ matching (matching.service.ts بيفلتر
  // verification_status='approved' بس)، فمفيش داعي نلمس is_available/is_on_duty يدوياً هنا.
  async suspend(adminUserId: string, technicianProfileId: string, reason: string, meta?: AuditActorMeta): Promise<TechnicianWithUser> {
    const profile = await this.transitionVerification(
      technicianProfileId,
      adminUserId,
      TechnicianVerificationStatus.SUSPENDED,
      reason,
      meta,
    );
    const [withUser] = await this.attachUsers([profile]);
    return withUser;
  }

  // ── الحالات الوسيطة (كانت فجوة موثّقة صراحة، اتقفلت) ────────────────
  // مسار خطي pending→documents_submitted→under_review→interview_scheduled→test_passed،
  // كل خطوة قرار أدمن يدوي بالكامل (زي approve/reject/suspend بالظبط) — راجع الشرح الكامل
  // في technician-verification-state-machine.ts ليه ده مش قاعدة عمل مُخترَعة.

  async markDocumentsSubmitted(adminUserId: string, technicianProfileId: string, notes: string | undefined, meta?: AuditActorMeta): Promise<TechnicianWithUser> {
    const profile = await this.transitionVerification(
      technicianProfileId,
      adminUserId,
      TechnicianVerificationStatus.DOCUMENTS_SUBMITTED,
      notes ?? null,
      meta,
    );
    const [withUser] = await this.attachUsers([profile]);
    return withUser;
  }

  async markUnderReview(adminUserId: string, technicianProfileId: string, notes: string | undefined, meta?: AuditActorMeta): Promise<TechnicianWithUser> {
    const profile = await this.transitionVerification(
      technicianProfileId,
      adminUserId,
      TechnicianVerificationStatus.UNDER_REVIEW,
      notes ?? null,
      meta,
    );
    const [withUser] = await this.attachUsers([profile]);
    return withUser;
  }

  async scheduleInterview(adminUserId: string, technicianProfileId: string, notes: string | undefined, meta?: AuditActorMeta): Promise<TechnicianWithUser> {
    const profile = await this.transitionVerification(
      technicianProfileId,
      adminUserId,
      TechnicianVerificationStatus.INTERVIEW_SCHEDULED,
      notes ?? null,
      meta,
    );
    const [withUser] = await this.attachUsers([profile]);
    return withUser;
  }

  async markTestPassed(adminUserId: string, technicianProfileId: string, notes: string | undefined, meta?: AuditActorMeta): Promise<TechnicianWithUser> {
    const profile = await this.transitionVerification(
      technicianProfileId,
      adminUserId,
      TechnicianVerificationStatus.TEST_PASSED,
      notes ?? null,
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

  /** ترقية/تخفيض يدوي لمستوى الفني — بيتسجّل في technician_level_history (جدول موجود من 0005 بس مش مستخدم لحد دلوقتي). */
  async changeLevel(
    adminUserId: string,
    technicianProfileId: string,
    dto: ChangeTechnicianLevelDto,
    meta?: AuditActorMeta,
  ): Promise<TechnicianWithUser> {
    const profile = await this.findProfileOrThrow(technicianProfileId);
    if (profile.currentLevel === dto.level) {
      throw new ApiException(ErrorCode.VAL_001, 'الفني أصلاً على المستوى ده', HttpStatus.CONFLICT);
    }

    const previousLevel = profile.currentLevel;
    const levelOrder = ['new', 'verified', 'professional', 'premium', 'team_leader'];
    const changeType =
      levelOrder.indexOf(dto.level) > levelOrder.indexOf(previousLevel)
        ? TechnicianLevelChangeType.PROMOTION
        : TechnicianLevelChangeType.DEMOTION;

    profile.currentLevel = dto.level;
    await this.technicianProfiles.save(profile);

    await this.levelHistory.save(
      this.levelHistory.create({
        technicianId: profile.id,
        previousLevel,
        newLevel: dto.level,
        changeType: TechnicianLevelChangeType.MANUAL_OVERRIDE,
        qualityScoreAtChange: profile.qualityScore,
        reason: dto.reason ?? null,
        changedByUserId: adminUserId,
        effectiveFrom: new Date(),
      }),
    );

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: `technician.level_${changeType}`,
      entityType: 'technician_profile',
      entityId: profile.id,
      oldValues: { current_level: previousLevel },
      newValues: { current_level: profile.currentLevel, reason: dto.reason ?? null },
      meta,
    });

    const [withUser] = await this.attachUsers([profile]);
    return withUser;
  }

  // ── مناطق العمل ──────────────────────────────────────────────────────
  // كانت فجوة موثّقة صراحة: technician_zones (اللي matching.service.ts's findEligibleTechnicians
  // بيفلتر عليها فعلياً) كان تعيينها يدوي عبر SQL مباشر تماماً — مفيش أي endpoint. نفس نمط
  // technician_services (catalog/admin-catalog.service.ts) بالظبط.

  listZones(technicianProfileId: string): Promise<TechnicianZone[]> {
    return this.technicianZones.find({ where: { technicianId: technicianProfileId }, order: { createdAt: 'DESC' } });
  }

  async assignZone(
    adminUserId: string,
    technicianProfileId: string,
    dto: AssignTechnicianZoneDto,
    meta?: AuditActorMeta,
  ): Promise<TechnicianZone> {
    await this.findProfileOrThrow(technicianProfileId);
    await this.geoService.findServiceZoneOrThrow(dto.service_zone_id);

    const existing = await this.technicianZones.findOne({
      where: { technicianId: technicianProfileId, serviceZoneId: dto.service_zone_id },
    });
    if (existing) {
      throw new ApiException(ErrorCode.VAL_001, 'المنطقة دي متعيّنة للفني ده بالفعل', HttpStatus.CONFLICT);
    }

    const zone = this.technicianZones.create({
      technicianId: technicianProfileId,
      serviceZoneId: dto.service_zone_id,
      isPrimary: dto.is_primary ?? false,
    });
    await this.technicianZones.save(zone);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'technician_zone.assigned',
      entityType: 'technician_profile',
      entityId: technicianProfileId,
      newValues: { service_zone_id: dto.service_zone_id, is_primary: zone.isPrimary },
      meta,
    });

    return zone;
  }

  /** serviceZoneId هنا هو id نطاق الخدمة نفسه (مش id صف التعيين) — نفس نمط removeTechnician
   * في technician_services (بيتعامل معاها كمفتاح مركّب technician+zone، مش صف مستقل).
   *
   * **بَقّة حقيقية اتلقطت واتصلحت وقت الاختبار الحي**: `repository.softDelete(criteria)` بيبني
   * `UPDATE ... WHERE <criteria>` من غير `AND deleted_at IS NULL` تلقائي (الاستبعاد التلقائي ده
   * بس لـ `find`/`findOne`، مش لعمليات الكتابة). يعني نداء `softDelete()` مرتين بنفس المعايير
   * كان بيطابق نفس الصف الاتنين المرتين ويرجّع `affected: 1` في الاتنين — إزالة مكرّرة كانت
   * بترجع نجاح (`{removed: true}`) بدل 404 المتوقع. الإصلاح: `findOne` الأول (ده بيستبعد
   * soft-deleted تلقائياً)، وبعدين `softDelete` بـ `id` الصف الفعلي لو لقيناه.
   */
  async removeZone(adminUserId: string, technicianProfileId: string, serviceZoneId: string, meta?: AuditActorMeta): Promise<void> {
    const existing = await this.technicianZones.findOne({ where: { technicianId: technicianProfileId, serviceZoneId } });
    if (!existing) {
      throw new ApiException(ErrorCode.VAL_001, 'المنطقة دي مش متعيّنة للفني ده أصلاً', HttpStatus.NOT_FOUND);
    }
    await this.technicianZones.softDelete(existing.id);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'technician_zone.removed',
      entityType: 'technician_profile',
      entityId: technicianProfileId,
      oldValues: { service_zone_id: serviceZoneId },
      meta,
    });
  }

  // ── "معاه مساعد؟" — موافقة/رفض الإدارة (docs/06 §3.7، docs/07 الجزء د) ────────

  async approveAssistant(adminUserId: string, technicianProfileId: string, meta?: AuditActorMeta): Promise<TechnicianProfile> {
    const profile = await this.findProfileOrThrow(technicianProfileId);
    if (profile.assistantLinkStatus !== TechnicianAssistantLinkStatus.PENDING_APPROVAL) {
      throw new ApiException(ErrorCode.VAL_001, 'مفيش طلب مساعد مستني موافقة للفني ده', HttpStatus.CONFLICT);
    }

    profile.assistantLinkStatus = TechnicianAssistantLinkStatus.APPROVED;
    await this.technicianProfiles.save(profile);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'technician.assistant_approved',
      entityType: 'technician_profile',
      entityId: profile.id,
      newValues: { assistant_technician_id: profile.assistantTechnicianId },
      meta,
    });
    return profile;
  }

  async rejectAssistant(adminUserId: string, technicianProfileId: string, meta?: AuditActorMeta): Promise<TechnicianProfile> {
    const profile = await this.findProfileOrThrow(technicianProfileId);
    if (profile.assistantLinkStatus !== TechnicianAssistantLinkStatus.PENDING_APPROVAL) {
      throw new ApiException(ErrorCode.VAL_001, 'مفيش طلب مساعد مستني موافقة للفني ده', HttpStatus.CONFLICT);
    }

    const oldAssistantId = profile.assistantTechnicianId;
    profile.assistantTechnicianId = null;
    profile.assistantLinkStatus = TechnicianAssistantLinkStatus.NONE;
    await this.technicianProfiles.save(profile);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'technician.assistant_rejected',
      entityType: 'technician_profile',
      entityId: profile.id,
      oldValues: { assistant_technician_id: oldAssistantId },
      meta,
    });
    return profile;
  }
}
