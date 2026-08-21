import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { AuditActorMeta, AuditLogService } from '../audit/audit-log.service';
import { UpdateWorkerLocationDto } from './dto/update-worker-location.dto';
import { UpdateWorkerProfileDto } from './dto/update-worker-profile.dto';
import { ReviewWorkerDto } from './dto/review-worker.dto';
import { DomesticWorkerProfile, DomesticWorkerSpecialty, DomesticWorkerVerificationStatus } from './entities/domestic-worker-profile.entity';

export interface PublicWorkerListItem {
  profile: DomesticWorkerProfile;
  fullName: string;
  distanceKm: number | null;
}

@Injectable()
export class DomesticWorkersService {
  constructor(
    @InjectRepository(DomesticWorkerProfile) private readonly profiles: Repository<DomesticWorkerProfile>,
    private readonly auditLog: AuditLogService,
  ) {}

  async findByUserIdOrThrow(userId: string): Promise<DomesticWorkerProfile> {
    const profile = await this.profiles.findOne({ where: { userId } });
    if (!profile) {
      throw new ApiException(ErrorCode.VAL_001, 'حسابك غير مسجّل كمقدّم خدمة منزلية', HttpStatus.NOT_FOUND);
    }
    return profile;
  }

  async findByIdOrThrow(id: string): Promise<DomesticWorkerProfile> {
    const profile = await this.profiles.findOne({ where: { id } });
    if (!profile) {
      throw new ApiException(ErrorCode.VAL_001, 'مقدّم الخدمة غير موجود', HttpStatus.NOT_FOUND);
    }
    return profile;
  }

  /**
   * فحص تعارض جدولي حقيقي (ADR-0030) — إصلاح فجوة صحة بيانات كانت موجودة: صفر فحص تعارض من أي
   * نوع لحجز الشغالة قبل كده، في أي مسار (القديم `domestic_worker_bookings` ولا الجديد
   * `orders.domestic_worker_profile_id`، ADR-0029 Slice 2a) — عميلين كانوا يقدروا يحجزوا نفس
   * الشغالة لنفس الوقت بالظبط بلا أي رفض. الدالة دي بتفحص المسارين مصدر واحد، مش منطق مكرر.
   *
   * حجز `hourly` (قديم أو جديد) بمداه الحقيقي `[scheduledAt, scheduledAt+durationHours)`. حجز
   * `monthly_live_in` نشط (قديم بس — الجديد مؤجّل لـPhase A.4 Slice 4) بيُعتبر شاغل **كل** وقت
   * الشغالة طول مدته (`scheduledAt` → `currentPeriodEndAt`/`pendingPeriodEndAt`، أو مفتوح لو
   * الاتنين null) — شغالة مقيمة مينفعش تاخد شغلانة بالساعة في نفس الوقت.
   *
   * `durationHours=null` معناها فترة مفتوحة (بلا نهاية معروفة) — نفس معنى حجز شهري مقيم جديد بيبدأ
   * وهيفضل شاغل الشغالة "للأبد" لحد ما يتلغي/يخلص، فبيتفحص ضد أي حجز تاني (بالساعة أو شهري) بلا
   * حد أقصى لتاريخ النهاية.
   */
  async assertNoSchedulingConflict(
    workerId: string,
    startsAt: Date,
    durationHours: number | null,
    opts?: { excludeBookingId?: string; excludeOrderId?: string },
  ): Promise<void> {
    const endsAt = durationHours === null ? null : new Date(startsAt.getTime() + durationHours * 3_600_000);
    const [legacyConflict] = await this.profiles.manager.query<{ booking_number: string }[]>(
      `SELECT booking_number FROM domestic_worker_bookings
       WHERE worker_id = $1 AND status NOT IN ('cancelled', 'completed')
         AND id IS DISTINCT FROM $4::uuid
         AND (
           (booking_type = 'hourly' AND scheduled_at < COALESCE($3::timestamptz, 'infinity'::timestamptz)
             AND (scheduled_at + (COALESCE(duration_hours, 0) || ' hours')::interval) > $2)
           OR (booking_type = 'monthly_live_in' AND scheduled_at < COALESCE($3::timestamptz, 'infinity'::timestamptz)
               AND COALESCE(current_period_end_at, pending_period_end_at, 'infinity'::timestamptz) > $2)
         )
       LIMIT 1`,
      [workerId, startsAt, endsAt, opts?.excludeBookingId ?? null],
    );
    if (legacyConflict) {
      throw new ApiException(
        ErrorCode.VAL_001,
        `الفني ده متعارض مع حجز موجود بالفعل (${legacyConflict.booking_number}) في الفترة دي`,
        HttpStatus.CONFLICT,
      );
    }

    const [unifiedConflict] = await this.profiles.manager.query<{ order_number: string }[]>(
      `SELECT order_number FROM orders
       WHERE domestic_worker_profile_id = $1
         AND order_status NOT IN ('cancelled_by_customer', 'cancelled_by_technician', 'cancelled_by_system', 'expired', 'completed', 'refunded')
         AND id IS DISTINCT FROM $4::uuid
         AND scheduled_at IS NOT NULL AND domestic_worker_duration_hours IS NOT NULL
         AND scheduled_at < COALESCE($3::timestamptz, 'infinity'::timestamptz)
         AND (scheduled_at + (domestic_worker_duration_hours || ' hours')::interval) > $2`,
      [workerId, startsAt, endsAt, opts?.excludeOrderId ?? null],
    );
    if (unifiedConflict) {
      throw new ApiException(
        ErrorCode.VAL_001,
        `الفني ده متعارض مع طلب موجود بالفعل (${unifiedConflict.order_number}) في الفترة دي`,
        HttpStatus.CONFLICT,
      );
    }
  }

