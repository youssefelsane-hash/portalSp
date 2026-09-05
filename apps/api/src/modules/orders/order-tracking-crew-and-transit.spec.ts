import { DataSource } from 'typeorm';
import { Order, OrderStatus } from './entities/order.entity';
import { OrdersService } from './orders.service';
import { ordersServiceForGateway } from './orders.testing';

/**
 * **تدقيق L-4 + L-5 — تتبّع الطلب: مين ينضم، ولمين البث يروح.**
 *
 * الاتنين بَقّتين حقيقيتين اتلقطوا في التدقيق الشامل، والاتنين نفس الفئة: **الـgateway كان عنده
 * تعريفه الخاص لسؤال المفروض يكون له إجابة واحدة في النظام كله**.
 *
 * • **L-5**: «الفني ده على الطلب ده؟» كان `order.technicianId === profile.id` بس — يعني قائد
 *   الطلب لوحده. في طلب فريق، باقي الطاقم كانوا بياخدوا «الطلب ده مش بتاعك».
 *
 * • **L-4**: «الفني في طريقه لأنهي طلب دلوقتي؟» كان `findOne` **بلا `ORDER BY`** على شرط ممكن
 *   يطابق أكتر من صف. قبل ADR-0070 ده كان شبه آمن (الفني بطلب نشط واحد)، وبعده بقى الفني يقدر
 *   يمسك أكتر من طلب في نفس اليوم — فالصف اللي بيترجع بقى بيعتمد على خطة تنفيذ Postgres.
 *
 * الاختبار بيشتغل على Postgres حقيقي وبينده الدوال الحقيقية — مش mocks.
 */
