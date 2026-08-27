import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import {
  blindIndex,
  decryptPii,
  encryptPii,
  isValidEgyptianNationalId,
  maskNationalId,
  normalizeNationalId,
} from '../../common/crypto/pii-crypto.util';
import { AuditActorMeta, AuditLogService } from '../audit/audit-log.service';
import { SecurityEventsService } from '../security/security-events.service';
import { SecurityEventSeverity, SecurityEventType } from '../security/entities/security-event.entity';
import { TechnicianProfile, TechnicianVerificationStatus } from './entities/technician-profile.entity';

/** مين كتب الرقم — الاتنين مسموحين (ADR-0045 §4)، بس بقواعد مختلفة. */
export type NationalIdSource = 'technician' | 'admin';

export interface NationalIdConflict {
  /** البروفايل اللي ماسك الرقم بالفعل. */
  technicianProfileId: string;
  technicianCode: string;
  verificationStatus: TechnicianVerificationStatus;
  isBlocked: boolean;
  /** الحساب اتشال فعلًا؟ لو أيوه، الرقم متحرّر والتعارض ده تاريخي بس (مش مانع). */
  isDeleted: boolean;
}

/**
 * هوية الفني الدائمة عبر الرقم القومي (ADR-0045).
 *
 * **المشكلة اللي بيحلها**: الهوية الوحيدة الفعّالة في المنصة كانت رقم التليفون، وهي قابلة
 * للتبديل بالكامل — فني اتحظر يشتري شريحة جديدة ويسجّل من تاني كشخص جديد تمامًا. الاسم مش كافي
 * (تشابه أسماء عالي). الرقم القومي هو الحاجة الوحيدة اللي بتفضل ثابتة.
 *
 * **الفصل بين القيمة والفهرس**: القيمة بتتخزّن مشفّرة (`national_id_encrypted`) عشان المراجع
 * البشري يقدر يقارنها بصورة البطاقة، والمقارنة/التفرّد بيتم على HMAC حتمي
 * (`national_id_hash`). راجع `pii-crypto.util.ts` للسبب الكامل.
 */
@Injectable()
export class TechnicianIdentityService {
  private readonly logger = new Logger(TechnicianIdentityService.name);

  constructor(
    @InjectRepository(TechnicianProfile) private readonly technicianProfiles: Repository<TechnicianProfile>,
    private readonly dataSource: DataSource,
    private readonly auditLog: AuditLogService,
    private readonly securityEvents: SecurityEventsService,
  ) {}

  /**
   * بتدوّر على أي حساب تاني ماسك نفس الرقم — **بما فيهم المحذوفين**، لأن السؤال الإداري
   * «الشخص ده كان عندنا قبل كده؟» مهم حتى لو الرقم متحرّر تقنيًا.
   */
  async findConflicts(hash: string, excludeProfileId?: string): Promise<NationalIdConflict[]> {
    const rows = await this.dataSource.query<
      {
        id: string;
        technician_code: string;
        verification_status: TechnicianVerificationStatus;
        is_blocked: boolean;
        is_deleted: boolean;
      }[]
    >(
      `SELECT tp.id, tp.technician_code, tp.verification_status,
              COALESCE(u.is_blocked, false) AS is_blocked,
              (tp.deleted_at IS NOT NULL) AS is_deleted
         FROM technician_profiles tp
         JOIN users u ON u.id = tp.user_id
        WHERE tp.national_id_hash = $1
          AND ($2::uuid IS NULL OR tp.id <> $2::uuid)
        ORDER BY tp.created_at ASC`,
      [hash, excludeProfileId ?? null],
    );

    return rows.map((r) => ({
      technicianProfileId: r.id,
      technicianCode: r.technician_code,
      verificationStatus: r.verification_status,
      isBlocked: r.is_blocked,
      isDeleted: r.is_deleted,
    }));
  }

