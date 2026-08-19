import { Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { toEmployeeSessionResponseDto } from './dto/employee-session-response.dto';
import { WorkforceActivityService } from './workforce-activity.service';

// Script 5 Part 2/12 — رؤية جلسات/نشاط الموظفين. heartbeat مفتوح لأي أدمن (بيسجّل نشاطه هو بس)،
// باقي الـendpoints محتاجة صلاحيات دقيقة (employees.activity.view/sessions.view، security.sessions.revoke).
@Controller('admin/workforce')
@Roles(UserType.ADMIN)
export class AdminWorkforceController {
  constructor(private readonly workforce: WorkforceActivityService) {}

  @Post('heartbeat')
  @HttpCode(HttpStatus.OK)
  async heartbeat(@CurrentUser() admin: JwtPayload) {
    await this.workforce.heartbeat(admin.sub);
    return null;
  }

  @Get('summary')
  @RequirePermission('employees.activity.view')
  getSummary() {
    return this.workforce.getWorkforceSummary();
  }

  @Get('employees/:userId/presence')
  @RequirePermission('employees.activity.view')
  getPresence(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.workforce.getPresence(userId);
  }

  @Get('employees/:userId/sessions')
  @RequirePermission('employees.sessions.view')
  async listSessions(@Param('userId', ParseUUIDPipe) userId: string) {
    const sessions = await this.workforce.listSessions(userId);
    return sessions.map(toEmployeeSessionResponseDto);
  }

  @Delete('employees/:userId/sessions/:sessionId')
  @RequirePermission('security.sessions.revoke')
  async revokeSession(
    @CurrentUser() admin: JwtPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
  ) {
    await this.workforce.revokeEmployeeSession(admin.sub, userId, sessionId);
    return null;
  }
}
