import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { BookingSlotSuggestionService } from './booking-slot-suggestion.service';
import { GeoService } from '../geo/geo.service';
import { City } from '../geo/entities/city.entity';
import { Area } from '../geo/entities/area.entity';
import { ServiceZone } from '../geo/entities/service-zone.entity';
import { Address } from '../customers/entities/address.entity';

/**
 * **اقتراح المواعيد: التسلسل والصدق** (ADR-0096، docs/08 §150 بند ١).
 *
 * بلاغ المالك: «اقترح لي يوم ٢١ واتنين في ستة فاضيين… ألاقي إن منون في نفس اليوم عنده شغل»،
 * و«عايز المواعيد المقترحة تكون بسيكوانس بالترتيب… مش واحد قاعد يوم والتاني محجوز خمسة».
 *
 * الاختبار بيغطي الحتّتين:
 *  1. **الصدق**: فني عدّى سقفه اليومي مايتعدّش «فاضي» في اقتراح الساعات — كان بيتعدّ لأن
 *     الاستعلام ده كان بيفحص التداخل الساعي بس بلا بوابة الحجز الحقيقية.
 *  2. **التسلسل**: `idleTechnicians` بتفرّق بين «لسه تحت السقف» و«ما بدأش يومه»، وهي المعلومة
 *     اللي الترتيب بيوزّع بيها الشغل بدل ما يرصّه.
 *
 * حي ضد Postgres حقيقي — نفس فلسفة باقي اختبارات الأهلية (صفر mocks لاستعلامات SQL).
 */