  /**
   * تسجيل/تعديل الرقم القومي لفني.
   *
   * @param actorUserId مين بيعمل العملية (الفني نفسه أو الأدمن) — بيتسجّل في `national_id_set_by_user_id`.
   * @param source الفني بيقدر يكتبه **قبل الاعتماد بس**؛ الأدمن في أي وقت. لو الفني قدر يغيّره
   *   بعد الاعتماد، الحماية كلها بتتلف: اتحظر ⇒ غيّر رقمه ⇒ سجّل من تاني.
   */
  async setNationalId(params: {
    technicianProfileId: string;
    rawNationalId: string;
    actorUserId: string;
    source: NationalIdSource;
    meta?: AuditActorMeta;
  }): Promise<TechnicianProfile> {
    const normalized = normalizeNationalId(params.rawNationalId);
    if (!isValidEgyptianNationalId(normalized)) {
      throw new ApiException(
        ErrorCode.VAL_001,
        'الرقم القومي لازم يكون 14 رقم بالظبط',
        HttpStatus.BAD_REQUEST,
      );
    }

    const profile = await this.technicianProfiles.findOne({ where: { id: params.technicianProfileId } });
    if (!profile) {
      throw new ApiException(ErrorCode.TECH_001, 'الفني غير موجود', HttpStatus.NOT_FOUND);
    }

    if (params.source === 'technician' && profile.verificationStatus === TechnicianVerificationStatus.APPROVED) {
      throw new ApiException(
        ErrorCode.TECH_004,
        'الرقم القومي مش بيتغيّر بعد اعتماد الحساب — كلّم الإدارة لو فيه غلط',
        HttpStatus.FORBIDDEN,
      );
    }

    const hash = blindIndex(normalized);
    if (profile.nationalIdHash === hash) return profile; // نفس القيمة — عملية بلا أثر، مش خطأ

    const conflicts = await this.findConflicts(hash, profile.id);
    // الحسابات المحذوفة بتحرّر الرقم (ADR-0045 §2) — تعارض معاها تاريخي بس، مش مانع.
    const blocking = conflicts.filter((c) => !c.isDeleted);
    if (blocking.length > 0) {
      await this.recordDuplicateAttempt(profile, blocking, normalized, params);
      throw new ApiException(
        ErrorCode.TECH_003,
        // بلا أي تلميح لمين الرقم — وإلا أي حد بيجرّب أرقام يقدر يستخرج قاعدة هوية.
        'الرقم القومي ده مسجّل بالفعل. لو ده رقمك فعلاً، كلّم الإدارة.',
        HttpStatus.CONFLICT,
      );
    }

    const previouslyHadValue = profile.nationalIdHash !== null;
    profile.nationalIdEncrypted = encryptPii(normalized);
    profile.nationalIdHash = hash;
    profile.nationalIdSetAt = new Date();
    profile.nationalIdSetByUserId = params.actorUserId;

    try {
      await this.technicianProfiles.save(profile);
    } catch (err) {
      // الفهرس الفريد الجزئي هو الضمان الحقيقي ضد السباق (طلبين متزامنين بنفس الرقم) — الفحص
      // فوق بيدّي رسالة مفهومة في الحالة العادية، وده بيمسك الحالة النادرة.
      if (String(err).includes('uq_technician_national_id_active')) {
        throw new ApiException(
          ErrorCode.TECH_003,
          'الرقم القومي ده مسجّل بالفعل. لو ده رقمك فعلاً، كلّم الإدارة.',
          HttpStatus.CONFLICT,
        );
      }
      throw err;
    }

    await this.auditLog.record({
      actorUserId: params.actorUserId,
      actorRole: params.source === 'admin' ? 'admin' : 'technician',
      action: previouslyHadValue ? 'technician.national_id_replaced' : 'technician.national_id_set',
      entityType: 'technician_profile',
      entityId: profile.id,
      // الرقم نفسه **ما بيتسجّلش** في الـaudit — سجل التدقيق دايم وبيتقرا من ناس كتير.
      newValues: {
        national_id_masked: maskNationalId(normalized),
        source: params.source,
        historical_deleted_matches: conflicts.filter((c) => c.isDeleted).length,
      },
      meta: params.meta,
    });

    // معلومة إدارية حقيقية: الشخص ده كان عندنا قبل كده بحساب اتشال. مش مانع، بس الأدمن لازم يعرف.
    if (conflicts.some((c) => c.isDeleted)) {
      this.logger.warn(
        `الفني ${profile.technicianCode} سجّل رقم قومي مطابق لحساب متشال قبل كده (${conflicts
          .filter((c) => c.isDeleted)
          .map((c) => c.technicianCode)
          .join(', ')})`,
      );
    }

    return profile;
  }

