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

  async listAll(page = 1, perPage = 20): Promise<{
    items: Record<string, unknown>[];
    meta: { page: number; per_page: number; total: number };
  }> {
    const safePage = Math.max(1, Math.floor(page));
    const safePerPage = Math.min(100, Math.max(1, Math.floor(perPage)));
    const [items, countRows] = await Promise.all([
      this.dataSource.query(
      `SELECT p.*, u.full_name AS customer_full_name, u.phone_number AS customer_phone,
              a.street_name AS address_street
       FROM projects p
       JOIN customer_profiles cp ON cp.id = p.customer_id
       JOIN users u ON u.id = cp.user_id
       JOIN addresses a ON a.id = p.address_id
       WHERE p.deleted_at IS NULL
       ORDER BY p.created_at DESC
       LIMIT $1 OFFSET $2`,
      [safePerPage, (safePage - 1) * safePerPage],
      ),
      this.dataSource.query<{ total: string }[]>(
        `SELECT COUNT(*)::text AS total FROM projects WHERE deleted_at IS NULL`,
      ),
    ]);
    return {
      items,
      meta: { page: safePage, per_page: safePerPage, total: Number(countRows[0]?.total ?? 0) },
    };
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

    return this.dataSource.transaction(async (manager) => {
      const [number] = await manager.query<{ next: string }[]>(`SELECT next_human_readable_number('PRJ') AS next`);
      const project = manager.create(Project, {
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
      await manager.save(project);
      await this.auditLog.record({
        actorUserId: userId, actorRole: 'customer',
        action: 'project.created', entityType: 'project', entityId: project.id,
        newValues: { name: project.nameAr, type: project.projectType }, meta,
      }, manager);
      return project;
    });
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

  async findOneOwned(userId: string, projectId: string): Promise<Project> {
    const [row] = await this.dataSource.query<{ id: string }[]>(
      `SELECT p.id FROM projects p
       JOIN customer_profiles cp ON cp.id = p.customer_id
       WHERE p.id = $1 AND cp.user_id = $2 AND p.deleted_at IS NULL`,
      [projectId, userId],
    );
    if (!row) throw new ApiException(ErrorCode.VAL_001, 'المشروع غير موجود', HttpStatus.NOT_FOUND);
    return this.findOne(row.id);
  }

  async transition(adminUserId: string, projectId: string, to: ProjectStatus, reason?: string, meta?: AuditActorMeta): Promise<Project> {
    return this.dataSource.transaction(async (manager) => {
      const project = await manager.createQueryBuilder(Project, 'p')
        .setLock('pessimistic_write').where('p.id = :id', { id: projectId }).getOne();
      if (!project) throw new ApiException(ErrorCode.VAL_001, 'المشروع غير موجود', HttpStatus.NOT_FOUND);
      if (!canTransitionProject(project.status as ProjectStatus, to)) {
        throw new ApiException(ErrorCode.VAL_001, `مينفعش ينتقل من ${project.status} لـ${to}`, HttpStatus.CONFLICT);
      }
      if (to === 'awaiting_customer_approval') {
        throw new ApiException(ErrorCode.VAL_001, 'إرسال عرض السعر هو الطريق الوحيد لانتظار موافقة العميل', HttpStatus.CONFLICT);
      }
      if (project.status === 'awaiting_customer_approval' && to === 'awaiting_deposit') {
        throw new ApiException(ErrorCode.VAL_001, 'العميل صاحب المشروع هو الوحيد اللي يقدر يعتمد عرض السعر', HttpStatus.CONFLICT);
      }
      const previousStatus = project.status;
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
        newValues: { from: previousStatus, to }, meta,
      }, manager);
      return project;
    });
  }

  // ── Quotes ──
  async createQuote(adminUserId: string, projectId: string, dto: {
    work_lines?: unknown[]; material_lines?: unknown[];
    scope_included?: string; scope_excluded?: string; assumptions?: string;
    duration_days?: number; proposed_company_id?: string;
  }, meta?: AuditActorMeta): Promise<ProjectQuote> {
    type QuoteLine = {
      description_ar: string; quantity: number; unit?: string; unit_price_cents: number;
      responsibility?: string;
    };
    const workLines = (dto.work_lines ?? []) as QuoteLine[];
    const materialLines = (dto.material_lines ?? []) as QuoteLine[];

    if ([...workLines, ...materialLines].some((line) => !line.description_ar?.trim()
      || !Number.isFinite(line.quantity) || !Number.isInteger(line.unit_price_cents)
      || line.quantity <= 0 || line.unit_price_cents < 0)) {
      throw new ApiException(ErrorCode.VAL_001, 'بنود عرض السعر لازم تحمل وصف وكمية موجبة وسعر صحيح بالقرش', HttpStatus.BAD_REQUEST);
    }

    const totalWork = workLines.reduce((sum, l) => sum + l.quantity * l.unit_price_cents, 0);
    const totalMaterials = materialLines.reduce((sum, l) => sum + l.quantity * l.unit_price_cents, 0);
    const totalCents = totalWork + totalMaterials;

    if (totalCents <= 0) throw new ApiException(ErrorCode.VAL_001, 'إجمالي عرض السعر لازم يكون أكبر من صفر', HttpStatus.BAD_REQUEST);

    return this.dataSource.transaction(async (manager) => {
      const project = await manager.createQueryBuilder(Project, 'p').setLock('pessimistic_write')
        .where('p.id = :id AND p.deleted_at IS NULL', { id: projectId }).getOne();
      if (!project) throw new ApiException(ErrorCode.VAL_001, 'المشروع غير موجود', HttpStatus.NOT_FOUND);
      const [latest] = await manager.query<{ max_version: number }[]>(
        `SELECT COALESCE(MAX(version),0)+1 AS max_version FROM project_quotes WHERE project_id=$1`, [projectId],
      );
      const quote = manager.create(ProjectQuote, {
        projectId, version: Number(latest.max_version), status: 'draft',
        workLines: workLines.map((line) => ({
          description_ar: line.description_ar.trim(), quantity: line.quantity, unit: line.unit ?? 'وحدة',
          unit_price_cents: line.unit_price_cents, total_cents: line.quantity * line.unit_price_cents,
        })),
        materialLines: materialLines.map((line) => ({
          description_ar: line.description_ar.trim(), responsibility: line.responsibility ?? 'provider_supplied',
          quantity: line.quantity, unit: line.unit ?? 'وحدة', unit_price_cents: line.unit_price_cents,
          total_cents: line.quantity * line.unit_price_cents,
        })),
        totalWorkCents: totalWork, totalMaterialsCents: totalMaterials, discountCents: 0, totalCents,
        durationDays: dto.duration_days ?? null, scopeIncluded: dto.scope_included ?? null,
        scopeExcluded: dto.scope_excluded ?? null, assumptions: dto.assumptions ?? null,
        proposedCompanyId: dto.proposed_company_id ?? null, createdBy: adminUserId,
      });
      await manager.save(quote);
      await this.auditLog.record({ actorUserId: adminUserId, actorRole: 'admin', action: 'project.quote_created',
        entityType: 'project_quote', entityId: quote.id, newValues: { project_id: projectId, version: quote.version, total_cents: totalCents }, meta }, manager);
      return quote;
    });
  }

  async sendQuote(adminUserId: string, quoteId: string, expiryDays: number, expectedProjectId?: string, meta?: AuditActorMeta): Promise<ProjectQuote> {
    return this.dataSource.transaction(async (manager) => {
      const quote = await manager.createQueryBuilder(ProjectQuote, 'q')
        .setLock('pessimistic_write').where('q.id = :id', { id: quoteId }).getOne();
      if (!quote || quote.status !== 'draft') {
        throw new ApiException(ErrorCode.VAL_001, 'العرض إما مبعتش أو تم اعتماده بالفعل', HttpStatus.CONFLICT);
      }
      if (expectedProjectId && quote.projectId !== expectedProjectId) {
        throw new ApiException(ErrorCode.VAL_001, 'عرض السعر غير تابع للمشروع المحدد', HttpStatus.NOT_FOUND);
      }
      quote.status = 'sent';
      quote.sentAt = new Date();
      quote.expiresAt = new Date(Date.now() + expiryDays * 86_400_000);
      await manager.save(quote);
      const project = await manager.createQueryBuilder(Project, 'p').setLock('pessimistic_write')
        .where('p.id = :id AND p.deleted_at IS NULL', { id: quote.projectId }).getOne();
      if (!project) throw new ApiException(ErrorCode.VAL_001, 'المشروع غير موجود', HttpStatus.NOT_FOUND);
      if (!['quote_preparing', 'awaiting_customer_approval'].includes(project.status)) {
        throw new ApiException(ErrorCode.VAL_001, 'حالة المشروع الحالية لا تسمح بإرسال عرض سعر', HttpStatus.CONFLICT);
      }
      project.status = 'awaiting_customer_approval';
      await manager.save(project);
      await this.auditLog.record({ actorUserId: adminUserId, actorRole: 'admin', action: 'project.quote_sent',
        entityType: 'project_quote', entityId: quote.id, newValues: { project_id: quote.projectId, expires_at: quote.expiresAt.toISOString() }, meta }, manager);
      return quote;
    });
  }

  async approveQuote(userId: string, quoteId: string, expectedProjectId?: string, meta?: AuditActorMeta): Promise<Project> {
    return this.dataSource.transaction(async (manager) => {
      const quote = await manager.createQueryBuilder(ProjectQuote, 'q')
        .setLock('pessimistic_write').where('q.id = :id', { id: quoteId }).getOne();
      if (!quote || quote.status !== 'sent') {
        throw new ApiException(ErrorCode.VAL_001, 'العرض مش في حالة "مُرسل"', HttpStatus.CONFLICT);
      }
      if (quote.expiresAt && quote.expiresAt.getTime() <= Date.now()) {
        quote.status = 'expired';
        await manager.save(quote);
        throw new ApiException(ErrorCode.VAL_001, 'عرض السعر انتهت صلاحيته', HttpStatus.CONFLICT);
      }
      if (expectedProjectId && quote.projectId !== expectedProjectId) {
        throw new ApiException(ErrorCode.VAL_001, 'عرض السعر غير تابع للمشروع المحدد', HttpStatus.NOT_FOUND);
      }
      const [owned] = await manager.query<{ exists: boolean }[]>(
        `SELECT EXISTS(SELECT 1 FROM projects p JOIN customer_profiles cp ON cp.id=p.customer_id
         WHERE p.id=$1 AND cp.user_id=$2 AND p.deleted_at IS NULL) AS exists`,
        [quote.projectId, userId],
      );
      if (!owned?.exists) throw new ApiException(ErrorCode.VAL_001, 'عرض السعر غير موجود', HttpStatus.NOT_FOUND);
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
      await this.auditLog.record({
        actorUserId: userId, actorRole: 'customer', action: 'project.quote_approved',
        entityType: 'project_quote', entityId: quote.id,
        newValues: { project_id: project.id, total_cents: quote.totalCents }, meta,
      }, manager);
      return project;
    });
  }

  // ── Milestones ──
  async createMilestones(adminUserId: string, projectId: string, milestones: {
    name_ar: string; amount_cents: number; is_down_payment?: boolean;
    expected_date?: string; completion_criteria?: string;
  }[], meta?: AuditActorMeta): Promise<ProjectMilestone[]> {
    if (milestones.length === 0 || milestones.some((m) => !m.name_ar?.trim() || !Number.isInteger(m.amount_cents) || m.amount_cents <= 0)) {
      throw new ApiException(ErrorCode.VAL_001, 'لازم تضيف مراحل صحيحة بمبالغ موجبة', HttpStatus.BAD_REQUEST);
    }
    if (milestones.filter((m) => m.is_down_payment).length > 1) {
      throw new ApiException(ErrorCode.VAL_001, 'مسموح بمرحلة عربون واحدة فقط', HttpStatus.BAD_REQUEST);
    }
    return this.dataSource.transaction(async (manager) => {
      const project = await manager.createQueryBuilder(Project, 'p').setLock('pessimistic_write')
        .where('p.id = :id AND p.deleted_at IS NULL', { id: projectId }).getOne();
      if (!project) throw new ApiException(ErrorCode.VAL_001, 'المشروع غير موجود', HttpStatus.NOT_FOUND);
      const existing = await manager.getRepository(ProjectMilestone).count({ where: { projectId } });
      if (existing > 0) throw new ApiException(ErrorCode.VAL_001, 'مراحل المشروع اتعملت بالفعل', HttpStatus.CONFLICT);
      const total = milestones.reduce((sum, milestone) => sum + milestone.amount_cents, 0);
      if (total !== (project.approvedQuoteTotalCents ?? 0)) {
        throw new ApiException(ErrorCode.VAL_001, `مجموع المراحل (${total}) لا يساوي قيمة العرض المعتمد (${project.approvedQuoteTotalCents})`, HttpStatus.BAD_REQUEST);
      }
      const created = milestones.map((milestone, index) => manager.create(ProjectMilestone, {
        projectId, sequenceNumber: index + 1, nameAr: milestone.name_ar.trim(), amountCents: milestone.amount_cents,
        isDownPayment: milestone.is_down_payment ?? false, expectedDate: milestone.expected_date ?? null,
        completionCriteria: milestone.completion_criteria ?? null,
      }));
      const saved = await manager.save(created);
      await this.auditLog.record({
        actorUserId: adminUserId, actorRole: 'admin', action: 'project.milestones_created',
        entityType: 'project', entityId: project.id,
        newValues: { count: saved.length, total_cents: total }, meta,
      }, manager);
      return saved;
    });
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
    const [project] = await this.dataSource.query<Record<string, unknown>[]>(
      `SELECT p.*, u.full_name AS customer_full_name, u.phone_number AS customer_phone,
              a.street_name AS address_street
       FROM projects p
       JOIN customer_profiles cp ON cp.id = p.customer_id
       JOIN users u ON u.id = cp.user_id
       JOIN addresses a ON a.id = p.address_id
       WHERE p.id = $1 AND p.deleted_at IS NULL`,
      [projectId],
    );
    if (!project) throw new ApiException(ErrorCode.VAL_001, 'المشروع غير موجود', HttpStatus.NOT_FOUND);

    const [quotes, milestones, orders, warranties, activity] = await Promise.all([
      this.dataSource.query(
        `SELECT q.id, q.project_id, q.version, q.status, q.work_lines, q.material_lines,
                q.total_work_cents, q.total_materials_cents, q.discount_cents, q.total_cents,
                q.duration_days, q.scope_included, q.scope_excluded, q.assumptions,
                q.proposed_company_id, q.expires_at, q.sent_at, q.approved_at, q.rejected_reason,
                q.created_at, creator.full_name AS created_by_name,
                CASE WHEN q.status = 'approved' THEN customer.full_name ELSE NULL END AS approved_by_name
         FROM project_quotes q
         LEFT JOIN users creator ON creator.id = q.created_by
         JOIN projects p ON p.id = q.project_id
         JOIN customer_profiles cp ON cp.id = p.customer_id
         JOIN users customer ON customer.id = cp.user_id
         WHERE q.project_id = $1
         ORDER BY q.version DESC`,
        [projectId],
      ),
      this.dataSource.query(
        `SELECT id, project_id, sequence_number, name_ar, amount_cents, expected_date,
                completion_criteria, execution_status, approval_status, payment_status,
                payout_status, is_down_payment, approved_by_customer, approved_at, paid_at,
                payout_released_at, created_at, updated_at
         FROM project_milestones WHERE project_id = $1 ORDER BY sequence_number ASC`,
        [projectId],
      ),
      this.dataSource.query(
      `SELECT o.id, o.order_number, o.order_status::text AS status, o.total_amount_cents
       FROM orders o WHERE o.project_id = $1 AND o.deleted_at IS NULL ORDER BY o.created_at ASC`,
        [projectId],
      ),
      this.dataSource.query(
        `SELECT cw.id, cw.name_ar, cw.coverage_months, cw.coverage_days, cw.expires_at, cw.claims_used
         FROM customer_warranties cw WHERE cw.project_id = $1 ORDER BY cw.created_at DESC`,
        [projectId],
      ),
      this.dataSource.query(
        `SELECT al.id, al.action, al.actor_role, al.new_values, al.created_at,
                COALESCE(actor.full_name,
                  CASE WHEN al.actor_role = 'customer' THEN 'العميل' ELSE 'النظام' END) AS actor_name
         FROM audit_logs al
         LEFT JOIN users actor ON actor.id = al.actor_user_id
         WHERE (al.entity_type = 'project' AND al.entity_id = $1)
            OR (al.entity_type = 'project_quote' AND al.entity_id IN (
              SELECT id FROM project_quotes WHERE project_id = $1
            ))
         ORDER BY al.created_at ASC`,
        [projectId],
      ),
    ]);

    return {
      project,
      quotes,
      milestones,
      orders,
      warranties,
      activity,
      summary: {
        total_financed_cents: Number(project.approved_quote_total_cents ?? 0),
        paid_cents: Number(project.paid_cents ?? 0),
        remaining_cents: Number(project.remaining_cents ?? 0),
        milestone_count: milestones.length,
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
