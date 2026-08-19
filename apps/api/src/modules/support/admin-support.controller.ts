import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { AuditContext, AuditMeta } from '../../common/decorators/audit-meta.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { RequireStepUp } from '../../common/decorators/require-step-up.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { RejectComplaintDto, ResolveComplaintDto } from './dto/file-complaint.dto';
import { UpdateComplaintSeverityDto } from './dto/update-complaint-severity.dto';
import { toComplaintResponseDto } from './dto/complaint-response.dto';
import { SupportService } from './support.service';

@Controller('admin/complaints')
@Roles(UserType.ADMIN)
export class AdminSupportController {
  constructor(private readonly supportService: SupportService) {}

  @Get()
  async listAll() {
    const complaints = await this.supportService.listAllForAdmin();
    return complaints.map(toComplaintResponseDto);
  }

  // بَقّة أمنية حقيقية اتلقطت واتصلحت (Script 7 Phase 24): compensation_cents بتحوّل فلوس حقيقية
  // من محفظة المنصة (allowNegativeBalance:true، بلا حد أقصى) بقرار أدمن مباشر — نفس مستوى حساسية
  // orders.resolve_failed_visit/orders.resolve_cash_dispute بالظبط (اتضافت لـMFA_REQUIRED_PERMISSIONS
  // معاها)، لكن كانت ناقصة @RequireStepUp() من الأساس.
  @Post(':id/resolve')
  @RequirePermission('complaints.resolve')
  @RequireStepUp()
  async resolve(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveComplaintDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return toComplaintResponseDto(await this.supportService.resolve(user.sub, id, dto, audit));
  }

  @Post(':id/reject')
  @RequirePermission('complaints.resolve')
  async reject(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectComplaintDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return toComplaintResponseDto(await this.supportService.reject(user.sub, id, dto, audit));
  }

  @Post(':id/close')
  @RequirePermission('complaints.resolve')
  async close(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @AuditContext() audit: AuditMeta,
  ) {
    return toComplaintResponseDto(await this.supportService.close(user.sub, id, audit));
  }

  // التصنيف الأولي وقت الفتح بقى تلقائي حسب الفئة (SEVERITY_BY_CATEGORY في support.service.ts)،
  // بس القرار النهائي لسه لفريق الدعم — ده بيسمح بتعديله بعد المراجعة.
  @Patch(':id/severity')
  @RequirePermission('complaints.resolve')
  async updateSeverity(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateComplaintSeverityDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return toComplaintResponseDto(await this.supportService.updateSeverity(user.sub, id, dto, audit));
  }
}
