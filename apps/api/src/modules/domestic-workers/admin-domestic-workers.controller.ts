import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { AuditContext, AuditMeta } from '../../common/decorators/audit-meta.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { RequireStepUp } from '../../common/decorators/require-step-up.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { DomesticWorkerBookingsService } from './domestic-worker-bookings.service';
import { DomesticWorkerEarningApprovalsService } from './domestic-worker-earning-approvals.service';
import { DomesticWorkersService } from './domestic-workers.service';
import { DomesticWorkerBookingStatus } from './entities/domestic-worker-booking.entity';
import { DomesticWorkerEarningApprovalStatus } from './entities/domestic-worker-earning-approval.entity';
import { DomesticWorkerVerificationStatus } from './entities/domestic-worker-profile.entity';
import { RejectEarningApprovalDto } from './dto/reject-earning-approval.dto';
import { ReviewWorkerDto } from './dto/review-worker.dto';
import { toEarningApprovalResponseDto } from './dto/earning-approval-response.dto';
import { toWorkerResponseDto } from './dto/worker-response.dto';
import { toWorkerBookingResponseDto } from './dto/worker-booking-response.dto';

// إدارة قطاع الخدمات المنزلية (docs/08 §12، ADR-0004) — نفس صلاحية technicians.review_documents
// (قرار مراجعة approve/reject على مقدّم خدمة قبل ما يبان للعميل، نفس نوع القرار بالظبط).
@Controller('admin/domestic-workers')
@Roles(UserType.ADMIN)
export class AdminDomesticWorkersController {
  constructor(
    private readonly workersService: DomesticWorkersService,
    private readonly bookingsService: DomesticWorkerBookingsService,
    private readonly earningApprovalsService: DomesticWorkerEarningApprovalsService,
  ) {}

  @Get()
  async list(@Query('status') status?: string) {
    if (status !== undefined && !Object.values(DomesticWorkerVerificationStatus).includes(status as DomesticWorkerVerificationStatus)) {
      throw new BadRequestException('status غير صحيحة');
    }
    const workers = await this.workersService.listForAdmin(status as DomesticWorkerVerificationStatus | undefined);
    return workers.map(toWorkerResponseDto);
  }

  @Post(':id/review')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('technicians.review_documents')
  async review(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewWorkerDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return toWorkerResponseDto(await this.workersService.review(admin.sub, id, dto, audit));
  }

  /**
   * حجوزات الخدمات المنزلية — ظهور للأدمن (docs/adr/0019 §6). أهم استخدام:
   * `?status=awaiting_payment` عشان الأدمن يلاقي الحجوزات المستنية دفع InstaPay ويأكّدها عبر
   * `POST /admin/payments/:id/confirm-instapay` بتاعة orders بالحرف (نفس الـendpoint، مفيش تكرار).
   */
  @Get('bookings')
  @RequirePermission('domestic_workers.approve_earnings')
  async listBookings(@Query('status') status?: string) {
    if (status !== undefined && !Object.values(DomesticWorkerBookingStatus).includes(status as DomesticWorkerBookingStatus)) {
      throw new BadRequestException('status غير صحيحة');
    }
    const bookings = await this.bookingsService.listForAdmin(status as DomesticWorkerBookingStatus | undefined);
    return bookings.map(toWorkerBookingResponseDto);
  }

  // طابور موافقة أرباح العمالة المنزلية (docs/08 §25.1، قرار مالك صريح 2026-08-15) — أرباح
  // الشغالة/العامل بتدخل "pending" بعد اكتمال الخدمة، ومتتحوّلش رصيد قابل للصرف إلا هنا.
  @Get('earning-approvals')
  @RequirePermission('domestic_workers.approve_earnings')
  async listEarningApprovals(@Query('status') status?: string) {
    if (status !== undefined && !Object.values(DomesticWorkerEarningApprovalStatus).includes(status as DomesticWorkerEarningApprovalStatus)) {
      throw new BadRequestException('status غير صحيحة');
    }
    const rows = await this.earningApprovalsService.listForAdmin(status as DomesticWorkerEarningApprovalStatus | undefined);
    return rows.map(toEarningApprovalResponseDto);
  }

  @Post('earning-approvals/:id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('domestic_workers.approve_earnings')
  @RequireStepUp()
  async approveEarning(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @AuditContext() audit: AuditMeta,
  ) {
    return toEarningApprovalResponseDto(await this.earningApprovalsService.approve(admin.sub, id, audit));
  }

  @Post('earning-approvals/:id/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('domestic_workers.approve_earnings')
  @RequireStepUp()
  async rejectEarning(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectEarningApprovalDto,
    @AuditContext() audit: AuditMeta,
  ) {
    return toEarningApprovalResponseDto(await this.earningApprovalsService.reject(admin.sub, id, dto.reason, audit));
  }
}
