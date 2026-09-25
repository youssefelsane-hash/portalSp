import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Patch, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthService } from './auth.service';
import { RecoveryVerifyDto } from './dto/recovery-verify.dto';
import { RegisterDto } from './dto/register.dto';
import { RequestOtpDto } from './dto/request-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { PinLoginDto } from './dto/pin-login.dto';
import { PinResetRedeemDto } from './dto/pin-reset-redeem.dto';
import { PinRegisterDto } from './dto/pin-register.dto';
import { SetPinDto } from './dto/set-pin.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { toUserResponseDto } from './dto/user-response.dto';
import { JwtPayload } from './types/authenticated-request';
import { AccountRole } from './entities/user-role-grant.entity';

function clientIp(req: Request): string | null {
  return req.ip ?? req.socket.remoteAddress ?? null;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('otp/request')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } }) // 5/دقيقة — docs/01-master-plan.md §7.3
  requestOtp(@Body() dto: RequestOtpDto, @Req() req: Request) {
    return this.authService.requestOtp(dto, clientIp(req));
  }

  @Public()
  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.authService.register(dto, clientIp(req));
  }

  @Public()
  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  login(@Body() dto: VerifyOtpDto, @Req() req: Request) {
    return this.authService.login(dto, clientIp(req));
  }

  // استرجاع حساب Admin عليه MFA — OTP + recovery code سويًا (مش أي واحد لوحده)، بيمسح كل
  // الـPasskeys/recovery codes الحاليين ويرجّع نفس شكل mfa_required (ceremony: registration) —
  // إجبار تسجيل Passkey جديد فورًا (ADR-0011 §6).
  @Public()
  @Post('recovery/verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  recoveryVerify(@Body() dto: RecoveryVerifyDto, @Req() req: Request) {
    return this.authService.recoveryLogin(dto, clientIp(req));
  }

  // ── الدخول برمز (ADR-0109) ───────────────────────────────────────────
  // نفس حدود الـthrottle بتاعت مساري الـOTP بالحرف — الحماية مش أضعف لمجرد إن الـcredential
  // اتغيّر. وفوقها القفل المتدرّج على مستوى الحساب نفسه (`login-pin.policy.ts`).

  @Public()
  @Post('pin/register')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  registerWithPin(@Body() dto: PinRegisterDto, @Req() req: Request) {
    return this.authService.registerWithPin(dto, clientIp(req));
  }

  @Public()
  @Post('pin/login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  loginWithPin(@Body() dto: PinLoginDto, @Req() req: Request) {
    return this.authService.loginWithPin(dto, clientIp(req));
  }

  /**
   * تعيين/تغيير الرمز — **مسار متوثّق** (مفيش `@Public()`).
   *
   * ده مسار هجرة المستخدمين الحاليين (ADR-0109 §6-أ): اللي لسه داخل بيحط رمزه من جوّه التطبيق.
   * كونه متوثّق هو اللي بيمنع الاستيلاء — مستحيل حد ياخد حساب حد بمجرد إنه يعرف رقمه.
   */
  @Post('pin')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  setPin(@CurrentUser() user: JwtPayload, @Body() dto: SetPinDto) {
    return this.authService.setPin(user.sub, dto);
  }

  /**
   * **استهلاك كود استرجاع رمز الدخول** (ADR-0109 §6-ب).
   *
   * عام عمدًا: العميل هنا **مش داخل** — ده المسار الوحيد اللي بيرجّعه لحسابه بعد ما نسي رمزه
   * وعمل logout. الاستثناء مشروط بكود من ١٠ أرقام أصدره أدمن بعد ما تأكد من هويته، عمره ١٥
   * دقيقة، ولمرة واحدة.
   *
   * **الـthrottle أضيق من الدخول (٥ مش ١٠)**: الدخول العادي ممكن الواحد يغلط فيه وهو فاكر رمزه؛
   * كود الاسترجاع مكتوب قصاده وهو بيكتبه، فمحاولات كتير عليه = تخمين مش نسيان.
   */
  @Public()
  @Post('pin/reset/redeem')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  redeemPinResetCode(@Body() dto: PinResetRedeemDto) {
    return this.authService.redeemPinResetCode(dto);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshTokenDto, @Req() req: Request) {
    return this.authService.refresh(dto.refresh_token, clientIp(req), dto);
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Body() dto: RefreshTokenDto) {
    await this.authService.logout(dto.refresh_token);
    return null;
  }

  /**
   * **«عايز أبقى صنايعي»** — طلب دور الفني لحساب موجود (ADR-0110 §7-ب).
   *
   * متوثّق عمدًا: صاحب الحساب هو اللي بيطلب، مش أي حد يعرف رقمه. والجلسة الحالية **مابتتوسّعش**
   * — الدور بيتمنح وبيتعمل بروفايل `pending`، والمستخدم لازم يعمل دخول من تطبيق الفني عشان
   * ياخد جلسة بالدور الجديد. فتوكن مسروق مايقدرش يرقّي نفسه لصلاحيات فني في نفس النداء.
   *
   * دور العميل **مالوش نداء هنا** عن قصد: مالوش أي تحقّق، فأول دخول من تطبيق العميل بيمنحه
   * تلقائيًا (ADR-0110 §7-أ). نداء زيادة كان هيبقى عرقلة بلا مقابل أمني.
   */
  @Post('roles/technician')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  requestTechnicianRole(@CurrentUser() user: JwtPayload) {
    return this.authService.requestConsumerRole(user.sub, AccountRole.TECHNICIAN);
  }

  @Get('me')
  async getMe(@CurrentUser() user: JwtPayload) {
    // سياق الجلسة من التوكن — `user_type` في الرد = الدور النشط (ADR-0110)، مش عمود القاعدة.
    return toUserResponseDto(await this.authService.getMe(user.sub), {
      activeRole: user.userType,
      roles: user.roles as AccountRole[] | undefined,
    });
  }

  @Patch('me')
  async updateMe(@CurrentUser() user: JwtPayload, @Body() dto: UpdateMeDto) {
    return toUserResponseDto(await this.authService.updateMe(user.sub, dto));
  }

  @Delete('me')
  @HttpCode(HttpStatus.OK)
  async deleteMe(@CurrentUser() user: JwtPayload) {
    await this.authService.deleteMe(user.sub);
    return null;
  }
}
