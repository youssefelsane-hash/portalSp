import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { MyWarrantyController } from './my-warranty.controller';
import { AdminWarrantyClaimsController } from './admin-warranty-claims.controller';
import { WarrantyClaim } from './entities/warranty-entities';
import { AuditLogService } from '../audit/audit-log.service';

describe('Warranty claims — ownership and concurrency (PostgreSQL)', () => {
  jest.setTimeout(30_000);
  let dataSource: DataSource;
  let controller: MyWarrantyController;
  let adminController: AdminWarrantyClaimsController;
  let auditLog: AuditLogService;
  let userId: string;
  let customerId: string;
  let warrantyId: string;
  const runId = randomUUID().replaceAll('-', '').slice(0, 12);

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [WarrantyClaim],
    });
    await dataSource.initialize();
    const [user] = await dataSource.query(
      `INSERT INTO users (phone_number,full_name,user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [`+2014${runId}`.slice(0, 14), `Warranty test ${runId}`],
    );
    userId = user.id;
    const [profile] = await dataSource.query(
      `INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`,
      [userId],
    );
    customerId = profile.id;
    const [warranty] = await dataSource.query(
      `INSERT INTO customer_warranties (
         plan_id,plan_version,customer_id,name_ar,warranty_type,price_paid_cents,
         coverage_months,coverage_days,max_claims,starts_at,expires_at
       )
       SELECT id,version,$1,'ضمان اختبار','workmanship',0,1,30,1,now(),now()+interval '30 days'
       FROM warranty_plans WHERE slug='system-service-workmanship' RETURNING id`,
      [customerId],
    );
    warrantyId = warranty.id;
    controller = new MyWarrantyController(dataSource);
    auditLog = { record: jest.fn(async () => undefined) } as unknown as AuditLogService;
    adminController = new AdminWarrantyClaimsController(
      dataSource.getRepository(WarrantyClaim),
      dataSource,
      auditLog,
    );
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    await dataSource.query(`DELETE FROM warranty_claims WHERE warranty_id=$1`, [warrantyId]);
    await dataSource.query(`DELETE FROM customer_warranties WHERE id=$1`, [warrantyId]);
    await dataSource.query(`DELETE FROM customer_profiles WHERE id=$1`, [customerId]);
    await dataSource.query(`DELETE FROM users WHERE id=$1`, [userId]);
    await dataSource.destroy();
  });

  it('allows only one claim when two requests race for the final claim slot', async () => {
    const actor = { sub: userId } as never;
    const attempts = await Promise.allSettled([
      controller.openClaim(actor, warrantyId, { defect_description: 'عيب واضح في تنفيذ الخدمة الأولى' }),
      controller.openClaim(actor, warrantyId, { defect_description: 'عيب واضح في تنفيذ الخدمة الثانية' }),
    ]);
    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === 'rejected')).toHaveLength(1);
    const [state] = await dataSource.query(
      `SELECT claims_used, (SELECT count(*)::integer FROM warranty_claims WHERE warranty_id=$1) AS claim_count
       FROM customer_warranties WHERE id=$1`,
      [warrantyId],
    );
    expect(state.claims_used).toBe(1);
    expect(state.claim_count).toBe(1);
  });

  it('rolls back a warranty decision when its mandatory audit fails', async () => {
    const [claim] = await dataSource.query<{ id: string; status: string }[]>(
      `SELECT id, status::text AS status FROM warranty_claims WHERE warranty_id=$1`,
      [warrantyId],
    );
    expect(claim.status).toBe('open');
    const failure = jest.spyOn(auditLog, 'record').mockRejectedValueOnce(new Error('simulated warranty audit failure'));
    try {
      await expect(adminController.review(
        { sub: userId } as never,
        claim.id,
        { status: 'under_review' },
      )).rejects.toThrow('simulated warranty audit failure');
    } finally {
      failure.mockRestore();
    }
    const [unchanged] = await dataSource.query<{ status: string }[]>(
      `SELECT status::text AS status FROM warranty_claims WHERE id=$1`,
      [claim.id],
    );
    expect(unchanged.status).toBe('open');
  });

  it('enforces the warranty claim state machine', async () => {
    const [claim] = await dataSource.query<{ id: string }[]>(
      `SELECT id FROM warranty_claims WHERE warranty_id=$1`,
      [warrantyId],
    );
    await expect(adminController.review(
      { sub: userId } as never,
      claim.id,
      { status: 'resolved', resolution_notes: 'تم الإصلاح' },
    )).rejects.toMatchObject({ status: 409 });
    const reviewed = await adminController.review(
      { sub: userId } as never,
      claim.id,
      { status: 'under_review' },
    );
    expect(reviewed.status).toBe('under_review');
  });
});
