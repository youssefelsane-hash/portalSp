import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createHash, randomBytes, randomInt } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { DataSource, EntityManager, LessThan, Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { NotificationChannel } from '../notifications/entities/notification.entity';
import { TwilioSmsDispatcher } from '../../common/notifications/twilio-sms-dispatcher.service';
import { parseDurationToMs } from '../../common/utils/duration';
import { USER_REGISTERED_EVENT, UserRegisteredEvent } from '../../common/events/user-registered.event';
import { REFERRAL_REGISTERED_EVENT, ReferralRegisteredEvent } from '../../common/events/referral-registered.event';
import {
  TECHNICIAN_REFERRAL_CAPTURED_EVENT,
  TechnicianReferralCapturedEvent,
} from '../../common/events/technician-referral-captured.event';
import { DeviceMetadataDto } from './dto/device-metadata.dto';
import { OtpCode, OtpPurpose } from './entities/otp-code.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { User } from './entities/user.entity';
import { RequestOtpDto } from './dto/request-otp.dto';
import { RegisterDto } from './dto/register.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { MfaPolicyService } from './mfa-policy.service';
import { WebAuthnService } from './webauthn.service';
import { RecoveryVerifyDto } from './dto/recovery-verify.dto';
import { NotificationRoutingService } from '../notifications/notification-routing.service';

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  expires_in_seconds: number;
}

// المستخدم محتاج يكمل MFA (ADR-0011) — التوكن النهائي مش بيتصدر لحد ما ceremony الـWebAuthn تنجح.
export interface MfaRequiredResponse {
  mfa_required: true;
  ceremony: 'registration' | 'authentication';
  mfa_session_token: string;
}

export type LoginResult = TokenPair | MfaRequiredResponse;

const OTP_CODE_LENGTH = 6;
const BCRYPT_SALT_ROUNDS = 10;
const MFA_PENDING_TOKEN_TTL_MS = 5 * 60_000; // 5 دقايق — نفس مهلة تحدي WebAuthn (ADR-0011 §3)

