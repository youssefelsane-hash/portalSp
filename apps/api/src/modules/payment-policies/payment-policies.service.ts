import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AuditActorMeta, AuditLogService } from '../audit/audit-log.service';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import {
  PaymentPolicy,
  PaymentPolicyAcceptance,
  PaymentPolicyVersion,
} from './entities/payment-policy.entity';

export interface ApplicablePolicy {
  policyId: string;
  slug: string;
  titleAr: string;
  isRequired: boolean;
  currentVersionId: string;
  currentVersion: number;
  bodyAr: string;
}

/**
 * سياسات الدفع/الشروط (versioned consent) — نفس نمط settings/branding في الإدارة، بس المحتوى
 * هنا legal-ish فبناء النسخ إجباري: التعديل = نشر نسخة جديدة، والنسخ القديمة immutable،
 * والقبول بيتسجل مربوط بنسخة محددة + سياق (طلب/تقديم تقسيط) — ممنوع إعادة كتابة الموافقات.
 */
@Injectable()
export class PaymentPoliciesService {
  constructor(
    @InjectRepository(PaymentPolicy) private readonly policies: Repository<PaymentPolicy>,
    @InjectRepository(PaymentPolicyVersion) private readonly versions: Repository<PaymentPolicyVersion>,
    @InjectRepository(PaymentPolicyAcceptance) private readonly acceptances: Repository<PaymentPolicyAcceptance>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly auditLog: AuditLogService,
  ) {}

  /**
   * السياسات المطبقة فعلاً على checkout معيّن + نسختها الحالية — مصدر إجابة السؤال الثلاثي:
   * "إيه السياسة؟ أنهي نسخة؟ هل القبول إجباري؟". الاستهداف: خدمة بعينها تتفوق على الفئة
   * تتفوق على العام (أول match لكل applies_to).
   */
  async listApplicableForCheckout(params: {
    appliesTo: string;
    serviceId?: string;
    categoryId?: string;
  }): Promise<ApplicablePolicy[]> {
    const rows = await this.dataSource.query<
      { id: string; slug: string; title_ar: string; is_required: boolean; version_id: string; version: number; body_ar: string }[]
    >(
      `SELECT DISTINCT ON (p.id)
              p.id, p.slug, p.title_ar, p.is_required,
              v.id AS version_id, v.version, v.body_ar
       FROM payment_policies p
       JOIN LATERAL (
         SELECT id, version, body_ar FROM payment_policy_versions
         WHERE policy_id = p.id ORDER BY version DESC LIMIT 1
       ) v ON true
       WHERE p.is_active = true AND p.applies_to = $1
         AND (p.target_service_id IS NULL OR p.target_service_id = $2)
         AND (p.target_category_id IS NULL OR p.target_category_id = $3)
       ORDER BY p.id, p.target_service_id NULLS LAST, v.version DESC`,
      [params.appliesTo, params.serviceId ?? null, params.categoryId ?? null],
    );
    return rows.map((r) => ({
      policyId: r.id,
      slug: r.slug,
      titleAr: r.title_ar,
      isRequired: r.is_required,
      currentVersionId: r.version_id,
      currentVersion: Number(r.version),
      bodyAr: r.body_ar,
    }));
  }

  /** الإجبارية فقط — بتستخدم في التحقق من جهة الباك-إند عند الإنشاء/التقديم. */
  async listRequiredForCheckout(params: { appliesTo: string; serviceId?: string; categoryId?: string }): Promise<ApplicablePolicy[]> {
    const all = await this.listApplicableForCheckout(params);
    return all.filter((p) => p.isRequired);
  }

  /** تسجيل قبول موثّق — context يربط الإثبات بالعملية الفعلية (طلب/تقديم). */
  async recordAcceptance(params: {
    userId: string;
    policyVersionId: string;
    contextType: string;
    contextId: string;
  }): Promise<void> {
    const versionExists = await this.versions.findOne({ where: { id: params.policyVersionId } });
    if (!versionExists) {
      throw new ApiException(ErrorCode.VAL_001, 'نسخة السياسة غير موجودة', HttpStatus.BAD_REQUEST);
    }
    await this.acceptances.save(
      this.acceptances.create({
        policyVersionId: params.policyVersionId,
        userId: params.userId,
        contextType: params.contextType,
        contextId: params.contextId,
      }),
    );
  }

