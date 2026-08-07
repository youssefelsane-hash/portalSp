import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { AuditActorMeta, AuditLogService } from '../audit/audit-log.service';
import { Setting } from './entities/setting.entity';

@Injectable()
export class SettingsService {
  constructor(
    @InjectRepository(Setting) private readonly settings: Repository<Setting>,
    private readonly auditLog: AuditLogService,
  ) {}

  list(groupName?: string): Promise<Setting[]> {
    return this.settings.find({
      where: groupName ? { groupName } : {},
      order: { groupName: 'ASC', key: 'ASC' },
    });
  }

  async getOrThrow(key: string): Promise<Setting> {
    const setting = await this.settings.findOne({ where: { key } });
    if (!setting) {
      throw new ApiException(ErrorCode.VAL_001, `الإعداد ${key} غير موجود`, HttpStatus.NOT_FOUND);
    }
    return setting;
  }

  /** بيستخدمها أي موديول تاني (payments, matching, ...) بدل الثوابت المكتوبة في الكود — قيمة افتراضية لو مفيش الإعداد أصلاً (أول تشغيل قبل الـ seed مثلاً). */
  async getNumber(key: string, fallback: number): Promise<number> {
    const setting = await this.settings.findOne({ where: { key } });
    if (!setting || typeof setting.value !== 'number') return fallback;
    return setting.value;
  }

  async getBoolean(key: string, fallback: boolean): Promise<boolean> {
    const setting = await this.settings.findOne({ where: { key } });
    if (!setting || typeof setting.value !== 'boolean') return fallback;
    return setting.value;
  }

  async getString(key: string, fallback: string): Promise<string> {
    const setting = await this.settings.findOne({ where: { key } });
    if (!setting || typeof setting.value !== 'string') return fallback;
    return setting.value;
  }

  private assertValueMatchesType(setting: Setting, value: unknown): void {
    const actualType = Array.isArray(value) ? 'array' : typeof value;
    const expected = setting.valueType;
    const matches =
      (expected === 'number' && actualType === 'number') ||
      (expected === 'boolean' && actualType === 'boolean') ||
      (expected === 'string' && actualType === 'string') ||
      expected === 'json'; // json بيقبل أي شكل — الغرض منه المرونة

    if (!matches) {
      throw new ApiException(
        ErrorCode.VAL_001,
        `قيمة الإعداد ${setting.key} لازم تكون من نوع ${expected}`,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  async update(adminUserId: string, key: string, value: unknown, meta?: AuditActorMeta): Promise<Setting> {
    const setting = await this.getOrThrow(key);
    this.assertValueMatchesType(setting, value);

    const oldValue = setting.value;
    setting.value = value;
    setting.updatedByUserId = adminUserId;
    await this.settings.save(setting);

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'setting.updated',
      entityType: 'setting',
      entityId: setting.id,
      oldValues: { key: setting.key, value: oldValue },
      newValues: { key: setting.key, value },
      meta,
    });
    return setting;
  }
}
