import { HttpStatus, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { Repository } from 'typeorm';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { RedisCacheService } from '../../common/cache/redis-cache.service';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import {
  SETTING_RELOAD_REQUIRED_EVENT,
  SETTING_UPDATED_EVENT,
  SettingUpdatedEvent,
} from '../../common/events/setting-updated.event';
import { AuditActorMeta, AuditLogService } from '../audit/audit-log.service';
import { Setting } from './entities/setting.entity';

// TTL دفاعي بس — الإبطال الفعلي فوري في update() تحت، الـ TTL ده شبكة أمان لو حصل تعديل
// مباشر في القاعدة (SQL) من غير ما يعدّي من update() هنا.
const CACHE_TTL_SECONDS = 60;

/**
 * **طبقة كاش داخل العملية قدّام Redis** (تدقيق `docs/29` P0-1، الشق التاني).
 *
 * `readRaw()` تحت بترجع للقاعدة (`this.settings.findOne`) لو الكاش فاضي. المشكلة إن الرجوع ده
 * **بياخد اتصال من نفس الـpool**، و`MatchingService.findEligibleTechnicians()` بتقرا **١٢ إعداد**
 * في النداء الواحد — وبتتنادى من جوّه ترانزاكشن. يعني على كاش بارد (بعد نشر جديد، أو إعادة
 * تشغيل Redis، أو انتهاء TTL) الترانزاكشن الواحد كان ممكن يطلب ١٢ اتصال إضافي وهو ماسك اتصال،
 * فيستنزف الـpool ويعمل نفس القفلة اللي البند ده موجود عشانها.
 *
 * الحل: كاش ذاكرة قصير جدًا قدّام Redis. الإعدادات دي **قيم ضبط بتتقرا آلاف المرات وبتتغيّر
 * نادرًا**، فالقراءة المتكررة من الشبكة إهدار خالص.
 *
 * **مدى التقادم**: `update()` بيمسح النسخة المحلية والـRedis مع بعض، فالـinstance اللي عدّل
 * بيشوف التغيير **فورًا**. أي instance تاني بيشوفه بعد `LOCAL_CACHE_TTL_MS` بحد أقصى (ثانيتين
 * افتراضيًا). ده مقبول لقيم الضبط، ومضبوط بـ`SETTINGS_LOCAL_CACHE_TTL_MS` (صفر = تعطيل كامل
 * ورجوع للسلوك القديم بالحرف).
 */
const LOCAL_CACHE_TTL_MS = Math.max(0, parseInt(process.env.SETTINGS_LOCAL_CACHE_TTL_MS ?? '2000', 10) || 0);
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
  key === 'crew.assistant_share_ratio' ||
  key === 'earnings.v2_cutover_enabled';

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

  /**
   * كاش الذاكرة (الطبقة صفر). `null` كقيمة مخزّنة معناها «المفتاح مش موجود» — بنكاشها كمان،
   * وإلا كل قراءة لمفتاح مالوش صف بتضرب القاعدة كل مرة.
   */
  private readonly localCache = new Map<string, { raw: { value: unknown; valueType: string } | null; expiresAt: number }>();

  private readonly logger = new Logger(SettingsService.name);

  /** مفاتيح عليها تحديث خلفي شغّال دلوقتي — بيمنع تدافع (stampede) على نفس المفتاح. */
  private readonly refreshing = new Set<string>();

  /**
   * بيرجّع القيمة المحفوظة ولو **منتهية الصلاحية** (`stale: true`) بدل ما يمسحها.
   *
   * ده أساس سياسة stale-while-revalidate تحت — والسبب مش أداء، ده **منع انقطاع خدمة**.
   */
  private localGet(key: string): { raw: { value: unknown; valueType: string } | null; stale: boolean } | undefined {
    if (LOCAL_CACHE_TTL_MS === 0) return undefined;
    const hit = this.localCache.get(key);
    if (!hit) return undefined;
    return { raw: hit.raw, stale: hit.expiresAt <= Date.now() };
  }

  /**
   * تحديث خلفي لمفتاح منتهي الصلاحية — **مايرميش أبدًا ومحدش بيستناه**.
   *
   * لو فشل (Redis واقع مثلاً) القيمة القديمة بتفضل مخدومة، وده بالظبط المطلوب: الإعدادات
   * بتتغير نادرًا، وقيمة قديمة بثواني أهون بما لا يقاس من طلب حجز بيفشل.
   */
  private scheduleRefresh(key: string): void {
    if (this.refreshing.has(key)) return;
    this.refreshing.add(key);
    void (async () => {
      try {
        await this.readFromSource(key);
      } catch (err) {
        this.logger.warn(`فشل تحديث إعداد ${key} في الخلفية: ${err instanceof Error ? err.message : err}`);
      } finally {
        this.refreshing.delete(key);
      }
    })();
  }

  private localSet(key: string, raw: { value: unknown; valueType: string } | null): void {
    if (LOCAL_CACHE_TTL_MS === 0) return;
    this.localCache.set(key, { raw, expiresAt: Date.now() + LOCAL_CACHE_TTL_MS });
  }

  /** إبطال محلي فوري — بيتنادى من `update()` عشان الـinstance اللي عدّل يشوف قيمته الجديدة حالًا. */
  private localInvalidate(key: string): void {
    this.localCache.delete(key);
  }

  /**
   * إبطال النسخة المحلية لمفتاح اتعدّل **من برّه الخدمة** (SQL مباشر، migration، أداة إدارية).
   *
   * مع سياسة stale-while-revalidate، القيمة القديمة بتتخدم فورًا ولو عمرها خلص — وده مقصود
   * (شوف `readRaw`). لكنه معناه إن كتابة مباشرة في القاعدة مش هتبان في **نفس** القراءة اللي
   * بعدها. الدالة دي هي المسار المدعوم لأي كاتب من برّه: نادِها بعد الكتابة ومسح Redis.
   */
  invalidateLocalCache(key: string): void {
    this.localInvalidate(key);
  }

  /**
   * **إعداد اتعدّل على نسخة تانية** (`SettingsCrossInstanceBridge`، ADR-0075).
   *
   * الجسر بيبطّل الكاش **المشترك** (Redis) على النسخة الكاتبة وبعدين يبلّغ باقي النسخ. لكن كل
   * نسخة عندها كمان كاش **محلي** في الذاكرة بسياسة stale-while-revalidate — ومحدش كان بيبطّله
   * هنا. النتيجة إن المستمعين على النسخة التانية (بوابات الدفع مثلاً) بيعيدوا القراءة فورًا
   * فياخدوا **القيمة القديمة من ذاكرتهم**، ويفضلوا عليها لأن مفيش إعادة تحميل تانية بعد كده:
   * عنوان InstaPay القديم يفضل شغّال على النسخة دي لحد إعادة تشغيل — وهو بالظبط اللي ADR-0075
   * اتكتب عشان يمنعه.
   *
   * `prependListener` مقصود: لازم الإبطال يحصل **قبل** أي مستمع تاني للحدث ده يقرا القيمة.
   */
  @OnEvent(SETTING_RELOAD_REQUIRED_EVENT, { prependListener: true })
  handleCrossInstanceReload(event: SettingUpdatedEvent): void {
    if (!event?.key) return;
    this.localInvalidate(event.key);
  }

  /**
   * قراءة القيمة الخام (value + valueType بس) — ذاكرة ← Redis ← القاعدة (مصدر الحقيقة).
   *
   * ### stale-while-revalidate — ده إصلاح انقطاع، مش تحسين أداء
   *
   * **المشكلة اللي اتقاست حيًا**: `OrdersService.create()` بتقرا إعدادات **جوّه ترانزاكشن
   * الإنشاء**. القراءة دي كانت بتضرب Redis كل مرة الكاش المحلي يخلص عمره (ثانيتين)، يعني
   * الترانزاكشن بتفضل مفتوحة والقاعدة مستنية التطبيق يبعت — وهو مستني Redis.
   *
   * تحت دفعة حجوزات، كل اللي فاتوا الكاش في نفس اللحظة بيتعلّقوا مع بعض. العيّنة من
   * `pg_stat_activity` وقت الحادثة:
   *
   *     n=22  act=1  iit=18  waits=Client/ClientRead
   *
   * تمنتاشر ترانزاكشن مفتوحة وصامتة ⇒ الـpool بيخلص ⇒ **كل العملاء بياخدوا 503** لمدة مهلة
   * الحصول على اتصال بالظبط (١٠ ثواني). الإثبات القاطع: تثبيت الكاش المحلي
   * (`SETTINGS_LOCAL_CACHE_TTL_MS` كبير) خلّى ٦ من ٦ تشغيلات تعدّي نضيف، من غير أي تغيير تاني.
   *
   * **القاعدة الجديدة**: أول قراءة لأي مفتاح بس هي اللي بتنتظر مصدر خارجي. بعد كده القيمة
   * بتتخدم من الذاكرة **حتى لو عمرها خلص**، والتحديث بيحصل في الخلفية. النتيجة: Redis بطيء أو
   * واقع مابيقدرش يعلّق ولا ترانزاكشن واحدة — وده الفرق بين «خدمة ثانوية اتعطّلت» و«الحجز وقف».
   *
   * تكلفة القِدَم مقبولة: الإعدادات بتتغير نادرًا، والـinstance اللي عدّل بيبطّل كاشه فورًا
   * (`update()`)، والباقيين بيشوفوا التغيير خلال `LOCAL_CACHE_TTL_MS` — نفس ضمان الأول بالظبط،
   * الفرق إن الانتظار بقى على التحديث الخلفي مش على الطلب الحي.
   */
  private async readRaw(key: string): Promise<{ value: unknown; valueType: string } | null> {
    const local = this.localGet(key);
    if (local) {
      if (local.stale) this.scheduleRefresh(key);
      return local.raw;
    }

    return this.readFromSource(key);
  }

  /** القراءة الحقيقية من المصادر الخارجية — Redis ثم القاعدة. المكان الوحيد اللي بينتظر. */
  private async readFromSource(key: string): Promise<{ value: unknown; valueType: string } | null> {
    const cached = await this.cache.get(this.cacheKey(key));
    if (cached !== null) {
      try {
        const raw = JSON.parse(cached) as { value: unknown; valueType: string };
        this.localSet(key, raw);
        return raw;
      } catch {
        // كاش فاسد (تنسيق قديم مثلاً) — تجاهله وارجع للقاعدة، متكسرش الطلب
      }
    }

    const setting = await this.settings.findOne({ where: { key } });
    if (!setting) {
      this.localSet(key, null);
      return null;
    }

    const raw = { value: setting.value, valueType: setting.valueType };
    await this.cache.set(this.cacheKey(key), JSON.stringify(raw), CACHE_TTL_SECONDS);
    this.localSet(key, raw);
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
    if (key === 'matching.additional_request_batch_size' &&
        (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 100)) {
      throw new ApiException(ErrorCode.VAL_001, 'عدد الفنيين في الدفعة لازم يكون عددًا صحيحًا من 1 إلى 100', HttpStatus.BAD_REQUEST);
    }
    if (
      key === 'matching.daily_capacity_minutes' &&
      (typeof value !== 'number' || !Number.isInteger(value) || value < 60 || value > 12 * 60)
    ) {
      throw new ApiException(
        ErrorCode.VAL_001,
        'يوم العمل لازم يكون عدد دقائق صحيحًا من ساعة إلى 12 ساعة كحد أقصى',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (isLegacyEarningsSettingKey(key)) {
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
    // الترتيب مقصود: المحلي الأول (متزامن، مايفشلش)، وبعدين Redis. كده الـinstance اللي عدّل
    // بيشوف قيمته الجديدة فورًا حتى لو Redis وقع في اللحظة دي.
    this.localInvalidate(key);
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
