import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { AuditLogService } from '../audit/audit-log.service';
import { DomesticWorkersService } from './domestic-workers.service';
import { DomesticWorkerProfile } from './entities/domestic-worker-profile.entity';
import { DomesticWorkerBooking, DomesticWorkerBookingStatus, DomesticWorkerBookingType } from './entities/domestic-worker-booking.entity';
import { Order, OrderStatus, OrderPaymentStatus, BookingMode, OrderType, OrderSourceChannel } from '../orders/entities/order.entity';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { ServiceCategory } from '../catalog/entities/service-category.entity';
import { Service } from '../catalog/entities/service.entity';

/**
 * ADR-0030 — DomesticWorkersService.assertNoSchedulingConflict(): كانت فجوة صحة بيانات حقيقية
 * (صفر فحص تعارض من أي نوع قبل كده). الاختبار ده بيغطي:
 * 1. hourly جديد بيتقاطع مع hourly قديم (domestic_worker_bookings) موجود: يترفض.
 * 2. hourly جديد بره وقت حجز قديم موجود (زمن مختلف تمامًا): يعدّي عادي.
 * 3. hourly جديد بيتقاطع مع طلب unified orders موجود (domesticWorkerProfileId): يترفض — المسار
 *    الجديد بيتفحص برضو، مش القديم بس.
 * 4. monthly_live_in جديد (نطاق مفتوح) بيتعارض مع hourly مستقبلي موجود: يترفض.
 * 5. حجز ملغي (cancelled) مايتحسبش تعارض خالص.
 */
