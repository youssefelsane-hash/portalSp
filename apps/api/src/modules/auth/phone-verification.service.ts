import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Not, Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { isProductionLikeEnv } from '../../config/env.validation';
import { ConfigService } from '@nestjs/config';
import { AuditLogService } from '../audit/audit-log.service';
import { SettingsService } from '../settings/settings.service';
import { SMS_DISPATCHER, SmsDispatcher } from '../../common/notifications/sms-dispatcher';
import { Inject } from '@nestjs/common';
import { AuthService } from './auth.service';
import { OtpCode, OtpPurpose } from './entities/otp-code.entity';
import { User } from './entities/user.entity';
import { verifyPinHash } from './login-pin.policy';
import {
  needsPhoneVerification,
  REQUIRE_PHONE_VERIFICATION_SETTING,
} from './phone-verification.policy';

/**
 * **تحقّق رقم العميل عند أول طلب، وتغيير الرقم** (ADR-0112).
 *
 * الخدمة دي بتخدم شاشة واحدة في التطبيق: «أكّد رقمك» — وفيها جوّاها إمكانية تصحيح الرقم لو
 * المستخدم كتبه غلط وقت التسجيل.
 *
 * ### ليه خدمة منفصلة مش دوال في `AuthService`
 *
 * `AuthService` بقت ~١٢٠٠ سطر وبتملك دورة الدخول. تحقّق الرقم **مسار منفصل بشرط تشغيل مختلف**
 * (مفتاح أدمن، مش وسيلة الدخول)، وله سياسة أمان خاصة بيه (عاملين للتغيير). خلطه جوّه الدخول كان
 * بيخلي قراءة أي واحد منهم أصعب.
 */
