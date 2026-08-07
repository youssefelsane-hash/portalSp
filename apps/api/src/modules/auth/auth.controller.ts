import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Patch, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { RequestOtpDto } from './dto/request-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { toUserResponseDto } from './dto/user-response.dto';
import { JwtPayload } from './types/authenticated-request';

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
  register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.authService.register(dto, clientIp(req));
  }

  @Public()
  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: VerifyOtpDto, @Req() req: Request) {
    return this.authService.login(dto, clientIp(req));
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshTokenDto, @Req() req: Request) {
    return this.authService.refresh(dto.refresh_token, clientIp(req));
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Body() dto: RefreshTokenDto) {
    await this.authService.logout(dto.refresh_token);
    return null;
  }

  @Get('me')
  async getMe(@CurrentUser() user: JwtPayload) {
    return toUserResponseDto(await this.authService.getMe(user.sub));
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
