import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuditContext, AuditMeta } from '../../common/decorators/audit-meta.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtPayload } from '../auth/types/authenticated-request';
import { UserType } from '../auth/entities/user.entity';
import { ProjectsService } from './projects.service';
import { Project } from './entities/project.entity';


function toProjectResponseDto(p: Project): Record<string, unknown> {
  return {
    id: p.id,
    project_number: p.projectNumber,
    customer_id: p.customerId,
    address_id: p.addressId,
    city_id: p.cityId,
    project_type: p.projectType,
    name_ar: p.nameAr,
    description_ar: p.descriptionAr,
    status: p.status,
    budget_estimate_cents: p.budgetEstimateCents,
    approved_quote_total_cents: p.approvedQuoteTotalCents,
    total_work_value_cents: p.totalWorkValueCents,
    total_materials_value_cents: p.totalMaterialsValueCents,
    paid_cents: p.paidCents,
    retained_cents: p.retainedCents,
    released_cents: p.releasedCents,
    remaining_cents: p.remainingCents,
    assigned_company_id: p.assignedCompanyId,
    survey_requested_at: p.surveyRequestedAt?.toISOString() ?? null,
    survey_scheduled_at: p.surveyScheduledAt?.toISOString() ?? null,
    expected_start: p.expectedStart,
    expected_end: p.expectedEnd,
    actual_start: p.actualStart,
    actual_end: p.actualEnd,
    created_at: p.createdAt.toISOString(),
  };
}

@Controller('me/projects')
@Roles(UserType.CUSTOMER)
export class MyProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  async create(@CurrentUser() user: JwtPayload, @Body() dto: {
    project_type: string; name_ar: string; description_ar?: string;
    address_id: string; budget_estimate_cents?: number;
  }, @AuditContext() meta: AuditMeta) {
    const project = await this.projectsService.create(user.sub, dto, meta);
    return toProjectResponseDto(project);
  }

  @Get()
  async list(@CurrentUser() user: JwtPayload) {
    const projects = await this.projectsService.listForCustomer(user.sub);
    return projects.map(toProjectResponseDto);
  }

  @Get(':id')
  async detail(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return toProjectResponseDto(await this.projectsService.findOneOwned(user.sub, id));
  }

  @Get(':id/quotes')
  async quotes(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    await this.projectsService.findOneOwned(user.sub, id);
    return this.projectsService.listQuotesForProject(id);
  }

  @Post(':id/quotes/:quoteId/approve')
  async approveQuote(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) projectId: string,
    @Param('quoteId', ParseUUIDPipe) quoteId: string,
    @AuditContext() meta: AuditMeta,
  ) {
    return this.projectsService.approveQuote(user.sub, quoteId, projectId, meta);
  }

  // ── موافقة/رفض المرحلة + كومنتات العميل (ADR-0036) ──────────────────────────
  // الموافقة التلقائية (MilestoneAutoApproveService) موجودة من قبل كده وبتشتغل بعد 72 ساعة —
  // دي المسار **اليدوي** للعميل اللي مش عايز يستنى المهلة، وكان ناقص تمامًا.

  @Post(':id/milestones/:milestoneId/approve')
  async approveMilestone(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('milestoneId', ParseUUIDPipe) milestoneId: string,
    @AuditContext() meta: AuditMeta,
  ) {
    return this.projectsService.approveMilestone(user.sub, id, milestoneId, meta);
  }

  @Post(':id/milestones/:milestoneId/reject')
  async rejectMilestone(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('milestoneId', ParseUUIDPipe) milestoneId: string,
    @Body() dto: { reason: string },
    @AuditContext() meta: AuditMeta,
  ) {
    return this.projectsService.rejectMilestone(user.sub, id, milestoneId, dto?.reason ?? '', meta);
  }

  /** كومنت من العميل — دايمًا مرئي (مالوش معنى يخفي حاجة عن نفسه). */
  @Post(':id/comments')
  async addComment(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: { body: string; milestone_id?: string },
    @AuditContext() meta: AuditMeta,
  ) {
    return this.projectsService.addComment({ userId: user.sub, role: 'customer' }, id, dto, meta);
  }
}