// أحرف واضحة بصريًا بس — استبعاد 0/O و1/I لتقليل غلطات النسخ اليدوي لكود الترشيح. مكرّرة عمداً هنا
// (وفي ReferralsService.generateUniqueReferralCode لإعادة توليد كود لمستخدمين قدامى) بدل ما auth
// يعتمد على referrals module — auth بيتحكم في عمود users.referral_code نفسه بس (حدود الموديولات).
const REFERRAL_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const REFERRAL_CODE_LENGTH = 6;
const MAX_REFERRAL_CODE_ATTEMPTS = 10;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(OtpCode) private readonly otpCodes: Repository<OtpCode>,
    @InjectRepository(RefreshToken) private readonly refreshTokens: Repository<RefreshToken>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly events: EventEmitter2,
    private readonly smsDispatcher: TwilioSmsDispatcher,
    private readonly mfaPolicy: MfaPolicyService,
    private readonly webAuthn: WebAuthnService,
    private readonly notificationRouting: NotificationRoutingService,
  ) {}

  // ── OTP ──────────────────────────────────────────────────────────────

  async requestOtp(dto: RequestOtpDto, requestIp: string | null): Promise<{ expires_in_seconds: number }> {
    const code = String(randomInt(0, 1_000_000)).padStart(OTP_CODE_LENGTH, '0');
    const codeHash = await bcrypt.hash(code, BCRYPT_SALT_ROUNDS);
    const expiryMinutes = this.config.get<number>('otp.expiryMinutes')!;
    const maxAttempts = this.config.get<number>('otp.maxAttempts')!;

    const otp = this.otpCodes.create({
      phoneNumber: dto.phone_number,
      codeHash,
      purpose: dto.purpose,
      attemptsCount: 0,
      maxAttempts,
      isUsed: false,
      expiresAt: new Date(Date.now() + expiryMinutes * 60_000),
      requestIp,
    });
    await this.otpCodes.save(otp);

    // بَقّة أمنية حقيقية اتصلحت (مراجعة أمان شاملة 2026-08-13، P0-4): اللوج ده كان بيسجّل الكود
    // نفسه دايماً بلا شرط — مقبول تمامًا للتطوير/الاختبار المحلي (نفس فلسفة كل تكامل خارجي تاني
    // في المشروع، Paymob/S3/إلخ)، لكن خطر حقيقي في Production — أي حد عنده access للوجز يقدر
    // ياخد أي كود OTP ويدخل أي حساب. الكود الفعلي بقى يظهر بس لو NODE_ENV≠production؛ في
    // Production بيتسجّل رقم موبايل مقنّع (أول 5 أرقام + آخر رقمين بس) بلا الكود خالص.
    if (this.config.get<string>('nodeEnv') !== 'production') {
      // eslint-disable-next-line no-console
      console.log(`[OTP] ${dto.phone_number} (${dto.purpose}) → ${code}`);
    } else {
      const masked = dto.phone_number.length > 7 ? `${dto.phone_number.slice(0, 5)}***${dto.phone_number.slice(-2)}` : '***';
      this.logger.log(`[OTP] كود جديد اتصدر لـ ${masked} (${dto.purpose})`);
    }

    // كانت فجوة موثّقة صراحة (TODO ثابت هنا من أول يوم) — بوابة Twilio SMS حقيقية اتبنت
    // معمارياً في common/notifications/ بـ isConfigured (تفعيلها = env vars، تفاصيل في
    // docs/03-external-integrations.md)، هنا أول استهلاك حقيقي ليها. فشل الإرسال (بوابة مش
    // مظبوطة أو خطأ شبكة) ميرمّيش الطلب — نفس فلسفة "فشل تقني مايكسرش تجربة المستخدم الحقيقي"
    // المتّبعة في كل مكان تاني، وخصوصاً هنا: العميل المحلي بيقدر يكمل التسجيل من اللوج فوق.
    const result = await this.smsDispatcher.send({
      userId: '', // مش موجود بعد (OTP ممكن يكون لتسجيل جديد) — TwilioSmsDispatcher.send() مبيقراش الحقل ده أصلاً
      channel: NotificationChannel.SMS,
      titleAr: 'كود التحقق — baytak',
      bodyAr: `كودك: ${code} — صالح لمدة ${expiryMinutes} دقيقة. متشاركوش الكود ده مع حد.`,
      deepLink: null,
      targets: [dto.phone_number],
      notificationType: 'otp',
    });
    if (!result.delivered) {
      // ملحوظة: النص ده متعمّد ميحتويش على الحرفين "OTP" (الإنجليزية) — أدوات/سكريبتات الاختبار
      // الحي في المشروع كله بتدوّر على أقرب سطر فيه "OTP" ورقم الموبايل عشان تلاقط الكود من اللوج
      // فوق؛ لو السطر ده احتوى على "OTP" برضه هيتطابق بالغلط بدل السطر الصح (مفيش "→" فيه أصلاً)
      // ويرجّع كود فاضي. بَقّة حقيقية اتلقطت واتصلحت أثناء بناء شاشة الشكاوى (اختبار bash فشل
      // فجأة في استخراج الكود من اللوج بعد ما الميزة دي اتضافت).
      this.logger.warn(`فشل إرسال كود التحقق بـ SMS لـ ${dto.phone_number}: ${result.failureReason}`);
    }

    return { expires_in_seconds: expiryMinutes * 60 };
  }

  /** بيتحقق من الكود، يزوّد العدّاد، ويرجّع صف الـ OTP المطابق أو يرمي AUTH_003/AUTH_004. */
  private async consumeOtp(phoneNumber: string, code: string, purpose: OtpPurpose): Promise<OtpCode> {
    const otp = await this.otpCodes.findOne({
      where: { phoneNumber, purpose, isUsed: false },
      order: { createdAt: 'DESC' },
    });

    if (!otp || otp.expiresAt.getTime() < Date.now()) {
      throw new ApiException(ErrorCode.AUTH_003, 'كود التحقق غير صحيح أو منتهي', HttpStatus.BAD_REQUEST);
    }

    if (otp.attemptsCount >= otp.maxAttempts) {
      throw new ApiException(ErrorCode.AUTH_004, 'تجاوزت عدد المحاولات، اطلب كود جديد', HttpStatus.TOO_MANY_REQUESTS);
    }

    const isMatch = await bcrypt.compare(code, otp.codeHash);
    if (!isMatch) {
      otp.attemptsCount += 1;
      await this.otpCodes.save(otp);
      throw new ApiException(ErrorCode.AUTH_003, 'كود التحقق غير صحيح', HttpStatus.BAD_REQUEST);
    }

    otp.isUsed = true;
    otp.usedAt = new Date();
    await this.otpCodes.save(otp);
    return otp;
  }

  // ── تسجيل / دخول ─────────────────────────────────────────────────────

  private async generateUniqueReferralCode(): Promise<string> {
    for (let attempt = 0; attempt < MAX_REFERRAL_CODE_ATTEMPTS; attempt++) {
      let code = '';
      const bytes = randomBytes(REFERRAL_CODE_LENGTH);
      for (let i = 0; i < REFERRAL_CODE_LENGTH; i++) {
        code += REFERRAL_CODE_ALPHABET[bytes[i] % REFERRAL_CODE_ALPHABET.length];
      }
      const existing = await this.users.findOne({ where: { referralCode: code } });
      if (!existing) return code;
    }
    throw new Error('فشل توليد كود ترشيح فريد بعد عدة محاولات');
  }

  async register(dto: RegisterDto, ip: string | null): Promise<TokenPair> {
    await this.consumeOtp(dto.phone_number, dto.otp_code, OtpPurpose.REGISTER);

    const existing = await this.users.findOne({ where: { phoneNumber: dto.phone_number } });
    if (existing) {
      throw new ApiException(ErrorCode.VAL_001, 'الرقم ده مسجل قبل كده، سجّل دخول بدل كده', HttpStatus.CONFLICT);
    }

    // نظام الترشيحات: كود الترشيح عمود على users نفسها فبنتعامل معاه هنا مباشرة (حدود الموديولات)،
    // إنشاء صف referrals المعلّق بيحصل في referrals module لما يستقبل REFERRAL_REGISTERED_EVENT تحت.
    let referrer: User | null = null;
    if (dto.referral_code) {
      referrer = await this.users.findOne({ where: { referralCode: dto.referral_code.toUpperCase() } });
      if (!referrer) {
        throw new ApiException(ErrorCode.VAL_001, 'كود الترشيح غير صحيح', HttpStatus.BAD_REQUEST);
      }
    }
    const referralCode = await this.generateUniqueReferralCode();

    // ملاحظة حدود الموديول: auth بيتحكم في users بس. إنشاء customer_profiles/technician_profiles
    // مسؤولية موديولات customers/technicians (بيتعملوا على حدث "user.registered" لما يتبنوا).
    const user = this.users.create({
      phoneNumber: dto.phone_number,
      phoneVerifiedAt: new Date(),
      fullName: dto.full_name,
      userType: dto.user_type,
      preferredLanguage: 'ar',
      isActive: true,
      isBlocked: false,
      referralCode,
      referredByUserId: referrer?.id ?? null,
    });
    await this.users.save(user);

    // async مقصودة: مفيش استنى — لو listener فشل في إنشاء البروفايل، ميقفلش تسجيل المستخدم نفسه
    this.events.emit(
      USER_REGISTERED_EVENT,
      new UserRegisteredEvent(user.id, user.userType, user.phoneNumber, user.fullName),
    );
    if (referrer) {
      this.events.emit(REFERRAL_REGISTERED_EVENT, new ReferralRegisteredEvent(referrer.id, user.id));
    }
    // ترشيح QR فني (docs/11 §1) — نظام منفصل تمامًا عن referral_code فوق. الفحص/الربط الفعلي
    // بيحصل جوّه technician-referrals module (حدود الموديولات)، هنا بس بنصدر الحدث.
    if (dto.technician_referral_code) {
      this.events.emit(
        TECHNICIAN_REFERRAL_CAPTURED_EVENT,
        new TechnicianReferralCapturedEvent(user.id, dto.technician_referral_code),
      );
    }

    return this.issueTokenPair(user, ip, ['otp']);
  }

  async login(dto: VerifyOtpDto, ip: string | null): Promise<LoginResult> {
    await this.consumeOtp(dto.phone_number, dto.otp_code, OtpPurpose.LOGIN);

    const user = await this.users.findOne({ where: { phoneNumber: dto.phone_number } });
    if (!user) {
      throw new ApiException(ErrorCode.VAL_001, 'الرقم ده مش مسجل، سجّل حساب جديد الأول', HttpStatus.NOT_FOUND);
    }
    if (user.isBlocked) {
      throw new ApiException(ErrorCode.AUTH_001, user.blockedReason ?? 'حسابك موقوف', HttpStatus.FORBIDDEN);
    }

    user.lastLoginAt = new Date();
    user.lastLoginIp = ip;
    await this.users.save(user);

    // MFA إجباري لأي حساب High-Privilege (ADR-0011، docs/08 §14) — فحص حي، صفر تغيير سلوكي
    // لأي حساب تاني (الغالبية العظمى). لو مطلوب، التوكن النهائي ميتصدرش هنا خالص.
    if (await this.mfaPolicy.userRequiresMfa(user.id)) {
      const hasCredential = await this.webAuthn.hasAnyCredential(user.id);
      return {
        mfa_required: true,
        ceremony: hasCredential ? 'authentication' : 'registration',
        mfa_session_token: await this.issueMfaPendingToken(user.id),
      };
    }

    return this.issueTokenPair(user, ip, ['otp'], dto);
  }

  // ── MFA (ADR-0011) ───────────────────────────────────────────────────

  private async issueMfaPendingToken(userId: string): Promise<string> {
    return this.jwt.signAsync(
      { sub: userId, typ: 'mfa_pending' },
      { secret: this.config.get<string>('jwt.refreshSecret'), expiresIn: `${MFA_PENDING_TOKEN_TTL_MS / 1000}s` },
    );
  }

  /** بيرجّع userId لو التوكن صالح، يرمي AUTH_005 غير كده. */
  async verifyMfaPendingToken(token: string): Promise<string> {
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; typ: string }>(token, {
        secret: this.config.get<string>('jwt.refreshSecret'),
      });
      if (payload.typ !== 'mfa_pending') throw new Error('نوع توكن غلط');
      return payload.sub;
    } catch {
      throw new ApiException(ErrorCode.AUTH_005, 'جلسة التحقق انتهت، سجّل دخول تاني', HttpStatus.UNAUTHORIZED);
    }
  }

  /** بتتنادى من WebAuthnController بعد ما ceremony الدخول (OTP+Passkey) تنجح فعليًا. */
  async completeMfaLogin(userId: string, ip: string | null, device?: DeviceMetadataDto): Promise<TokenPair> {
    const user = await this.users.findOneOrFail({ where: { id: userId } });
    return this.issueTokenPair(user, ip, ['otp', 'webauthn'], device);
  }

  /** الدخول السريع اليومي بـPasskey بس (discoverable credential، مفيش OTP خالص) — السيرفر برضه بيتحقق is_blocked/is_active حي هنا (نفس ما طلب المالك بالحرف). */
  async passwordlessLogin(userId: string, ip: string | null, device?: DeviceMetadataDto): Promise<TokenPair> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) {
      throw new ApiException(ErrorCode.AUTH_001, 'الحساب غير متاح', HttpStatus.UNAUTHORIZED);
    }
    if (user.isBlocked) {
      throw new ApiException(ErrorCode.AUTH_001, user.blockedReason ?? 'حسابك موقوف', HttpStatus.FORBIDDEN);
    }
    user.lastLoginAt = new Date();
    user.lastLoginIp = ip;
    await this.users.save(user);
    return this.issueTokenPair(user, ip, ['webauthn'], device);
  }

  /**
   * استرجاع MFA (ADR-0011 §6) — OTP + recovery code **مع بعض**، عاملين مستقلين. لو نجح: كل
   * الـPasskeys/أكواد الاسترجاع القديمة بتتمسح بالكامل (نفس فلسفة "الجهاز القديم مفقود/مش
   * موثوق")، كل الجلسات القديمة بتتلغي، تصعيد أمني فوري لـsuper_admin، والمستخدم يرجعله نفس رد
   * "مفيش Passkey" العادي (mfa_required + ceremony=registration) — إعادة استخدام كاملة لمسار
   * enrollment الموجود، مفيش رد جديد منفصل.
   */
  async recoveryLogin(dto: RecoveryVerifyDto, ip: string | null): Promise<MfaRequiredResponse> {
    await this.consumeOtp(dto.phone_number, dto.otp_code, OtpPurpose.LOGIN);

    const user = await this.users.findOne({ where: { phoneNumber: dto.phone_number } });
    if (!user) {
      throw new ApiException(ErrorCode.VAL_001, 'الرقم ده مش مسجل', HttpStatus.NOT_FOUND);
    }
    if (user.isBlocked) {
      throw new ApiException(ErrorCode.AUTH_001, user.blockedReason ?? 'حسابك موقوف', HttpStatus.FORBIDDEN);
    }

    const recoveryValid = await this.webAuthn.consumeRecoveryCode(user.id, dto.recovery_code);
    if (!recoveryValid) {
      throw new ApiException(ErrorCode.AUTH_003, 'كود الاسترجاع غير صحيح أو مستخدم قبل كده', HttpStatus.BAD_REQUEST);
    }

    await this.webAuthn.resetMfa(user.id);
    await this.revokeAllUserTokens(user.id, 'mfa_recovery');

    await this.notificationRouting.routeToRole('admin_mfa.recovery_used', {
      notificationType: 'admin_mfa.recovery_used',
      titleAr: 'استخدام كود استرجاع MFA',
      bodyAr: `الحساب ${user.fullName} (${user.phoneNumber}) استخدم كود استرجاع MFA — كل الجلسات القديمة اتلغت وهيحتاج يسجّل Passkey جديد.`,
      referenceType: 'user',
      referenceId: user.id,
    });

    return {
      mfa_required: true,
      ceremony: 'registration',
      mfa_session_token: await this.issueMfaPendingToken(user.id),
    };
  }

  // ── التوكن ───────────────────────────────────────────────────────────

  private hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async issueTokenPair(
    user: User,
    ip: string | null,
    amr: ('otp' | 'webauthn')[],
    device?: DeviceMetadataDto,
    manager?: EntityManager,
  ): Promise<TokenPair> {
    const accessExpiresIn = this.config.get<string>('jwt.accessExpiresIn')!;
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, userType: user.userType, amr },
      { secret: this.config.get<string>('jwt.accessSecret'), expiresIn: accessExpiresIn },
    );

    const refreshTokenRaw = randomBytes(48).toString('hex');
    const refreshExpiresIn = this.config.get<string>('jwt.refreshExpiresIn')!;

    const refreshTokens = manager ? manager.getRepository(RefreshToken) : this.refreshTokens;
    const now = new Date();
    const refreshTokenEntity = refreshTokens.create({
      userId: user.id,
      tokenHash: this.hashRefreshToken(refreshTokenRaw),
      ipAddress: ip,
      deviceId: device?.device_id ?? null,
      deviceName: device?.device_name ?? null,
      devicePlatform: device?.device_platform ?? null,
      lastSeenAt: now,
      amr,
      isRevoked: false,
      expiresAt: new Date(Date.now() + parseDurationToMs(refreshExpiresIn)),
    });
    await refreshTokens.save(refreshTokenEntity);

    return {
      access_token: accessToken,
      refresh_token: refreshTokenRaw,
      expires_in_seconds: Math.floor(parseDurationToMs(accessExpiresIn) / 1000),
    };
  }

  /**
   * تدوير: أي refresh token اتستخدم مرة واحدة يتبطل فوراً — استخدام تاني ليه = سرقة محتملة فيتقفل الحساب كله.
   *
   * **بَقّة أمنية حقيقية اتلقطت واتصلحت (مراجعة أمان شاملة 2026-08-13، P0-5)**: قبل كده الدالة دي
   * كانت بتقرأ صف الـ`refresh_tokens` بـ`findOne` عادي (من غير قفل)، تفحصه في الذاكرة، وتكتب
   * `isRevoked=true` بعد كده — بلا transaction ولا `SELECT ... FOR UPDATE`. طلبين `refresh()`
   * متزامنين فعليًا بنفس التوكن (اتأكد حياً في `apps/admin`'s `auth-context.tsx` — راجع
   * `apps/admin/README.md`) تحت READ COMMITTED كانوا الاتنين يقدروا يقروا `isRevoked=false` قبل
   * ما أي واحد يكتب، فيعدّوا الاتنين ويصدروا **زوج توكنز صالح لكل واحد فيهم** — إصدار جلستين من
   * توكن واحد بدل التصرف الصح (رفض واحد منهم). الإصلاح: نفس نمط `pessimistic_write` المستخدم في
   * `matching.service.ts`'s `accept()`/`permissions.service.ts`'s `setRolePermissions()` — قفل
   * صف الـtoken من أول خطوة جوّه transaction واحدة، فأي نداء تاني بيستنى القفل يتفك وبعدين يلاقي
   * `isRevoked=true` فعلاً ويترفض بأمان (`AUTH_001`) بدل ما يعدّي.
   */
  async refresh(rawToken: string, ip: string | null, device?: DeviceMetadataDto): Promise<TokenPair> {
    const tokenHash = this.hashRefreshToken(rawToken);

    return this.dataSource.transaction(async (manager) => {
      const existing = await manager
        .createQueryBuilder(RefreshToken, 'rt')
        .setLock('pessimistic_write')
        .where('rt.tokenHash = :tokenHash', { tokenHash })
        .getOne();

      if (!existing || existing.isRevoked || existing.expiresAt.getTime() < Date.now()) {
        if (existing?.isRevoked) {
          await manager.update(RefreshToken, { userId: existing.userId, isRevoked: false }, {
            isRevoked: true,
            revokedAt: new Date(),
            revokedReason: 'security_breach',
          });
        }
        throw new ApiException(ErrorCode.AUTH_001, 'توكن التجديد غير صالح، سجّل دخول تاني', HttpStatus.UNAUTHORIZED);
      }

      const user = await manager.findOne(User, { where: { id: existing.userId } });
      if (!user || user.isBlocked) {
        throw new ApiException(ErrorCode.AUTH_001, 'الحساب غير متاح', HttpStatus.UNAUTHORIZED);
      }

      existing.isRevoked = true;
      existing.revokedAt = new Date();
      existing.revokedReason = 'rotation';
      existing.lastSeenAt = new Date();
      await manager.save(existing);

      // amr بيتنقل من الجلسة القديمة (ADR-0011) — لو المستخدم أثبت هويته بـwebauthn قبل كده،
      // الجلسات الجديدة الناتجة من refresh() تفضل عارفة ده مش ترجع لـotp بس بصمت.
      return this.issueTokenPair(user, ip, existing.amr, device, manager);
    });
  }

  async logout(rawToken: string): Promise<void> {
    const tokenHash = this.hashRefreshToken(rawToken);
    await this.refreshTokens.update(
      { tokenHash, isRevoked: false },
      { isRevoked: true, revokedAt: new Date(), revokedReason: 'logout' },
    );
  }

  /** عام (مش private) — بيتستخدم من WebAuthnController (enrollment/recovery) وSessionsController (revoke-all يدوي، ADR-0011 §5). */
  async revokeAllUserTokens(userId: string, reason: string): Promise<void> {
    await this.refreshTokens.update(
      { userId, isRevoked: false },
      { isRevoked: true, revokedAt: new Date(), revokedReason: reason },
    );
  }

  // ── إدارة الأجهزة/الجلسات (ADR-0011 §5) ──────────────────────────────

  listSessions(userId: string): Promise<RefreshToken[]> {
    return this.refreshTokens.find({
      where: { userId, isRevoked: false },
      order: { lastSeenAt: 'DESC', createdAt: 'DESC' },
    });
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const result = await this.refreshTokens.update(
      { id: sessionId, userId, isRevoked: false },
      { isRevoked: true, revokedAt: new Date(), revokedReason: 'user_revoked' },
    );
    if (!result.affected) {
      throw new ApiException(ErrorCode.VAL_001, 'الجلسة غير موجودة', HttpStatus.NOT_FOUND);
    }
  }

  /** بيتنضف دورياً (BullMQ cron) — مش جزء من مسار الطلب الحي. */
  async purgeExpiredOtps(): Promise<number> {
    const result = await this.otpCodes.delete({ expiresAt: LessThan(new Date()) });
    return result.affected ?? 0;
  }

  // ── الحساب ───────────────────────────────────────────────────────────

  async getMe(userId: string): Promise<User> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) {
      throw new ApiException(ErrorCode.AUTH_001, 'المستخدم غير موجود', HttpStatus.UNAUTHORIZED);
    }
    return user;
  }

  async updateMe(userId: string, dto: UpdateMeDto): Promise<User> {
    const user = await this.getMe(userId);
    if (dto.full_name !== undefined) user.fullName = dto.full_name;
    if (dto.avatar_url !== undefined) user.avatarUrl = dto.avatar_url;
    if (dto.preferred_language !== undefined) user.preferredLanguage = dto.preferred_language;
    await this.users.save(user);
    return user;
  }

  async deleteMe(userId: string): Promise<void> {
    await this.revokeAllUserTokens(userId, 'account_deletion');
    await this.users.update(userId, { isActive: false });
    await this.users.softDelete(userId);
  }
}
