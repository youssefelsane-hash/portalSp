import { DataSource } from 'typeorm';
import { ApiException } from '../../common/exceptions/api.exception';
import { Order } from './entities/order.entity';
import { assertNoScheduleOverlap, resolveRescheduledInterval, slotEnd, slotStart } from './order-schedule-interval';
import { TechnicianScheduleSlot } from '../technicians/entities/technician-schedule-slot.entity';

/**
 * فحص التعارض كان **مكتوب مرتين** في `orders.service.ts` بفرقين صامتين — أخطرهم إن مسار
 * الإنشاء كان بيشترط `duration IS NOT NULL`، يعني طلب له **نهاية صريحة بلا مدة** كان بيعدّي
 * كأنه مش موجود، بينما مسار إعادة الجدولة كان بيمسكه. نفس البيانات، إجابتين.
 *
 * الاختبار ده بيثبت إن النسخة الموحّدة بتمسك الحالة دي — على قاعدة حيّة، لأن المنطق كله في SQL.
 */
describe('فترة الموعد وفحص التعارض — نسخة موحّدة (تدقيق A-1، شريحة ٢)', () => {
  jest.setTimeout(30_000);

  let dataSource: DataSource;
  const runId = Date.now().toString(36) + Math.floor(Math.random() * 1e5).toString(36);
  const ids = { city: '', zone: '', category: '', service: '', user: '', profile: '', address: '', technician: '', technicianUser: '', order: '' };
  const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

  // الطلب الموجود: 10:00 → 12:00 بنهاية صريحة و**بلا** أي مدة.
  const existingStart = new Date('2027-03-10T10:00:00Z');
  const existingEnd = new Date('2027-03-10T12:00:00Z');

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [],
    });
    await dataSource.initialize();

    const [country] = await q(`SELECT id FROM countries ORDER BY created_at ASC LIMIT 1`);
    const [city] = await q(`INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`, [
      country.id, `مدينة تعارض ${runId}`, `Overlap City ${runId}`, `test-ovl-city-${runId}`,
    ]);
    ids.city = city.id;
    const [zone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city, `نطاق تعارض ${runId}`, `Overlap Zone ${runId}`,
    ]);
    ids.zone = zone.id;
    const [category] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة تعارض ${runId}`, `Overlap Cat ${runId}`, `test-ovl-cat-${runId}`,
    ]);
    ids.category = category.id;
    const [svc] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents) VALUES ($1,$2,$3,'formula',10000) RETURNING id`,
      [ids.category, `خدمة تعارض ${runId}`, `test-ovl-svc-${runId}`],
    );
    ids.service = svc.id;
    const [techUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [
      `+2037${runId}`.slice(0, 14), `فني تعارض ${runId}`,
    ]);
    ids.technicianUser = techUser.id;
    const [profile] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, current_level, verification_status) VALUES ($1,$2,'new','approved') RETURNING id`,
      [ids.technicianUser, `TOVL${runId}`.slice(0, 20)],
    );
    ids.technician = profile.id;
    const [user] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`, [
      `+2038${runId}`.slice(0, 14), `عميل تعارض ${runId}`,
    ]);
    ids.user = user.id;
    const [cp] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.user]);
    ids.profile = cp.id;
    const [addr] = await q(
      `INSERT INTO addresses (user_id, street_name, location) VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography) RETURNING id`,
      [ids.user, `شارع تعارض ${runId}`],
    );
    ids.address = addr.id;

    const [order] = await q(
      `INSERT INTO orders (order_number, customer_id, service_id, address_id, service_zone_id, order_status, total_amount_cents,
                           booking_mode, order_type, technician_id, scheduled_at, scheduled_end_at)
       VALUES ($1,$2,$3,$4,$5,'accepted',0,'individual','scheduled',$6,$7::timestamptz,$8::timestamptz) RETURNING id`,
      [`TOVL-${runId}`.slice(0, 24), ids.profile, ids.service, ids.address, ids.zone, ids.technician,
       existingStart.toISOString(), existingEnd.toISOString()],
    );
    ids.order = order.id;
  }, 30000);

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      await q(`DELETE FROM orders WHERE id = $1`, [ids.order]);
      await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
      await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.profile]);
      await q(`DELETE FROM technician_profiles WHERE id = $1`, [ids.technician]);
      await q(`DELETE FROM users WHERE id = ANY($1)`, [[ids.user, ids.technicianUser]]);
      await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
      await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
      await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
      await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    } finally {
      await dataSource.destroy();
    }
  }, 20000);

  const msg = (n: string) => `تعارض مع ${n}`;

  it('طلب له نهاية صريحة بلا مدة **بيتحسب** تعارضًا — ده اللي مسار الإنشاء كان بيفوّته', async () => {
    await expect(
      assertNoScheduleOverlap(
        dataSource,
        { technicianId: ids.technician, startsAt: new Date('2027-03-10T11:00:00Z'), endsAt: new Date('2027-03-10T13:00:00Z') },
        msg,
      ),
    ).rejects.toBeInstanceOf(ApiException);
  });

  it('فترة مجاورة بلا تداخل حقيقي بتعدّي (نصف مفتوح: النهاية = بداية التانية)', async () => {
    await expect(
      assertNoScheduleOverlap(
        dataSource,
        { technicianId: ids.technician, startsAt: new Date('2027-03-10T12:00:00Z'), endsAt: new Date('2027-03-10T13:00:00Z') },
        msg,
      ),
    ).resolves.toBeUndefined();
  });

  it('الطلب مابيتعارضش مع نفسه لما يتستثنى (مسار إعادة الجدولة)', async () => {
    await expect(
      assertNoScheduleOverlap(
        dataSource,
        {
          technicianId: ids.technician,
          startsAt: new Date('2027-03-10T11:00:00Z'),
          endsAt: new Date('2027-03-10T13:00:00Z'),
          excludeOrderId: ids.order,
        },
        msg,
      ),
    ).resolves.toBeUndefined();
  });

  it('طلب ملغي مابيحجزش وقت الفني', async () => {
    await q(`UPDATE orders SET order_status = 'cancelled_by_customer' WHERE id = $1`, [ids.order]);
    await expect(
      assertNoScheduleOverlap(
        dataSource,
        { technicianId: ids.technician, startsAt: new Date('2027-03-10T11:00:00Z'), endsAt: new Date('2027-03-10T13:00:00Z') },
        msg,
      ),
    ).resolves.toBeUndefined();
    await q(`UPDATE orders SET order_status = 'accepted' WHERE id = $1`, [ids.order]);
  });

  describe('حساب الفترة الجديدة', () => {
    const slot = { slotDate: '2027-04-01', startTime: '09:00:00', endTime: '17:00:00' } as TechnicianScheduleSlot;

    it('بداية/نهاية السلوت بتتقروا UTC', () => {
      expect(slotStart(slot).toISOString()).toBe('2027-04-01T09:00:00.000Z');
      expect(slotEnd(slot).toISOString()).toBe('2027-04-01T17:00:00.000Z');
    });

    it('بلا نهاية صريحة: نفس مدة الموعد القديم بتتنقل للبداية الجديدة', () => {
      const order = {
        scheduledAt: existingStart,
        scheduledEndAt: existingEnd,
        durationMinutes: null,
        durationHours: null,
      } as unknown as Order;
      const result = resolveRescheduledInterval(order, new Date('2027-04-01T09:00:00Z'));
      expect(result.scheduledEndAt?.toISOString()).toBe('2027-04-01T11:00:00.000Z');
      expect(result.durationMinutes).toBe(120);
    });

    it('نهاية صريحة على طلب مالوش نهاية أصلًا بترفض', () => {
      const order = { scheduledAt: existingStart, scheduledEndAt: null, durationMinutes: 60, durationHours: null } as unknown as Order;
      expect(() => resolveRescheduledInterval(order, new Date('2027-04-01T09:00:00Z'), '2027-04-01T10:00:00Z')).toThrow(ApiException);
    });

    it('مدة سالبة (نهاية قبل البداية) بترفض', () => {
      const order = { scheduledAt: existingStart, scheduledEndAt: existingEnd, durationMinutes: null, durationHours: null } as unknown as Order;
      expect(() => resolveRescheduledInterval(order, new Date('2027-04-01T12:00:00Z'), '2027-04-01T09:00:00Z')).toThrow(ApiException);
    });
  });
});
