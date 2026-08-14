import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsOptional, IsString } from 'class-validator';
import { Request } from 'express';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequireStepUp } from '../../common/decorators/require-step-up.decorator';
import { AuthService } from './auth.service';
import { WebAuthnAuthenticationVerifyDto } from './dto/webauthn-authentication-verify.dto';
import { WebAuthnRegistrationVerifyDto } from './dto/webauthn-registration-verify.dto';
import { StepUpService } from './step-up.service';
import { JwtPayload } from './types/authenticated-request';
import { WebAuthnService } from './webauthn.service';

function clientIp(req: Request): string | null {
  return req.ip ?? req.socket.remoteAddress ?? null;
}

// بَقّة حقيقية اتلقطت أثناء الاختبار الحي: من غير الديكوريتورز دي، ValidationPipe العالمي
// (forbidNonWhitelisted) بيرفض الـproperty كـ"unknown" رغم إنها متعرّفة على الكلاس فعليًا —
// class-transformer/class-validator بيتجاهلوا أي property من غير decorator خالص.
class MfaSessionTokenDto {
  @IsOptional()
  @IsString()
  mfa_session_token?: string;
}

@Controller('auth/webauthn')
export class WebAuthnController {
  constructor(
    private readonly authService: AuthService,
    private readonly webAuthnService: WebAuthnService,
    private readonly stepUpService: StepUpService,
  ) {}

  // ── تسجيل Passkey جديد — دايمًا جوّه مسار MFA (mfa_session_token) ─────

  @Public()
  @Post('registration/options')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async registrationOptions(@Body() dto: MfaSessionTokenDto) {
    const userId = await this.requireMfaSessionUserId(dto);
    return this.webAuthnService.generateRegistrationOptions(userId);
  }

  @Public()
  @Post('registration/verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async registrationVerify(@Body() body: WebAuthnRegistrationVerifyDto, @Req() req: Request) {
    const userId = await this.requireMfaSessionUserId(body);
    const result = await this.webAuthnService.verifyRegistration(userId, body.response, body.device_label);

    // أول Passkey للمستخدم (recoveryCodes !== null) = تغيير حساس، كل الجلسات القديمة (لو موجودة
    // من قبل ما MFA يتفرض) بتتلغي — الجلسة الجديدة الناتجة من completeMfaLogin تحت بتفضل شغالة
    // لأنها بتتصدر بعد كده (ADR-0011 §5).
    if (result.recoveryCodes) {
      await this.authService.revokeAllUserTokens(userId, 'mfa_enrolled');
    }

    const tokens = await this.authService.completeMfaLogin(userId, clientIp(req));
    return { ...tokens, recovery_codes: result.recoveryCodes };
  }

  // ── تحقق Passkey (MFA login أو دخول سريع بـPasskey بس) ────────────────

  @Public()
  @Post('authentication/options')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async authenticationOptions(@Body() dto: MfaSessionTokenDto) {
    const userId = dto.mfa_session_token ? await this.authService.verifyMfaPendingToken(dto.mfa_session_token) : null;
    return this.webAuthnService.generateAuthenticationOptions(userId);
  }

  @Public()
  @Post('authentication/verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async authenticationVerify(@Body() body: WebAuthnAuthenticationVerifyDto, @Req() req: Request) {
    const expectedUserId = body.mfa_session_token ? await this.authService.verifyMfaPendingToken(body.mfa_session_token) : null;
    const userId = await this.webAuthnService.verifyAuthentication(body.response, expectedUserId);

    if (expectedUserId) {
      return this.authService.completeMfaLogin(userId, clientIp(req), body);
    }
    // مفيش mfa_session_token — دخول سريع يومي بـPasskey بس (discoverable credential، ADR-0011 §3).
    return this.authService.passwordlessLogin(userId, clientIp(req), body);
  }

  // ── Step-up re-authentication للعمليات الحساسة (ADR-0011 §4) ─────────

  @Post('step-up/options')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  stepUpOptions(@CurrentUser() user: JwtPayload) {
    return this.webAuthnService.generateAuthenticationOptions(user.sub);
  }

  @Post('step-up/verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async stepUpVerify(@CurrentUser() user: JwtPayload, @Body() body: WebAuthnAuthenticationVerifyDto) {
    await this.webAuthnService.verifyAuthentication(body.response, user.sub);
    const { token, expiresAt } = await this.stepUpService.issue(user.sub);
    return { step_up_token: token, expires_at: expiresAt };
  }

  // ── إدارة الـPasskeys بتاعتي ───────────────────────────────────────

  @Get('credentials')
  async listCredentials(@CurrentUser() user: JwtPayload) {
    const credentials = await this.webAuthnService.listCredentials(user.sub);
    return credentials.map((c) => ({
      id: c.id,
      device_label: c.deviceLabel,
      backed_up: c.backedUp,
      last_used_at: c.lastUsedAt,
      created_at: c.createdAt,
    }));
  }

  // مسح Passkey = تعطيل حماية جزئي — محتاج step-up (Passkey فعلي تاني) نفس أي عملية حساسة.
  @Delete('credentials/:id')
  @HttpCode(HttpStatus.OK)
  @RequireStepUp()
  async removeCredential(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    await this.webAuthnService.removeCredential(user.sub, id);
    return null;
  }

  private async requireMfaSessionUserId(dto: MfaSessionTokenDto): Promise<string> {
    if (!dto.mfa_session_token) {
      throw new ApiException(ErrorCode.AUTH_005, 'mfa_session_token مطلوب', HttpStatus.BAD_REQUEST);
    }
    return this.authService.verifyMfaPendingToken(dto.mfa_session_token);
  }
}