  /** بروفايل عام — لازم معتمد فعلاً، وإلا 404 (مش عرض حالة داخلية للعميل). */
  async getPublicProfileOrThrow(id: string): Promise<{ profile: DomesticWorkerProfile; fullName: string }> {
    const profile = await this.findByIdOrThrow(id);
    if (profile.verificationStatus !== DomesticWorkerVerificationStatus.APPROVED) {
      throw new ApiException(ErrorCode.VAL_001, 'مقدّم الخدمة غير موجود', HttpStatus.NOT_FOUND);
    }
    const [user] = await this.profiles.manager.query<{ full_name: string }[]>(
      'SELECT full_name FROM users WHERE id = $1',
      [profile.userId],
    );
    return { profile, fullName: user.full_name };
  }

  async updateProfile(userId: string, dto: UpdateWorkerProfileDto): Promise<DomesticWorkerProfile> {
    const profile = await this.findByUserIdOrThrow(userId);
    if (dto.bio !== undefined) profile.bio = dto.bio;
    if (dto.years_of_experience !== undefined) profile.yearsOfExperience = dto.years_of_experience;
    if (dto.specialties !== undefined) profile.specialties = dto.specialties;
    if (dto.hourly_rate_cents !== undefined) profile.hourlyRateCents = dto.hourly_rate_cents;
    if (dto.monthly_rate_cents !== undefined) profile.monthlyRateCents = dto.monthly_rate_cents;

    // مينفعش تطلب مراجعة أدمن قبل ما يكون عندها تخصص واحد على الأقل وسعر مناسب له —
    // فحص واضح هنا بدل ما نسيب بروفايل ناقص يوصل للمراجعة (نفس فلسفة "فشل واضح أحسن من صمت").
    if (dto.specialties !== undefined) {
      this.assertRatesMatchSpecialties(profile);
    }

    return this.profiles.save(profile);
  }

  private assertRatesMatchSpecialties(profile: DomesticWorkerProfile): void {
    const needsHourly = profile.specialties.some(
      (s) => s === DomesticWorkerSpecialty.CLEANING_HOURLY || s === DomesticWorkerSpecialty.BABYSITTING_HOURLY,
    );
    const needsMonthly = profile.specialties.includes(DomesticWorkerSpecialty.LIVE_IN_MAID_MONTHLY);
    if (needsHourly && !profile.hourlyRateCents) {
      throw new ApiException(ErrorCode.VAL_001, 'لازم تحدد سعر الساعة لتخصصات الساعة', HttpStatus.BAD_REQUEST);
    }
    if (needsMonthly && !profile.monthlyRateCents) {
      throw new ApiException(ErrorCode.VAL_001, 'لازم تحدد السعر الشهري لتخصص الإقامة الشهرية', HttpStatus.BAD_REQUEST);
    }
  }

  async updateLocation(userId: string, dto: UpdateWorkerLocationDto): Promise<void> {
    const profile = await this.findByUserIdOrThrow(userId);
    await this.profiles.update(profile.id, {
      currentLocation: { type: 'Point', coordinates: [dto.longitude, dto.latitude] },
    });
  }

