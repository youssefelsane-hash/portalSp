import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { IsNull, LessThan, Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { AdminMfaRecoveryCode } from './entities/admin-mfa-recovery-code.entity';
import { User } from './entities/user.entity';
import { WebAuthnChallenge, WebAuthnCeremonyType } from './entities/webauthn-challenge.entity';
import { WebAuthnCredential } from './entities/webauthn-credential.entity';

const CHALLENGE_TTL_MS = 5 * 60_000; // 5 دقايق — نفس مهلة صلاحية OTP تقريبًا
const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // بدون 0/O و1/I، نفس نمط كود الترشيح
const BCRYPT_SALT_ROUNDS = 10;

export interface VerifiedRegistration {
  credential: WebAuthnCredential;
  recoveryCodes: string[] | null; // اترجع مرة واحدة بس — أول credential للمستخدم
}

@Injectable()
export class WebAuthnService {
  private readonly logger = new Logger(WebAuthnService.name);

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(WebAuthnCredential) private readonly credentials: Repository<WebAuthnCredential>,
    @InjectRepository(WebAuthnChallenge) private readonly challenges: Repository<WebAuthnChallenge>,
    @InjectRepository(AdminMfaRecoveryCode) private readonly recoveryCodes: Repository<AdminMfaRecoveryCode>,
    private readonly config: ConfigService,
  ) {}

  private get rpName(): string {
    return this.config.get<string>('webauthn.rpName')!;
  }
  private get rpId(): string {
    return this.config.get<string>('webauthn.rpId')!;
  }
  private get origin(): string {
    return this.config.get<string>('webauthn.origin')!;
  }

  // ── تسجيل Passkey جديد (Registration) ───────────────────────────────

  async generateRegistrationOptions(userId: string): Promise<PublicKeyCredentialCreationOptionsJSON> {
    const user = await this.users.findOneOrFail({ where: { id: userId } });
    const existingCredentials = await this.credentials.find({ where: { userId } });

    const options = await generateRegistrationOptions({
      rpName: this.rpName,
      rpID: this.rpId,
      userName: user.phoneNumber,
      userDisplayName: user.fullName,
      attestationType: 'none',
      // discoverable credential (resident key) — عشان الدخول السريع اليومي بـPasskey بس
      // (بدون OTP الأول) يبقى ممكن، السيرفر يقدر يعرف هوية المستخدم من الـcredential نفسه.
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
      excludeCredentials: existingCredentials.map((c) => ({ id: c.credentialId, transports: c.transports ?? undefined })),
    });

    await this.saveChallenge(userId, WebAuthnCeremonyType.REGISTRATION, options.challenge);
    return options;
  }

  async verifyRegistration(userId: string, response: RegistrationResponseJSON, deviceLabel?: string): Promise<VerifiedRegistration> {
    const challenge = await this.consumeChallenge(userId, WebAuthnCeremonyType.REGISTRATION);

    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: this.origin,
      expectedRPID: this.rpId,
    });

    if (!verification.verified || !verification.registrationInfo) {
      throw new ApiException(ErrorCode.AUTH_005, 'فشل التحقق من تسجيل الـPasskey', HttpStatus.BAD_REQUEST);
    }

    const { credential, credentialBackedUp } = verification.registrationInfo;
    const isFirstCredential = (await this.credentials.count({ where: { userId } })) === 0;

    const saved = this.credentials.create({
      userId,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64url'),
      signCount: credential.counter,
      deviceLabel: deviceLabel ?? null,
      transports: credential.transports ?? null,
      backedUp: credentialBackedUp,
      lastUsedAt: new Date(),
    });
    await this.credentials.save(saved);

    // أول Passkey للمستخدم = لحظة توليد أكواد الاسترجاع (ADR-0011 §6) — بتتعرض مرة واحدة بس هنا.
    const recoveryCodes = isFirstCredential ? await this.generateRecoveryCodes(userId) : null;

    return { credential: saved, recoveryCodes };
  }

  // ── تحقق Passkey (Authentication — MFA login أو دخول سريع بـPasskey بس) ─

  async generateAuthenticationOptions(userId: string | null): Promise<PublicKeyCredentialRequestOptionsJSON> {
    let allowCredentials: { id: string; transports?: AuthenticatorTransportFuture[] }[] | undefined;
    if (userId) {
      const userCredentials = await this.credentials.find({ where: { userId } });
      if (userCredentials.length === 0) {
        throw new ApiException(ErrorCode.AUTH_005, 'مفيش Passkey مسجّل للمستخدم ده — سجّل واحد الأول', HttpStatus.BAD_REQUEST);
      }
      allowCredentials = userCredentials.map((c) => ({ id: c.credentialId, transports: c.transports ?? undefined }));
    }
    // userId=null → discoverable-credential login (دخول سريع بـPasskey بس، مفيش allowCredentials
    // فيبقى المتصفح يعرض قايمة الحسابات المتاحة على الجهاز، السيرفر بيعرف الهوية من userHandle الرد).

    const options = await generateAuthenticationOptions({
      rpID: this.rpId,
      allowCredentials,
      userVerification: 'preferred',
    });

    await this.saveChallenge(userId, WebAuthnCeremonyType.AUTHENTICATION, options.challenge);
    return options;
  }

  /** بيرجّع userId المتحقق منه فعليًا — مهم لمسار discoverable-credential لأن السيرفر ميعرفهوش قبل كده. */
  async verifyAuthentication(response: AuthenticationResponseJSON, expectedUserId: string | null): Promise<string> {
    const credential = await this.credentials.findOne({ where: { credentialId: response.id } });
    if (!credential) {
      throw new ApiException(ErrorCode.AUTH_005, 'الـPasskey ده غير مسجّل', HttpStatus.UNAUTHORIZED);
    }
    if (expectedUserId && credential.userId !== expectedUserId) {
      throw new ApiException(ErrorCode.AUTH_005, 'الـPasskey ده مش بتاع الحساب ده', HttpStatus.UNAUTHORIZED);
    }

    // ملحوظة: `expectedUserId` بالحرف (بما فيه null) — مش `?? credential.userId` — عشان مسار
    // discoverable-credential بيخزّن التحدي بـuser_id=NULL (generateAuthenticationOptions فوق)،
    // فلازم نستهلكه بنفس القيمة اللي اتخزن بيها بالظبط.
    const challenge = await this.consumeChallenge(expectedUserId, WebAuthnCeremonyType.AUTHENTICATION);

    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: this.origin,
      expectedRPID: this.rpId,
      credential: {
        id: credential.credentialId,
        publicKey: new Uint8Array(Buffer.from(credential.publicKey, 'base64url')),
        counter: credential.signCount,
        transports: credential.transports ?? undefined,
      },
    });

    if (!verification.verified) {
      throw new ApiException(ErrorCode.AUTH_005, 'فشل التحقق من الـPasskey', HttpStatus.UNAUTHORIZED);
    }

    // منع replay — sign_count لازم يزيد كل استخدام حقيقي. بعض المصادقات (macOS platform
    // authenticators قديمًا) بترجع 0 دايمًا لو مش بتتبّع العداد — نقبلها بس لو كانت أصلاً صفر،
    // مش نسمح برجوع لقيمة أقل من المخزّنة.
    const newCounter = verification.authenticationInfo.newCounter;
    if (newCounter !== 0 && newCounter <= credential.signCount) {
      this.logger.warn(`sign_count مشبوه لـcredential ${credential.id} — القديم ${credential.signCount}, الجديد ${newCounter}`);
      throw new ApiException(ErrorCode.AUTH_005, 'فشل التحقق من الـPasskey (احتمال استنساخ)', HttpStatus.UNAUTHORIZED);
    }
    credential.signCount = newCounter;
    credential.lastUsedAt = new Date();
    await this.credentials.save(credential);

    return credential.userId;
  }

  // ── التحديات (challenges) ────────────────────────────────────────────

  private async saveChallenge(userId: string | null, ceremonyType: WebAuthnCeremonyType, challenge: string): Promise<void> {
    await this.challenges.save(
      this.challenges.create({ userId, ceremonyType, challenge, expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) }),
    );
  }

  private async consumeChallenge(userId: string | null, ceremonyType: WebAuthnCeremonyType): Promise<string> {
    const record = await this.challenges.findOne({
      where: { userId: userId ?? IsNull(), ceremonyType, isUsed: false },
      order: { createdAt: 'DESC' },
    });
    if (!record || record.expiresAt.getTime() < Date.now()) {
      throw new ApiException(ErrorCode.AUTH_005, 'انتهت صلاحية طلب التحقق، ابدأ تاني', HttpStatus.BAD_REQUEST);
    }
    record.isUsed = true;
    await this.challenges.save(record);
    return record.challenge;
  }

  async purgeExpiredChallenges(): Promise<number> {
    const result = await this.challenges.delete({ expiresAt: LessThan(new Date()) });
    return result.affected ?? 0;
  }

  // ── إدارة Credentials ────────────────────────────────────────────────

  listCredentials(userId: string): Promise<WebAuthnCredential[]> {
    return this.credentials.find({ where: { userId }, order: { createdAt: 'DESC' } });
  }

  async removeCredential(userId: string, credentialRowId: string): Promise<void> {
    const credential = await this.credentials.findOne({ where: { id: credentialRowId, userId } });
    if (!credential) {
      throw new ApiException(ErrorCode.VAL_001, 'الـPasskey غير موجود', HttpStatus.NOT_FOUND);
    }
    await this.credentials.remove(credential);
  }

  hasAnyCredential(userId: string): Promise<boolean> {
    return this.credentials.count({ where: { userId } }).then((c) => c > 0);
  }

  // ── أكواد الاسترجاع (Recovery codes، ADR-0011 §6) ───────────────────

  private async generateRecoveryCodes(userId: string): Promise<string[]> {
    // أي أكواد قديمة (لو إعادة توليد بعد استخدام أول واحد أو reset إداري) بتتلغي بالكامل —
    // مفيش خلط قديم/جديد، سِت واحد صالح بس دايمًا.
    await this.recoveryCodes.delete({ userId });

    const plainCodes: string[] = [];
    const rows: AdminMfaRecoveryCode[] = [];
    for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
      const code = this.generateOneRecoveryCode();
      plainCodes.push(code);
      rows.push(this.recoveryCodes.create({ userId, codeHash: await bcrypt.hash(code, BCRYPT_SALT_ROUNDS) }));
    }
    await this.recoveryCodes.save(rows);
    return plainCodes;
  }

  private generateOneRecoveryCode(): string {
    const bytes = randomBytes(12);
    let raw = '';
    for (let i = 0; i < 12; i++) raw += RECOVERY_CODE_ALPHABET[bytes[i] % RECOVERY_CODE_ALPHABET.length];
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
  }

  /** بيتستخدم مع OTP مش بمفرده (ADR-0011 §6) — الاستدعاء من AuthService بعد ما OTP يتستهلك. */
  /**
   * بَقّة حقيقية اتلقطت في مراجعة أمان (2026-08-14، §23 من توجيه المالك — "audit recovery
   * endpoints for... recovery-code replay"): النسخة القديمة كانت `find()` بس، تعمل bcrypt.compare،
   * وبعدين `save()` عادي — مفيش قفل ولا شرط `WHERE used_at IS NULL` وقت الكتابة. طلبين متزامنين
   * بنفس كود الاسترجاع الصحيح كانوا الاتنين ممكن يعدّوا الـ`find()` قبل ما أي واحد فيهم يكتب
   * (السباق: read-read-write-write بدل read-write ذرّي)، فالاتنين يعتبروا الكود "استُهلك بنجاح"
   * ويبدأوا مسار MFA reset — كسر لضمان "كود واحد = استخدام واحد بس". الإصلاح: UPDATE ذرّي بشرط
   * `WHERE id = :id AND used_at IS NULL` (نفس فلسفة `StepUpService.consume()` بالحرف)، وبنتأكد إن
   * الطلب ده فعلاً هو اللي كسب السباق عبر `affected > 0` قبل ما نرجّع true.
   */
  async consumeRecoveryCode(userId: string, plainCode: string): Promise<boolean> {
    const unused = await this.recoveryCodes.find({ where: { userId, usedAt: IsNull() } });
    for (const row of unused) {
      // eslint-disable-next-line no-await-in-loop
      const matches = await bcrypt.compare(plainCode, row.codeHash);
      if (!matches) continue;

      // eslint-disable-next-line no-await-in-loop
      const result = await this.recoveryCodes
        .createQueryBuilder()
        .update(AdminMfaRecoveryCode)
        .set({ usedAt: () => 'now()' })
        .where('id = :id', { id: row.id })
        .andWhere('used_at IS NULL')
        .execute();
      return (result.affected ?? 0) > 0;
    }
    return false;
  }

  /** إعادة تعيين إداري كامل (super_admin، step-up مطلوب) — بيمسح كل Passkeys/أكواد استرجاع المستخدم المتأثر. */
  async resetMfa(userId: string): Promise<void> {
    await this.credentials.delete({ userId });
    await this.recoveryCodes.delete({ userId });
  }
}