describe('تتبّع الطلب — انتماء الطاقم وحتمية «في الطريق» (تدقيق L-4/L-5)', () => {
  jest.setTimeout(60_000);

  let dataSource: DataSource;
  let ordersService: OrdersService;

  const runId = Date.now().toString(36);
  const ids = {
    category: '',
    service: '',
    customerUser: '',
    customerProfile: '',
    address: '',
    leaderUser: '',
    leaderProfile: '',
    crewUser: '',
    crewProfile: '',
    strangerUser: '',
    strangerProfile: '',
  };
  const orderIds: string[] = [];
  let seq = 0;

  const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

  async function makeTechnician(tag: string): Promise<{ userId: string; profileId: string }> {
    const [user] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`,
      [`+2033${runId}${tag}`.slice(0, 15), `فني ${tag} ${runId}`],
    );
    const [profile] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, current_level, verification_status)
       VALUES ($1,$2,'new','approved') RETURNING id`,
      [user.id, `TRK${tag}${runId}`.slice(0, 20)],
    );
    return { userId: user.id as string, profileId: profile.id as string };
  }

  async function makeOrder(status: OrderStatus, technicianProfileId: string | null, scheduledAt: string | null = null): Promise<string> {
    const [row] = await q(
      `INSERT INTO orders (order_number, customer_id, service_id, address_id, order_status,
                           total_amount_cents, technician_earning_cents, technician_id, scheduled_at)
       VALUES ($1,$2,$3,$4,$5,0,0,$6,$7::timestamptz) RETURNING id`,
      [`TRK-${runId}-${++seq}`.slice(0, 24), ids.customerProfile, ids.service, ids.address, status, technicianProfileId, scheduledAt],
    );
    orderIds.push(row.id as string);
    return row.id as string;
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Order],
    });
    await dataSource.initialize();
    ordersService = ordersServiceForGateway(dataSource);

    const [category] = await q(
      `INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`,
      [`فئة تتبّع ${runId}`, `Trk Cat ${runId}`, `trk-cat-${runId}`],
    );
    ids.category = category.id;
    const [service] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents)
       VALUES ($1,$2,$3,'formula',10000) RETURNING id`,
      [ids.category, `خدمة تتبّع ${runId}`, `trk-svc-${runId}`],
    );
    ids.service = service.id;

    const [customerUser] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [`+2032${runId}c`.slice(0, 15), `عميل تتبّع ${runId}`],
    );
    ids.customerUser = customerUser.id;
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customerUser]);
    ids.customerProfile = customerProfile.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, street_name, location)
       VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography) RETURNING id`,
      [ids.customerUser, `شارع تتبّع ${runId}`],
    );
    ids.address = address.id;

    const leader = await makeTechnician('L');
    ids.leaderUser = leader.userId;
    ids.leaderProfile = leader.profileId;
    const crew = await makeTechnician('C');
    ids.crewUser = crew.userId;
    ids.crewProfile = crew.profileId;
    const stranger = await makeTechnician('S');
    ids.strangerUser = stranger.userId;
    ids.strangerProfile = stranger.profileId;
  });

  afterEach(async () => {
    if (orderIds.length === 0) return;
    await q(`DELETE FROM order_team_members WHERE order_id = ANY($1::uuid[])`, [orderIds]);
    await q(`DELETE FROM order_status_history WHERE order_id = ANY($1::uuid[])`, [orderIds]);
    await q(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [orderIds]);
    orderIds.length = 0;
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
    await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
    await q(`DELETE FROM technician_profiles WHERE id = ANY($1::uuid[])`, [
      [ids.leaderProfile, ids.crewProfile, ids.strangerProfile],
    ]);
    await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [
      [ids.customerUser, ids.leaderUser, ids.crewUser, ids.strangerUser],
    ]);
    await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
    await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
    await dataSource.destroy();
  });

  describe('L-5 — الانتماء للطلب بيشمل الطاقم مش القائد بس', () => {
    it('قائد الطلب منتمي (خط الأساس)', async () => {
      const orderId = await makeOrder(OrderStatus.ACCEPTED, ids.leaderProfile);
      const order = await dataSource.getRepository(Order).findOneOrFail({ where: { id: orderId } });
      expect(await ordersService.isTechnicianAssignedToOrder(ids.leaderProfile, order)).toBe(true);
    });

    it('عضو الطاقم منتمي كمان — دي البَقّة اللي كانت بتدّيه «الطلب ده مش بتاعك»', async () => {
      const orderId = await makeOrder(OrderStatus.IN_PROGRESS, ids.leaderProfile);
      await q(
        `INSERT INTO order_team_members (order_id, technician_id, role_label, added_by_technician_id)
         VALUES ($1,$2,'مساعد',$3)`,
        [orderId, ids.crewProfile, ids.leaderProfile],
      );
      const order = await dataSource.getRepository(Order).findOneOrFail({ where: { id: orderId } });
      expect(await ordersService.isTechnicianAssignedToOrder(ids.crewProfile, order)).toBe(true);
    });

    it('فني غريب مش منتمي — الحاجز الأمني لسه شغّال', async () => {
      const orderId = await makeOrder(OrderStatus.IN_PROGRESS, ids.leaderProfile);
      await q(
        `INSERT INTO order_team_members (order_id, technician_id, role_label, added_by_technician_id)
         VALUES ($1,$2,'مساعد',$3)`,
        [orderId, ids.crewProfile, ids.leaderProfile],
      );
      const order = await dataSource.getRepository(Order).findOneOrFail({ where: { id: orderId } });
      expect(await ordersService.isTechnicianAssignedToOrder(ids.strangerProfile, order)).toBe(false);
    });
  });

  describe('L-4 — «في الطريق» محصور ومحدّد بدقة', () => {
    it('بيرجّع طلب technician_on_way بس', async () => {
      const onWay = await makeOrder(OrderStatus.TECHNICIAN_ON_WAY, ids.leaderProfile);
      const rows = await ordersService.findOrdersInTransitForTechnician(ids.leaderProfile);
      expect(rows.map((r) => r.id)).toEqual([onWay]);
    });

    it('الفني الواصل/الشغّال مش «في الطريق» — بث موقعه وقتها تسريب خصوصية بلا فايدة', async () => {
      await makeOrder(OrderStatus.TECHNICIAN_ARRIVED, ids.leaderProfile);
      await makeOrder(OrderStatus.IN_PROGRESS, ids.leaderProfile);
      await makeOrder(OrderStatus.ACCEPTED, ids.leaderProfile);
      expect(await ordersService.findOrdersInTransitForTechnician(ids.leaderProfile)).toEqual([]);
    });

    it('مع طلبين متزامنين (ADR-0070) بيرجّع اللي في الطريق بس، مش واحد بالعشوائي', async () => {
      // ده بالظبط السيناريو اللي كان بيكسر: الكود القديم `findOne` بلا ترتيب كان ممكن يرجّع أي
      // واحد من الاتنين، فالبث كان ممكن يروح لعميل الطلب الغلط.
      await makeOrder(OrderStatus.IN_PROGRESS, ids.leaderProfile);
      const onWay = await makeOrder(OrderStatus.TECHNICIAN_ON_WAY, ids.leaderProfile);
      for (let i = 0; i < 5; i++) {
        const rows = await ordersService.findOrdersInTransitForTechnician(ids.leaderProfile);
        expect(rows.map((r) => r.id)).toEqual([onWay]);
      }
    });

    it('الترتيب حتمي لو الفني في طريقه لأكتر من طلب — نفس النتيجة كل مرة', async () => {
      const later = await makeOrder(OrderStatus.TECHNICIAN_ON_WAY, ids.leaderProfile, '2030-01-02T10:00:00Z');
      const earlier = await makeOrder(OrderStatus.TECHNICIAN_ON_WAY, ids.leaderProfile, '2030-01-01T10:00:00Z');
      for (let i = 0; i < 5; i++) {
        const rows = await ordersService.findOrdersInTransitForTechnician(ids.leaderProfile);
        expect(rows.map((r) => r.id)).toEqual([earlier, later]);
      }
    });

    it('طلبات فني تاني مابتتسرّبش', async () => {
      await makeOrder(OrderStatus.TECHNICIAN_ON_WAY, ids.strangerProfile);
      expect(await ordersService.findOrdersInTransitForTechnician(ids.leaderProfile)).toEqual([]);
    });
  });
});
