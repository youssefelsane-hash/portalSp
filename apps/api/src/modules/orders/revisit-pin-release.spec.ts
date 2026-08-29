import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AdminOrdersService } from './admin-orders.service';
import { Order } from './entities/order.entity';
import { OrderStatusHistory } from './entities/order-status-history.entity';
import { OrderTeamMember } from './entities/order-team-member.entity';
import { TechnicianOrderCancellation } from './entities/technician-order-cancellation.entity';
import { loadRevisitPinState } from './revisit-pin';
import { AdminExceptionCenterService } from '../operations/admin-exception-center.service';
import { AuditLogService } from '../audit/audit-log.service';
import { SettingsService } from '../settings/settings.service';
import { TechniciansService } from '../technicians/technicians.service';
import { WalletsService } from '../payments/wallets.service';
import { Wallet } from '../payments/entities/wallet.entity';
import { WalletTransaction } from '../payments/entities/wallet-transaction.entity';

/**
 * ADR-0051 (docs/08 §96) — إعادة الزيارة مربوطة بالفني الأصلي.
 *
 * الاختبار ده بيقفل على **الحارس اللي المالك شدّد عليه بالحرف**: «لازم يكون الفني الطلب مش عنده…
 * طالما الطلب عنده موجود، خلاص مش هناخد أي action». يعني التحرير والخصم ممنوعين تمامًا طول ما
 * الفني لسه شايل الطلب، ومسموحين مرة واحدة بس بعد ما يرفض/يلغي أو تعدّي المهلة.
 */
