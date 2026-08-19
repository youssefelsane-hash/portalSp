import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { In, Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import {
  TECHNICIAN_CATEGORY_VERIFICATION_CHANGED_EVENT,
  TechnicianCategoryVerificationChangedEvent,
} from '../../common/events/technician-category-verification-changed.event';
import { AuditActorMeta, AuditLogService } from '../audit/audit-log.service';
import { ServiceCategory } from '../catalog/entities/service-category.entity';
import { TechnicianCategory } from '../catalog/entities/technician-category.entity';
import { TechnicianServiceVerificationStatus } from '../catalog/entities/technician-service.entity';
import { SelfDeclareCategoryDto } from './dto/self-declare-category.dto';
import { TechnicianProfile } from './entities/technician-profile.entity';

/**
 * ADR-0018 §8 (طلب صريح من المالك 2026-08-19) — الفني بيصرّح بفئة/تخصص كامل (سباكة، كهرباء،
 * نجارة...) بدل ما يتربط بعشرات صفوف technician_services واحد واحد. نفس سير عمل تصريح المهارات
 * الذاتي بالحرف (`TechniciansService.declareService`/`AdminTechniciansService.approveServiceDeclaration`
 * — راجعهم للمقارنة المباشرة) بس على مستوى فئة بدل خدمة، وبـrepository مستقل عشان constructor
 * `TechniciansService`/`AdminTechniciansService` (26+ ملف اختبار بينشئهم بـ`new` مباشرة) يفضل
 * زي ما هو بلا أي تغيير.
 *
 * `technician_categories` **إضافة جنب technician_services مش بديل ليها** — أهلية الفني لخدمة
 * معيّنة بقت "خدمة معتمدة مباشرة OR فئة الخدمة معتمدة" (راجع matching.service.ts،
 * technician-assignment-guard.service.ts، technicians.service.ts's listForServiceBooking()،
 * assistant-matching.service.ts — الأربعة بيطبّقوا نفس القاعدة).
 */
@Injectable()
export class TechnicianCategoriesService {
  constructor(
    @InjectRepository(TechnicianCategory) private readonly technicianCategories: Repository<TechnicianCategory>,
    @InjectRepository(TechnicianProfile) private readonly technicianProfiles: Repository<TechnicianProfile>,
    @InjectRepository(ServiceCategory) private readonly serviceCategories: Repository<ServiceCategory>,
    private readonly events: EventEmitter2,
    private readonly auditLog: AuditLogService,
  ) {}

  private async findProfileByUserIdOrThrow(userId: string): Promise<TechnicianProfile> {
    const profile = await this.technicianProfiles.findOne({ where: { userId } });
    if (!profile) {
      throw new ApiException(ErrorCode.VAL_001, 'بروفايل الفني غير موجود', HttpStatus.NOT_FOUND);
    }
    return profile;
  }

  async listMyCategories(userId: string): Promise<TechnicianCategory[]> {
    const profile = await this.findProfileByUserIdOrThrow(userId);
    return this.technicianCategories.find({ where: { technicianId: profile.id }, order: { createdAt: 'DESC' } });
  }

  async declareCategory(userId: string, dto: SelfDeclareCategoryDto): Promise<TechnicianCategory> {
    const profile = await this.findProfileByUserIdOrThrow(userId);
    const category = await this.serviceCategories.findOne({ where: { id: dto.category_id } });
    if (!category || !category.isActive) {
      throw new ApiException(ErrorCode.VAL_001, 'الفئة غير موجودة أو متوقفة', HttpStatus.NOT_FOUND);
    }

    const existing = await this.technicianCategories.findOne({
      where: { technicianId: profile.id, categoryId: dto.category_id },
    });
    if (existing) {
      // نفس منطق declareService() بالحرف — رفض قديم بس ممكن يتصرّح تاني، أي حالة تانية قرار قائم.
      if (existing.verificationStatus !== TechnicianServiceVerificationStatus.REJECTED) {
        throw new ApiException(ErrorCode.VAL_001, 'عندك طلب/اعتماد قائم بالفعل لنفس الفئة دي', HttpStatus.CONFLICT);
      }
      const previousStatus = existing.verificationStatus;
      existing.verificationStatus = TechnicianServiceVerificationStatus.PENDING_VERIFICATION;
      existing.isSelfDeclared = true;
      existing.isActive = false;
      existing.rejectionReason = null;
      existing.reviewedByUserId = null;
      existing.reviewedAt = null;
      await this.technicianCategories.save(existing);

      await this.auditLog.record({
        actorUserId: userId,
        actorRole: 'technician',
        action: 'technician_category.re_declared',
        entityType: 'technician_category',
        entityId: existing.id,
        oldValues: { verification_status: previousStatus },
        newValues: { verification_status: existing.verificationStatus, category_id: dto.category_id },
      });
      return existing;
    }

    const row = this.technicianCategories.create({
      technicianId: profile.id,
      categoryId: dto.category_id,
      isActive: false,
      isSelfDeclared: true,
      verificationStatus: TechnicianServiceVerificationStatus.PENDING_VERIFICATION,
    });
    await this.technicianCategories.save(row);

    await this.auditLog.record({
      actorUserId: userId,
      actorRole: 'technician',
      action: 'technician_category.declared',
      entityType: 'technician_category',
      entityId: row.id,
      newValues: { category_id: dto.category_id },
    });
    return row;
  }

  private async findMyCategoryOrThrow(userId: string, technicianCategoryId: string): Promise<TechnicianCategory> {
    const profile = await this.findProfileByUserIdOrThrow(userId);
    const row = await this.technicianCategories.findOne({ where: { id: technicianCategoryId } });
    if (!row || row.technicianId !== profile.id) {
      throw new ApiException(ErrorCode.VAL_001, 'التصريح غير موجود', HttpStatus.NOT_FOUND);
    }
    return row;
  }

  async withdrawCategory(userId: string, technicianCategoryId: string): Promise<void> {
    const row = await this.findMyCategoryOrThrow(userId, technicianCategoryId);
    if (row.verificationStatus === TechnicianServiceVerificationStatus.SUSPENDED) {
      throw new ApiException(ErrorCode.VAL_001, 'الفئة دي موقوفة من الإدارة — تواصل مع الدعم', HttpStatus.FORBIDDEN);
    }

    if (row.verificationStatus === TechnicianServiceVerificationStatus.APPROVED) {
      row.isActive = false;
      await this.technicianCategories.save(row);
    } else {
      await this.technicianCategories.delete({ id: row.id });
    }

    await this.auditLog.record({
      actorUserId: userId,
      actorRole: 'technician',
      action: 'technician_category.withdrawn',
      entityType: 'technician_category',
      entityId: row.id,
      oldValues: { verification_status: row.verificationStatus },
    });
  }

  // ── مراجعة الأدمن ────────────────────────────────────────────────────

  async listPendingCategoryDeclarationsWithNames(): Promise<
    { row: TechnicianCategory; technicianCode: string; technicianFullName: string; categoryNameAr: string }[]
  > {
    const rows = await this.technicianCategories.manager.query<
      { id: string; technician_code: string; full_name: string; category_name_ar: string }[]
    >(
      `SELECT tc.id, tp.technician_code, u.full_name, sc.name_ar AS category_name_ar
       FROM technician_categories tc
       JOIN technician_profiles tp ON tp.id = tc.technician_id
       JOIN users u ON u.id = tp.user_id
       JOIN service_categories sc ON sc.id = tc.category_id
       WHERE tc.verification_status = 'pending_verification'
       ORDER BY tc.created_at ASC`,
    );
    if (rows.length === 0) return [];
    const declarations = await this.technicianCategories.find({ where: { id: In(rows.map((r) => r.id)) } });
    const byId = new Map(declarations.map((d) => [d.id, d]));
    return rows
      .map((r) => {
        const row = byId.get(r.id);
        if (!row) return null;
        return { row, technicianCode: r.technician_code, technicianFullName: r.full_name, categoryNameAr: r.category_name_ar };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }

  private async findTechnicianCategoryOrThrow(id: string): Promise<TechnicianCategory> {
    const row = await this.technicianCategories.findOne({ where: { id } });
    if (!row) {
      throw new ApiException(ErrorCode.VAL_001, 'التصريح غير موجود', HttpStatus.NOT_FOUND);
    }
    return row;
  }

  private async emitCategoryVerificationChanged(
    row: TechnicianCategory,
    previousStatus: TechnicianServiceVerificationStatus,
    reason: string | null,
  ): Promise<void> {
    const [profile, category] = await Promise.all([
      this.technicianProfiles.findOneOrFail({ where: { id: row.technicianId } }),
      this.serviceCategories.findOne({ where: { id: row.categoryId } }),
    ]);
    this.events.emit(
      TECHNICIAN_CATEGORY_VERIFICATION_CHANGED_EVENT,
      new TechnicianCategoryVerificationChangedEvent(
        row.id,
        profile.userId,
        category?.nameAr ?? 'فئة',
        previousStatus,
        row.verificationStatus,
        reason,
      ),
    );
  }

  async approveCategoryDeclaration(adminUserId: string, id: string, meta?: AuditActorMeta): Promise<TechnicianCategory> {
    const row = await this.findTechnicianCategoryOrThrow(id);
    if (
      row.verificationStatus !== TechnicianServiceVerificationStatus.PENDING_VERIFICATION &&
      row.verificationStatus !== TechnicianServiceVerificationStatus.SUSPENDED
    ) {
      throw new ApiException(ErrorCode.VAL_001, 'التصريح ده مش في حالة تسمح بالاعتماد', HttpStatus.CONFLICT);
    }

    const previousStatus = row.verificationStatus;
    row.verificationStatus = TechnicianServiceVerificationStatus.APPROVED;
    row.isActive = true;
    row.rejectionReason = null;
    row.reviewedByUserId = adminUserId;
    row.reviewedAt = new Date();
    await this.technicianCategories.save(row);

    await this.emitCategoryVerificationChanged(row, previousStatus, null);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'technician_category.approved',
      entityType: 'technician_category',
      entityId: row.id,
      oldValues: { verification_status: previousStatus },
      newValues: { verification_status: row.verificationStatus },
      meta,
    });
    return row;
  }

  async rejectCategoryDeclaration(adminUserId: string, id: string, reason: string, meta?: AuditActorMeta): Promise<TechnicianCategory> {
    const row = await this.findTechnicianCategoryOrThrow(id);
    if (row.verificationStatus !== TechnicianServiceVerificationStatus.PENDING_VERIFICATION) {
      throw new ApiException(ErrorCode.VAL_001, 'التصريح ده مش تحت المراجعة', HttpStatus.CONFLICT);
    }

    const previousStatus = row.verificationStatus;
    row.verificationStatus = TechnicianServiceVerificationStatus.REJECTED;
    row.isActive = false;
    row.rejectionReason = reason;
    row.reviewedByUserId = adminUserId;
    row.reviewedAt = new Date();
    await this.technicianCategories.save(row);

    await this.emitCategoryVerificationChanged(row, previousStatus, reason);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'technician_category.rejected',
      entityType: 'technician_category',
      entityId: row.id,
      oldValues: { verification_status: previousStatus },
      newValues: { verification_status: row.verificationStatus, rejection_reason: reason },
      meta,
    });
    return row;
  }

  async suspendCategoryDeclaration(adminUserId: string, id: string, reason: string, meta?: AuditActorMeta): Promise<TechnicianCategory> {
    const row = await this.findTechnicianCategoryOrThrow(id);
    if (row.verificationStatus !== TechnicianServiceVerificationStatus.APPROVED) {
      throw new ApiException(ErrorCode.VAL_001, 'مينفعش توقف تصريح مش معتمد أصلاً', HttpStatus.CONFLICT);
    }

    const previousStatus = row.verificationStatus;
    row.verificationStatus = TechnicianServiceVerificationStatus.SUSPENDED;
    row.isActive = false;
    row.rejectionReason = reason;
    row.reviewedByUserId = adminUserId;
    row.reviewedAt = new Date();
    await this.technicianCategories.save(row);

    await this.emitCategoryVerificationChanged(row, previousStatus, reason);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'technician_category.suspended',
      entityType: 'technician_category',
      entityId: row.id,
      oldValues: { verification_status: previousStatus },
      newValues: { verification_status: row.verificationStatus, reason },
      meta,
    });
    return row;
  }
}