describe('DomesticWorkersService.assertNoSchedulingConflict() — فحص تعارض جدولي حقيقي (ADR-0030)', () => {
  let dataSource: DataSource;
  let service: DomesticWorkersService;
  const runId = randomUUID().replaceAll('-', '').slice(0, 12);
  const ids = { workerUser: '', worker: '', customerUser: '', customerProfile: '', category: '', wrService: '', address: '', city: '', country: '' };

  const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [DomesticWorkerProfile, DomesticWorkerBooking, Order, CustomerProfile, ServiceCategory, Service],
    });
    await dataSource.initialize();

    const [country] = await q(`SELECT id FROM countries WHERE iso_code = 'EG' LIMIT 1`);
    ids.country = country.id;
    const [city] = await q(
      `INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [ids.country, `مدينة تعارض ${runId}`, `Conflict City ${runId}`, `conflict-city-${runId}`],
    );
    ids.city = city.id;

    const [workerUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'domestic_worker') RETURNING id`, [
      `+2039${runId}`.slice(0, 15),
      `شغالة تعارض ${runId}`,
    ]);
    ids.workerUser = workerUser.id;
    const [worker] = await q(
      `INSERT INTO domestic_worker_profiles (user_id, worker_code, hourly_rate_cents, monthly_rate_cents, verification_status)
       VALUES ($1,$2,8000,500000,'approved') RETURNING id`,
      [ids.workerUser, `DWC-${runId}`],
    );
    ids.worker = worker.id;

    const [customerUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`, [
      `+2040${runId}`.slice(0, 15),
      `عميل تعارض ${runId}`,
    ]);
    ids.customerUser = customerUser.id;
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customerUser]);
    ids.customerProfile = customerProfile.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, city_id, street_name, location)
       VALUES ($1,$2,$3, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography) RETURNING id`,
      [ids.customerUser, ids.city, `شارع تعارض ${runId}`],
    );
    ids.address = address.id;

    const [category] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة تعارض ${runId}`,
      `Conflict Category ${runId}`,
      `test-category-conflict-${runId}`,
    ]);
    ids.category = category.id;
    const [wrService] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents) VALUES ($1,$2,$3,'worker_rate',0) RETURNING id`,
      [ids.category, `خدمة تعارض ${runId}`, `test-service-conflict-${runId}`],
    );
    ids.wrService = wrService.id;

    service = new DomesticWorkersService(dataSource.getRepository(DomesticWorkerProfile), { record: async () => undefined } as unknown as AuditLogService);
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      await q(`DELETE FROM orders WHERE customer_id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM domestic_worker_bookings WHERE worker_id = $1`, [ids.worker]);
      await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
      await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM users WHERE id = $1`, [ids.customerUser]);
      await q(`DELETE FROM domestic_worker_profiles WHERE id = $1`, [ids.worker]);
      await q(`DELETE FROM users WHERE id = $1`, [ids.workerUser]);
      await q(`DELETE FROM services WHERE id = $1`, [ids.wrService]);
      await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
      await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    } finally {
      await dataSource.destroy();
    }
  });

  async function insertLegacyBooking(scheduledAt: Date, durationHours: number | null, type: DomesticWorkerBookingType, status = DomesticWorkerBookingStatus.CONFIRMED) {
    const [{ next_human_readable_number: bookingNumber }] = await q("SELECT next_human_readable_number('DWB')");
    await q(
      `INSERT INTO domestic_worker_bookings (booking_number, customer_id, worker_id, address_id, specialty, booking_type, scheduled_at, duration_hours, price_cents, status)
       VALUES ($1,$2,$3,$4,'cleaning_hourly',$5,$6,$7,10000,$8)`,
      [bookingNumber, ids.customerProfile, ids.worker, ids.address, type, scheduledAt, durationHours, status],
    );
  }

  async function insertUnifiedOrder(scheduledAt: Date, durationHours: number, status = OrderStatus.ACCEPTED) {
    const [{ next_human_readable_number: orderNumber }] = await q("SELECT next_human_readable_number('ORD')");
    await dataSource.getRepository(Order).save(
      dataSource.getRepository(Order).create({
        orderNumber,
        customerId: ids.customerProfile,
        serviceId: ids.wrService,
        addressId: ids.address,
        orderType: OrderType.STANDARD,
        bookingMode: BookingMode.INDIVIDUAL,
        orderStatus: status,
        scheduledAt,
        domesticWorkerProfileId: ids.worker,
        domesticWorkerDurationHours: durationHours,
        totalAmountCents: 10000,
        paymentStatus: OrderPaymentStatus.UNPAID,
        placedAt: new Date(),
        sourceChannel: OrderSourceChannel.CUSTOMER_APP,
      }),
    );
  }

  it('hourly جديد بيتقاطع مع hourly قديم (domestic_worker_bookings) موجود: يترفض', async () => {
    const start = new Date('2027-03-10T10:00:00Z');
    await insertLegacyBooking(start, 3, DomesticWorkerBookingType.HOURLY);
    // نطاق جديد يتقاطع جزئيًا: 11:00-14:00 يتقاطع مع 10:00-13:00
    await expect(service.assertNoSchedulingConflict(ids.worker, new Date('2027-03-10T11:00:00Z'), 3)).rejects.toMatchObject({
      code: 'VAL_001',
    });
  });

  it('hourly جديد بره وقت حجز قديم موجود (زمن مختلف تمامًا): يعدّي عادي', async () => {
    await expect(service.assertNoSchedulingConflict(ids.worker, new Date('2027-03-11T10:00:00Z'), 2)).resolves.toBeUndefined();
  });

  it('hourly جديد بيتقاطع مع طلب unified orders موجود: يترفض', async () => {
    const start = new Date('2027-04-05T09:00:00Z');
    await insertUnifiedOrder(start, 4);
    await expect(service.assertNoSchedulingConflict(ids.worker, new Date('2027-04-05T10:00:00Z'), 2)).rejects.toMatchObject({
      code: 'VAL_001',
    });
  });

  it('monthly_live_in جديد (نطاق مفتوح) بيتعارض مع hourly مستقبلي موجود: يترفض', async () => {
    const futureHourly = new Date('2027-06-01T10:00:00Z');
    await insertLegacyBooking(futureHourly, 2, DomesticWorkerBookingType.HOURLY);
    await expect(service.assertNoSchedulingConflict(ids.worker, new Date('2027-05-01T00:00:00Z'), null)).rejects.toMatchObject({
      code: 'VAL_001',
    });
  });

  it('حجز ملغي (cancelled) مايتحسبش تعارض خالص', async () => {
    const start = new Date('2027-07-01T10:00:00Z');
    await insertLegacyBooking(start, 3, DomesticWorkerBookingType.HOURLY, DomesticWorkerBookingStatus.CANCELLED);
    await expect(service.assertNoSchedulingConflict(ids.worker, start, 3)).resolves.toBeUndefined();
  });
});
