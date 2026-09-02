import { DataSource } from 'typeorm';
import { AdminOrdersService } from './admin-orders.service';
import { AuditLogService } from '../audit/audit-log.service';
import { Order, OrderPriceStatus, OrderStatus } from './entities/order.entity';
import { OrderStatusHistory } from './entities/order-status-history.entity';
import { OrderTeamMember } from './entities/order-team-member.entity';
import { TechnicianOrderCancellation } from './entities/technician-order-cancellation.entity';
import { OrderQuote } from './entities/order-quote.entity';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { Address } from '../customers/entities/address.entity';
import { User } from '../auth/entities/user.entity';
import { ServiceCategory } from '../catalog/entities/service-category.entity';
import { Service } from '../catalog/entities/service.entity';
import { City } from '../geo/entities/city.entity';
import { ServiceZone } from '../geo/entities/service-zone.entity';
import { OrderFinancialFinalizationService } from '../pricing/order-financial-finalization.service';

/**
 * **ADR-0068 §1 — البوابة الجديدة بتشتغل فعلاً على الترانزاكشن الحقيقي.**
 *
 * `price-authority-and-audit.spec.ts` بيقفل **التصنيف**؛ الاختبار ده بيقفل **الفرض**: إن
 * `adjustPrice` بترفض فعليًا لما السلطة ناقصة، وإن نوع القرار بيتسجّل في الـaudit — القاعدة
 * الحاكمة إن مفيش جنيه بيتحرّك من غير سطر بيقول مين وليه وإيه نوع القرار.
 */
