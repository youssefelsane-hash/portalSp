import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { RequireStepUp } from '../../common/decorators/require-step-up.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuditContext, AuditMeta } from '../../common/decorators/audit-meta.decorator';
import { STORAGE_SERVICE, StorageService } from '../../common/storage/storage.service';
import { Inject } from '@nestjs/common';
import { JwtPayload } from '../auth/types/authenticated-request';
import { UserType } from '../auth/entities/user.entity';
import { InstallmentsService } from './installments.service';

// مسارات الأدمن للتقسيط (migration 0177) — فصل صارم للصلاحيات:
// - installments.view: قراءة الطلبات والجدولة (مالية/KYC)
// - installments.review: اعتماد/رفض بقرار بشري (+ step-up MFA زي باقي القرارات المالية)
// - installments.manage: إدارة الخطط وربطها بالخدمات
// المستندات الحساسة: الرابط بيتبني لحظيًا من storage key خاص + كل فتح بيتسجل audit.
@Controller('admin/installments')
@Roles(UserType.ADMIN)
export class AdminInstallmentsController {
  constructor(
    private readonly installmentsService: InstallmentsService,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
  ) {}

  @Get('applications')
  @RequirePermission('installments.view')
  async listApplications(
    @Query('status') status: string | undefined,
    @Query('page') page?: string,
    @Query('per_page') perPage?: string,
  ) {
    const p = Math.max(1, Number(page) || 1);
    const pp = Math.min(100, Math.max(1, Number(perPage) || 20));
    return this.installmentsService.adminListApplications(status ?? undefined, p, pp);
  }

  @Get('applications/:id')
  @RequirePermission('installments.view')
  async applicationDetail(@Param('id', ParseUUIDPipe) id: string) {
    return this.installmentsService.adminApplicationDetail(id);
  }

  // قرار مالي/KYC — step-up MFA إجباري (نفس مستوى adjust-price/refunds بالحرف).
  @Post('applications/:id/approve')
  @RequirePermission('installments.review')
  @RequireStepUp()
  async approve(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: { notes?: string },
    @AuditContext() audit: AuditMeta,
  ) {
    const app = await this.installmentsService.reviewApplication(admin.sub, id, { approve: true, notes: dto?.notes }, audit);
    return { id: app.id, status: app.status };
  }

  @Post('applications/:id/reject')
  @RequirePermission('installments.review')
  @RequireStepUp()
  async reject(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: { reason: string; notes?: string },
    @AuditContext() audit: AuditMeta,
  ) {
    const app = await this.installmentsService.reviewApplication(
      admin.sub,
      id,
      { approve: false, reason: dto.reason, notes: dto?.notes },
      audit,
    );
    return { id: app.id, status: app.status };
  }

  /** لوحة الجدولة النشطة — active/due/overdue/completed. */
  @Get('schedules')
  @RequirePermission('installments.view')
  async schedules(@Query('filter') filter = 'active', @Query('page') page?: string, @Query('per_page') perPage?: string) {
    const allowed = ['active', 'due', 'overdue', 'completed'] as const;
    const f = (allowed as readonly string[]).includes(filter) ? (filter as (typeof allowed)[number]) : 'active';
    const p = Math.max(1, Number(page) || 1);
    const pp = Math.min(100, Math.max(1, Number(perPage) || 20));
    return this.installmentsService.adminScheduleOverview(f, p, pp);
  }

  /** رابط مؤقت لمستند KYC — بصلاحية review + audit لكل فتح (مين فتح إيه وإمتى). */
  @Get('documents/:documentId/url')
  @RequirePermission('installments.review')
  async documentUrl(@CurrentUser() admin: JwtPayload, @Param('documentId', ParseUUIDPipe) documentId: string) {
    const [doc] = await this.installmentsService.getApplicationDocument(documentId);
    const url = await this.storage.getUrl(doc.storage_key);
    await this.installmentsService.auditDocumentAccess(admin.sub, documentId);
    return { url, doc_type: doc.doc_type };
  }

  // ===================== الخطط =====================

  @Get('plans')
  @RequirePermission('installments.manage')
  async plans() {
    return this.installmentsService.listPlans();
  }

  @Post('plans')
  @RequirePermission('installments.manage')
  async createPlan(@CurrentUser() admin: JwtPayload, @Body() dto: Record<string, unknown>, @AuditContext() audit: AuditMeta) {
    return this.installmentsService.createPlan(admin.sub, dto as never, audit);
  }

  @Patch('plans/:id')
  @RequirePermission('installments.manage')
  async updatePlan(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: Record<string, unknown>,
    @AuditContext() audit: AuditMeta,
  ) {
    return this.installmentsService.updatePlan(admin.sub, id, dto, audit);
  }

  /** الخدمات المرتبطة حالياً بخطة معينة — لإدارة الربط في الواجهة. */
  @Get('plans/:planId/services')
  @RequirePermission('installments.manage')
  async planServices(@Param('planId', ParseUUIDPipe) planId: string) {
    return this.installmentsService.listServicesForPlan(planId);
  }

  @Post('services/:serviceId/plans/:planId/link')
  @RequirePermission('installments.manage')
  async linkPlan(
    @CurrentUser() admin: JwtPayload,
    @Param('serviceId', ParseUUIDPipe) serviceId: string,
    @Param('planId', ParseUUIDPipe) planId: string,
    @AuditContext() audit: AuditMeta,
  ) {
    await this.installmentsService.setPlanForService(admin.sub, serviceId, planId, true, audit);
    return null;
  }

  @Post('services/:serviceId/plans/:planId/unlink')
  @RequirePermission('installments.manage')
  async unlinkPlan(
    @CurrentUser() admin: JwtPayload,
    @Param('serviceId', ParseUUIDPipe) serviceId: string,
    @Param('planId', ParseUUIDPipe) planId: string,
    @AuditContext() audit: AuditMeta,
  ) {
    await this.installmentsService.setPlanForService(admin.sub, serviceId, planId, false, audit);
    return null;
  }
}