  /** القيمة الصريحة للأدمن المصرّح له بس — `select: false` على العمود بيمنع تحميلها بالغلط. */
  async revealNationalId(technicianProfileId: string): Promise<string | null> {
    const row = await this.technicianProfiles
      .createQueryBuilder('tp')
      .select('tp.id')
      .addSelect('tp.nationalIdEncrypted')
      // `withDeleted` مقصود: أهم سؤال إداري هنا («الشخص ده كان عندنا قبل كده؟») بيتسأل عن
      // حسابات **متشالة** بالظبط. من غيرها الاستعلام كان بيرجّع null بصمت للحساب المتشال
      // (TypeORM بيفلتر الـsoft-deleted تلقائيًا) — اتلقطت بالاختبار الحي.
      .withDeleted()
      .where('tp.id = :id', { id: technicianProfileId })
      .getOne();
    return row?.nationalIdEncrypted ? decryptPii(row.nationalIdEncrypted) : null;
  }

  /** ملخّص آمن للعرض في أي مكان (مفيش الرقم كامل) — بيتحط في رد الأدمن العادي. */
  async summaryFor(profile: TechnicianProfile): Promise<{
    hasNationalId: boolean;
    maskedNationalId: string | null;
    setAt: Date | null;
    /** حسابات تانية (بما فيها المتشالة) بنفس الرقم — إشارة "الشخص ده رجع تاني". */
    linkedAccountCodes: string[];
  }> {
    if (!profile.nationalIdHash) {
      return { hasNationalId: false, maskedNationalId: null, setAt: null, linkedAccountCodes: [] };
    }
    const decrypted = await this.revealNationalId(profile.id);
    const conflicts = await this.findConflicts(profile.nationalIdHash, profile.id);
    return {
      hasNationalId: true,
      maskedNationalId: decrypted ? maskNationalId(decrypted) : null,
      setAt: profile.nationalIdSetAt,
      linkedAccountCodes: conflicts.map((c) => c.technicianCode),
    };
  }

  private async recordDuplicateAttempt(
    profile: TechnicianProfile,
    blocking: NationalIdConflict[],
    normalized: string,
    params: { actorUserId: string; source: NationalIdSource },
  ): Promise<void> {
    // حساب محظور ماسك الرقم = بالظبط السيناريو اللي المالك خايف منه (اتحظر ورجع بتليفون تاني).
    const involvesBlocked = blocking.some(
      (c) => c.isBlocked || c.verificationStatus === TechnicianVerificationStatus.SUSPENDED,
    );
    await this.securityEvents.recordDenial({
      eventType: SecurityEventType.DUPLICATE_IDENTITY_ATTEMPT,
      severity: involvesBlocked ? SecurityEventSeverity.HIGH : SecurityEventSeverity.WARNING,
      actorUserId: params.actorUserId,
      targetType: 'technician_profile',
      targetId: profile.id,
      action: `national_id_duplicate:${params.source}`,
      attemptedValue: {
        attempting_technician_code: profile.technicianCode,
        national_id_masked: maskNationalId(normalized),
        conflicting_accounts: blocking.map((c) => ({
          technician_code: c.technicianCode,
          verification_status: c.verificationStatus,
          is_blocked: c.isBlocked,
        })),
      },
    });
  }
}
