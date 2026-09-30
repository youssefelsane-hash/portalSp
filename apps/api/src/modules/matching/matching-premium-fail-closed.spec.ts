import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { MatchingService } from './matching.service';
import { Order } from '../orders/entities/order.entity';
import { OrderStatusHistory } from '../orders/entities/order-status-history.entity';
import { OrderAssignment } from './entities/order-assignment.entity';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { TechnicianAssignmentGuardService } from '../technicians/technician-assignment-guard.service';
import { TechnicianWorkOpportunitiesService } from '../technicians/technician-work-opportunities.service';
import { LevelPremiumService } from '../pricing/level-premium.service';

/**
 * **فرق الفني المميّز: قاعدة واحدة في كل مسارات التعيين** (docs/08 §188).
 *
 * التأكيد التلقائي كان بيبلع فشل حساب الفرق ويكمّل التعيين **بسعر ناقص**، بينما قبول الفني
 * بنفسه (`accept()`) بيعمل rollback على نفس الفشل. يعني «اتعيّن فني مميّز» كان ليها نتيجتين
 * حسب المسار. دلوقتي الفشل بيفشّل التعيين في الاتنين، والطلب بيفضل بيدوّر والـsweep بيعيد.
 *
 * **الضابط جزء أصيل من الاختبار**: من غيره، «الطلب مااتعيّنش» ممكن يعدّي لأي سبب تاني خالص
 * (الفني مش مؤهّل، الموعد غلط…). الضابط بيثبت إن نفس السيناريو بالظبط بيتعيّن لما الفرق ينجح.
 */
