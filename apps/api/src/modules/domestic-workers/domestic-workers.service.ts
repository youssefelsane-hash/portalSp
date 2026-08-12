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
    const profile = await this.findByIdOrThrow(workerId);
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
    await this.profiles.save(profile);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'domestic_worker.reviewed',
      entityType: 'domestic_worker_profile',
      entityId: profile.id,
      oldValues: { verification_status: previousStatus },
      newValues: { verification_status: profile.verificationStatus },
      meta,
    });

    return profile;
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
