import { HttpStatus, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Repository } from 'typeorm';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { RedisCacheService } from '../../common/cache/redis-cache.service';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { SETTING_UPDATED_EVENT, SettingUpdatedEvent } from '../../common/events/setting-updated.event';
import { AuditActorMeta, AuditLogService } from '../audit/audit-log.service';
import { Setting } from './entities/setting.entity';

// TTL دفاعي بس — الإبطال الفعلي فوري في update() تحت، الـ TTL ده شبكة أمان لو حصل تعديل
// مباشر في القاعدة (SQL) من غير ما يعدّي من update() هنا.
const CACHE_TTL_SECONDS = 60;
const SECRET_SETTING_KEYS = new Set([
  'payments.paymob.api_key',
  'payments.paymob.secret_key',
  'payments.paymob.hmac_secret',
]);

export const isSecretSettingKey = (key: string): boolean => SECRET_SETTING_KEYS.has(key);

/** V1 settlement knobs are frozen once V2 starts creating orders. */
export const isLegacyEarningsSettingKey = (key: string): boolean =>
  key.startsWith('commission_base.') ||
  /^commission\.(individual|team|emergency)_adjustment_percentage$/.test(key) ||
  key === 'crew.assistant_share_ratio';

@Injectable()
export class SettingsService {
  constructor(
    @InjectRepository(Setting) private readonly settings: Repository<Setting>,
    private readonly auditLog: AuditLogService,
    private readonly cache: RedisCacheService,
    // اختياري عمدًا — SettingsService بيتنشئ يدويًا بـ`new` في 24+ ملف اختبار (3 args بس) قبل
    // إضافة الحدث ده (§33)، إجباره كان هيكسرهم كلهم لمجرد ميزة إضافية. الاستخدام الحقيقي (DI في
    // apps/api الفعلي) بيوصله دايمًا، الـ`?.` تحت بس للسياقات اليدوية دي.
    private readonly events?: EventEmitter2,
    @Optional() private readonly config?: ConfigService,
  ) {}

  private encryptionKey(): Buffer {
    const material = this.config?.get<string>('security.settingsEncryptionKey') || process.env.SETTINGS_ENCRYPTION_KEY;
    if (!material || material.length < 32) {
      throw new ApiException(ErrorCode.VAL_001, 'مفتاح تشفير إعدادات الأسرار غير مُعدّ', HttpStatus.SERVICE_UNAVAILABLE);
    }
    return createHash('sha256').update(material).digest();
  }

  private encryptSecret(value: string): string {
    if (!value) return '';
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return `enc:v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${ciphertext.toString('base64')}`;
  }

  private decryptSecret(value: string): string {
    if (!value) return '';
    if (!value.startsWith('enc:v1:')) {
      // Environment/migration bootstrap compatibility only. The next admin save encrypts it.
      return value;
    }
    const [, , iv, tag, ciphertext] = value.split(':');
    const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey(), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8');
  }

  private cacheKey(key: string): string {
    return `settings:${key}`;
  }

  /** قراءة القيمة الخام (value + valueType بس) — كاش-أول، مصدر الحقيقة القاعدة دايماً لو فشل الكاش أو مفيش. */
  private async readRaw(key: string): Promise<{ value: unknown; valueType: string } | null> {
    const cached = await this.cache.get(this.cacheKey(key));
    if (cached !== null) {
      try {
        return JSON.parse(cached) as { value: unknown; valueType: string };
      } catch {
        // كاش فاسد (تنسيق قديم مثلاً) — تجاهله وارجع للقاعدة، متكسرش الطلب
      }
    }

    const setting = await this.settings.findOne({ where: { key } });
    if (!setting) return null;

    const raw = { value: setting.value, valueType: setting.valueType };
    await this.cache.set(this.cacheKey(key), JSON.stringify(raw), CACHE_TTL_SECONDS);
    return raw;
  }

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

  /** بيستخدمها أي موديول تاني (payments, matching, ...) بدل الثوابت المكتوبة في الكود — قيمة افتراضية لو مفيش الإعداد أصلاً (أول تشغيل قبل الـ seed مثلاً). قراءة مكشوشة (Redis) بدل ما تروح للقاعدة في كل نداء. */
  async getNumber(key: string, fallback: number): Promise<number> {
    const raw = await this.readRaw(key);
    if (!raw || typeof raw.value !== 'number') return fallback;
    return raw.value;
  }