describe('فرق الفني المميّز fail-closed في التأكيد التلقائي (§188)', () => {
  jest.setTimeout(120_000);

  let dataSource: DataSource;
  const runId = randomUUID().replaceAll('-', '').slice(0, 10);
  const ids: Record<string, string> = {};
  const users: string[] = [];
  const orders: string[] = [];
  let seq = 0;

  const q = <T = Record<string, string>>(sql: string, params?: unknown[]): Promise<T[]> =>
    dataSource.query(sql, params);

  /** نفس تركيب `company-member-availability.spec.ts` بالحرف — بس الفرق مُحقَن. */
  const buildMatching = (premium: LevelPremiumService) =>
    new MatchingService(
      dataSource.getRepository(OrderAssignment),
      dataSource.getRepository(Order),
      dataSource,
      {} as never,
      new TechnicianAssignmentGuardService({ getNumber: jest.fn(async (_k: string, f: number) => f) } as never),
      {
        getNumber: jest.fn(async (_k: string, f: number) => f),
        getString: jest.fn(async (_k: string, f: string) => f),
        getBoolean: jest.fn(async (_k: string, f: boolean) => f),
      } as never,
      { emit: jest.fn() } as never,
      { add: jest.fn().mockResolvedValue(undefined) } as never,
      new TechnicianWorkOpportunitiesService(dataSource),
      premium,
    );

  const premiumStub = (behaviour: 'ok' | 'throws') =>
    ({
      applyOnAutoAssignment: async () => {
        if (behaviour === 'throws') throw new Error('صف تسعير المستوى مش موجود');
        return 0;
      },
      applyOnProviderSelection: async () => 0,
      reverseOnProviderLost: async () => 0,
    }) as unknown as LevelPremiumService;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Order, OrderAssignment, OrderStatusHistory, TechnicianProfile],
    });
    await dataSource.initialize();

    const [country] = await q(`SELECT id FROM countries WHERE iso_code = 'EG' LIMIT 1`);
    const [city] = await q(
      `INSERT INTO cities (country_id,name_ar,name_en,slug,is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [country.id, `مدينة ${runId}`, `City ${runId}`, `city-pfc-${runId}`],
    );
    ids.city = city.id;
    const [zone] = await q(
      `INSERT INTO service_zones (city_id,name_ar,name_en) VALUES ($1,$2,$3) RETURNING id`,
      [ids.city, `نطاق ${runId}`, `Zone ${runId}`],
    );
    ids.zone = zone.id;
    const [category] = await q(
      `INSERT INTO service_categories (name_ar,name_en,slug) VALUES ($1,$2,$3) RETURNING id`,
      [`فئة ${runId}`, `Cat ${runId}`, `cat-pfc-${runId}`],
    );
    ids.category = category.id;
    const [service] = await q(
      `INSERT INTO services (category_id,name_ar,slug,pricing_model,base_price_cents,commission_percentage,
                             warranty_days,estimated_duration_minutes,requires_start_time_only,allows_emergency)
       VALUES ($1,$2,$3,'formula',25000,20,0,90,false,false) RETURNING id`,
      [ids.category, `خدمة ${runId}`, `svc-pfc-${runId}`],
    );
    ids.service = service.id;
  });

  afterAll(async () => {
    if (orders.length) {
      await q(`DELETE FROM order_status_history WHERE order_id = ANY($1::uuid[])`, [orders]);
      await q(`DELETE FROM order_assignments WHERE order_id = ANY($1::uuid[])`, [orders]);
      await q(`DELETE FROM technician_work_opportunities WHERE order_id = ANY($1::uuid[])`, [orders]);
      await q(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [orders]);
    }
    if (users.length) {
      const profiles = `(SELECT id FROM technician_profiles WHERE user_id = ANY($1::uuid[]))`;
      await q(`DELETE FROM technician_zones WHERE technician_id IN ${profiles}`, [users]);
      await q(`DELETE FROM technician_services WHERE technician_id IN ${profiles}`, [users]);
      await q(`DELETE FROM technician_profiles WHERE user_id = ANY($1::uuid[])`, [users]);
      await q(`DELETE FROM addresses WHERE user_id = ANY($1::uuid[])`, [users]);
      await q(`DELETE FROM customer_profiles WHERE user_id = ANY($1::uuid[])`, [users]);
      await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [users]);
    }
    await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
    await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
    await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
    await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    await dataSource.destroy();
  });

  const makeUser = async (type: 'technician' | 'customer') => {
    seq += 1;
    const [user] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,$3) RETURNING id`,
      [`+2013${runId.slice(0, 6)}${seq}`.slice(0, 15), `${type} ${runId} ${seq}`, type],
    );
    users.push(user.id);
    return user.id as string;
  };

  /** سيناريو واحد كامل: فني مؤهّل فاضي + طلب مجدول بعيد (مسار التأكيد التلقائي). */
  const runScenario = async (premium: 'ok' | 'throws') => {
    const techUserId = await makeUser('technician');
    const [tech] = await q(
      `INSERT INTO technician_profiles
         (user_id, technician_code, current_level, verification_status, is_available, is_on_duty,
          technician_kind, current_location)
       VALUES ($1,$2,'premium'::technician_level,'approved',true,true,'technician',
               ST_SetSRID(ST_MakePoint(31.25,30.05),4326)::geography) RETURNING id`,
      [techUserId, `PFC${runId.slice(0, 8)}${seq}`.slice(0, 20)],
    );
    await q(
      `INSERT INTO technician_services (technician_id, service_id, is_active, verification_status)
       VALUES ($1,$2,true,'approved')`,
      [tech.id, ids.service],
    );
    await q(`INSERT INTO technician_zones (technician_id, service_zone_id, is_active) VALUES ($1,$2,true)`, [
      tech.id,
      ids.zone,
    ]);

    const customerUserId = await makeUser('customer');
    const [profile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [customerUserId]);
    const [address] = await q(
      `INSERT INTO addresses (user_id, city_id, street_name, building_number, location, is_default)
       VALUES ($1,$2,'ش','1',ST_SetSRID(ST_MakePoint(31.25,30.05),4326)::geography,true) RETURNING id`,
      [customerUserId, ids.city],
    );
    // موعد بعد ٦ أيام — أبعد من عتبة «قريب» (٤٨ ساعة)، فالمسار **تأكيد تلقائي** مش جولات.
    const scheduledAt = new Date(Date.now() + 6 * 86_400_000);
    scheduledAt.setUTCHours(9, 0, 0, 0);
    seq += 1;
    const [order] = await q(
      `INSERT INTO orders (customer_id, service_id, address_id, service_zone_id, order_number,
         order_status, booking_mode, scheduled_at, duration_minutes, total_amount_cents,
         estimated_price_cents, payment_method, commission_rate_applied)
       VALUES ($1,$2,$3,$4,$5,'searching_technician','individual',$6,90,25000,25000,'cash',20.00) RETURNING id`,
      [profile.id, ids.service, address.id, ids.zone, `PFC-${runId}-${seq}`, scheduledAt],
    );
    orders.push(order.id);

    // الفشل المتوقّع بيطلع من الترانزاكشن — المسارات الحقيقية (طابور/مستمع/sweep) بتمسكه.
    await buildMatching(premiumStub(premium))
      .dispatchOrAutoConfirm(order.id)
      .catch(() => undefined);

    const [row] = await q<{ order_status: string; technician_id: string | null }>(
      `SELECT order_status, technician_id FROM orders WHERE id = $1`,
      [order.id],
    );
    const [{ n }] = await q<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM order_assignments WHERE order_id = $1 AND assignment_status = 'accepted'`,
      [order.id],
    );
    return { status: row.order_status, assigned: row.technician_id === tech.id, acceptedRows: Number(n) };
  };

  it('ضابط: الفرق نجح ⇒ الطلب بيتأكّد للفني', async () => {
    expect(await runScenario('ok')).toEqual({ status: 'accepted', assigned: true, acceptedRows: 1 });
  });

  it('الفرق فشل ⇒ مفيش تعيين بسعر ناقص: الطلب بيفضل بيدوّر ومفيش أي أثر جزئي', async () => {
    expect(await runScenario('throws')).toEqual({ status: 'searching_technician', assigned: false, acceptedRows: 0 });
  });
});