@Injectable()
export class PhoneVerificationService {
  private readonly logger = new Logger(PhoneVerificationService.name);

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(OtpCode) private readonly otpCodes: Repository<OtpCode>,
    private readonly dataSource: DataSource,
    private readonly authService: AuthService,
    private readonly settingsService: SettingsService,
    private readonly auditLog: AuditLogService,
    private readonly config: ConfigService,
    @Inject(SMS_DISPATCHER) private readonly smsDispatcher: SmsDispatcher,
  ) {}

  private pinPepper(): string {
    return this.config.get<string>('auth.pinPepper') ?? '';
  }

  /** حالة التحقّق للواجهة — التطبيق بيستخدمها يعرف يعرض الشاشة ولا لأ قبل ما يحاول يطلب. */
  async status(userId: string): Promise<{ required: boolean; phone_number: string; phone_verified: boolean }> {
    const enabled = await this.settingsService.getBoolean(REQUIRE_PHONE_VERIFICATION_SETTING, false);
    const user = await this.loadUser(userId);
    return {
      required: needsPhoneVerification(user.phoneVerifiedAt, enabled),
      phone_number: user.phoneNumber,
      phone_verified: user.phoneVerifiedAt !== null,
    };
  }

  private async loadUser(userId: string): Promise<User> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new ApiException(ErrorCode.AUTH_001, 'الحساب غير متاح', HttpStatus.UNAUTHORIZED);
    return user;
  }

  /**
   * **إصدار كود التحقّق.** بيروح للرقم الحالي، أو للرقم الجديد لو المستخدم بيصحّح رقمه.
   *
   * ### تغيير الرقم محتاج **عاملين مستقلين** (ADR-0112 §5)
   *
   * الرقم هو **هوية الحساب**، فتغييره = تغيير مين يقدر يدخل. جلسة مسروقة لوحدها كانت تقدر تحوّل
   * الرقم لرقم المهاجم ⇒ **استيلاء كامل**، وصاحبه الأصلي مابقاش يدخل.
   *
   *   - **رمز الدخول الحالي** بيثبت إن اللي بيطلب صاحب الحساب ⇒ توكن مسروق مش كفاية.
   *   - **الكود على الرقم الجديد** بيثبت إنه بيتحكم فيه ⇒ مايحوّلهوش لرقم عشوائي أو رقم حد تاني.
   *
   * التحقّق العادي (بلا تغيير) **مابيطلبش رمز**: الكود رايح لرقم صاحب الحساب نفسه، فجلسة مسروقة
   * عمرها ما هتشوفه. مفيش حاجة تتحمى منها هنا، وطلب الرمز كان بيبقى عرقلة بلا مقابل.
   */
  async requestCode(
    userId: string,
    dto: { new_phone_number?: string; pin?: string },
    requestIp: string | null,
  ): Promise<{ expires_in_seconds: number; target_phone_number: string }> {
    await this.assertFeatureEnabled();
    const user = await this.loadUser(userId);

    let target = user.phoneNumber;
    if (dto.new_phone_number && dto.new_phone_number !== user.phoneNumber) {
      await this.assertPinMatches(userId, dto.pin);
      await this.assertPhoneAvailable(dto.new_phone_number, userId);
      target = dto.new_phone_number;
    }

    // **بوابة مش مُجهّزة = فشل صريح مش نجاح كداب** — نفس الدرس المكلف في `requestOtp`: المستخدم
    // كان بيقعد يستنى كود عمره ما هيوصل والشاشة بتقوله «بعتنالك كود». محليًا البوابة عمرها ما
    // بتبقى مُجهّزة والكود بيتقرا من اللوج، فالفشل مقصور على البيئات الإنتاجية.
    if (!this.smsDispatcher.isConfigured && isProductionLikeEnv(this.config.get<string>('nodeEnv'))) {
      this.logger.error('مفتاح تحقّق الرقم مفعّل وبوابة SMS مش مُجهّزة — الطلب اترفض بدل نجاح كداب.');
      throw new ApiException(
        ErrorCode.SYS_001,
        'إرسال كود التأكيد متوقف حاليًا، حاول بعد شوية أو كلّم الدعم.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    // نفس نواة الإصدار بالحرف (قفل، إبطال الأقدم، صلاحية، عدّاد) — غرض منفصل `verify_phone`
    // فكود دخول عمره ما ينفع للتحقّق والعكس.
    const { expires_in_seconds } = await this.authService.issueOtpCode(target, OtpPurpose.VERIFY_PHONE, requestIp);
    return { expires_in_seconds, target_phone_number: target };
  }

  /**
   * **تأكيد الكود** — وتغيير الرقم لو كان ده المطلوب، **في معاملة واحدة**.
   *
   * الذرّية مقصودة: مستحيل الرقم يتغيّر بلا ما يتعلّم متحقَّق منه، ومستحيل يتعلّم متحقَّق منه
   * على رقم ما اتغيّرش.
   */
  async confirm(
    userId: string,
    dto: { otp_code: string; new_phone_number?: string },
    meta?: Parameters<AuditLogService['record']>[0]['meta'],
  ): Promise<{ phone_verified: true; phone_number: string }> {
    await this.assertFeatureEnabled();
    const user = await this.loadUser(userId);

    const isChange = !!dto.new_phone_number && dto.new_phone_number !== user.phoneNumber;
    const target = isChange ? dto.new_phone_number! : user.phoneNumber;
    if (isChange) await this.assertPhoneAvailable(target, userId);

    // الاستهلاك بيمر على **نفس** `consumeOtp` بالظبط — بالقفل وعدّاد المحاولات وسلّم الرفض.
    // أي مسار بيتأكد من كود بلا العدّاد بيبقى oracle لتخمين الكود بلا حد.
    await this.authService.consumeOtp(target, dto.otp_code, OtpPurpose.VERIFY_PHONE);

    const previousPhone = user.phoneNumber;
    await this.dataSource.transaction(async (manager) => {
      await manager.update(User, { id: userId }, { phoneNumber: target, phoneVerifiedAt: new Date() });
      // إبطال أي كود حي على **الرقمين** — القديم والجديد. كود لسه صالح على رقم مبقى مش رقم
      // الحساب هو تصريح معلّق بلا صاحب.
      await manager.update(
        OtpCode,
        { phoneNumber: previousPhone, isUsed: false },
        { isUsed: true, usedAt: new Date() },
      );
      if (isChange) {
        await manager.update(
          OtpCode,
          { phoneNumber: target, isUsed: false },
          { isUsed: true, usedAt: new Date() },
        );
      }
    });

    if (isChange) {
      // تغيير هوية حساب **لازم** يكون له أثر. الرقمين بيتسجّلوا — ده مش سر، وبيبقى الأثر الوحيد
      // اللي يخلي أي بلاغ «مش عارف أدخل» قابل للمراجعة.
      await this.auditLog.record({
        actorUserId: userId,
        actorRole: 'customer',
        action: 'user.phone_changed',
        entityType: 'user',
        entityId: userId,
        oldValues: { phone_number: previousPhone },
        newValues: { phone_number: target, phone_verified: true },
        meta,
      });
      this.logger.log(`رقم الحساب ${userId} اتغيّر بعد تأكيد بكود`);
    }

    return { phone_verified: true, phone_number: target };
  }

  /**
   * المفتاح مقفول ⇒ المسار كله مقفول. من غير الفحص ده، أي حد كان يقدر يستهلك رصيد SMS على منصة
   * الأدمن **مقرر عن قصد** إنها ماتستخدمش مزوّد.
   */
  private async assertFeatureEnabled(): Promise<void> {
    const enabled = await this.settingsService.getBoolean(REQUIRE_PHONE_VERIFICATION_SETTING, false);
    if (!enabled) {
      throw new ApiException(
        ErrorCode.VAL_001,
        'تأكيد رقم الموبايل مش مطلوب حاليًا',
        HttpStatus.GONE,
      );
    }
  }

  /** الرمز الحالي — بيقرا الهاش صراحةً (`select: false` على العمود) ويدعم هاش الإصدار القديم. */
  private async assertPinMatches(userId: string, pin: string | undefined): Promise<void> {
    if (!pin) {
      throw new ApiException(
        ErrorCode.VAL_001,
        'لتغيير رقم الموبايل لازم تدخل رمز الدخول الحالي',
        HttpStatus.BAD_REQUEST,
      );
    }
    const row = await this.users
      .createQueryBuilder('u')
      .addSelect('u.pinHash')
      .where('u.id = :userId', { userId })
      .getOne();
    if (!row?.pinHash || !(await verifyPinHash(pin, row.pinHash, this.pinPepper()))) {
      // نفس رسالة الدخول الغلط بالحرف — مفيش تفريق بين «مفيش رمز» و«الرمز غلط».
      throw new ApiException(ErrorCode.AUTH_003, 'رمز الدخول غلط', HttpStatus.UNAUTHORIZED);
    }
  }

  /**
   * الرقم الجديد لازم يكون متاح. `users.phone_number` فريد، فبلا الفحص ده الفشل كان بيطلع
   * كـ`500` من القاعدة بدل رسالة مفهومة.
   *
   * **مش تعداد حسابات جديد**: `POST /auth/pin/register` بيرجّع «الرقم ده مسجل قبل كده» أصلاً،
   * فالمعلومة دي متاحة بلا المسار ده — والمستخدم هنا **متوثّق** أصلاً.
   */
  private async assertPhoneAvailable(phoneNumber: string, selfUserId: string): Promise<void> {
    const taken = await this.users.count({
      where: { phoneNumber, id: Not(selfUserId), deletedAt: IsNull() },
    });
    if (taken > 0) {
      throw new ApiException(
        ErrorCode.VAL_001,
        'الرقم ده مستخدم في حساب تاني. استخدم رقم غير ده أو كلّم الدعم.',
        HttpStatus.CONFLICT,
      );
    }
  }
}
