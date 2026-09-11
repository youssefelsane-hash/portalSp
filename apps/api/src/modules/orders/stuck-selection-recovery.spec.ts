import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { ORDER_CREATED_EVENT } from '../../common/events/order-created.event';
import { OrderStatus } from './entities/order.entity';
import { StuckSelectionRecoveryService } from './stuck-selection-recovery.service';

/**
 * **إنقاذ الطلبات العالقة في «مستنيك تختار الفني»** — حي على Postgres حقيقي.
 *
 * بلاغ مالك بلقطة شاشة (`ORD-2026-000301`): الطلب واقف على
 * `awaiting_technician_selection` ومفيش أي حاجة بتحصل. إصلاح الموافقة بيمنع الحالة دي
 * **للطلبات الجديدة**؛ الطلبات اللي وقعت فيها قبل كده محتاجة اللي هنا.
 */
describe('إنقاذ الطلبات العالقة في اختيار الفني — حي', () => {
  jest.setTimeout(60_000);

  const url = process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak';
  let ds: DataSource;
  let service: StuckSelectionRecoveryService;
  let emitter: EventEmitter2;
  const emitted: { event: string; payload: unknown }[] = [];
  const orderIds: string[] = [];
  let seed: { customerProfile: string; address: string; service: string; city: string; category: string; user: string } | null = null;

  const q = <T = unknown>(sql: string, params: unknown[] = []): Promise<T> => ds.query(sql, params) as Promise<T>;

  beforeAll(async () => {
    ds = await new DataSource({ type: 'postgres', url, entities: [] }).initialize();
    emitter = new EventEmitter2();
    emitter.onAny((event: string | string[], payload: unknown) =>
      emitted.push({ event: String(event), payload }),
    );
    service = new StuckSelectionRecoveryService(ds, emitter);

    const suffix = Date.now().toString(36);
    const [user] = await q<{ id: string }[]>(
      `INSERT INTO users (phone_number, full_name, user_type, is_active, phone_verified_at)
       VALUES ($1, 'عميل إنقاذ', 'customer', true, now()) RETURNING id`,
      [`+2077${suffix}`],
    );
    const [profile] = await q<{ id: string }[]>(
      `INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`,
      [user.id],
    );
    // **كتالوج خاص بالملف ده** — الاختبار كان بياخد أي عنوان/خدمة موجودين
    // (`SELECT ... LIMIT 1`)، يعني بيعتمد على بقايا ملف تاني: على قاعدة نضيفة (كونتينر جديد،
    // CI) الاستعلام بيرجّع صفر صفوف والسويتة بتقع على `Cannot read properties of undefined`
    // قبل ما توصل للسلوك اللي بتقيسه أصلاً. اتلقطت حيًا على قاعدة اتعملها migrate من الصفر.
    const [country] = await q<{ id: string }[]>(`SELECT id FROM countries ORDER BY created_at ASC LIMIT 1`);
    const [city] = await q<{ id: string }[]>(
      `INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [country.id, `مدينة إنقاذ ${suffix}`, `Recovery City ${suffix}`, `recovery-city-${suffix}`],
    );
    const [category] = await q<{ id: string }[]>(
      `INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`,
      [`فئة إنقاذ ${suffix}`, `Recovery Category ${suffix}`, `recovery-category-${suffix}`],
    );
    const [svc] = await q<{ id: string }[]>(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days)
       VALUES ($1,$2,$3,'formula',70000,20,0) RETURNING id`,
      [category.id, `خدمة إنقاذ ${suffix}`, `recovery-service-${suffix}`],
    );
    const [address] = await q<{ id: string }[]>(
      `INSERT INTO addresses (user_id, city_id, street_name, building_number, location, is_default)
       VALUES ($1, $2, 'شارع الإنقاذ', '1', ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography, true)
       RETURNING id`,
      [user.id, city.id],
    );
    seed = { customerProfile: profile.id, address: address.id, service: svc.id, city: city.id, category: category.id, user: user.id };
  });

  afterAll(async () => {
    if (!ds?.isInitialized) return;
    if (orderIds.length) {
      await q(`DELETE FROM order_status_history WHERE order_id = ANY($1::uuid[])`, [orderIds]);
      await q(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [orderIds]);
    }
    if (seed) {
      await q(`DELETE FROM addresses WHERE id = $1`, [seed.address]);
      await q(`DELETE FROM customer_profiles WHERE id = $1`, [seed.customerProfile]);
      // **المستخدم بتاع التشغيلة دي بس** — الحذف بالاسم كان بيحاول يشيل مستخدمي تشغيلات
      // قديمة لسه ليهم `customer_profiles`، فبيقع على مفتاح أجنبي ويكسر تنظيف السويتة كلها.
      await q(`DELETE FROM users WHERE id = $1`, [seed.user]);
      await q(`DELETE FROM services WHERE id = $1`, [seed.service]);
      await q(`DELETE FROM service_categories WHERE id = $1`, [seed.category]);
      await q(`DELETE FROM cities WHERE id = $1`, [seed.city]);
    }
    await q(`DELETE FROM sweep_leases WHERE lock_name = 'stuck-selection-recovery'`);
    await ds.destroy();
  });

  async function seedStuckOrder(): Promise<string> {
    const [row] = await q<{ id: string }[]>(
      `INSERT INTO orders (commission_rate_applied,order_number, customer_id, service_id, address_id, order_status, price_status,
                           total_amount_cents, scheduled_at, booking_mode)
       VALUES (20,'STUCK-' || substr(md5(random()::text), 1, 10), $1, $2, $3, $4, 'confirmed',
               70000, now() + interval '2 days', 'individual')
       RETURNING id`,
      [seed!.customerProfile, seed!.service, seed!.address, OrderStatus.AWAITING_TECHNICIAN_SELECTION],
    );
    orderIds.push(row.id);
    return row.id;
  }

  it('الطلب العالق بيدخل التوزيع التلقائي، ومرة واحدة بس', async () => {
    const orderId = await seedStuckOrder();
    emitted.length = 0;

    expect(await service.sweep()).toBeGreaterThanOrEqual(1);

    const [after] = await q<{ order_status: string }[]>(`SELECT order_status FROM orders WHERE id = $1`, [orderId]);
    expect(after.order_status).toBe(OrderStatus.SEARCHING_TECHNICIAN);

    // نقطة الدخول الموحّدة للتوزيع (ADR-0018) — من غيرها الطلب بيقف في حالة تانية وخلاص.
    const dispatched = emitted.filter(
      (e) => e.event === ORDER_CREATED_EVENT && (e.payload as { orderId: string }).orderId === orderId,
    );
    expect(dispatched).toHaveLength(1);

    // الأثر متسجّل عشان يبان في سجل حالات الطلب مش يتغيّر في الخفا.
    const [history] = await q<{ c: string }[]>(
      `SELECT count(*) AS c FROM order_status_history
        WHERE order_id = $1 AND new_status = $2 AND change_source = 'system'`,
      [orderId, OrderStatus.SEARCHING_TECHNICIAN],
    );
    expect(Number(history.c)).toBe(1);
  });

  it('دورة تانية مابتلمسش نفس الطلب — الحالة بتتغيّر ذرّيًا قبل البث', async () => {
    const orderId = await seedStuckOrder();
    await service.sweep();
    emitted.length = 0;

    await service.sweep();

    const again = emitted.filter(
      (e) => e.event === ORDER_CREATED_EVENT && (e.payload as { orderId: string }).orderId === orderId,
    );
    expect(again).toHaveLength(0);
  });
});