  /** تحقق أن كل النسخ الإجبارية المتاحة اتبعتت ضمن acceptances اللي العميل بعتها. */
  assertAllRequiredAccepted(required: ApplicablePolicy[], acceptedVersionIds: Set<string>): void {
    const missing = required.filter((p) => !acceptedVersionIds.has(p.currentVersionId));
    if (missing.length > 0) {
      throw new ApiException(
        ErrorCode.VAL_001,
        `لازم توافق على الشروط دي الأول: ${missing.map((m) => m.titleAr).join('، ')}`,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  // ===================== Admin CRUD =====================

  async listAll(): Promise<(PaymentPolicy & { latest_version: number | null })[]> {
    const rows = await this.policies.find({ order: { displayOrder: 'ASC', createdAt: 'DESC' } });
    const latest = await this.dataSource.query<{ policy_id: string; version: number }[]>(
      `SELECT DISTINCT ON (policy_id) policy_id, version FROM payment_policy_versions ORDER BY policy_id, version DESC`,
    );
    const byPolicy = new Map(latest.map((l) => [l.policy_id, Number(l.version)]));
    return rows.map((p) => ({ ...p, latest_version: byPolicy.get(p.id) ?? null }));
  }

  async listVersions(policyId: string): Promise<PaymentPolicyVersion[]> {
    return this.versions.find({ where: { policyId }, order: { version: 'DESC' } });
  }

  async createPolicy(
    adminUserId: string,
    dto: {
      slug: string;
      title_ar: string;
      applies_to: string;
      target_service_id?: string | null;
      target_category_id?: string | null;
      is_required?: boolean;
      display_order?: number;
      body_ar: string;
    },
    meta?: AuditActorMeta,
  ): Promise<PaymentPolicy> {
    if (!dto.body_ar?.trim() || dto.body_ar.length < 20) {
      throw new ApiException(ErrorCode.VAL_001, 'نص السياسة قصير جدًا — لازم محتوى فعلي', HttpStatus.BAD_REQUEST);
    }
    return this.dataSource.transaction(async (manager) => {
      const policy = await manager.save(
        manager.create(PaymentPolicy, {
          slug: dto.slug,
          titleAr: dto.title_ar,
          appliesTo: dto.applies_to,
          targetServiceId: dto.target_service_id ?? null,
          targetCategoryId: dto.target_category_id ?? null,
          isRequired: dto.is_required ?? true,
          displayOrder: dto.display_order ?? 0,
          isActive: true,
        }),
      );
      await manager.save(manager.create(PaymentPolicyVersion, { policyId: policy.id, version: 1, bodyAr: dto.body_ar }));
      await this.auditLog.record({
        actorUserId: adminUserId,
        actorRole: 'admin',
        action: 'payment_policy.created',
        entityType: 'payment_policy',
        entityId: policy.id,
        newValues: { slug: policy.slug, applies_to: policy.appliesTo },
        meta,
      });
      return policy;
    });
  }

  async updatePolicyMeta(
    adminUserId: string,
    policyId: string,
    dto: { title_ar?: string; is_required?: boolean; is_active?: boolean; display_order?: number },
    meta?: AuditActorMeta,
  ): Promise<PaymentPolicy> {
    const policy = await this.policies.findOne({ where: { id: policyId } });
    if (!policy) throw new ApiException(ErrorCode.VAL_001, 'السياسة غير موجودة', HttpStatus.NOT_FOUND);
    if (dto.title_ar !== undefined) policy.titleAr = dto.title_ar;
    if (dto.is_required !== undefined) policy.isRequired = dto.is_required;
    if (dto.is_active !== undefined) policy.isActive = dto.is_active;
    if (dto.display_order !== undefined) policy.displayOrder = dto.display_order;
    await this.policies.save(policy);
    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'payment_policy.updated',
      entityType: 'payment_policy',
      entityId: policy.id,
      newValues: { ...dto },
      meta,
    });
    return policy;
  }

  /**
   * نشر نسخة جديدة — **مش تعديل** للنسخ الحالية (immutable by design). القبولات القديمة بتفضل
   * مربوطة بنسخها؛ الجديد بيخضع للنسخة الجديدة من لحظة النشر.
   */
  async publishNewVersion(
    adminUserId: string,
    policyId: string,
    bodyAr: string,
    meta?: AuditActorMeta,
  ): Promise<PaymentPolicyVersion> {
    if (!bodyAr?.trim() || bodyAr.length < 20) {
      throw new ApiException(ErrorCode.VAL_001, 'نص السياسة قصير جدًا', HttpStatus.BAD_REQUEST);
    }
    return this.dataSource.transaction(async (manager) => {
      const [{ next }] = await manager.query<{ next: number }[]>(
        `SELECT COALESCE(MAX(version), 0) + 1 AS next FROM payment_policy_versions WHERE policy_id = $1`,
        [policyId],
      );
      const version = await manager.save(manager.create(PaymentPolicyVersion, { policyId, version: Number(next), bodyAr }));
      await this.auditLog.record({
        actorUserId: adminUserId,
        actorRole: 'admin',
        action: 'payment_policy.version_published',
        entityType: 'payment_policy_version',
        entityId: version.id,
        newValues: { policy_id: policyId, version: version.version },
        meta,
      });
      return version;
    });
  }
}
