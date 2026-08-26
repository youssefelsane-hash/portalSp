import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { AuditLogService } from '../audit/audit-log.service';
import { ProjectsService } from './projects.service';
import { Project, ProjectStatus } from './entities/project.entity';
import { ProjectQuote } from './entities/project-quote.entity';
import { ProjectMilestone } from './entities/project-milestone.entity';
import { User } from '../auth/entities/user.entity';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { Address } from '../customers/entities/address.entity';
import { City } from '../geo/entities/city.entity';
import { Area } from '../geo/entities/area.entity';
import { ServiceZone } from '../geo/entities/service-zone.entity';
import { Order } from '../orders/entities/order.entity';
import { ServiceCategory } from '../catalog/entities/service-category.entity';
import { Service } from '../catalog/entities/service.entity';

/**
 * نظام المشروعات (docs/01B مهمة A) — تدفق حي كامل:
 * إنشاء → معاينة → عرض → اعتماد → مراحل → إطلاق مستحق
 */
describe('ProjectsService — المشروعات والمراحل والعروض (PostgreSQL)', () => {
  let dataSource: DataSource;
  let projectsService: ProjectsService;
  let auditLog: AuditLogService;
  const runId = randomUUID().replaceAll('-', '').slice(0, 10);
  const ids = {
    customerUser: '', customerProfile: '', category: '', service: '',
    address: '', city: '', zone: '', project: '', adminUser: '', otherUser: '', otherProfile: '',
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function q<T = any>(sql: string, params?: unknown[]): Promise<T> {
    return dataSource.query(sql, params) as Promise<T>;
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [User, CustomerProfile, Address, City, Area, ServiceZone, Order, ServiceCategory, Service, Project, ProjectQuote, ProjectMilestone],
    });
    await dataSource.initialize();

    const [country] = await q(`SELECT id FROM countries WHERE iso_code='EG'`);
    const [city] = await q(`INSERT INTO cities (country_id,name_ar,name_en,slug) VALUES ($1,$2,$3,$4) RETURNING id`,
      [country.id, `مدينة مشروع ${runId}`, `Proj City ${runId}`, `proj-city-${runId}`]);
    ids.city = city.id;
    const [zone] = await q(`INSERT INTO service_zones (city_id,name_ar,name_en) VALUES ($1,$2,$3) RETURNING id`, [ids.city, `نطاق ${runId}`, `Proj Zone ${runId}`]);
    ids.zone = zone.id;
    const [category] = await q(`INSERT INTO service_categories (name_ar,name_en,slug) VALUES ($1,$2,$3) RETURNING id`,
      [`فئة مشروع ${runId}`, `Proj Cat ${runId}`, `proj-cat-${runId}`]);
    ids.category = category.id;
    const [serviceRow] = await q(
      `INSERT INTO services (category_id,name_ar,slug,pricing_model,base_price_cents) VALUES ($1,$2,$3,'fixed',10000) RETURNING id`,
      [ids.category, `خدمة مشروع ${runId}`, `proj-svc-${runId}`],
    );
    ids.service = serviceRow.id;

    const [customerUser] = await q(`INSERT INTO users (phone_number,full_name,user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [`+2070${runId}`.slice(0, 15), `عميل مشروع ${runId}`]);
    ids.customerUser = customerUser.id;
    const [profile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customerUser]);
    ids.customerProfile = profile.id;
    const [otherUser] = await q(`INSERT INTO users (phone_number,full_name,user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [`+2080${runId}`.slice(0, 15), `عميل آخر ${runId}`]);
    ids.otherUser = otherUser.id;
    const [otherProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.otherUser]);
    ids.otherProfile = otherProfile.id;
    const [addr] = await q(
      `INSERT INTO addresses (user_id,city_id,street_name,location)
       VALUES ($1,$2,$3, ST_SetSRID(ST_MakePoint(31.25,30.05),4326)::geography) RETURNING id`,
      [ids.customerUser, ids.city, `شارع مشروع ${runId}`],
    );
    ids.address = addr.id;

    const [admin] = await q(`INSERT INTO users (phone_number,full_name,user_type,phone_verified_at) VALUES ($1,$2,'admin',now()) RETURNING id`,
      [`+2060${runId}`.slice(0, 15), `أدمن مشروع ${runId}`]);
    ids.adminUser = admin.id;

    auditLog = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditLogService;
    projectsService = new ProjectsService(dataSource.getRepository(Project), dataSource.getRepository(ProjectQuote), dataSource.getRepository(ProjectMilestone), dataSource, auditLog);
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      if (ids.project) {
        await q(`DELETE FROM project_milestones WHERE project_id=$1`, [ids.project]);
        await q(`UPDATE project_quotes SET status='rejected' WHERE project_id=$1 AND status IN ('sent','approved')`, [ids.project]);
        await q(`DELETE FROM project_quotes WHERE project_id=$1`, [ids.project]);
        await q(`DELETE FROM projects WHERE id=$1`, [ids.project]);
      }
      await q(`DELETE FROM orders WHERE customer_id=$1`, [ids.customerProfile]);
      await q(`DELETE FROM addresses WHERE id=$1`, [ids.address]);
      await q(`DELETE FROM customer_profiles WHERE id IN ($1,$2)`, [ids.customerProfile, ids.otherProfile]);
      await q(`DELETE FROM users WHERE id IN ($1,$2,$3)`, [ids.customerUser, ids.adminUser, ids.otherUser]);
      await q(`DELETE FROM services WHERE id=$1`, [ids.service]);
      await q(`DELETE FROM service_categories WHERE id=$1`, [ids.category]);
      await q(`DELETE FROM service_zones WHERE id=$1`, [ids.zone]);
      await q(`DELETE FROM cities WHERE id=$1`, [ids.city]);
    } finally {
      await dataSource.destroy();
    }
  });

  it('إنشاء مشروع: رقم قابل للقراءة + حالة survey_requested', async () => {
    const idempotencyKey = `project-create-${runId}`;
    const project = await projectsService.create(ids.customerUser, {
      project_type: 'finishing',
      name_ar: `تشطيب شقة ${runId}`,
      description_ar: `وصف العميل الكامل ${runId}`,
      address_id: ids.address,
      budget_estimate_cents: 500_000,
    }, undefined, idempotencyKey);
    ids.project = project.id;
    expect(project.projectNumber).toMatch(/^PRJ-/);
    expect(project.status).toBe('survey_requested');
    expect(project.budgetEstimateCents).toBe(500000);
    const replay = await projectsService.create(ids.customerUser, {
      project_type: 'finishing',
      name_ar: 'اسم مختلف لا يجب أن ينشئ مشروعًا ثانيًا',
      address_id: ids.address,
    }, undefined, idempotencyKey);
    expect(replay.id).toBe(project.id);
    const [{ count: projectCount }] = await q<{ count: string }[]>(
      `SELECT COUNT(*)::text AS count FROM projects WHERE customer_id=$1 AND idempotency_key=$2`,
      [ids.customerProfile, idempotencyKey],
    );
    expect(Number(projectCount)).toBe(1);
    await expect(projectsService.findOneOwned(ids.otherUser, project.id)).rejects.toMatchObject({ code: 'VAL_001' });

    const page = await projectsService.listAll(1, 1);
    expect(page.items).toHaveLength(1);
    expect(page.items[0].id).toBe(project.id);
    expect(page.meta).toMatchObject({ page: 1, per_page: 1 });
    expect(page.meta.total).toBeGreaterThanOrEqual(1);
  });

  it('ضغطتان متزامنتان بنفس مفتاح الإنشاء تنتجان مشروعًا واحدًا', async () => {
    const idempotencyKey = `project-concurrent-${runId}`;
    const createAttempt = () => projectsService.create(ids.customerUser, {
      project_type: 'renovation',
      name_ar: `مشروع متزامن ${runId}`,
      address_id: ids.address,
    }, undefined, idempotencyKey);

    const [first, second] = await Promise.all([createAttempt(), createAttempt()]);
    expect(second.id).toBe(first.id);

    const [{ count }] = await q<{ count: string }[]>(
      `SELECT COUNT(*)::text AS count FROM projects WHERE customer_id=$1 AND idempotency_key=$2`,
      [ids.customerProfile, idempotencyKey],
    );
    expect(Number(count)).toBe(1);
    await q(`DELETE FROM projects WHERE id=$1`, [first.id]);
  });

  it('انتقال صحيح حتى تحضير العرض، وانتظار موافقة العميل لا يبدأ إلا بإرسال عرض', async () => {
    let p = await projectsService.transition(ids.adminUser, ids.project, 'survey_scheduled');
    expect(p.status).toBe('survey_scheduled');
    p = await projectsService.transition(ids.adminUser, ids.project, 'quote_preparing');
    expect(p.status).toBe('quote_preparing');
    await expect(projectsService.transition(ids.adminUser, ids.project, 'awaiting_customer_approval'))
      .rejects.toMatchObject({ status: 409 });
  });

  it('عرض سعر v1: إنشاء وإرسال واعتماد — المجاميع محسوبة من الباك-إند', async () => {
    const quote = await projectsService.createQuote(ids.adminUser, ids.project, {
      work_lines: [
        { description_ar: 'دهان الحوائط', quantity: 100, unit: 'متر', unit_price_cents: 5000 },
        { description_ar: 'تركيب الجبس', quantity: 20, unit: 'متر', unit_price_cents: 3000 },
      ],
      material_lines: [
        { description_ar: 'خامات الدهان', responsibility: 'provider_supplied', quantity: 50, unit: 'لتر', unit_price_cents: 2000 },
      ],
      scope_included: 'دهان + جبس + سباكة',
      duration_days: 45,
    });
    // work=100×5000+20×3000=560,000 | materials=50×2000=100,000 | total=660,000
    expect(quote.totalWorkCents).toBe(560000);
    expect(quote.totalMaterialsCents).toBe(100000);
    expect(quote.totalCents).toBe(660000);
    expect(quote.workLines[0]).toMatchObject({ description_ar: 'دهان الحوائط', unit: 'متر' });
    expect(quote.materialLines[0]).toMatchObject({ description_ar: 'خامات الدهان', responsibility: 'provider_supplied' });

    const sent = await projectsService.sendQuote(ids.adminUser, quote.id, 14, ids.project);
    expect(sent.status).toBe('sent');
    await expect(projectsService.transition(ids.adminUser, ids.project, 'awaiting_deposit'))
      .rejects.toMatchObject({ status: 409 });

    await expect(projectsService.approveQuote(ids.otherUser, quote.id)).rejects.toMatchObject({ code: 'VAL_001' });

    const approved = await projectsService.approveQuote(ids.customerUser, quote.id);
    expect(approved.status).toBe('awaiting_deposit');
    expect(approved.approvedQuoteTotalCents).toBe(660000);
    expect(approved.totalWorkValueCents).toBe(560000);
    expect(approved.totalMaterialsValueCents).toBe(100000);

    const room = await projectsService.getProjectRoom(ids.project);
    expect(room.project).toMatchObject({
      id: ids.project,
      description_ar: `وصف العميل الكامل ${runId}`,
      budget_estimate_cents: 500_000,
      status: 'awaiting_deposit',
    });
    expect(room.quotes[0]).toMatchObject({
      status: 'approved',
      work_lines: expect.arrayContaining([
        expect.objectContaining({ description_ar: 'دهان الحوائط', quantity: 100 }),
      ]),
      material_lines: expect.arrayContaining([
        expect.objectContaining({ description_ar: 'خامات الدهان', responsibility: 'provider_supplied' }),
      ]),
      scope_included: 'دهان + جبس + سباكة',
      duration_days: 45,
      approved_by_name: `عميل مشروع ${runId}`,
    });
    expect(room.quotes[0].sent_at).toBeTruthy();
    expect(room.quotes[0].approved_at).toBeTruthy();
    expect(room.activity).toEqual(expect.any(Array));
  });

  it('العرض المعتمد غير قابل للتعديل — نسخة جديدة بس', async () => {
    const quotes = await projectsService.listQuotesForProject(ids.project);
    const sent = quotes.find((q2) => q2.status === 'sent');
    expect(sent).toBeUndefined(); // مفيش عرض تاني في حالة sent بعد الاعتماد
    expect(quotes.filter((q2) => q2.version === 1)[0].status).toBe('approved');
  });

  it('مراحل: إنشاء 3 مراحل مجموعها = قيمة العرض المعتمد بالظبط', async () => {
    const auditRecord = auditLog.record as jest.MockedFunction<AuditLogService['record']>;
    auditRecord.mockRejectedValueOnce(new Error('audit unavailable'));
    await expect(projectsService.createMilestones(ids.adminUser, ids.project, [
      { name_ar: 'عربون', amount_cents: 100000 },
      { name_ar: 'تأسيس', amount_cents: 200000 },
      { name_ar: 'تشطيبات نهائية', amount_cents: 360000 },
    ])).rejects.toThrow('audit unavailable');
    const [{ count }] = await q<{ count: string }[]>(`SELECT COUNT(*)::text AS count FROM project_milestones WHERE project_id=$1`, [ids.project]);
    expect(Number(count)).toBe(0);

    const milestones = await projectsService.createMilestones(ids.adminUser, ids.project, [
      { name_ar: 'عربون', amount_cents: 100000 },
      { name_ar: 'تأسيس', amount_cents: 200000 },
      { name_ar: 'تشطيبات نهائية', amount_cents: 360000 },
    ]);
    expect(milestones).toHaveLength(3);
    const total = milestones.reduce((s, m) => s + Number(m.amountCents), 0);
    expect(total).toBe(660000);
  });

  it('مجموع المراحل ≠ العرض: يترفض', async () => {
    await expect(projectsService.createMilestones(ids.adminUser, ids.project, [
      { name_ar: 'غلط', amount_cents: 999999 },
    ])).rejects.toThrow(/اتعملت بالفعل|لا يساوي/);
  });

  it('بوابة إطلاق المستحق: مرحلة مش مكتملة → false، مكتملة + مدفوعة + موافقة → true', async () => {
    const msList = await projectsService.listProjectMilestones(ids.project);
    // مرحلة pending: مينفعش تتطلق
    const releasedPending = await projectsService.releaseMilestonePayout(msList[0].id);
    expect(releasedPending).toBe(false);
    void releasedPending;

    // نحاكي مرحلة اكتملت + اتوافقت + اتحصلت
    const ms = msList[1];
    await q(`UPDATE project_milestones SET execution_status='completed', approval_status='approved', payment_status='paid' WHERE id=$1`, [ms.id]);
    const released = await projectsService.releaseMilestonePayout(ms.id);
    expect(released).toBe(true);

    // إطلاق تاني → false (idempotent)
    const again = await projectsService.releaseMilestonePayout(ms.id);
    expect(again).toBe(false);
  });

  // ── ADR-0036 / docs/08 §57 بند 3 — تسليم مرحلة-مرحلة + كومنتات ──────────────
  // ملحوظة: الاختبار اللي فوق ده كان مضطر يزوّر `execution_status='completed'` بـSQL خام
  // **لأن مفيش دالة كانت بتعمل كده أصلاً** — دي بالظبط الفجوة اللي المالك بلّغ عنها.

  it('كل مرحلة بتتسلّم لوحدها: بدء+تسليم المرحلة الأولى مايلمسش الباقي', async () => {
    const [first, , third] = await projectsService.listProjectMilestones(ids.project);

    await projectsService.startMilestone(ids.adminUser, ids.project, first.id);
    await projectsService.completeMilestone(ids.adminUser, ids.project, first.id, ['projects/proof-1.jpg']);

    const after = await projectsService.listProjectMilestones(ids.project);
    const firstAfter = after.find((m) => m.id === first.id)!;
    expect(firstAfter.executionStatus).toBe('completed');
    expect(firstAfter.proofAttachments).toHaveLength(1);
    // المرحلة التالتة لسه ماتلمستش — ده جوهر "كل فيز تتسلّم على حدة".
    expect(after.find((m) => m.id === third.id)!.executionStatus).toBe('pending');
  });

  it('الترتيب مش مفروض: مرحلة متأخرة تقدر تبدأ من غير ما اللي قبلها تخلص', async () => {
    const [, , third] = await projectsService.listProjectMilestones(ids.project);
    await projectsService.startMilestone(ids.adminUser, ids.project, third.id);
    const after = await projectsService.listProjectMilestones(ids.project);
    expect(after.find((m) => m.id === third.id)!.executionStatus).toBe('in_progress');
  });

  it('الانتقالات الغلط بترفض بوضوح: تسليم قبل البدء، وبدء مرحلة شغّالة', async () => {
    const [, , third] = await projectsService.listProjectMilestones(ids.project);
    await expect(projectsService.startMilestone(ids.adminUser, ids.project, third.id)).rejects.toThrow(/مينفعش تبدأ/);

    const fresh = (await projectsService.listProjectMilestones(ids.project)).find((m) => m.executionStatus === 'pending');
    if (fresh) {
      await expect(
        projectsService.completeMilestone(ids.adminUser, ids.project, fresh.id),
      ).rejects.toThrow(/لازم تبدأها الأول/);
    }
  });

  it('رفض العميل بيرجّع المرحلة in_progress بسبب مكتوب، وإعادة التسليم بترجّع الموافقة pending', async () => {
    const [first] = await projectsService.listProjectMilestones(ids.project);

    await projectsService.rejectMilestone(ids.customerUser, ids.project, first.id, 'الدهان مش متساوي');
    let current = (await projectsService.listProjectMilestones(ids.project)).find((m) => m.id === first.id)!;
    expect(current.approvalStatus).toBe('rejected');
    expect(current.rejectionReason).toBe('الدهان مش متساوي');
    // رجعت in_progress عشان الأدمن يصلّح — الرفض مش نهاية المرحلة.
    expect(current.executionStatus).toBe('in_progress');

    await projectsService.completeMilestone(ids.adminUser, ids.project, first.id);
    current = (await projectsService.listProjectMilestones(ids.project)).find((m) => m.id === first.id)!;
    expect(current.approvalStatus).toBe('pending');
    expect(current.rejectionReason).toBeNull();

    await projectsService.approveMilestone(ids.customerUser, ids.project, first.id);
    current = (await projectsService.listProjectMilestones(ids.project)).find((m) => m.id === first.id)!;
    expect(current.approvalStatus).toBe('approved');
    expect(current.approvedByCustomer).toBe(true);
  });

  it('الرفض من غير سبب بيترفض، وعميل تاني مايقدرش يوافق على مرحلة مش بتاعته', async () => {
    const [first] = await projectsService.listProjectMilestones(ids.project);
    await expect(projectsService.rejectMilestone(ids.customerUser, ids.project, first.id, '   ')).rejects.toThrow(/سبب الرفض/);
    await expect(projectsService.approveMilestone(ids.otherUser, ids.project, first.id)).rejects.toThrow();
  });

  it('كومنتات: كومنت الأدمن المرئي بيوصل للعميل، والداخلي بيتفلتر في SQL', async () => {
    const [first] = await projectsService.listProjectMilestones(ids.project);

    const auditRecord = auditLog.record as jest.MockedFunction<AuditLogService['record']>;
    auditRecord.mockRejectedValueOnce(new Error('simulated comment audit failure'));
    await expect(projectsService.addComment(
      { userId: ids.adminUser, role: 'admin' },
      ids.project,
      { body: 'تعليق لازم يرجع بالكامل عند فشل التدقيق', milestone_id: first.id },
    )).rejects.toThrow('simulated comment audit failure');
    const [{ count: rolledBackCommentCount }] = await q<{ count: string }[]>(
      `SELECT COUNT(*)::text AS count FROM project_comments WHERE project_id = $1 AND body = $2`,
      [ids.project, 'تعليق لازم يرجع بالكامل عند فشل التدقيق'],
    );
    expect(Number(rolledBackCommentCount)).toBe(0);

    await projectsService.addComment({ userId: ids.adminUser, role: 'admin' }, ids.project, {
      body: 'خلصنا تأسيس السباكة، بننتقل للكهربا بكرة',
      milestone_id: first.id,
    });
    await projectsService.addComment({ userId: ids.adminUser, role: 'admin' }, ids.project, {
      body: 'ملاحظة داخلية: نراجع تكلفة الخامات مع المورّد',
      milestone_id: first.id,
      is_visible_to_customer: false,
    });
    await projectsService.addComment({ userId: ids.customerUser, role: 'customer' }, ids.project, {
      body: 'تمام، متابع معاكم',
    });

    const adminRoom = await projectsService.getProjectRoom(ids.project, 'admin');
    const customerRoom = await projectsService.getProjectRoom(ids.project, 'customer');

    const adminMilestone = adminRoom.milestones.find((m: Record<string, unknown>) => m.id === first.id)!;
    const customerMilestone = customerRoom.milestones.find((m: Record<string, unknown>) => m.id === first.id)!;

    // الأدمن بيشوف الاتنين، العميل بيشوف المرئي بس — والفلترة في SQL مش في العرض.
    expect((adminMilestone.comments as unknown[])).toHaveLength(2);
    expect((customerMilestone.comments as Record<string, unknown>[])).toHaveLength(1);
    expect((customerMilestone.comments as Record<string, unknown>[])[0].body).toContain('تأسيس السباكة');
    expect(JSON.stringify(customerRoom)).not.toContain('ملاحظة داخلية');

    // كومنت العميل العام (بلا مرحلة) بيظهر في قائمة كومنتات المشروع مش جوّه المراحل.
    expect((customerRoom.comments as Record<string, unknown>[]).some((c) => c.body === 'تمام، متابع معاكم')).toBe(true);
  });

  it('كومنت فاضي بيترفض، وكومنت على مرحلة مش بتاعة المشروع بيترفض', async () => {
    await expect(
      projectsService.addComment({ userId: ids.adminUser, role: 'admin' }, ids.project, { body: '  ' }),
    ).rejects.toThrow(/فاضي/);
    await expect(
      projectsService.addComment({ userId: ids.adminUser, role: 'admin' }, ids.project, {
        body: 'كومنت',
        milestone_id: '00000000-0000-0000-0000-000000000000',
      }),
    ).rejects.toThrow(/المرحلة غير موجودة/);
  });

  // ── docs/08 §57 بنود 4-5 — الفجوتين اللي المالك قال "مش عارف بتتضاف إزاي" ──

  it('ربط طلب بمشروع من الأدمن: بيظهر في تبويب الطلبات، وطلب عميل تاني بيترفض', async () => {
    const [order] = await q<{ id: string }[]>(
      `INSERT INTO orders (order_number, customer_id, service_id, address_id, service_zone_id,
         order_status, payment_status, total_amount_cents, technician_earning_cents)
       VALUES ($1,$2,$3,$4,$5,'completed','paid',50000,0) RETURNING id`,
      [`PRJLINK-${runId}`.slice(0, 24), ids.customerProfile, ids.service, ids.address, ids.zone],
    );
    const linkable = await projectsService.listLinkableOrders(ids.project);
    expect(linkable).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: order.id, project_id: null }),
    ]));

    const auditRecord = auditLog.record as jest.MockedFunction<AuditLogService['record']>;
    auditRecord.mockRejectedValueOnce(new Error('simulated link audit failure'));
    await expect(
      projectsService.linkOrderToProject(ids.adminUser, ids.project, order.id),
    ).rejects.toThrow('simulated link audit failure');
    const [notLinked] = await q<{ project_id: string | null }[]>(
      `SELECT project_id FROM orders WHERE id = $1`,
      [order.id],
    );
    expect(notLinked.project_id).toBeNull();

    const result = await projectsService.linkOrderToProject(ids.adminUser, ids.project, order.id);
    expect(result).toEqual({ linked: true, already: false });

    const room = await projectsService.getProjectRoom(ids.project, 'admin');
    expect((room.orders as Record<string, unknown>[]).some((o) => o.id === order.id)).toBe(true);

    // نداء تاني idempotent — مش بيرمي ولا بيكرر.
    expect(await projectsService.linkOrderToProject(ids.adminUser, ids.project, order.id)).toEqual({
      linked: true,
      already: true,
    });

    // طلب عميل تاني: تسريب، لازم يترفض.
    const [foreignOrder] = await q<{ id: string }[]>(
      `INSERT INTO orders (order_number, customer_id, service_id, address_id, service_zone_id,
         order_status, payment_status, total_amount_cents, technician_earning_cents)
       VALUES ($1,$2,$3,$4,$5,'completed','paid',50000,0) RETURNING id`,
      [`PRJFRGN-${runId}`.slice(0, 24), ids.otherProfile, ids.service, ids.address, ids.zone],
    );
    await expect(
      projectsService.linkOrderToProject(ids.adminUser, ids.project, foreignOrder.id),
    ).rejects.toThrow(/مش لنفس عميل المشروع/);

    await q(`UPDATE orders SET project_id = NULL WHERE id = $1`, [order.id]);
    await q(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [[order.id, foreignOrder.id]]);
  });

  it('إصدار ضمان على المشروع كله: بيتخزّن بـproject_id وorder_id فاضي، وبيظهر في تبويب الضمانات', async () => {
    const [plan] = await q<{ id: string }[]>(
      `INSERT INTO warranty_plans (slug, name_ar, warranty_type, coverage_months, max_claims, pricing_model, price_value, is_active, version)
       VALUES ($1,$2,'extended_workmanship',24,2,'fixed',0,true,1) RETURNING id`,
      [`prj-warranty-${runId}`, `ضمان تشطيب ${runId}`],
    );

    const auditRecord = auditLog.record as jest.MockedFunction<AuditLogService['record']>;
    auditRecord.mockRejectedValueOnce(new Error('simulated warranty audit failure'));
    await expect(
      projectsService.issueProjectWarranty(ids.adminUser, ids.project, plan.id),
    ).rejects.toThrow('simulated warranty audit failure');
    const [{ count: warrantyCountAfterFailure }] = await q<{ count: string }[]>(
      `SELECT COUNT(*)::text AS count FROM customer_warranties WHERE project_id = $1 AND plan_id = $2`,
      [ids.project, plan.id],
    );
    expect(Number(warrantyCountAfterFailure)).toBe(0);

    const warranty = await projectsService.issueProjectWarranty(ids.adminUser, ids.project, plan.id);
    expect(warranty.project_id).toBe(ids.project);
    expect(Number(warranty.coverage_months)).toBe(24);

    const [row] = await q<{ order_id: string | null; project_id: string }[]>(
      `SELECT order_id, project_id FROM customer_warranties WHERE id = $1`,
      [warranty.id],
    );
    // ضمان المشروع مش مربوط بزيارة واحدة — الجدول بيسمح بده من الأساس.
    expect(row.order_id).toBeNull();
    expect(row.project_id).toBe(ids.project);

    const room = await projectsService.getProjectRoom(ids.project, 'customer');
    expect((room.warranties as Record<string, unknown>[]).some((w) => w.id === warranty.id)).toBe(true);

    await q(`DELETE FROM customer_warranties WHERE id = $1`, [warranty.id]);
    await q(`DELETE FROM warranty_plans WHERE id = $1`, [plan.id]);
  });

  it('خطة ضمان موقوفة أو مش موجودة بترفض الإصدار', async () => {
    await expect(
      projectsService.issueProjectWarranty(ids.adminUser, ids.project, '00000000-0000-0000-0000-000000000000'),
    ).rejects.toThrow(/غير موجودة أو موقوفة/);
  });
});