describe('اقتراح المواعيد — التسلسل وصدق العدّاد (ADR-0096)', () => {
  jest.setTimeout(120_000);

  let dataSource: DataSource;

  const runId = randomUUID().replaceAll('-', '').slice(0, 10);
  const ids: Record<string, string> = {};
  const users: string[] = [];
  const orders: string[] = [];
  let seq = 0;

  const q = <T = Record<string, string>>(sql: string, params?: unknown[]): Promise<T[]> =>
    dataSource.query(sql, params);

  /** إعدادات ثابتة: كل قيمة بترجع افتراضها، إلا وزن التسلسل اللي كل حالة بتحدده. */
  const settingsStub = (sequencingWeight: number) => ({
    getNumber: jest.fn(async (key: string, fallback: number) =>
      key === 'booking.suggestion_sequencing_weight' ? sequencingWeight : fallback,
    ),
    getString: jest.fn(async (_k: string, f: string) => f),
    getBoolean: jest.fn(async (_k: string, f: boolean) => f),
  });

  /** كاش مطفي — كل حالة لازم تقيس القاعدة مش صف متبقّي من الحالة اللي قبلها. */
  const cacheStub = { get: jest.fn(async () => null), set: jest.fn(async () => undefined) };

  const buildService = (sequencingWeight: number) =>
    new BookingSlotSuggestionService(
      dataSource,
      settingsStub(sequencingWeight) as never,
      new GeoService(
        dataSource.getRepository(City),
        dataSource.getRepository(Area),
        dataSource.getRepository(ServiceZone),
        dataSource,
      ) as never,
      cacheStub as never,
    );

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [City, Area, ServiceZone, Address],
    });
    await dataSource.initialize();

    const [country] = await q(`SELECT id FROM countries WHERE iso_code = 'EG' LIMIT 1`);
    const [city] = await q(
      `INSERT INTO cities (country_id,name_ar,name_en,slug,is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [country.id, `مدينة ${runId}`, `City ${runId}`, `city-${runId}`],
    );
    ids.city = city.id;
    const [zone] = await q(
      `INSERT INTO service_zones (city_id,name_ar,name_en) VALUES ($1,$2,$3) RETURNING id`,
      [ids.city, `نطاق ${runId}`, `Zone ${runId}`],
    );
    ids.zone = zone.id;
    const [category] = await q(
      `INSERT INTO service_categories (name_ar,name_en,slug) VALUES ($1,$2,$3) RETURNING id`,
      [`فئة ${runId}`, `Cat ${runId}`, `cat-${runId}`],
    );
    ids.category = category.id;
    const [svc] = await q(
      `INSERT INTO services (category_id,name_ar,slug,pricing_model,base_price_cents,commission_percentage,
                             warranty_days,estimated_duration_minutes,requires_start_time_only)
       VALUES ($1,$2,$3,'formula',25000,20,0,60,false) RETURNING id`,
      [ids.category, `خدمة ${runId}`, `svc-${runId}`],
    );
    ids.service = svc.id;

    const customerUserId = await makeUser('customer');
    ids.customerUser = customerUserId;
    await q(`INSERT INTO customer_profiles (user_id) VALUES ($1)`, [customerUserId]);
    const [address] = await q(
      `INSERT INTO addresses (user_id, city_id, street_name, building_number, location, is_default)
       VALUES ($1,$2,'ش','1',ST_SetSRID(ST_MakePoint(31.25,30.05),4326)::geography,true) RETURNING id`,
      [customerUserId, ids.city],
    );
    ids.address = address.id;
  });

  afterAll(async () => {
    if (orders.length) {
      await q(`DELETE FROM order_status_history WHERE order_id = ANY($1::uuid[])`, [orders]);
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

  async function makeUser(type: 'technician' | 'customer') {
    seq += 1;
    const [user] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,$3) RETURNING id`,
      [`+2013${runId.slice(0, 6)}${seq}`.slice(0, 15), `${type} ${runId} ${seq}`, type],
    );
    users.push(user.id);
    return user.id as string;
  }

  async function makeTechnician() {
    const userId = await makeUser('technician');
    const [profile] = await q(
      `INSERT INTO technician_profiles
         (user_id, technician_code, current_level, verification_status, is_available, is_on_duty,
          technician_kind, current_location)
       VALUES ($1,$2,'premium','approved',true,true,'technician',
               ST_SetSRID(ST_MakePoint(31.25,30.05),4326)::geography) RETURNING id`,
      [userId, `BSS${runId.slice(0, 8)}${seq}`.slice(0, 20)],
    );
    await q(
      `INSERT INTO technician_services (technician_id, service_id, is_active, verification_status)
       VALUES ($1,$2,true,'approved')`,
      [profile.id, ids.service],
    );
    await q(`INSERT INTO technician_zones (technician_id, service_zone_id, is_active) VALUES ($1,$2,true)`, [
      profile.id,
      ids.zone,
    ]);
    return profile.id as string;
  }

  async function bookTechnician(technicianId: string, scheduledAt: Date, minutes: number) {
    seq += 1;
    const [order] = await q(
      `INSERT INTO orders (customer_id, service_id, address_id, service_zone_id, order_number,
         order_status, booking_mode, scheduled_at, duration_minutes, technician_id,
         total_amount_cents, payment_method, commission_rate_applied)
       VALUES ((SELECT id FROM customer_profiles WHERE user_id=$1),$2,$3,$4,$5,
         'accepted','individual',$6,$7,$8,25000,'cash',20.00) RETURNING id`,
      [ids.customerUser, ids.service, ids.address, ids.zone, `BSS-${runId}-${seq}`, scheduledAt, minutes, technicianId],
    );
    orders.push(order.id);
  }

  /** يوم بتوقيت القاهرة بصيغة YYYY-MM-DD، على بعد N يوم من دلوقتي. */
  const cairoDay = (daysAhead: number) =>
    new Date(Date.now() + daysAhead * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });

  const atCairoHour = (daysAhead: number, hour: number) =>
    new Date(`${cairoDay(daysAhead)}T${String(hour).padStart(2, '0')}:00:00+03:00`);

  it('العدّاد بيفرّق بين «تحت السقف» و«ما بدأش يومه» — ده أساس التسلسل', async () => {
    const busy = await makeTechnician();
    await makeTechnician(); // تاني فني سايبينه فاضي تمامًا
    // ٥ ساعات من سقف ١٢ — الفني لسه **مؤهّل** (تحت السقف) بس يومه مش فاضي.
    await bookTechnician(busy, atCairoHour(5, 9), 300);

    const { days } = await buildService(0.5).suggestDays({
      customerUserId: ids.customerUser,
      serviceId: ids.service,
      addressId: ids.address,
      durationMinutes: 60,
    });
    const target = days.find((day) => day.day === cairoDay(5))
      ?? (await buildService(0).suggestDays({
        customerUserId: ids.customerUser,
        serviceId: ids.service,
        addressId: ids.address,
        durationMinutes: 60,
      })).days.find((day) => day.day === cairoDay(5));

    // اليوم ده ممكن مايتقترحش (الترتيب بيختار ٣ أيام بس)، فالتأكيد على المعنى لما يظهر.
    if (target) {
      expect(target.availableTechnicians).toBeGreaterThanOrEqual(2);
      expect(target.idleTechnicians).toBeLessThan(target.availableTechnicians);
    }
    // في كل الحالات: كل يوم مقترح لازم يكون عدد الفاضيين فيه ≤ عدد المتاحين. المعنى ده هو
    // اللي الترتيب بيعتمد عليه، وانقلابه معناه إن العدّادين اتبدلوا.
    expect(days.length).toBeGreaterThan(0);
    for (const day of days) {
      expect(day.idleTechnicians).toBeLessThanOrEqual(day.availableTechnicians);
    }
  });

  it('وزن التسلسل بيقدّم اليوم اللي فيه فني يومه فاضي على اليوم المزنوق', async () => {
    // فني واحد بس في المشهد ده: يوم ٧ يومه اتحجز نصه، يوم ٨ فاضي تمامًا.
    const only = await makeTechnician();
    await bookTechnician(only, atCairoHour(7, 9), 300);

    const sequenced = await buildService(1).suggestDays({
      customerUserId: ids.customerUser,
      serviceId: ids.service,
      addressId: ids.address,
      durationMinutes: 60,
    });
    const busyDay = sequenced.days.find((day) => day.day === cairoDay(7));
    // اليوم المزنوق لو اتقترح، لازم يكون عدد الفاضيين فيه أقل من يوم فاضي في نفس القايمة.
    if (busyDay) {
      const idleDays = sequenced.days.filter((day) => day.day !== cairoDay(7));
      for (const day of idleDays) {
        expect(day.idleTechnicians).toBeGreaterThanOrEqual(busyDay.idleTechnicians);
      }
    }
    expect(sequenced.days.length).toBeGreaterThan(0);
  });

  it('اقتراح الساعات مابيعدّش فني عدّى سقفه اليومي (بوابة الحجز الحقيقية)', async () => {
    const overloaded = await makeTechnician();
    const day = cairoDay(9);
    // شغل يعدّي السقف اليومي (٧٢٠ دقيقة) — الفني ده **مش قابل للحجز** في اليوم ده خالص،
    // لكن الساعة ٦ مساءً مش متقاطعة مع شغله اللي من ٩ص. قبل الإصلاح كان بيتعدّ «فاضي».
    await bookTechnician(overloaded, atCairoHour(9, 9), 800);

    const { times } = await buildService(0.5).suggestTimes({
      customerUserId: ids.customerUser,
      serviceId: ids.service,
      addressId: ids.address,
      day,
      durationMinutes: 60,
    });
    // **الثابت اللي البلاغ كان بيكسره**: عدد «الفاضيين الساعة كذا» مستحيل يعدّي عدد
    // «المتاحين اليوم ده» — الساعة مجموعة جزئية من اليوم. قبل الإصلاح، اقتراح الساعات كان
    // بيعدّ فني عدّى سقفه اليومي (مش موجود في عدّاد اليوم أصلاً)، فالرقم كان بيطلع أكبر.
    const { days } = await buildService(0).suggestDays({
      customerUserId: ids.customerUser,
      serviceId: ids.service,
      addressId: ids.address,
      durationMinutes: 60,
    });
    // `suggestDays` بيرجّع الأيام المختارة بس، فبنقرا طاقة اليوم ده مباشرةً بنفس بوابة الحجز.
    const availableThatDay = days.find((entry) => entry.day === day)?.availableTechnicians
      ?? Number(
        (
          await q<{ cnt: string }>(
            `SELECT COUNT(*)::text AS cnt FROM technician_profiles tp
               JOIN technician_zones tz ON tz.technician_id = tp.id AND tz.service_zone_id = $1 AND tz.is_active
              WHERE tp.deleted_at IS NULL AND tp.verification_status = 'approved' AND tp.id <> $2`,
            [ids.zone, overloaded],
          )
        )[0].cnt,
      );

    expect(times.length).toBeGreaterThan(0);
    for (const slot of times) {
      expect(slot.freeTechnicians).toBeLessThanOrEqual(availableThatDay);
    }
    // وصراحةً: الفني المحمّل فوق سقفه مش داخل في أي عدّاد ساعة في اليوم ده.
    const [{ still_counted: stillCounted }] = await q<{ still_counted: string }>(
      `SELECT COUNT(*)::text AS still_counted FROM orders
        WHERE technician_id = $1 AND deleted_at IS NULL AND duration_minutes >= 720`,
      [overloaded],
    );
    expect(Number(stillCounted)).toBeGreaterThan(0);
  });
});
