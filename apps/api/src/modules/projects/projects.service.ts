import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
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

  private async enqueueNotification(
    manager: EntityManager,
    projectId: string,
    action: string,
    actor: { userId: string | null; role: 'admin' | 'customer' | 'system' },
    details: Record<string, unknown> = {},
  ): Promise<void> {
    await manager.query(
      `INSERT INTO project_notification_outbox (project_id, action, actor_user_id, actor_role, details)
       VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [projectId, action, actor.userId, actor.role, JSON.stringify(details)],
    );
  }

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
  }, meta?: AuditActorMeta, idempotencyKey?: string): Promise<Project> {
    const [profile] = await this.dataSource.query<{ id: string }[]>(
      `SELECT id FROM customer_profiles WHERE user_id = $1`, [userId],
    );
    if (!profile) throw new ApiException(ErrorCode.VAL_001, 'بروفايل العميل غير موجود', HttpStatus.NOT_FOUND);
    const [addr] = await this.dataSource.query<{ city_id: string | null }[]>(
      `SELECT city_id FROM addresses WHERE id = $1 AND user_id = $2`, [dto.address_id, userId],
    );
    if (!addr) throw new ApiException(ErrorCode.VAL_001, 'العنوان غير موجود', HttpStatus.NOT_FOUND);

    const normalizedIdempotencyKey = idempotencyKey?.trim() || null;
    if (normalizedIdempotencyKey && normalizedIdempotencyKey.length > 128) {
      throw new ApiException(ErrorCode.VAL_001, 'Idempotency-Key أطول من المسموح', HttpStatus.BAD_REQUEST);
    }
    if (normalizedIdempotencyKey) {
      const existing = await this.projects.findOne({
        where: { customerId: profile.id, idempotencyKey: normalizedIdempotencyKey },
      });
      if (existing) return existing;
    }

    try {
      return await this.dataSource.transaction(async (manager) => {
        const [number] = await manager.query<{ next: string }[]>(`SELECT next_human_readable_number('PRJ') AS next`);
        const project = manager.create(Project, {
          projectNumber: number.next,
          customerId: profile.id,
          idempotencyKey: normalizedIdempotencyKey,
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
        await this.enqueueNotification(manager, project.id, 'project.created', { userId, role: 'customer' });
        return project;
      });
    } catch (error) {
      if (normalizedIdempotencyKey && (error as { code?: string }).code === '23505') {
        const existing = await this.projects.findOne({
          where: { customerId: profile.id, idempotencyKey: normalizedIdempotencyKey },
        });
        if (existing) return existing;
      }
      throw error;
    }
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
      await this.enqueueNotification(manager, project.id, `project.${to}`, { userId: adminUserId, role: 'admin' }, { from: previousStatus, to });
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
      await this.enqueueNotification(manager, project.id, 'project.quote_sent', { userId: adminUserId, role: 'admin' }, {
        quote_id: quote.id,
        total_cents: quote.totalCents,
      });
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
      await this.enqueueNotification(manager, project.id, 'project.quote_approved', { userId, role: 'customer' }, {
        quote_id: quote.id,
        total_cents: quote.totalCents,
      });
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
      await this.enqueueNotification(manager, project.id, 'project.milestones_created', { userId: adminUserId, role: 'admin' }, {
        count: saved.length,
        has_down_payment: saved.some((milestone) => milestone.isDownPayment),
      });
      return saved;
    });
  }

  /** بوابة إطلاق المستحق — لازم: مرحلة مكتملة + عميل موافق + مدفوعة. ذرّية بـSKIP LOCKED. */
  /**
   * دورة حياة المرحلة الواحدة (ADR-0036، docs/08 §57 بند 3) — بلاغ المالك: "الأدمن بيسلّم كله مع
   * بعض، وده مش منطقي… كل فيز تسمح إن هي تتسلم على حدة."
   *
   * الاكتشاف الحقيقي وقت التنفيذ: `project_milestones` كانت **مبنية صح من الأساس** (سعر وحالة
   * تنفيذ وموافقة ودفع واستحقاق لكل مرحلة مستقلين)، و`MilestoneAutoApproveService` شغّالة بالفعل
   * وبتستنى `execution_status='completed'` — بس **مفيش ولا endpoint في المشروع كله كان بيوصّل
   * للحالة دي**. الحلقة كانت مقفولة من الطرفين ومفتوحة من النص.
   *
   * الترتيب مش مفروض عمدًا: الأدمن يقدر يبدأ أي مرحلة `pending` من غير ما يستنى اللي قبلها —
   * شغل التشطيب الحقيقي بيتوازى (سباكة وكهربا مع بعض)، وفرض التسلسل قيد مصطنع.
   */
  private async transitionMilestone(
    projectId: string,
    milestoneId: string,
    actor: { userId: string; role: 'admin' | 'customer' },
    apply: (milestone: ProjectMilestone) => { action: string; newValues: Record<string, unknown> },
    meta?: AuditActorMeta,
  ): Promise<ProjectMilestone> {
    return this.dataSource.transaction(async (manager) => {
      const found = await manager
        .createQueryBuilder(ProjectMilestone, 'm')
        .setLock('pessimistic_write')
        .where('m.id = :id AND m.project_id = :projectId', { id: milestoneId, projectId })
        .getOne();
      if (!found) {
        throw new ApiException(ErrorCode.VAL_001, 'المرحلة غير موجودة في المشروع ده', HttpStatus.NOT_FOUND);
      }
      const result = apply(found);
      await manager.save(found);
      await this.auditLog.record({
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: result.action,
        entityType: 'project_milestone',
        entityId: milestoneId,
        newValues: { project_id: projectId, sequence_number: found.sequenceNumber, ...result.newValues },
        meta,
      }, manager);
      await this.enqueueNotification(manager, projectId, result.action, actor, {
        milestone_id: milestoneId,
        milestone_name: found.nameAr,
        ...result.newValues,
      });
      return found;
    });
  }

  async startMilestone(adminUserId: string, projectId: string, milestoneId: string, meta?: AuditActorMeta) {
    return this.transitionMilestone(projectId, milestoneId, { userId: adminUserId, role: 'admin' }, (m) => {
      if (m.executionStatus !== 'pending') {
        throw new ApiException(
          ErrorCode.VAL_001,
          `مينفعش تبدأ مرحلة حالتها ${m.executionStatus}`,
          HttpStatus.CONFLICT,
        );
      }
      m.executionStatus = 'in_progress';
      return { action: 'project.milestone_started', newValues: { execution_status: 'in_progress' } };
    }, meta);
  }

  /** تسليم مرحلة بعينها — بيبدأ عدّاد الموافقة التلقائية الموجود بالفعل (72 ساعة افتراضيًا). */
  async completeMilestone(
    adminUserId: string,
    projectId: string,
    milestoneId: string,
    proofStorageKeys: string[] = [],
    meta?: AuditActorMeta,
  ) {
    return this.transitionMilestone(projectId, milestoneId, { userId: adminUserId, role: 'admin' }, (m) => {
      if (m.executionStatus !== 'in_progress') {
        throw new ApiException(
          ErrorCode.VAL_001,
          `مينفعش تسلّم مرحلة حالتها ${m.executionStatus} — لازم تبدأها الأول`,
          HttpStatus.CONFLICT,
        );
      }
      m.executionStatus = 'completed';
      // إعادة الفتح بعد رفض العميل بترجّع approval_status لـpending — من غير كده المرحلة
      // المرفوضة تفضل مرفوضة للأبد حتى بعد ما الأدمن يصلّح ويسلّم تاني.
      m.approvalStatus = 'pending';
      m.rejectionReason = null;
      if (proofStorageKeys.length > 0) {
        const uploadedAt = new Date().toISOString();
        m.proofAttachments = [
          ...(m.proofAttachments ?? []),
          ...proofStorageKeys.map((storage_key) => ({ storage_key, uploaded_at: uploadedAt })),
        ];
      }
      return {
        action: 'project.milestone_completed',
        newValues: { execution_status: 'completed', proof_count: m.proofAttachments?.length ?? 0 },
      };
    }, meta);
  }

  /** موافقة العميل اليدوية — الموافقة التلقائية موجودة بالفعل، دي للعميل اللي مش عايز يستنى. */
  async approveMilestone(customerUserId: string, projectId: string, milestoneId: string, meta?: AuditActorMeta) {
    await this.findOneOwned(customerUserId, projectId);
    return this.transitionMilestone(projectId, milestoneId, { userId: customerUserId, role: 'customer' }, (m) => {
      if (m.executionStatus !== 'completed') {
        throw new ApiException(ErrorCode.VAL_001, 'المرحلة لسه ما اتسلّمتش', HttpStatus.CONFLICT);
      }
      if (m.approvalStatus !== 'pending') {
        throw new ApiException(ErrorCode.VAL_001, `المرحلة دي حالتها ${m.approvalStatus} بالفعل`, HttpStatus.CONFLICT);
      }
      m.approvalStatus = 'approved';
      m.approvedByCustomer = true;
      m.approvedAt = new Date();
      return { action: 'project.milestone_approved', newValues: { approval_status: 'approved' } };
    }, meta);
  }

  async rejectMilestone(
    customerUserId: string,
    projectId: string,
    milestoneId: string,
    reason: string,
    meta?: AuditActorMeta,
  ) {
    if (!reason?.trim()) {
      throw new ApiException(ErrorCode.VAL_001, 'سبب الرفض مطلوب', HttpStatus.BAD_REQUEST);
    }
    await this.findOneOwned(customerUserId, projectId);
    return this.transitionMilestone(projectId, milestoneId, { userId: customerUserId, role: 'customer' }, (m) => {
      if (m.executionStatus !== 'completed') {
        throw new ApiException(ErrorCode.VAL_001, 'المرحلة لسه ما اتسلّمتش', HttpStatus.CONFLICT);
      }
      if (m.approvalStatus !== 'pending') {
        throw new ApiException(ErrorCode.VAL_001, `المرحلة دي حالتها ${m.approvalStatus} بالفعل`, HttpStatus.CONFLICT);
      }
      m.approvalStatus = 'rejected';
      m.approvedByCustomer = false;
      m.rejectionReason = reason.trim();
      // بترجع in_progress عشان الأدمن يقدر يصلّح ويسلّم تاني — الرفض مش نهاية المرحلة.
      m.executionStatus = 'in_progress';
      return { action: 'project.milestone_rejected', newValues: { approval_status: 'rejected', reason: reason.trim() } };
    }, meta);
  }

  /**
   * كومنتات المشروع/المرحلة (ADR-0036) — `milestoneId` اختياري: موجود = كومنت على مرحلة،
   * null = كومنت عام. كومنت العميل بيتفرض مرئي دايمًا (مالوش معنى يخفي حاجة عن نفسه).
   */
  async addComment(
    author: { userId: string; role: 'admin' | 'customer' },
    projectId: string,
    dto: { body: string; milestone_id?: string | null; is_visible_to_customer?: boolean },
    meta?: AuditActorMeta,
  ): Promise<Record<string, unknown>> {
    const body = dto.body?.trim();
    if (!body) {
      throw new ApiException(ErrorCode.VAL_001, 'الكومنت ماينفعش يكون فاضي', HttpStatus.BAD_REQUEST);
    }
    if (author.role === 'customer') {
      await this.findOneOwned(author.userId, projectId);
    } else {
      await this.findOne(projectId);
    }
    if (dto.milestone_id) {
      const [owned] = await this.dataSource.query<{ id: string }[]>(
        `SELECT id FROM project_milestones WHERE id = $1 AND project_id = $2`,
        [dto.milestone_id, projectId],
      );
      if (!owned) {
        throw new ApiException(ErrorCode.VAL_001, 'المرحلة غير موجودة في المشروع ده', HttpStatus.NOT_FOUND);
      }
    }
    const visible = author.role === 'customer' ? true : dto.is_visible_to_customer !== false;
    return this.dataSource.transaction(async (manager) => {
      const [row] = await manager.query<Record<string, unknown>[]>(
        `INSERT INTO project_comments (project_id, milestone_id, author_user_id, author_role, body, is_visible_to_customer)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING id, project_id, milestone_id, author_role, body, is_visible_to_customer, created_at`,
        [projectId, dto.milestone_id ?? null, author.userId, author.role, body, visible],
      );
      await this.auditLog.record({
        actorUserId: author.userId,
        actorRole: author.role,
        action: 'project.comment_added',
        entityType: 'project',
        entityId: projectId,
        newValues: { milestone_id: dto.milestone_id ?? null, is_visible_to_customer: visible },
        meta,
      }, manager);
      await this.enqueueNotification(manager, projectId, 'project.comment_added', author, {
        comment_id: row.id,
        milestone_id: dto.milestone_id ?? null,
        visible_to_customer: visible,
      });
      return row;
    });
  }

  /**
   * ربط طلب موجود بمشروع (docs/08 §57 بند 4) — بلاغ المالك: "مش عارف الطلبات دي بتضاف إزاي".
   * السبب إن `orders.project_id` كان بيتحدد **بس** من `OrdersService.create()` وقت إنشاء الطلب
   * من العميل (`dto.project_id`) — مفيش أي مسار أدمن يربط طلب قايم بمشروع، فالتبويب كان بيفضل
   * فاضي عمليًا. الربط مقصور على طلبات **نفس العميل** — طلب عميل تاني في مشروع مش بتاعه تسريب.
   */
  async linkOrderToProject(adminUserId: string, projectId: string, orderId: string, meta?: AuditActorMeta) {
    return this.dataSource.transaction(async (manager) => {
      const [project] = await manager.query<{ id: string; customer_id: string }[]>(
        `SELECT id, customer_id FROM projects WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [projectId],
      );
      if (!project) {
        throw new ApiException(ErrorCode.VAL_001, 'المشروع غير موجود', HttpStatus.NOT_FOUND);
      }
      const [order] = await manager.query<{ id: string; customer_id: string; project_id: string | null }[]>(
        `SELECT id, customer_id, project_id FROM orders WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [orderId],
      );
      if (!order) {
        throw new ApiException(ErrorCode.VAL_001, 'الطلب غير موجود', HttpStatus.NOT_FOUND);
      }
      if (order.customer_id !== project.customer_id) {
        throw new ApiException(
          ErrorCode.VAL_001,
          'الطلب ده مش لنفس عميل المشروع — مينفعش يتربط بيه',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (order.project_id && order.project_id !== projectId) {
        throw new ApiException(ErrorCode.VAL_001, 'الطلب مربوط بمشروع تاني بالفعل', HttpStatus.CONFLICT);
      }
      if (order.project_id === projectId) return { linked: true, already: true };

      await manager.query(`UPDATE orders SET project_id = $1 WHERE id = $2`, [projectId, orderId]);
      await this.auditLog.record({
        actorUserId: adminUserId,
        actorRole: 'admin',
        action: 'project.order_linked',
        entityType: 'project',
        entityId: projectId,
        newValues: { order_id: orderId },
        meta,
      }, manager);
      await this.enqueueNotification(manager, projectId, 'project.order_linked', { userId: adminUserId, role: 'admin' }, { order_id: orderId });
      return { linked: true, already: false };
    });
  }

  async listLinkableOrders(projectId: string): Promise<Record<string, unknown>[]> {
    const project = await this.findOne(projectId);
    return this.dataSource.query(
      `SELECT id, order_number, order_status::text AS status, total_amount_cents, project_id
       FROM orders
       WHERE customer_id = $1 AND deleted_at IS NULL
         AND (project_id IS NULL OR project_id = $2)
       ORDER BY created_at DESC
       LIMIT 100`,
      [project.customerId, projectId],
    );
  }

  /**
   * إصدار ضمان على مستوى المشروع كله (docs/08 §57 بند 5) — بلاغ المالك: "الضمانات… مش عارف
   * إزاي أضيفها، ولا هي جاهزة أصلاً ولا لأ".
   *
   * الحقيقة اللي اتلقطت: خطط الضمان وإدارتها من الأدمن **موجودة وشغّالة**، وصفوف
   * `customer_warranties` بتتولد **في مكان واحد بس**: `payments.service.ts` عند تسوية **طلب**
   * فيه خطة ضمان (وبتحمل `project_id` لو الطلب مربوط بمشروع). يعني ضمان **المشروع نفسه** —
   * اللي بيغطي الشغل ككل مش زيارة واحدة — مكانش ليه أي مسار إصدار خالص. الجدول نفسه بيسمح بيه
   * من الأساس (`order_id` nullable + الفهرس الفريد مشروط بـ`order_id IS NOT NULL`).
   */
  async issueProjectWarranty(
    adminUserId: string,
    projectId: string,
    planId: string,
    meta?: AuditActorMeta,
  ): Promise<Record<string, unknown>> {
    return this.dataSource.transaction(async (manager) => {
      const [project] = await manager.query<{ id: string; customer_id: string; approved_quote_total_cents: number | null }[]>(
        `SELECT id, customer_id, approved_quote_total_cents
         FROM projects WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [projectId],
      );
      if (!project) {
        throw new ApiException(ErrorCode.VAL_001, 'المشروع غير موجود', HttpStatus.NOT_FOUND);
      }
      const [plan] = await manager.query<Record<string, unknown>[]>(
        `SELECT * FROM warranty_plans WHERE id = $1 AND is_active = true`,
        [planId],
      );
      if (!plan) {
        throw new ApiException(ErrorCode.VAL_001, 'خطة الضمان غير موجودة أو موقوفة', HttpStatus.NOT_FOUND);
      }
      const coverageMonths = Number(plan.coverage_months ?? 12);
      const startsAt = new Date();
      const expiresAt = new Date(startsAt);
      expiresAt.setMonth(expiresAt.getMonth() + coverageMonths);

      const [row] = await manager.query<Record<string, unknown>[]>(
        `INSERT INTO customer_warranties (
           plan_id, plan_version, order_id, project_id, customer_id, name_ar, warranty_type,
           price_paid_cents, coverage_months, max_coverage_cents, max_claims,
           terms_ar, exclusions_ar, starts_at, expires_at, claims_used
         ) VALUES ($1,$2,NULL,$3,$4,$5,$6,0,$7,$8,$9,$10,$11,$12,$13,0)
         RETURNING id, project_id, name_ar, coverage_months, starts_at, expires_at`,
        [
          plan.id,
          Number(plan.version ?? 1),
          projectId,
          project.customer_id,
          String(plan.name_ar ?? 'ضمان المشروع'),
          String(plan.warranty_type ?? 'extended_workmanship'),
          coverageMonths,
          plan.max_coverage_cents ?? project.approved_quote_total_cents ?? null,
          Number(plan.max_claims ?? 1),
          plan.terms_ar ?? null,
          plan.exclusions_ar ?? null,
          startsAt,
          expiresAt,
        ],
      );
      await this.auditLog.record({
        actorUserId: adminUserId,
        actorRole: 'admin',
        action: 'project.warranty_issued',
        entityType: 'project',
        entityId: projectId,
        newValues: { plan_id: planId, warranty_id: row.id, expires_at: expiresAt.toISOString() },
        meta,
      }, manager);
      await this.enqueueNotification(manager, projectId, 'project.warranty_issued', { userId: adminUserId, role: 'admin' }, {
        warranty_id: row.id,
        plan_id: planId,
      });
      return row;
    });
  }

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

  /**
   * `viewer` (ADR-0036) — `'customer'` بيفلتر الكومنتات المخفية **في SQL نفسه**، مش في طبقة
   * العرض: الإخفاء لازم يكون على مستوى الاستعلام عشان مايتسربش بالغلط في أي مسار جديد بعد كده.
   */
  async getProjectRoom(projectId: string, viewer: 'admin' | 'customer' = 'admin') {
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

    const comments = await this.dataSource.query<Record<string, unknown>[]>(
      `SELECT c.id, c.milestone_id, c.author_role, c.body, c.is_visible_to_customer, c.created_at,
              COALESCE(u.full_name, CASE WHEN c.author_role = 'customer' THEN 'العميل' ELSE 'الإدارة' END) AS author_name
       FROM project_comments c
       LEFT JOIN users u ON u.id = c.author_user_id
       WHERE c.project_id = $1 AND c.deleted_at IS NULL
         AND ($2::boolean IS FALSE OR c.is_visible_to_customer = true)
       ORDER BY c.created_at ASC`,
      [projectId, viewer === 'customer'],
    );

    // كل مرحلة بتشيل كومنتاتها جوّاها — الواجهة بتعرض الكارت كامل من غير نداء تاني لكل مرحلة.
    const milestonesWithComments = (milestones as Record<string, unknown>[]).map((milestone) => ({
      ...milestone,
      comments: comments.filter((c) => c.milestone_id === milestone.id),
    }));

    return {
      project,
      quotes,
      milestones: milestonesWithComments,
      orders,
      warranties,
      activity,
      /** كومنتات عامة على المشروع كله (milestone_id = NULL) — كومنتات المراحل جوّه المراحل نفسها. */
      comments: comments.filter((c) => c.milestone_id === null),
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
