import { DataSource } from 'typeorm';
import { CrewEarningsService, DEFAULT_ASSISTANT_SHARE_RATIO } from './crew-earnings.service';
import { OrderEarningShare } from './entities/order-earning-share.entity';
import { Order } from '../orders/entities/order.entity';

// ADR-0040 / docs/08 §63.أ3 — اختبار حي على Postgres حقيقي: هل الحصص بتتحسب بأوزان المستويات
// الحقيقية من `technician_level_config`، وبتتسجّل كـsnapshot، والمجموع = الوعاء بالظبط؟
describe('حصص الطاقم من مستحقات الشغلانة — حي (ADR-0040)', () => {
  jest.setTimeout(30_000);

  let dataSource: DataSource;
  let service: CrewEarningsService;
  const runId = Date.now().toString(36);
  const ids = {
    cityId: '', customerUserId: '', customerId: '', addressId: '', serviceId: '', standardDataId: '', orderId: '',
    leaderUserId: '', leaderId: '', memberUserId: '', memberId: '', assistantUserId: '', assistantId: '',
  };

  async function makeTech(label: string, level: string) {
    const [u] = await dataSource.query(
      `INSERT INTO users (phone_number,full_name,user_type) VALUES ($1,$2,'technician') RETURNING id`,
      [`+2091${label}${runId}`.slice(0, 15), `فني ${label} ${runId}`],
    );
    const [p] = await dataSource.query(
      `INSERT INTO technician_profiles (user_id, technician_code, current_level, verification_status)
       VALUES ($1,$2,$3,'approved') RETURNING id`,
      [u.id, `CS${label}${runId}`.slice(0, 20), level],
    );
    return { userId: u.id as string, techId: p.id as string };
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [OrderEarningShare, Order],
    });
    await dataSource.initialize();
    service = new CrewEarningsService();

    const [country] = await dataSource.query(`SELECT id FROM countries LIMIT 1`);
    const [category] = await dataSource.query(`SELECT id FROM service_categories LIMIT 1`);
    const [city] = await dataSource.query(
      `INSERT INTO cities (country_id,name_ar,name_en,slug,is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [country.id, `مدينة حصص ${runId}`, `ShareCity${runId}`, `share-city-${runId}`],
    );
    ids.cityId = city.id;
    const [cu] = await dataSource.query(
      `INSERT INTO users (phone_number,full_name,user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [`+2092${runId}`.slice(0, 15), `عميل حصص ${runId}`],
    );
    ids.customerUserId = cu.id;
    const [cp] = await dataSource.query(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [cu.id]);
    ids.customerId = cp.id;
    const [addr] = await dataSource.query(
      `INSERT INTO addresses (user_id,city_id,street_name,location)
       VALUES ($1,$2,$3, ST_SetSRID(ST_MakePoint(31.24,30.04),4326)::geography) RETURNING id`,
      [cu.id, ids.cityId, 'شارع الحصص'],
    );
    ids.addressId = addr.id;
    const [svc] = await dataSource.query(
      `INSERT INTO services (category_id,name_ar,slug,pricing_model,base_price_cents,is_active)
       VALUES ($1,$2,$3,'fixed',100000,true) RETURNING id`,
      [category.id, `خدمة حصص ${runId}`, `share-service-${runId}`],
    );
    ids.serviceId = svc.id;
    const [standardData] = await dataSource.query(
      `INSERT INTO service_standard_data
         (service_id, execution_type_ar, unit_ar, technician_daily_wage_cents,
          assistant_daily_wage_cents, productivity_per_day, min_technicians, min_assistants)
       VALUES ($1,'تنفيذ','يوم',50000,20000,1,1,1) RETURNING id`,
      [ids.serviceId],
    );
    ids.standardDataId = standardData.id;

    const leader = await makeTech('L', 'team_leader');
    ids.leaderUserId = leader.userId; ids.leaderId = leader.techId;
    const member = await makeTech('M', 'professional');
    ids.memberUserId = member.userId; ids.memberId = member.techId;
    const assistant = await makeTech('A', 'new');
    ids.assistantUserId = assistant.userId; ids.assistantId = assistant.techId;

    const [order] = await dataSource.query(
      `INSERT INTO orders (order_number,customer_id,address_id,service_id,order_status,payment_method,
                           total_amount_cents,technician_id,booking_mode,standard_data_id,estimated_duration_days,
                           assistant_daily_wage_cents_snapshot)
       VALUES ($1,$2,$3,$4,'work_completed','cash',100000,$5,'team',$6,2,20000) RETURNING id`,
      [`ORD-SHARE-${runId}`, ids.customerId, ids.addressId, ids.serviceId, ids.leaderId, ids.standardDataId],
    );
    ids.orderId = order.id;

    const [admin] = await dataSource.query(`SELECT id FROM users WHERE user_type='admin' LIMIT 1`);
    for (const [techId, type] of [[ids.memberId, 'team_member'], [ids.assistantId, 'assistant']] as const) {
      await dataSource.query(
        `INSERT INTO order_team_members (order_id,technician_id,role_label,member_type,added_by_admin_user_id)
         VALUES ($1,$2,$3,$4,$5)`,
        [ids.orderId, techId, 'تنفيذ', type, admin.id],
      );
    }
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    const q = (sql: string, p?: unknown[]) => dataSource.query(sql, p);
    await q(`DELETE FROM order_earning_shares WHERE order_id = $1`, [ids.orderId]);
    await q(`DELETE FROM order_team_members WHERE order_id = $1`, [ids.orderId]);
    await q(`DELETE FROM orders WHERE id = $1`, [ids.orderId]);
    await q(`DELETE FROM addresses WHERE id = $1`, [ids.addressId]);
    await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerId]);
    await q(`DELETE FROM technician_profiles WHERE id = ANY($1::uuid[])`, [[ids.leaderId, ids.memberId, ids.assistantId]]);
    await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [
      [ids.customerUserId, ids.leaderUserId, ids.memberUserId, ids.assistantUserId],
    ]);
    await q(`DELETE FROM service_standard_data WHERE id = $1`, [ids.standardDataId]);
    await q(`DELETE FROM services WHERE id = $1`, [ids.serviceId]);
    await q(`DELETE FROM cities WHERE id = $1`, [ids.cityId]);
    await dataSource.destroy();
  });

  it('بيجمع القائد + أعضاء الفريق + المساعد بأوزان مستوياتهم الحقيقية من technician_level_config', async () => {
    const order = await dataSource.getRepository(Order).findOneByOrFail({ id: ids.orderId });
    const participants = await service.resolveParticipants(dataSource.manager, order);

    expect(participants).toHaveLength(3);
    const leader = participants.find((p) => p.participantRole === 'leader')!;
    const member = participants.find((p) => p.participantRole === 'team_member')!;
    const assistant = participants.find((p) => p.participantRole === 'assistant')!;
    // الأوزان الافتراضية من migration 0195
    expect(leader.shareWeight).toBeCloseTo(1.6);
    expect(member.shareWeight).toBeCloseTo(1.25);
    // ADR-0043 (docs/08 §66) — المساعد مستواه `new` (وزن 1.00) بس الدور بيضربه في نسبة
    // `crew.assistant_share_ratio`. الخدمة هنا متركّبة من غير SettingsService فبتستخدم
    // الافتراضي 0.65، وده مقصود: الافتراضي لازم يبقى نفسه في الكود والـmigration.
    expect(assistant.shareWeight).toBeCloseTo(1.0 * DEFAULT_ASSISTANT_SHARE_RATIO);
    expect(assistant.assistantBaseWageCents).toBe(40_000);
    expect(assistant.assistantLevelMultiplier).toBeCloseTo(1);
    expect(assistant.assistantTargetCents).toBe(40_000);
  });

  it('**الفجوة اللي اتقفلت**: كل مشارك بياخد حصة فعلية، والمجموع = الوعاء بالظبط', async () => {
    const order = await dataSource.getRepository(Order).findOneByOrFail({ id: ids.orderId });
    const POOL = 85_000; // مستحقات العمّال بعد عمولة المنصة
    const shares = await service.recordShares(dataSource.manager, order, POOL);

    expect(shares).toHaveLength(3);
    // قبل ADR-0040 كان القائد ياخد 85000 والاتنين التانيين صفر.
    expect(shares.every((s) => s.shareCents > 0)).toBe(true);
    expect(shares.reduce((sum, s) => sum + s.shareCents, 0)).toBe(POOL);
    // أجر المساعد: 20,000 يوميًا × يومين × مستوى جديد 1.00.
    const byRole = Object.fromEntries(shares.map((s) => [s.participantRole, s.shareCents]));
    expect(byRole.leader).toBeGreaterThan(byRole.team_member);
    expect(byRole.assistant).toBe(40_000);
    expect(shares.find((s) => s.participantRole === 'assistant')!.calculationMethod).toBe('assistant_level_wage');
  });

  it('الحصص بتتسجّل كـsnapshot بالمستوى والوزن وقت التنفيذ', async () => {
    const rows = await dataSource.getRepository(OrderEarningShare).find({ where: { orderId: ids.orderId } });
    expect(rows).toHaveLength(3);
    const leaderRow = rows.find((r) => r.participantRole === 'leader')!;
    expect(leaderRow.technicianLevel).toBe('team_leader');
    expect(Number(leaderRow.shareWeight)).toBeCloseTo(1.6);
    expect(leaderRow.poolCents).toBe(85_000);
    const assistantRow = rows.find((r) => r.participantRole === 'assistant')!;
    expect(assistantRow.calculationMethod).toBe('assistant_level_wage');
    expect(assistantRow.assistantBaseWageCents).toBe(40_000);
    expect(Number(assistantRow.assistantLevelMultiplier)).toBeCloseTo(1);
    expect(assistantRow.assistantTargetCents).toBe(40_000);
  });

  it('ترقية الفني بعد كده ما بتغيّرش حصة قديمة (snapshot مش حساب حي)', async () => {
    await dataSource.query(`UPDATE technician_profiles SET current_level = 'premium' WHERE id = $1`, [ids.assistantId]);
    const row = await dataSource
      .getRepository(OrderEarningShare)
      .findOneByOrFail({ orderId: ids.orderId, technicianId: ids.assistantId });
    expect(row.technicianLevel).toBe('new');
    // الـsnapshot بيسجّل الوزن الفعّال (وزن المستوى × معامل الدور) — ده الرقم اللي وزّع الفلوس فعلاً.
    expect(Number(row.shareWeight)).toBeCloseTo(1.0 * DEFAULT_ASSISTANT_SHARE_RATIO);
  });

  it('إعادة تنفيذ التسوية (retry) مابتضاعفش الصفوف', async () => {
    const order = await dataSource.getRepository(Order).findOneByOrFail({ id: ids.orderId });
    const retried = await service.recordShares(dataSource.manager, order, 85_000);
    const rows = await dataSource.getRepository(OrderEarningShare).find({ where: { orderId: ids.orderId } });
    expect(rows).toHaveLength(3);
    // المساعد اترقى بعد التسوية في الاختبار السابق، لكن retry لازم يرجع نفس snapshot القديم.
    expect(retried.find((share) => share.participantRole === 'assistant')!.shareCents).toBe(40_000);
    expect(retried.reduce((sum, share) => sum + share.shareCents, 0)).toBe(85_000);
  });
});