  /** طلب مراجعة أدمن — لازم تخصص واحد على الأقل وأسعار متوافقة معاه، وإلا 400 واضح. */
  async requestReview(userId: string): Promise<DomesticWorkerProfile> {
    const profile = await this.findByUserIdOrThrow(userId);
    if (profile.specialties.length === 0) {
      throw new ApiException(ErrorCode.VAL_001, 'لازم تحدد تخصص واحد على الأقل الأول', HttpStatus.BAD_REQUEST);
    }
    this.assertRatesMatchSpecialties(profile);
    if (profile.verificationStatus !== DomesticWorkerVerificationStatus.PENDING) {
      throw new ApiException(ErrorCode.VAL_001, 'البروفايل مش في حالة انتظار مراجعة', HttpStatus.CONFLICT);
    }
    return profile;
  }

  async listForAdmin(status?: DomesticWorkerVerificationStatus): Promise<DomesticWorkerProfile[]> {
    return this.profiles.find({
      where: status ? { verificationStatus: status } : {},
      order: { createdAt: 'DESC' },
    });
  }

  async review(adminUserId: string, workerId: string, dto: ReviewWorkerDto, meta?: AuditActorMeta): Promise<DomesticWorkerProfile> {
    return this.profiles.manager.transaction(async (manager) => {
      const profile = await manager
        .createQueryBuilder(DomesticWorkerProfile, 'worker')
        .setLock('pessimistic_write')
        .where('worker.id = :workerId', { workerId })
        .getOne();
      if (!profile) {
        throw new ApiException(ErrorCode.VAL_001, 'مقدمة الخدمة غير موجودة', HttpStatus.NOT_FOUND);
      }
      if (profile.verificationStatus !== DomesticWorkerVerificationStatus.PENDING) {
        throw new ApiException(ErrorCode.VAL_001, 'البروفايل ده اترجع عليه قبل كده', HttpStatus.CONFLICT);
      }

      const previousStatus = profile.verificationStatus;
      profile.verificationStatus = dto.status;
      profile.verificationNotes = dto.status === DomesticWorkerVerificationStatus.REJECTED ? (dto.notes ?? null) : null;
      if (dto.status === DomesticWorkerVerificationStatus.APPROVED) {
        profile.approvedAt = new Date();
        profile.approvedByUserId = adminUserId;
      }
      await manager.save(profile);
      await this.auditLog.record(
        {
          actorUserId: adminUserId,
          actorRole: 'admin',
          action: 'domestic_worker.reviewed',
          entityType: 'domestic_worker_profile',
          entityId: profile.id,
          oldValues: { verification_status: previousStatus },
          newValues: { verification_status: profile.verificationStatus },
          meta,
        },
        manager,
      );
      return profile;
    });
  }

  /** تصفّح العميل — معتمدين ومتاحين بس، فلترة بتخصص اختيارية، ترتيب بالتقييم ثم القرب (نفس فلسفة §3). */
  async browseForCustomer(
    specialty: DomesticWorkerSpecialty | undefined,
    latitude: number | undefined,
    longitude: number | undefined,
  ): Promise<PublicWorkerListItem[]> {
    const rows = await this.profiles.manager.query<
      { id: string; full_name: string; distance_km: string | null }[]
    >(
      `SELECT dwp.id, u.full_name,
              CASE WHEN $2::double precision IS NULL OR $3::double precision IS NULL OR dwp.current_location IS NULL
                THEN NULL
                ELSE ST_Distance(dwp.current_location, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography) / 1000.0
              END AS distance_km
       FROM domestic_worker_profiles dwp
       JOIN users u ON u.id = dwp.user_id
       WHERE dwp.verification_status = 'approved' AND dwp.is_available = true AND dwp.deleted_at IS NULL
         AND ($1::domestic_worker_specialty IS NULL OR $1 = ANY(dwp.specialties))
       ORDER BY dwp.average_rating DESC, distance_km ASC NULLS LAST
       LIMIT 50`,
      [specialty ?? null, longitude ?? null, latitude ?? null],
    );

    const profileIds = rows.map((r) => r.id);
    if (profileIds.length === 0) return [];
    const profiles = await this.profiles.find({ where: { id: In(profileIds) } });
    const profilesById = new Map(profiles.map((p) => [p.id, p]));

    return rows
      .map((row) => {
        const profile = profilesById.get(row.id);
        if (!profile) return null;
        return { profile, fullName: row.full_name, distanceKm: row.distance_km !== null ? Number(row.distance_km) : null };
      })
      .filter((x): x is PublicWorkerListItem => x !== null);
  }
}
