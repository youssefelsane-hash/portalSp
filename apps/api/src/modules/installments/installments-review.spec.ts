import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditLogService } from '../audit/audit-log.service';
import { User } from '../auth/entities/user.entity';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { CustomerProfilesService } from '../customers/customer-profiles.service';
import { Address } from '../customers/entities/address.entity';
import { Order } from '../orders/entities/order.entity';
import { InstallmentPlan } from './entities/installment-plan.entity';
import { InstallmentApplication } from './entities/installment-application.entity';
import { InstallmentPlanDocumentRequirement } from './entities/installment-plan-document-requirement.entity';
import { InstallmentsService } from './installments.service';
import { PaymentPolicy, PaymentPolicyAcceptance, PaymentPolicyVersion } from '../payment-policies/entities/payment-policy.entity';
import { PaymentPoliciesService } from '../payment-policies/payment-policies.service';

/**
 * دورة طلب التقسيط والمراجعة (migration 0177) — التقديم **طلب مش موافقة**، الحساب authoritative،
 * والاعتماد البشري بيتنافس بأمان (أدمنين مع بعض = أول واحد يكسب).
 */
describe('InstallmentsService — تقديم/مراجعة/جدولة (PostgreSQL)', () => {
  let dataSource: DataSource;
  let service: InstallmentsService;
  let policiesService: PaymentPoliciesService;
  let auditLog: AuditLogService;
  const runId = randomUUID().replaceAll('-', '').slice(0, 10);
  const ids = {
    customerUser: '',
    customerProfile: '',
    category: '',
    service: '',
    address: '',
    order: '',
    plan: '',
    policyVersion: '',
    adminUser: '',
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function q<T = any>(sql: string, params?: unknown[]): Promise<T> {
    return dataSource.query(sql, params) as Promise<T>;
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [
        User,
        CustomerProfile,
        Address,
        Order,
        InstallmentPlan,
        InstallmentApplication,
        InstallmentPlanDocumentRequirement,
        PaymentPolicy,
        PaymentPolicyVersion,
        PaymentPolicyAcceptance,
      ],
    });
    await dataSource.initialize();

    const [customerUser] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [`+2077${runId}`.slice(0, 15), `عميل تقديم ${runId}`],
    );
    ids.customerUser = customerUser.id;
    const [adminUser] = await q(
      `INSERT INTO users (phone_number, full_name, user_type, phone_verified_at) VALUES ($1,$2,'admin',now()) RETURNING id`,
      [`+2088${runId}`.slice(0, 15), `أدمن مراجعة ${runId}`],
    );
    ids.adminUser = adminUser.id;
    const [profile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customerUser]);
    ids.customerProfile = profile.id;
    const [addr] = await q(
      `INSERT INTO addresses (user_id, street_name, location)
       VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography) RETURNING id`,
      [ids.customerUser, `عنوان تقديم ${runId}`],
    );
    ids.address = addr.id;
    const [category] = await q(
      `INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`,
      [`فئة تقديم ${runId}`, `Sub Cat ${runId}`, `sub-cat-${runId}`],
    );
    ids.category = category.id;
    const [serviceRow] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents)
       VALUES ($1,$2,$3,'fixed',500000) RETURNING id`,
      [category.id, `خدمة تقديم ${runId}`, `sub-svc-${runId}`],
    );
    ids.service = serviceRow.id;

    // خطة: تمويل 10% بلا مقدم، 3 أقساط شهرية — مربوطة بالخدمة
    const [plan] = await q(
      `INSERT INTO installment_plans (name_ar, installment_count, interval_days, financing_percentage, down_payment_percentage, requires_saved_card, min_order_amount_cents)
       VALUES ('خطة التقديم 3', 3, 30, 10, 0, false, 100000) RETURNING id`,
    );
    ids.plan = plan.id;
    await q(`INSERT INTO service_installment_plans (service_id, plan_id) VALUES ($1,$2)`, [ids.service, plan.id]);
    await q(
      `INSERT INTO installment_plan_document_requirements (plan_id, doc_type, label_ar) VALUES ($1,'national_id_front','صورة البطاقة')`,
      [plan.id],
    );

    // Category-targeted policy: checkout sends only service_id, so the API must infer its category.
    const [policy] = await q(
      `INSERT INTO payment_policies (slug, title_ar, applies_to, target_category_id, is_required, is_active)
       VALUES ($1,'شروط التقسيط للتحقق','installment',$2,true,true) RETURNING id`,
      [`inst-policy-${runId}`, ids.category],
    );
    const [version] = await q(
      `INSERT INTO payment_policy_versions (policy_id, version, body_ar) VALUES ($1,1,'نص شروط كافي للتحقق من الإصدار الأول') RETURNING id`,
      [policy.id],
    );
    ids.policyVersion = version.id;

    const events = new EventEmitter2();
    auditLog = { record: jest.fn(async () => undefined) } as unknown as AuditLogService;
    policiesService = new PaymentPoliciesService(
      dataSource.getRepository(PaymentPolicy),
      dataSource.getRepository(PaymentPolicyVersion),
      dataSource.getRepository(PaymentPolicyAcceptance),
      dataSource,
      auditLog,
    );
    service = new InstallmentsService(
      dataSource.getRepository(InstallmentPlan),
      dataSource.getRepository(InstallmentApplication),
      dataSource.getRepository(InstallmentPlanDocumentRequirement),
      dataSource,
      new CustomerProfilesService(dataSource.getRepository(CustomerProfile), dataSource),
      policiesService,
      events,
      auditLog,
      {} as never, // storage — مسارات الرفع مش متغطية هنا (مغطاة في live verify)
    );
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      await q(`DELETE FROM payment_policy_acceptances WHERE context_type='installment_application' AND context_id IN (SELECT id FROM installment_applications WHERE order_id IN (SELECT id FROM orders WHERE address_id=$1))`, [ids.address]);
      await q(`DELETE FROM installments WHERE application_id IN (SELECT id FROM installment_applications WHERE order_id IN (SELECT id FROM orders WHERE address_id=$1))`, [ids.address]);
      await q(`DELETE FROM installment_applications WHERE order_id IN (SELECT id FROM orders WHERE address_id=$1)`, [ids.address]);
      await q(`UPDATE orders SET recurring_template_id = NULL WHERE address_id=$1`, [ids.address]);
      await q(`DELETE FROM orders WHERE address_id=$1`, [ids.address]);
      await q(`DELETE FROM payment_policy_versions WHERE policy_id IN (SELECT id FROM payment_policies WHERE slug='inst-policy-${runId}')`);
      await q(`DELETE FROM payment_policies WHERE slug='inst-policy-${runId}'`);
      await q(`DELETE FROM service_installment_plans WHERE service_id=$1`, [ids.service]);
      await q(`DELETE FROM installment_plan_document_requirements WHERE plan_id=$1`, [ids.plan]);
      await q(`DELETE FROM installment_plans WHERE id=$1`, [ids.plan]);
      await q(`DELETE FROM addresses WHERE id=$1`, [ids.address]);
      await q(`DELETE FROM customer_profiles WHERE id=$1`, [ids.customerProfile]);
      await q(`DELETE FROM users WHERE id IN ($1,$2)`, [ids.customerUser, ids.adminUser]);
      await q(`DELETE FROM services WHERE id=$1`, [ids.service]);
      await q(`DELETE FROM service_categories WHERE id=$1`, [ids.category]);
    } finally {
      await dataSource.destroy();
    }
  });

  async function seedOrder(totalCents: number): Promise<string> {
    const [order] = await q<{ id: string }[]>(
      `INSERT INTO orders (order_number, customer_id, service_id, address_id, order_status, payment_status, total_amount_cents, technician_earning_cents)
       VALUES ($1,$2,$3,$4,'work_completed','unpaid',$5,0) RETURNING id`,
      [`SUB-${randomUUID().slice(0, 12)}`.slice(0, 24), ids.customerProfile, ids.service, ids.address, totalCents],
    );
    return order.id;
  }

  it('تقديم سليم: الحساب authoritative + إثبات القبول اتسجل + الجدولة لسه مش موجودة', async () => {
    const orderId = await seedOrder(500_000);
    const app = await service.submitApplication({
      userId: ids.customerUser,
      orderId,
      planId: ids.plan,
      acceptedPolicyVersionIds: [ids.policyVersion],
    });
    // سعر 500,000 قرش + تمويل 10% = 550,000 — مفيش مقدم → 3 أقساط: 183333×2 + 183334
    expect(app.totalFinancedCents).toBe(550_000);
    expect(app.financingFeeCents).toBe(50_000);
    expect(app.regularInstallmentCents).toBe(183_333);
    expect(app.finalInstallmentCents).toBe(183_334);

    const acceptances = await q<{ count: number }[]>(
      `SELECT COUNT(*)::int AS count FROM payment_policy_acceptances WHERE context_type='installment_application' AND context_id=$1`,
      [app.id],
    );
    expect(Number(acceptances[0].count)).toBe(1);

    // التقديم مش بينشئ جدولة — الموافقة بس
    const [{ count }] = await q<{ count: number }[]>(
      `SELECT COUNT(*)::int AS count FROM installments WHERE application_id=$1`,
      [app.id],
    );
    expect(Number(count)).toBe(0);
  });

  it('تقديم تاني على نفس الطلب وهو pending: يترفض 409', async () => {
    const orderId = await seedOrder(500_000);
    await service.submitApplication({
      userId: ids.customerUser,
      orderId,
      planId: ids.plan,
      acceptedPolicyVersionIds: [ids.policyVersion],
    });
    await expect(
      service.submitApplication({
        userId: ids.customerUser,
        orderId,
        planId: ids.plan,
        acceptedPolicyVersionIds: [ids.policyVersion],
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('قبول شروط ناقص/قديم: يترفض من الباك-إند (مش من الواجهة)', async () => {
    const orderId = await seedOrder(500_000);
    await expect(
      service.submitApplication({ userId: ids.customerUser, orderId, planId: ids.plan, acceptedPolicyVersionIds: [] }),
    ).rejects.toMatchObject({ code: 'VAL_001' });
    await expect(
      service.submitApplication({
        userId: ids.customerUser,
        orderId,
        planId: ids.plan,
        acceptedPolicyVersionIds: ['00000000-0000-0000-0000-000000000001'],
      }),
    ).rejects.toMatchObject({ code: 'VAL_001' });
  });

  it('مبلغ أقل من حد الخطة: يترفض', async () => {
    const orderId = await seedOrder(50_000); // تحت min 100,000
    await expect(
      service.submitApplication({
        userId: ids.customerUser,
        orderId,
        planId: ids.plan,
        acceptedPolicyVersionIds: [ids.policyVersion],
      }),
    ).rejects.toMatchObject({ code: 'VAL_001' });
  });

  it('الخطة الظاهرة للعميل تتضمن بوابة الدفع المطلوبة', async () => {
    const plans = await service.listPlansForService(ids.service);
    expect(plans).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: ids.plan, allowed_provider: 'paymob' }),
    ]));
  });

  it('فشل التدقيق يلغي تقديم التقسيط وقبول الشروط ذريًا', async () => {
    const orderId = await seedOrder(500_000);
    const failure = jest.spyOn(auditLog, 'record').mockRejectedValueOnce(new Error('simulated installment audit failure'));
    try {
      await expect(service.submitApplication({
        userId: ids.customerUser,
        orderId,
        planId: ids.plan,
        acceptedPolicyVersionIds: [ids.policyVersion],
      })).rejects.toThrow('simulated installment audit failure');
    } finally {
      failure.mockRestore();
    }
    const [state] = await q<{ applications: number; acceptances: number }[]>(
      `SELECT
         (SELECT count(*)::integer FROM installment_applications WHERE order_id=$1) AS applications,
         (SELECT count(*)::integer FROM payment_policy_acceptances
          WHERE context_type='installment_application'
            AND context_id IN (SELECT id FROM installment_applications WHERE order_id=$1)) AS acceptances`,
      [orderId],
    );
    expect(state).toEqual({ applications: 0, acceptances: 0 });
  });

  it('فشل تدقيق ربط الخطة لا يترك تغييرًا نصف مكتمل', async () => {
    const failure = jest.spyOn(auditLog, 'record').mockRejectedValueOnce(new Error('simulated link audit failure'));
    try {
      await expect(service.setPlanForService(ids.adminUser, ids.service, ids.plan, false))
        .rejects.toThrow('simulated link audit failure');
    } finally {
      failure.mockRestore();
    }
    const [row] = await q<{ linked: boolean }[]>(
      `SELECT EXISTS(SELECT 1 FROM service_installment_plans WHERE service_id=$1 AND plan_id=$2) AS linked`,
      [ids.service, ids.plan],
    );
    expect(row.linked).toBe(true);
  });

  it('نشر نسختين متزامنتين يتسلسل بقفل السياسة', async () => {
    const [policy] = await q<{ id: string }[]>(
      `SELECT id FROM payment_policies WHERE slug=$1`,
      [`inst-policy-${runId}`],
    );
    const [first, second] = await Promise.all([
      policiesService.publishNewVersion(ids.adminUser, policy.id, 'نص شروط جديد كامل للتحقق من التسلسل الأول'),
      policiesService.publishNewVersion(ids.adminUser, policy.id, 'نص شروط جديد كامل للتحقق من التسلسل الثاني'),
    ]);
    expect([first.version, second.version].sort()).toEqual([2, 3]);
    await q(`DELETE FROM payment_policy_versions WHERE policy_id=$1 AND version > 1`, [policy.id]);
  });

  it('فشل تدقيق تعديل السياسة يعيد القيمة الأصلية', async () => {
    const [policy] = await q<{ id: string; title_ar: string }[]>(
      `SELECT id, title_ar FROM payment_policies WHERE slug=$1`,
      [`inst-policy-${runId}`],
    );
    const failure = jest.spyOn(auditLog, 'record').mockRejectedValueOnce(new Error('simulated policy audit failure'));
    try {
      await expect(policiesService.updatePolicyMeta(ids.adminUser, policy.id, { title_ar: 'عنوان لا يجب أن يثبت' }))
        .rejects.toThrow('simulated policy audit failure');
    } finally {
      failure.mockRestore();
    }
    const [unchanged] = await q<{ title_ar: string }[]>(`SELECT title_ar FROM payment_policies WHERE id=$1`, [policy.id]);
    expect(unchanged.title_ar).toBe(policy.title_ar);
  });

  it('اعتماد أدمن: جدولة ذرّية مجموعها = الإجمالي الممول بالظبط — واعتماد تاني متزامن يفشل 409', async () => {
    const orderId = await seedOrder(500_000);
    const app = await service.submitApplication({
      userId: ids.customerUser,
      orderId,
      planId: ids.plan,
      acceptedPolicyVersionIds: [ids.policyVersion],
    });

    // الاختبار كان بيفترض إن النداء الأول هو اللي بيكسب السباق دايمًا (الأول من غير catch)، فلو
    // النظام جدول التاني الأول كانت السويت كلها بتفشل من غير أي علاقة بالكود (§63 شريحة 7).
    // السباق حقيقي بطبيعته — المطلوب إثباته إن **واحد بالظبط** بينجح والتاني بياخد 409، مش مين فيهم.
    const results = await Promise.all([
      service.reviewApplication(ids.adminUser, app.id, { approve: true }).catch((err) => err),
      service.reviewApplication(ids.adminUser, app.id, { approve: true }).catch((err) => err),
    ]);
    const approved = results.filter((r) => r?.status === 'approved');
    const conflicts = results.filter((r) => r?.status === 409);
    expect(approved).toHaveLength(1);
    expect(conflicts).toHaveLength(1);

    const rows = await q<{ sequence_number: number; amount_cents: number }[]>(
      `SELECT sequence_number, amount_cents FROM installments WHERE application_id=$1 ORDER BY sequence_number`,
      [app.id],
    );
    expect(rows.map((r) => r.amount_cents)).toEqual([183_333, 183_333, 183_334]);
    const total = rows.reduce((s, r) => s + Number(r.amount_cents), 0);
    expect(total).toBe(550_000); // الثابت الحاكم
  });

  it('الرفض محتاج سبب — والسبب بيوصل في السجل', async () => {
    const orderId = await seedOrder(500_000);
    const app = await service.submitApplication({
      userId: ids.customerUser,
      orderId,
      planId: ids.plan,
      acceptedPolicyVersionIds: [ids.policyVersion],
    });
    await expect(service.reviewApplication(ids.adminUser, app.id, { approve: false })).rejects.toMatchObject({ code: 'VAL_001' });
    const rejected = await service.reviewApplication(ids.adminUser, app.id, { approve: false, reason: 'المستندات مش واضحة' });
    expect(rejected.status).toBe('rejected');
    expect(rejected.rejectionReason).toContain('مش واضحة');
  });

  it('الرفض بيسمح بإعادة تقديم (الـpartial unique index بيقفل النشطة بس)', async () => {
    const orderId = await seedOrder(500_000);
    const first = await service.submitApplication({
      userId: ids.customerUser,
      orderId,
      planId: ids.plan,
      acceptedPolicyVersionIds: [ids.policyVersion],
    });
    await service.reviewApplication(ids.adminUser, first.id, { approve: false, reason: 'راجع تاني' });
    const resubmitted = await service.submitApplication({
      userId: ids.customerUser,
      orderId,
      planId: ids.plan,
      acceptedPolicyVersionIds: [ids.policyVersion],
    });
    expect(resubmitted.id).not.toBe(first.id);
    expect(resubmitted.status).toBe('pending_review');
  });
});
