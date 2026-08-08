import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { AuditActorMeta, AuditLogService } from '../audit/audit-log.service';
import { CreateFeatureFlagDto } from './dto/create-feature-flag.dto';
import { UpdateFeatureFlagDto } from './dto/update-feature-flag.dto';
import { FeatureFlag } from './entities/feature-flag.entity';

@Injectable()
export class FeatureFlagsService {
  constructor(
    @InjectRepository(FeatureFlag) private readonly flags: Repository<FeatureFlag>,
    private readonly auditLog: AuditLogService,
  ) {}

  list(): Promise<FeatureFlag[]> {
    return this.flags.find({ order: { key: 'ASC' } });
  }

  async findOrThrow(key: string): Promise<FeatureFlag> {
    const flag = await this.flags.findOne({ where: { key } });
    if (!flag) {
      throw new ApiException(ErrorCode.VAL_001, `فلاج الميزة ${key} غير موجود`, HttpStatus.NOT_FOUND);
    }
    return flag;
  }

  async create(adminUserId: string, dto: CreateFeatureFlagDto, meta?: AuditActorMeta): Promise<FeatureFlag> {
    const existing = await this.flags.findOne({ where: { key: dto.key } });
    if (existing) {
      throw new ApiException(ErrorCode.VAL_001, `فلاج الميزة ${dto.key} موجود بالفعل`, HttpStatus.CONFLICT);
    }

    const flag = this.flags.create({
      key: dto.key,
      isEnabled: dto.is_enabled ?? false,
      rolloutPercentage: dto.rollout_percentage ?? 0,
      enabledForUserIds: dto.enabled_for_user_ids ?? null,
      enabledForZoneIds: dto.enabled_for_zone_ids ?? null,
      description: dto.description ?? null,
    });
    await this.flags.save(flag);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'feature_flag.created',
      entityType: 'feature_flag',
      entityId: flag.id,
      newValues: { key: flag.key, is_enabled: flag.isEnabled, rollout_percentage: flag.rolloutPercentage },
      meta,
    });
    return flag;
  }

  async update(adminUserId: string, key: string, dto: UpdateFeatureFlagDto, meta?: AuditActorMeta): Promise<FeatureFlag> {
    const flag = await this.findOrThrow(key);
    const oldValues = {
      is_enabled: flag.isEnabled,
      rollout_percentage: flag.rolloutPercentage,
    };

    if (dto.is_enabled !== undefined) flag.isEnabled = dto.is_enabled;
    if (dto.rollout_percentage !== undefined) flag.rolloutPercentage = dto.rollout_percentage;
    if (dto.enabled_for_user_ids !== undefined) flag.enabledForUserIds = dto.enabled_for_user_ids;
    if (dto.enabled_for_zone_ids !== undefined) flag.enabledForZoneIds = dto.enabled_for_zone_ids;
    if (dto.description !== undefined) flag.description = dto.description;
    await this.flags.save(flag);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'feature_flag.updated',
      entityType: 'feature_flag',
      entityId: flag.id,
      oldValues,
      newValues: { is_enabled: flag.isEnabled, rollout_percentage: flag.rolloutPercentage },
      meta,
    });
    return flag;
  }

  async delete(adminUserId: string, key: string, meta?: AuditActorMeta): Promise<void> {
    const flag = await this.findOrThrow(key);
    await this.flags.delete(flag.id);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'feature_flag.deleted',
      entityType: 'feature_flag',
      entityId: flag.id,
      oldValues: { key: flag.key },
      meta,
    });
  }

  /**
   * توزيع نسبي ديترمينستيك — نفس (key, userId) دايماً بيرجع نفس النتيجة (مش عشوائي في كل نداء)،
   * عشان نفس المستخدم ميشوفش الميزة تظهر وتختفي بالتبديل بين الطلبات. hash بسيط (md5 أول 4 بايت
   * كـ uint32 mod 100) — مفيش داعي أمان تشفيري هنا، بس توزيع ثابت ومتجانس كفاية.
   */
  private isInRolloutBucket(key: string, userId: string, percentage: number): boolean {
    if (percentage >= 100) return true;
    if (percentage <= 0) return false;
    const hash = createHash('md5').update(`${key}:${userId}`).digest();
    const bucket = hash.readUInt32BE(0) % 100;
    return bucket < percentage;
  }

  /**
   * فحص التفعيل الحقيقي لمستخدم/منطقة معيّنة — الترتيب: `is_enabled=false` يقفل كل حاجة فوراً
   * (kill switch)، وإلا `enabled_for_user_ids`/`enabled_for_zone_ids` بيتجاوزوا نسبة التوزيع
   * (استهداف صريح)، وإلا نسبة التوزيع الديترمينستيكية. فلاج مش موجود أصلاً = false (افتراضي آمن،
   * نفس فلسفة SettingsService.getBoolean بفallback).
   */
  async isEnabledForUser(key: string, userId?: string, zoneId?: string): Promise<boolean> {
    const flag = await this.flags.findOne({ where: { key } });
    if (!flag || !flag.isEnabled) return false;

    if (userId && flag.enabledForUserIds?.includes(userId)) return true;
    if (zoneId && flag.enabledForZoneIds?.includes(zoneId)) return true;

    if (!userId) return flag.rolloutPercentage >= 100;
    return this.isInRolloutBucket(key, userId, flag.rolloutPercentage);
  }
}
