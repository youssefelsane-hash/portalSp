import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { AuditContext, AuditMeta } from '../../common/decorators/audit-meta.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/types/authenticated-request';
import { UserType } from '../auth/entities/user.entity';
import { ProjectsService } from './projects.service';

@Controller('admin/projects')
@Roles(UserType.ADMIN)
export class AdminProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get()
  @RequirePermission('projects.view')
  async list(@Query('page') page?: string, @Query('per_page') perPage?: string) {
    return this.projectsService.listAll(Number(page) || 1, Number(perPage) || 20);
  }

  @Get(':id/room')
  @RequirePermission('projects.view')
  async projectRoom(@Param('id', ParseUUIDPipe) id: string) {
    return this.projectsService.getProjectRoom(id, 'admin');
  }

  @Post(':id/transition')
  @RequirePermission('projects.manage')
  async transition(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: { to: string; reason?: string },
    @AuditContext() meta: AuditMeta,
  ) {
    return this.projectsService.transition(admin.sub, id, dto.to as never, dto.reason, meta);
  }

  @Post(':id/quotes')
  @RequirePermission('projects.manage')
  async createQuote(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: Record<string, unknown>,
    @AuditContext() meta: AuditMeta,
  ) {
    return this.projectsService.createQuote(admin.sub, id, dto as never, meta);
  }

  @Post(':id/quotes/:quoteId/send')
  @RequirePermission('projects.manage')
  async sendQuote(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) projectId: string,
    @Param('quoteId', ParseUUIDPipe) quoteId: string,
    @AuditContext() meta: AuditMeta,
  ) {
    return this.projectsService.sendQuote(admin.sub, quoteId, 14, projectId, meta);
  }

  @Post(':id/milestones')
  @RequirePermission('projects.manage')
  async createMilestones(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: { milestones: unknown[] },
    @AuditContext() meta: AuditMeta,
  ) {
    return this.projectsService.createMilestones(admin.sub, id, dto.milestones as never, meta);
  }

  // ── دورة حياة المرحلة الواحدة (ADR-0036، docs/08 §57 بند 3) ──────────────────
  // بلاغ المالك: "الأدمن بيسلّم كله مع بعض". الأفعال دي بتشتغل على **مرحلة بعينها**، والترتيب
  // بينهم مش مفروض (شغل التشطيب بيتوازى). الموافقة التلقائية الموجودة بالفعل بتبدأ بعد complete.

  @Post(':id/milestones/:milestoneId/start')
  @RequirePermission('projects.manage')
  async startMilestone(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('milestoneId', ParseUUIDPipe) milestoneId: string,
    @AuditContext() meta: AuditMeta,
  ) {
    return this.projectsService.startMilestone(admin.sub, id, milestoneId, meta);
  }

  @Post(':id/milestones/:milestoneId/complete')
  @RequirePermission('projects.manage')
  async completeMilestone(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('milestoneId', ParseUUIDPipe) milestoneId: string,
    @Body() dto: { proof_storage_keys?: string[] },
    @AuditContext() meta: AuditMeta,
  ) {
    return this.projectsService.completeMilestone(admin.sub, id, milestoneId, dto?.proof_storage_keys ?? [], meta);
  }

  /** كومنت على المشروع أو على مرحلة (milestone_id اختياري). مرئي للعميل افتراضيًا. */
  @Post(':id/comments')
  @RequirePermission('projects.manage')
  async addComment(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: { body: string; milestone_id?: string; is_visible_to_customer?: boolean },
    @AuditContext() meta: AuditMeta,
  ) {
    return this.projectsService.addComment({ userId: admin.sub, role: 'admin' }, id, dto, meta);
  }

  // ── سد فجوتَي الطلبات والضمانات (docs/08 §57 بنود 4-5) ──────────────────────

  /** ربط طلب قايم بالمشروع — الطلبات كانت بتتربط بس وقت إنشائها من العميل. */
  @Post(':id/orders/:orderId/link')
  @RequirePermission('projects.manage')
  async linkOrder(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @AuditContext() meta: AuditMeta,
  ) {
    return this.projectsService.linkOrderToProject(admin.sub, id, orderId, meta);
  }

  /** إصدار ضمان على المشروع كله — كان مفيش مسار إصدار غير عبر تسوية طلب. */
  @Post(':id/warranties')
  @RequirePermission('projects.manage')
  async issueWarranty(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: { plan_id: string },
    @AuditContext() meta: AuditMeta,
  ) {
    return this.projectsService.issueProjectWarranty(admin.sub, id, dto.plan_id, meta);
  }
}
