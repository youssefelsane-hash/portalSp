import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createHash, randomBytes, randomInt } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { LessThan, Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { NotificationChannel } from '../notifications/entities/notification.entity';
import { TwilioSmsDispatcher } from '../../common/notifications/twilio-sms-dispatcher.service';
import { parseDurationToMs } from '../../common/utils/duration';
import { USER_REGISTERED_EVENT, UserRegisteredEvent } from '../../common/events/user-registered.event';
import { OtpCode, OtpPurpose } from './entities/otp-code.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { User } from './entities/user.entity';
import { RequestOtpDto } from './dto/request-otp.dto';
import { RegisterDto } from './dto/register.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { UpdateMeDto } from './dto/update-me.dto';

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  expires_in_seconds: number;
}

const OTP_CODE_LENGTH = 6;
const BCRYPT_SALT_ROUNDS = 10;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(OtpCode) private readonly otpCodes: Repository<OtpCode>,
    @InjectRepository(RefreshToken) private readonly refreshTokens: Repository<RefreshToken>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly events: EventEmitter2,
    private readonly smsDispatcher: TwilioSmsDispatcher,
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

    // اللوج ده بيتسجل دايماً (حتى لو بوابة SMS حقيقية متظبطة) — نفس فلسفة استمرار التطوير/الاختبار
    // المحلي المتّبعة في كل تكامل خارجي تاني في المشروع (Paymob/S3/إلخ)، مش استبدال كامل له.
    // eslint-disable-next-line no-console
    console.log(`[OTP] ${dto.phone_number} (${dto.purpose}) → ${code}`);

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

  async register(dto: RegisterDto, ip: string | null): Promise<TokenPair> {
    await this.consumeOtp(dto.phone_number, dto.otp_code, OtpPurpose.REGISTER);

    const existing = await this.users.findOne({ where: { phoneNumber: dto.phone_number } });
    if (existing) {
      throw new ApiException(ErrorCode.VAL_001, 'الرقم ده مسجل قبل كده، سجّل دخول بدل كده', HttpStatus.CONFLICT);
    }

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
    });
    await this.users.save(user);

    // async مقصودة: مفيش استنى — لو listener فشل في إنشاء البروفايل، ميقفلش تسجيل المستخدم نفسه
    this.events.emit(
      USER_REGISTERED_EVENT,
      new UserRegisteredEvent(user.id, user.userType, user.phoneNumber, user.fullName),
    );

    return this.issueTokenPair(user, ip);
  }

  async login(dto: VerifyOtpDto, ip: string | null): Promise<TokenPair> {
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

    return this.issueTokenPair(user, ip);
  }

  // ── التوكن ───────────────────────────────────────────────────────────

  private hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async issueTokenPair(user: User, ip: string | null): Promise<TokenPair> {
    const accessExpiresIn = this.config.get<string>('jwt.accessExpiresIn')!;
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, userType: user.userType },
      { secret: this.config.get<string>('jwt.accessSecret'), expiresIn: accessExpiresIn },
    );

    const refreshTokenRaw = randomBytes(48).toString('hex');
    const refreshExpiresIn = this.config.get<string>('jwt.refreshExpiresIn')!;

    const refreshTokenEntity = this.refreshTokens.create({
      userId: user.id,
      tokenHash: this.hashRefreshToken(refreshTokenRaw),
      ipAddress: ip,
      isRevoked: false,
      expiresAt: new Date(Date.now() + parseDurationToMs(refreshExpiresIn)),
    });
    await this.refreshTokens.save(refreshTokenEntity);

    return {
      access_token: accessToken,
      refresh_token: refreshTokenRaw,
      expires_in_seconds: Math.floor(parseDurationToMs(accessExpiresIn) / 1000),
    };
  }

  /** تدوير: أي refresh token اتستخدم مرة واحدة يتبطل فوراً — استخدام تاني ليه = سرقة محتملة فيتقفل الحساب كله. */
  async refresh(rawToken: string, ip: string | null): Promise<TokenPair> {
    const tokenHash = this.hashRefreshToken(rawToken);
    const existing = await this.refreshTokens.findOne({ where: { tokenHash } });

    if (!existing || existing.isRevoked || existing.expiresAt.getTime() < Date.now()) {
      if (existing?.isRevoked) {
        await this.revokeAllUserTokens(existing.userId, 'security_breach');
      }
      throw new ApiException(ErrorCode.AUTH_001, 'توكن التجديد غير صالح، سجّل دخول تاني', HttpStatus.UNAUTHORIZED);
    }

    const user = await this.users.findOne({ where: { id: existing.userId } });
    if (!user || user.isBlocked) {
      throw new ApiException(ErrorCode.AUTH_001, 'الحساب غير متاح', HttpStatus.UNAUTHORIZED);
    }

    existing.isRevoked = true;
    existing.revokedAt = new Date();
    existing.revokedReason = 'rotation';
    await this.refreshTokens.save(existing);

    return this.issueTokenPair(user, ip);
  }

  async logout(rawToken: string): Promise<void> {
    const tokenHash = this.hashRefreshToken(rawToken);
    await this.refreshTokens.update(
      { tokenHash, isRevoked: false },
      { isRevoked: true, revokedAt: new Date(), revokedReason: 'logout' },
    );
  }

  private async revokeAllUserTokens(userId: string, reason: string): Promise<void> {
    await this.refreshTokens.update(
      { userId, isRevoked: false },
      { isRevoked: true, revokedAt: new Date(), revokedReason: reason },
    );
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
