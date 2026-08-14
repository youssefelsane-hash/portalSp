import { Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireStepUp } from '../../common/decorators/require-step-up.decorator';
import { AuthService } from './auth.service';
import { JwtPayload } from './types/authenticated-request';

// إدارة الأجهزة/الجلسات (ADR-0011 §5) — الأدمن يشوف كل الأجهزة المفتوحة، يلغي جهاز بعينه، أو
// يلغي الكل. الإلغاء الجماعي محتاج step-up (نفس قايمة العمليات الحساسة في الـADR).
@Controller('auth/sessions')
export class SessionsController {
  constructor(private readonly authService: AuthService) {}

  @Get()
  async list(@CurrentUser() user: JwtPayload) {
    const sessions = await this.authService.listSessions(user.sub);
    return sessions.map((s) => ({
      id: s.id,
      device_name: s.deviceName,
      device_platform: s.devicePlatform,
      ip_address: s.ipAddress,
      amr: s.amr,
      last_seen_at: s.lastSeenAt,
      created_at: s.createdAt,
    }));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async revokeOne(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    await this.authService.revokeSession(user.sub, id);
    return null;
  }

  @Post('revoke-all')
  @HttpCode(HttpStatus.OK)
  @RequireStepUp()
  async revokeAll(@CurrentUser() user: JwtPayload) {
    await this.authService.revokeAllUserTokens(user.sub, 'user_revoked_all');
    return null;
  }
}