  async getBoolean(key: string, fallback: boolean): Promise<boolean> {
    const raw = await this.readRaw(key);
    if (!raw || typeof raw.value !== 'boolean') return fallback;
    return raw.value;
  }

  async getString(key: string, fallback: string): Promise<string> {
    const raw = await this.readRaw(key);
    if (!raw || typeof raw.value !== 'string') return fallback;
    return raw.value;
  }

  async getSecret(key: string, fallback: string): Promise<string> {
    if (!isSecretSettingKey(key)) {
      throw new ApiException(ErrorCode.VAL_001, 'الإعداد المطلوب ليس سرًا مُسجّلًا', HttpStatus.BAD_REQUEST);
    }
    const raw = await this.readRaw(key);
    if (!raw || typeof raw.value !== 'string') return fallback;
    return this.decryptSecret(raw.value);
  }

  /** لإعدادات `value_type='json'` (زي `productivity.metrics_config`) — مفيش تحقق شكل هنا (T مسؤولية الكولر)، بس fallback آمن لو الإعداد مفقود/فاسد. */
  async getJson<T>(key: string, fallback: T): Promise<T> {
    const raw = await this.readRaw(key);
    if (!raw || raw.valueType !== 'json') return fallback;
    return raw.value as T;
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

    if (isLegacyEarningsSettingKey(key) && (await this.getBoolean('earnings.v2_cutover_enabled', false))) {
      throw new ApiException(
        ErrorCode.VAL_001,
        'الإعداد ده خاص بتسوية V1 واتقفل بعد تشغيل محرك الأرباح V2؛ استخدم صفحة سياسة الأرباح',
        HttpStatus.CONFLICT,
      );
    }

    const secret = isSecretSettingKey(key);
    if (secret && typeof value !== 'string') {
      throw new ApiException(ErrorCode.VAL_001, 'قيمة السر لازم تكون نصًا', HttpStatus.BAD_REQUEST);
    }
    const updated = await this.settings.manager.transaction(async (manager) => {
      const fresh = await manager.createQueryBuilder(Setting, 'setting')
        .setLock('pessimistic_write')
        .where('setting.id = :id', { id: setting.id })
        .getOne();
      if (!fresh) throw new ApiException(ErrorCode.VAL_001, `الإعداد ${key} غير موجود`, HttpStatus.NOT_FOUND);
      const oldValue = fresh.value;
      fresh.value = secret ? this.encryptSecret(value as string) : value;
      fresh.updatedByUserId = adminUserId;
      await manager.save(fresh);
      await this.auditLog.record({
        actorUserId: adminUserId,
        actorRole: 'admin',
        action: 'setting.updated',
        entityType: 'setting',
        entityId: fresh.id,
        oldValues: { key: fresh.key, value: secret ? '[REDACTED]' : oldValue },
        newValues: { key: fresh.key, value: secret ? '[REDACTED]' : value },
        meta,
      }, manager);
      return fresh;
    });
    // إبطال فوري — مش مستنيين انتهاء الـ TTL، القراءة الجاية لازم تشوف القيمة الجديدة على طول
    await this.cache.del(this.cacheKey(key));
    // §33 — أي موديول محتفظ بنسخة في الذاكرة من قيمة إعداد (زي InstaPayProvider) بيسمع للحدث ده
    // بدل ما يعتمد على readRaw() في كل نداء. in-process بس — راجع تحذير النطاق في
    // setting-updated.event.ts. emitAsync (مش emit) عمداً — نفس سبب orders.service.ts's
    // ORDER_CREATED_EVENT بالحرف: بننتظر كل المستمعين يخلّصوا قبل ما نرجّع نجاح الـPATCH للأدمن،
    // عشان super_admin يتأكد إن التغيير سارٍ فعليًا في اللحظة اللي بيشوف فيها رد الحفظ، مش سباق
    // race condition ممكن يخلّي قراءة فورية بعد الحفظ ترجع قيمة قديمة.
    await this.events?.emitAsync(
      SETTING_UPDATED_EVENT,
      new SettingUpdatedEvent(updated.key, secret ? '[REDACTED]' : value),
    );
    return updated;
  }
}