describe('ADR-0068 — فرض سلطة السعر على مسار adjustPrice الحقيقي', () => {
  jest.setTimeout(60_000);

  let dataSource: DataSource;
  let service: AdminOrdersService;
  const audited: { action: string; newValues?: Record<string, unknown> }[] = [];

  const runId = `${Date.now().toString(36)}a`;
  const ids = { city: '', zone: '', category: '', service: '', customerUser: '', customerProfile: '', address: '', adminUser: '' };
  const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

  const FEE_CENTS = 7_500;
  const TOTAL_CENTS = 30_000;

  async function seedOrder(): Promise<string> {
    const [{ next_human_readable_number: orderNumber }] = await q("SELECT next_human_readable_number('ORD')");
    const [row] = await q(
      `INSERT INTO orders (order_number, customer_id, service_id, address_id, service_zone_id,
                           order_status, payment_status, total_amount_cents, estimated_price_cents,
                           inspection_fee_cents, commissionable_base_cents, technician_earning_cents, price_status)
       VALUES ($1,$2,$3,$4,$5,$6,'unpaid',$7,$7,$8,$7,0,$9) RETURNING id`,
      [orderNumber, ids.customerProfile, ids.service, ids.address, ids.zone,
       OrderStatus.SEARCHING_TECHNICIAN, TOTAL_CENTS, FEE_CENTS, OrderPriceStatus.CONFIRMED],
    );
    return row.id;
  }

  beforeEach(() => {
    audited.length = 0;
  });

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [
        Order, OrderStatusHistory, OrderTeamMember, TechnicianOrderCancellation, OrderQuote,
        User, Address, CustomerProfile, ServiceCategory, Service, City, ServiceZone,
      ],
    });
    await dataSource.initialize();

    const [country] = await q(`SELECT id FROM countries ORDER BY created_at ASC LIMIT 1`);
    const [city] = await q(
      `INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [country.id, `مدينة سلطة ${runId}`, `Auth City ${runId}`, `auth-city-${runId}`],
    );
    ids.city = city.id;
    const [zone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city, `نطاق سلطة ${runId}`, `Auth Zone ${runId}`,
    ]);
    ids.zone = zone.id;
    const [category] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة سلطة ${runId}`, `Auth Cat ${runId}`, `auth-cat-${runId}`,
    ]);
    ids.category = category.id;
    const [svc] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, inspection_fee_cents,
                             commission_percentage, warranty_days)
       VALUES ($1,$2,$3,'formula',10000,$4,20,0) RETURNING id`,
      [ids.category, `خدمة سلطة ${runId}`, `auth-service-${runId}`, FEE_CENTS],
    );
    ids.service = svc.id;
    const [customerUser] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [`+2051${runId}`.slice(0, 15), `عميل سلطة ${runId}`],
    );
    ids.customerUser = customerUser.id;
    const [profile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customerUser]);
    ids.customerProfile = profile.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, street_name, location) VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.25,30.05),4326)::geography) RETURNING id`,
      [ids.customerUser, `شارع سلطة ${runId}`],
    );
    ids.address = address.id;
    const [adminUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'admin') RETURNING id`, [
      `+2052${runId}`.slice(0, 15), `أدمن سلطة ${runId}`,
    ]);
    ids.adminUser = adminUser.id;

    const auditStub = {
      record: async (params: { action: string; newValues?: Record<string, unknown> }) => {
        audited.push({ action: params.action, newValues: params.newValues });
      },
    } as unknown as AuditLogService;

    service = new AdminOrdersService(
      dataSource.getRepository(Order),
      dataSource.getRepository(OrderStatusHistory),
      dataSource.getRepository(TechnicianOrderCancellation),
      dataSource.getRepository(OrderTeamMember),
      dataSource,
      {} as never,
      {} as never,
      {} as never,
      auditStub,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      undefined,
      new OrderFinancialFinalizationService(),
    );
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      await q(`DELETE FROM order_status_history WHERE order_id IN (SELECT id FROM orders WHERE customer_id = $1)`, [ids.customerProfile]);
      await q(`DELETE FROM orders WHERE customer_id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
      await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM users WHERE id IN ($1,$2)`, [ids.customerUser, ids.adminUser]);
      await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
      await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
      await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
      await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    } finally {
      await dataSource.destroy();
    }
  });

  it('بلا صلاحية اعتماد الزيادة: الزيادة بترفض والسعر مابيتغيّرش في القاعدة', async () => {
    const orderId = await seedOrder();
    await expect(
      service.adjustPrice(ids.adminUser, orderId, TOTAL_CENTS + 5_000, 'زيادة', undefined, {
        canApprovePriceIncrease: false,
        canWaiveFees: true,
      }),
    ).rejects.toThrow(/مش باعتماد زيادة/);

    const [row] = await q(`SELECT total_amount_cents FROM orders WHERE id = $1`, [orderId]);
    expect(row.total_amount_cents).toBe(TOTAL_CENTS);
    expect(audited).toHaveLength(0);
  });

  it('نفس الدور يقدر يخفّض عادي — الفصل مابيمنعش الشغل اليومي', async () => {
    const orderId = await seedOrder();
    // 10,000 لسه فوق أرضية الرسوم 7,500 — خفض عادي مش إعفاء.
    await service.adjustPrice(ids.adminUser, orderId, 10_000, 'خصم مجاملة', undefined, {
      canApprovePriceIncrease: false,
      canWaiveFees: false,
    });

    const [row] = await q(`SELECT total_amount_cents FROM orders WHERE id = $1`, [orderId]);
    expect(row.total_amount_cents).toBe(10_000);
    expect(audited[0].newValues?.change_kind).toBe('decrease');
  });

  it('النزول تحت أرضية الرسوم بلا صلاحية إعفاء: بيترفض', async () => {
    const orderId = await seedOrder();
    await expect(
      service.adjustPrice(ids.adminUser, orderId, 3_000, 'إعفاء', undefined, {
        canApprovePriceIncrease: true,
        canWaiveFees: false,
      }),
    ).rejects.toThrow(/إعفاء من رسوم/);

    const [row] = await q(`SELECT total_amount_cents FROM orders WHERE id = $1`, [orderId]);
    expect(row.total_amount_cents).toBe(TOTAL_CENTS);
  });

  it('بالصلاحيتين: الزيادة والإعفاء بيعدّوا، ونوع القرار بيتسجّل في الـaudit', async () => {
    const increased = await seedOrder();
    await service.adjustPrice(ids.adminUser, increased, TOTAL_CENTS + 5_000, 'شغل إضافي متفق عليه', undefined, {
      canApprovePriceIncrease: true,
      canWaiveFees: true,
    });
    expect(audited.at(-1)?.action).toBe('order.price_adjusted_by_admin');
    expect(audited.at(-1)?.newValues?.change_kind).toBe('increase');

    const waived = await seedOrder();
    await service.adjustPrice(ids.adminUser, waived, 3_000, 'إعفاء من رسم المعاينة', undefined, {
      canApprovePriceIncrease: true,
      canWaiveFees: true,
    });
    expect(audited.at(-1)?.newValues?.change_kind).toBe('fee_waiver');

    const [row] = await q(`SELECT total_amount_cents FROM orders WHERE id = $1`, [waived]);
    expect(row.total_amount_cents).toBe(3_000);
  });
});