describe('ADR-0051 — تحرير إعادة الزيارة المثبّتة والخصم على الفني الأصلي', () => {
  let dataSource: DataSource;
  let adminOrders: AdminOrdersService;
  let walletsService: WalletsService;
  let exceptionCenter: AdminExceptionCenterService;
  const runId = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);

  const ids = {
    city: '',
    zone: '',
    category: '',
    service: '',
    customerUser: '',
    customerProfile: '',
    address: '',
    technicianUser: '',
    technicianProfile: '',
  };
  const orderIds: string[] = [];

  const settingsStub = { getNumber: async (_k: string, fallback: number) => fallback } as unknown as SettingsService;
  const techniciansStub = {
    findByProfileIdOrThrow: async (id: string) => ({ id, userId: ids.technicianUser }),
  } as unknown as TechniciansService;

  async function q<T = any>(sql: string, params?: unknown[]): Promise<T[]> {
    return dataSource.query(sql, params);
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Order, OrderStatusHistory, OrderTeamMember, TechnicianOrderCancellation, Wallet, WalletTransaction],
    });
    await dataSource.initialize();

    const [country] = await q(`SELECT id FROM countries ORDER BY created_at ASC LIMIT 1`);
    const [city] = await q(`INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`, [
      country.id,
      `مدينة إعادة زيارة ${runId}`,
      `Revisit City ${runId}`,
      `test-rv-city-${runId}`,
    ]);
    ids.city = city.id;
    const [zone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city,
      `نطاق إعادة زيارة ${runId}`,
      `Revisit Zone ${runId}`,
    ]);
    ids.zone = zone.id;
    const [category] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة إعادة زيارة ${runId}`,
      `Revisit Category ${runId}`,
      `test-rv-cat-${runId}`,
    ]);
    ids.category = category.id;
    const [service] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days, estimated_duration_minutes)
       VALUES ($1,$2,$3,'fixed',50000,20,14,60) RETURNING id`,
      [ids.category, `خدمة إعادة زيارة ${runId}`, `test-rv-svc-${runId}`],
    );
    ids.service = service.id;

    const [customerUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`, [
      `+201${runId}`.slice(0, 15),
      `عميل إعادة زيارة ${runId}`,
    ]);
    ids.customerUser = customerUser.id;
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customerUser]);
    ids.customerProfile = customerProfile.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, street_name, location) VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.26, 30.06), 4326)::geography) RETURNING id`,
      [ids.customerUser, `شارع إعادة زيارة ${runId}`],
    );
    ids.address = address.id;

    const [technicianUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [
      `+202${runId}`.slice(0, 15),
      `فني إعادة زيارة ${runId}`,
    ]);
    ids.technicianUser = technicianUser.id;
    const [technicianProfile] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, national_id_encrypted, years_of_experience, current_level, verification_status, is_available)
       VALUES ($1,$2,'x',3,'new','approved',true) RETURNING id`,
      [ids.technicianUser, `RV-${runId}`.slice(0, 20)],
    );
    ids.technicianProfile = technicianProfile.id;

    walletsService = new WalletsService(dataSource.getRepository(Wallet), dataSource.getRepository(WalletTransaction), dataSource);
    adminOrders = new AdminOrdersService(
      dataSource.getRepository(Order),
      dataSource.getRepository(OrderStatusHistory),
      dataSource.getRepository(TechnicianOrderCancellation),
      dataSource.getRepository(OrderTeamMember),
      dataSource,
      techniciansStub,
      {} as never, // assignmentGuard — مش متنادى في releaseRevisit
      new EventEmitter2(),
      { record: async () => undefined } as unknown as AuditLogService,
      {} as never, // pricingEngineService
      {} as never, // promoCodesService
      settingsStub,
      walletsService,
    );
    exceptionCenter = new AdminExceptionCenterService(dataSource, settingsStub);
  }, 30000);

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      if (orderIds.length) {
        await q(`DELETE FROM wallet_transactions WHERE reference_type = 'order' AND reference_id = ANY($1::uuid[])`, [orderIds]);
        await q(`DELETE FROM order_assignments WHERE order_id = ANY($1::uuid[])`, [orderIds]);
        await q(`DELETE FROM order_earning_shares WHERE order_id = ANY($1::uuid[])`, [orderIds]);
        await q(`DELETE FROM order_status_history WHERE order_id = ANY($1::uuid[])`, [orderIds]);
        // إعادة الزيارة بتشاور على الأصلي بـparent_order_id — الأولاد الأول.
        await q(`DELETE FROM orders WHERE id = ANY($1::uuid[]) AND parent_order_id IS NOT NULL`, [orderIds]);
        await q(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [orderIds]);
      }
      await q(`DELETE FROM wallets WHERE owner_user_id = $1`, [ids.technicianUser]);
      await q(`DELETE FROM technician_profiles WHERE id = $1`, [ids.technicianProfile]);
      await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
      await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM users WHERE id = ANY($1)`, [[ids.customerUser, ids.technicianUser]]);
      await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
      await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
      await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
      await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    } finally {
      if (dataSource?.isInitialized) await dataSource.destroy();
    }
  }, 20000);

  /** طلب أصلي مكتمل بأرباح فني معروفة + إعادة زيارة مثبّتة عليه. */
  async function seedRevisit(opts: { technicianEarningCents: number; pinnedHoursAgo: number; useEarningShare?: boolean }) {
    const [original] = await q(
      `INSERT INTO orders (order_number, customer_id, service_id, address_id, service_zone_id, technician_id,
                           order_status, payment_status, total_amount_cents, technician_earning_cents, booking_mode, order_type)
       VALUES ($1,$2,$3,$4,$5,$6,'completed','paid',50000,$7,'individual','standard') RETURNING id`,
      [
        `RVO-${runId}-${orderIds.length}`.slice(0, 24),
        ids.customerProfile,
        ids.service,
        ids.address,
        ids.zone,
        ids.technicianProfile,
        opts.technicianEarningCents,
      ],
    );
    orderIds.push(original.id);

    if (opts.useEarningShare) {
      await q(
        `INSERT INTO order_earning_shares (order_id, technician_id, participant_role, technician_level, share_weight, pool_cents, share_cents)
         VALUES ($1,$2,'leader','new',1,$3,$3)`,
        [original.id, ids.technicianProfile, opts.technicianEarningCents],
      );
    }

    const [revisit] = await q(
      `INSERT INTO orders (order_number, customer_id, service_id, address_id, service_zone_id, parent_order_id,
                           order_status, payment_status, total_amount_cents, booking_mode, order_type,
                           revisit_pinned_technician_id, revisit_pinned_at)
       VALUES ($1,$2,$3,$4,$5,$6,'searching_technician','unpaid',0,'individual','revisit',$7, now() - make_interval(hours => $8::int))
       RETURNING id`,
      [
        `RVR-${runId}-${orderIds.length}`.slice(0, 24),
        ids.customerProfile,
        ids.service,
        ids.address,
        ids.zone,
        original.id,
        ids.technicianProfile,
        opts.pinnedHoursAgo,
      ],
    );
    orderIds.push(revisit.id);
    return { originalId: original.id as string, revisitId: revisit.id as string };
  }

  async function loadOrder(id: string): Promise<Order> {
    return (await dataSource.getRepository(Order).findOneOrFail({ where: { id } })) as Order;
  }

  async function technicianBalanceCents(): Promise<number> {
    const [row] = await q<{ balance_cents: string | null }>(
      `SELECT balance_cents FROM wallets WHERE owner_user_id = $1`,
      [ids.technicianUser],
    );
    return Number(row?.balance_cents ?? 0);
  }

  it('الفني لسه الطلب عنده (لا رفض ولا مهلة عدّت) — مفيش تحرير ومفيش خصم خالص', async () => {
    const { revisitId } = await seedRevisit({ technicianEarningCents: 40000, pinnedHoursAgo: 2 });

    const state = await loadRevisitPinState(dataSource, await loadOrder(revisitId), 48);
    expect(state.pinned).toBe(true);
    expect(state.exhausted).toBe(false);

    const balanceBefore = await technicianBalanceCents();
    await expect(adminOrders.releaseRevisit(ids.customerUser, revisitId)).rejects.toThrow(/لسه الطلب عنده/);

    const after = await loadOrder(revisitId);
    expect(after.revisitReleasedAt).toBeNull();
    expect(after.revisitReleaseReason).toBeNull();
    expect(await technicianBalanceCents()).toBe(balanceBefore);
  }, 20000);

  it('الفني رفض العرض — التحرير مسموح، والخصم بنصيبه الفعلي من order_earning_shares', async () => {
    const { originalId, revisitId } = await seedRevisit({
      technicianEarningCents: 40000,
      pinnedHoursAgo: 1,
      useEarningShare: true,
    });
    await q(
      `INSERT INTO order_assignments (order_id, technician_id, assignment_round, distance_km, assignment_status, sent_at, expires_at)
       VALUES ($1,$2,1,1.0,'rejected', now(), now() + interval '1 hour')`,
      [revisitId, ids.technicianProfile],
    );

    const state = await loadRevisitPinState(dataSource, await loadOrder(revisitId), 48);
    expect(state.exhausted).toBe(true);
    expect(state.reason).toBe('refused');

    const balanceBefore = await technicianBalanceCents();
    const result = await adminOrders.releaseRevisit(ids.customerUser, revisitId);
    expect(result.reason).toBe('refused');
    expect(result.chargebackCents).toBe(40000);
    expect(await technicianBalanceCents()).toBe(balanceBefore - 40000);

    const after = await loadOrder(revisitId);
    expect(after.revisitReleasedAt).not.toBeNull();
    expect(after.revisitReleaseReason).toBe('refused');

    // القيد مرجعه **الطلب الأصلي** — الفلوس اللي بترجع هي فلوس الشغلانة الأصلية.
    const [tx] = await q<{ transaction_type: string; reference_id: string }>(
      `SELECT wt.transaction_type, wt.reference_id
         FROM wallet_transactions wt JOIN wallets w ON w.id = wt.wallet_id
        WHERE w.owner_user_id = $1 AND wt.transaction_type = 'penalty' AND wt.reference_id = $2`,
      [ids.technicianUser, originalId],
    );
    expect(tx).toBeDefined();

    // التحرير مرة واحدة بس — revisit_released_at هو الحارس.
    await expect(adminOrders.releaseRevisit(ids.customerUser, revisitId)).rejects.toThrow(/اتحررت قبل كده/);
    expect(await technicianBalanceCents()).toBe(balanceBefore - 40000);
  }, 20000);

  it('عدّت المهلة بلا رد — السبب no_response، والخصم بيرجع لـtechnician_earning_cents لو مفيش صف حصص', async () => {
    const { revisitId } = await seedRevisit({ technicianEarningCents: 33000, pinnedHoursAgo: 72 });

    const state = await loadRevisitPinState(dataSource, await loadOrder(revisitId), 48);
    expect(state.exhausted).toBe(true);
    expect(state.reason).toBe('no_response');

    // ظاهر عند الأدمن كبند محتاج تصرّف، برقم الطلب الأصلي وبيانات التواصل.
    const exceptions = await exceptionCenter.getExceptions({ categoryId: ids.category });
    const item = exceptions.stalledRevisits.items.find((i) => i.orderId === revisitId);
    expect(item).toBeDefined();
    expect(item!.reason).toBe('no_response');
    expect(item!.originalOrderNumber).toContain('RVO-');
    expect(item!.chargebackCents).toBe(33000);

    const balanceBefore = await technicianBalanceCents();
    const result = await adminOrders.releaseRevisit(ids.customerUser, revisitId);
    expect(result.reason).toBe('no_response');
    expect(result.chargebackCents).toBe(33000);
    expect(await technicianBalanceCents()).toBe(balanceBefore - 33000);

    // بعد التحرير بيختفي من البند — مفيش تصرّف مطلوب تاني.
    const afterExceptions = await exceptionCenter.getExceptions({ categoryId: ids.category });
    expect(afterExceptions.stalledRevisits.items.find((i) => i.orderId === revisitId)).toBeUndefined();
  }, 20000);

  it('إعادة زيارة لسه في مهلتها مش بتظهر كـ"توزيع متأخر" حتى لو العرض معاده فات', async () => {
    const { revisitId } = await seedRevisit({ technicianEarningCents: 10000, pinnedHoursAgo: 1 });
    await q(
      `INSERT INTO order_assignments (order_id, technician_id, assignment_round, distance_km, assignment_status, sent_at, expires_at)
       VALUES ($1,$2,1,1.0,'sent', now() - interval '2 hours', now() - interval '1 hour')`,
      [revisitId, ids.technicianProfile],
    );

    const exceptions = await exceptionCenter.getExceptions({ categoryId: ids.category });
    expect(exceptions.staleDispatch.items.find((i) => i.orderId === revisitId)).toBeUndefined();
    expect(exceptions.stalledRevisits.items.find((i) => i.orderId === revisitId)).toBeUndefined();
  }, 20000);
});
