import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { AuditActorMeta, AuditLogService } from '../audit/audit-log.service';
import { Project, ProjectStatus, canTransitionProject } from './entities/project.entity';
import { ProjectQuote } from './entities/project-quote.entity';
import { ProjectMilestone } from './entities/project-milestone.entity';

const PROJECT_NUMBER_PREFIX = 'PRJ';

@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(Project) private readonly projects: Repository<Project>,
    @InjectRepository(ProjectQuote) private readonly quotes: Repository<ProjectQuote>,
    @InjectRepository(ProjectMilestone) private readonly milestones: Repository<ProjectMilestone>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly auditLog: AuditLogService,
  ) {}

  async listAll(): Promise<Project[]> {
    return this.projects.find({ order: { createdAt: 'DESC' } });
  }

  async create(userId: string, dto: {
    project_type: string; name_ar: string; description_ar?: string;
    address_id: string; budget_estimate_cents?: number;
  }, meta?: AuditActorMeta): Promise<Project> {
    const [profile] = await this.dataSource.query<{ id: string }[]>(
      `SELECT id FROM customer_profiles WHERE user_id = $1`, [userId],
    );
    if (!profile) throw new ApiException(ErrorCode.VAL_001, 'بروفايل العميل غير موجود', HttpStatus.NOT_FOUND);
    const [addr] = await this.dataSource.query<{ city_id: string | null }[]>(
      `SELECT city_id FROM addresses WHERE id = $1 AND user_id = $2`, [dto.address_id, userId],
    );
    if (!addr) throw new ApiException(ErrorCode.VAL_001, 'العنوان غير موجود', HttpStatus.NOT_FOUND);

    const [number] = await this.dataSource.query<{ next: string }[]>(
      `SELECT next_human_readable_number('PRJ') AS next`,
    );
    const project = this.projects.create({
      projectNumber: number.next,
      customerId: profile.id,
      addressId: dto.address_id,
      cityId: addr.city_id,
      projectType: dto.project_type,
      nameAr: dto.name_ar,
      descriptionAr: dto.description_ar ?? null,
      status: 'survey_requested' as ProjectStatus,
      budgetEstimateCents: dto.budget_estimate_cents ?? null,
      surveyRequestedAt: new Date(),
    });
    await this.projects.save(project);
    await this.auditLog.record({
      actorUserId: userId, actorRole: 'customer',
      action: 'project.created', entityType: 'project', entityId: project.id,
      newValues: { name: project.nameAr, type: project.projectType }, meta,
    });
    return project;
  }

  async listForCustomer(userId: string): Promise<Project[]> {
    const [profile] = await this.dataSource.query<{ id: string }[]>(
      `SELECT id FROM customer_profiles WHERE user_id = $1`, [userId],
    );
    if (!profile) return [];
    return this.projects.find({ where: { customerId: profile.id }, order: { createdAt: 'DESC' } });
  }

  async findOne(projectId: string): Promise<Project> {
    const project = await this.projects.findOne({ where: { id: projectId } });
    if (!project) throw new ApiException(ErrorCode.VAL_001, 'المشروع غير موجود', HttpStatus.NOT_FOUND);
    return project;
  }

  async transition(adminUserId: string, projectId: string, to: ProjectStatus, reason?: string, meta?: AuditActorMeta): Promise<Project> {
    return this.dataSource.transaction(async (manager) => {
      const project = await manager.createQueryBuilder(Project, 'p')
        .setLock('pessimistic_write').where('p.id = :id', { id: projectId }).getOne();
      if (!project) throw new ApiException(ErrorCode.VAL_001, 'المشروع غير موجود', HttpStatus.NOT_FOUND);
      if (!canTransitionProject(project.status as ProjectStatus, to)) {
        throw new ApiException(ErrorCode.VAL_001, `مينفعش ينتقل من ${project.status} لـ${to}`, HttpStatus.CONFLICT);
      }
      project.status = to;
      if (to === 'paused') project.pausedReason = reason ?? null;
      if (to === 'cancelled') project.cancelledReason = reason ?? null;
      if (to === 'disputed') project.disputeReason = reason ?? null;
      if (to === 'active') { project.actualStart = new Date().toISOString().slice(0, 10); }
      if (to === 'completed') { project.actualEnd = new Date().toISOString().slice(0, 10); }
      await manager.save(project);
      await this.auditLog.record({
        actorUserId: adminUserId, actorRole: 'admin',
        action: `project.${to}`, entityType: 'project', entityId: project.id,
        newValues: { from: project.status, to }, meta,
      });
      return project;
    });
  }

  // ── Quotes ──
  async createQuote(adminUserId: string, projectId: string, dto: {
    work_lines?: unknown[]; material_lines?: unknown[];
    scope_included?: string; scope_excluded?: string; assumptions?: string;
    duration_days?: number; proposed_company_id?: string;
  }, meta?: AuditActorMeta): Promise<ProjectQuote> {
    const project = await this.findOne(projectId);

    const workLines = (dto.work_lines ?? []) as { quantity: number; unit_price_cents: number }[];
    const materialLines = (dto.material_lines ?? []) as { quantity: number; unit_price_cents: number }[];

    const totalWork = workLines.reduce((sum, l) => sum + l.quantity * l.unit_price_cents, 0);
    const totalMaterials = materialLines.reduce((sum, l) => sum + l.quantity * l.unit_price_cents, 0);
    const totalCents = totalWork + totalMaterials;

    const [latest] = await this.dataSource.query<{ max_version: number }[]>(
      `SELECT COALESCE(MAX(version),0)+1 AS max_version FROM project_quotes WHERE project_id=$1`, [projectId],
    );

    const quote = this.quotes.create({
      projectId, version: Number(latest.max_version),
      status: 'draft',
      workLines: workLines.map((l, i) => ({ ...l, total_cents: l.quantity * l.unit_price_cents, description_ar: '' })),
      materialLines: materialLines.map((l) => ({ ...l, total_cents: l.quantity * l.unit_price_cents })),
      totalWorkCents: totalWork, totalMaterialsCents: totalMaterials,
      discountCents: 0, totalCents,
      durationDays: dto.duration_days ?? null,
      scopeIncluded: dto.scope_included ?? null,
      scopeExcluded: dto.scope_excluded ?? null,
      assumptions: dto.assumptions ?? null,
      proposedCompanyId: dto.proposed_company_id ?? null,
      createdBy: adminUserId,
    });
    await this.quotes.save(quote);
    return quote;
  }

  async sendQuote(adminUserId: string, quoteId: string, expiryDays: number): Promise<ProjectQuote> {
    return this.dataSource.transaction(async (manager) => {
      const quote = await manager.createQueryBuilder(ProjectQuote, 'q')
        .setLock('pessimistic_write').where('q.id = :id', { id: quoteId }).getOne();
      if (!quote || quote.status !== 'draft') {
        throw new ApiException(ErrorCode.VAL_001, 'العرض إما مبعتش أو تم اعتماده بالفعل', HttpStatus.CONFLICT);
      }
      quote.status = 'sent';
      quote.sentAt = new Date();
      quote.expiresAt = new Date(Date.now() + expiryDays * 86_400_000);
      await manager.save(quote);
      return quote;
    });
  }

  async approveQuote(userId: string, quoteId: string): Promise<Project> {
    return this.dataSource.transaction(async (manager) => {
      const quote = await manager.createQueryBuilder(ProjectQuote, 'q')
        .setLock('pessimistic_write').where('q.id = :id', { id: quoteId }).getOne();
      if (!quote || quote.status !== 'sent') {
        throw new ApiException(ErrorCode.VAL_001, 'العرض مش في حالة "مُرسل"', HttpStatus.CONFLICT);
      }
      quote.status = 'approved';
      quote.approvedAt = new Date();
      await manager.save(quote);

      const project = await manager.createQueryBuilder(Project, 'p')
        .setLock('pessimistic_write').where('p.id = :pid', { pid: quote.projectId }).getOne();
      if (!project) throw new ApiException(ErrorCode.VAL_001, 'المشروع غير موجود', HttpStatus.NOT_FOUND);
      project.approvedQuoteTotalCents = quote.totalCents;
      project.totalWorkValueCents = quote.totalWorkCents;
      project.totalMaterialsValueCents = quote.totalMaterialsCents;
      if (quote.proposedCompanyId) project.assignedCompanyId = quote.proposedCompanyId;

      // انتقل لحالة انتظار العربون
      if (canTransitionProject(project.status as ProjectStatus, 'awaiting_deposit')) {
        project.status = 'awaiting_deposit';
      }
      await manager.save(project);
      return project;
    });
  }

  // ── Milestones ──
  async createMilestones(adminUserId: string, projectId: string, milestones: {
    name_ar: string; amount_cents: number; is_down_payment?: boolean;
    expected_date?: string; completion_criteria?: string;
  }[]): Promise<ProjectMilestone[]> {
    const project = await this.findOne(projectId);
    const total = milestones.reduce((s, m) => s + m.amount_cents, 0);
    if (total !== (project.approvedQuoteTotalCents ?? 0)) {
      throw new ApiException(ErrorCode.VAL_001, `مجموع المراحل (${total}) لا يساوي قيمة العرض المعتمد (${project.approvedQuoteTotalCents})`, HttpStatus.BAD_REQUEST);
    }
    const created: ProjectMilestone[] = [];
    for (let i = 0; i < milestones.length; i++) {
      const m = this.milestones.create({
        projectId,
        sequenceNumber: i + 1,
        nameAr: milestones[i].name_ar,
        amountCents: milestones[i].amount_cents,
        isDownPayment: milestones[i].is_down_payment ?? false,
        expectedDate: milestones[i].expected_date ?? null,
        completionCriteria: milestones[i].completion_criteria ?? null,
      });
      created.push(await this.milestones.save(m));
    }
    return created;
  }

  /** بوابة إطلاق المستحق — لازم: مرحلة مكتملة + عميل موافق + مدفوعة. ذرّية بـSKIP LOCKED. */
  async releaseMilestonePayout(milestoneId: string): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const ms = await manager.createQueryBuilder(ProjectMilestone, 'm')
        .setLock('pessimistic_write').where('m.id = :id', { id: milestoneId }).getOne();
      if (!ms) return false;
      if (ms.executionStatus !== 'completed' || ms.approvalStatus !== 'approved') return false;
      if (ms.paymentStatus !== 'paid') return false;
      if (ms.payoutStatus === 'released') return false;
      ms.payoutStatus = 'released';
      ms.payoutReleasedAt = new Date();
      await manager.save(ms);
      return true;
    });
  }

  async getProjectRoom(projectId: string) {
    const project = await this.findOne(projectId);
    const quotes = await this.listQuotesForProject(projectId);
    const milestones = await this.listProjectMilestones(projectId);
    const orders = await this.dataSource.query(
      `SELECT o.id, o.order_number, o.order_status::text AS status, o.total_amount_cents
       FROM orders o WHERE o.project_id = $1 AND o.deleted_at IS NULL ORDER BY o.created_at ASC`,
      [projectId],
    );
    return {
      project,
      quotes,
      milestones,
      orders,
      summary: {
        total_financed_cents: project.approvedQuoteTotalCents ?? 0,
        paid_cents: project.paidCents ?? 0,
        remaining_cents: (project.approvedQuoteTotalCents ?? 0) - (project.paidCents ?? 0),
      },
    };
  }

  async listProjectMilestones(projectId: string): Promise<ProjectMilestone[]> {
    return this.milestones.find({ where: { projectId }, order: { sequenceNumber: 'ASC' } });
  }

  async listQuotesForProject(projectId: string): Promise<ProjectQuote[]> {
    return this.quotes.find({ where: { projectId }, order: { version: 'DESC' } });
  }
}
