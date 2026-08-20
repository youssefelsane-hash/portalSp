import { DataSource } from 'typeorm';
import { RealtimeSessionRegistry } from '../../common/websocket/realtime-session-registry.service';
import { TechnicianActivityService } from './technician-activity.service';
import { AdminTechnician360Service } from './admin-technician-360.service';
import { SettingsService } from '../settings/settings.service';

// اختبار حي ضد Postgres حقيقي — بروفايل فني 360° (docs/08 §35.11، ADR-0021 §5). فني واحد
// مصمّم يمثّل أكبر عدد ممكن من الأبعاد الغنية سوا (identity/categories/zones/team role/current
// job/blocked date/open opportunity/cancellation/complaint/wallet/payout) عشان نتأكد إن التجميعة
// كلها بتتحسب صح من نفس المصادر الحقيقية.
const settingsServiceStub = { getNumber: async (_key: string, fallback: number) => fallback } as unknown as SettingsService;

describe('AdminTechnician360Service — بروفايل فني 360° (docs/08 §35.11)', () => {
  let dataSource: DataSource;
  let service: AdminTechnician360Service;
  const runId = Date.now().toString(36);
  const ids = {
    country: '',
    city: '',
    zone: '',
    category: '',
    service: '',
    company: '',
    customerProfile: '',
    address: '',
    techUser: '',
    techProfile: '',
    cancellationReason: '',
    order: '',
    wallet: '',
  };
  const users: string[] = [];

  async function q(sql: string, params?: unknown[]) {
    return dataSource.query(sql, params);
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
    });
    await dataSource.initialize();
    const sessionRegistry = new RealtimeSessionRegistry(dataSource);
    const activityService = new TechnicianActivityService(dataSource, sessionRegistry);
    service = new AdminTechnician360Service(dataSource, settingsServiceStub, activityService);

    const [country] = await q(
      `INSERT INTO countries (name_ar, name_en, iso_code, phone_prefix, currency_code) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [`دولة 360 ${runId}`, `360 Country ${runId}`, 'T' + runId.slice(0, 1).toUpperCase(), '+000', 'EGP'],
    );
    ids.country = country.id;
    const [city] = await q(`INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`, [
      ids.country,
      `مدينة 360 ${runId}`,
      `360 City ${runId}`,
      `test-360-city-${runId}`,
    ]);
    ids.city = city.id;
    const [zone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city,
      `نطاق 360 ${runId}`,
      `360 Zone ${runId}`,
    ]);
    ids.zone = zone.id;
    const [category] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة 360 ${runId}`,
      `360 Category ${runId}`,
      `test-360-category-${runId}`,
    ]);
    ids.category = category.id;
    const [service_] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days)
       VALUES ($1,$2,$3,'fixed',30000,20,0) RETURNING id`,
      [ids.category, `خدمة 360 ${runId}`, `test-360-service-${runId}`],
    );
    ids.service = service_.id;

    const [customerUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`, [
      `+2039${runId}`.slice(0, 15),
      `عميل 360 ${runId}`,
    ]);
    users.push(customerUser.id);
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [customerUser.id]);
    ids.customerProfile = customerProfile.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, street_name, location) VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.26, 30.06), 4326)::geography) RETURNING id`,
      [customerUser.id, `شارع 360 ${runId}`],
    );
    ids.address = address.id;

    const [techUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [
      `+2038${runId}`.slice(0, 15),
      `فني 360 ${runId}`,
    ]);
    users.push(techUser.id);
    ids.techUser = techUser.id;

    const [company] = await q(`INSERT INTO technician_companies (owner_user_id, name, is_active) VALUES ($1,$2,true) RETURNING id`, [
      techUser.id,
      `شركة 360 ${runId}`,
    ]);
    ids.company = company.id;

    const [techProfile] = await q(
      `INSERT INTO technician_profiles
         (user_id, technician_code, national_id_encrypted, years_of_experience, current_level, verification_status, is_available,
          average_rating, total_ratings_count, completed_orders_count, cancelled_orders_count, company_id)
       VALUES ($1,$2,'x',5,'professional','approved',true, 4.50, 12, 20, 3, $3) RETURNING id`,
      [techUser.id, `TC360${runId}`.slice(0, 20), ids.company],
    );
    ids.techProfile = techProfile.id;

    await q(`INSERT INTO technician_categories (technician_id, category_id, is_active, verification_status) VALUES ($1,$2,true,'approved')`, [
      ids.techProfile,
      ids.category,
    ]);
    await q(`INSERT INTO technician_zones (technician_id, service_zone_id, is_active) VALUES ($1,$2,true)`, [ids.techProfile, ids.zone]);

    // يوم محظور بكرة.
    await q(
      `INSERT INTO technician_schedule_slots (technician_id, slot_date, start_time, end_time, status)
       VALUES ($1, CURRENT_DATE + 1, '00:00', '23:59', 'blocked')`,
      [ids.techProfile],
    );

    // طلب "حالي/قادم" — accepted، الفني ده تقني عليه.
    const [order] = await q(
      `INSERT INTO orders (order_number, customer_id, technician_id, service_id, address_id, service_zone_id, order_status, payment_status, total_amount_cents, technician_earning_cents, booking_mode)
       VALUES ($1,$2,$3,$4,$5,$6,'accepted','pending',30000,0,'individual') RETURNING id`,
      [`TEST360-${runId}`.slice(0, 24), ids.customerProfile, ids.techProfile, ids.service, ids.address, ids.zone],
    );
    ids.order = order.id;

    // فرصة مفتوحة (order_assignments sent).
    await q(
      `INSERT INTO order_assignments (order_id, technician_id, assignment_round, assignment_status, sent_at, expires_at)
       VALUES ($1,$2,1,'sent', now(), now() + interval '30 seconds')`,
      [ids.order, ids.techProfile],
    );

    // سبب إلغاء + إلغاء حقيقي (نفس اليوم — يظهر في recent_cancellations كمان).
    const [reason] = await q(
      `INSERT INTO cancellation_reasons (reason_ar, reason_en, applies_to) VALUES ($1,$2,'technician') RETURNING id`,
      [`سبب 360 ${runId}`, `360 Reason ${runId}`],
    );
    ids.cancellationReason = reason.id;
    await q(
      `INSERT INTO technician_order_cancellations
         (order_id, technician_id, technician_user_id, cancellation_reason_id, booking_mode, accepted_at, elapsed_seconds_after_acceptance, within_policy_window, recovery_action, fee_cents)
       VALUES ($1,$2,$3,$4,'individual', now() - interval '10 minutes', 600, true, 'auto_rematch', 0)`,
      [ids.order, ids.techProfile, ids.techUser, ids.cancellationReason],
    );

    // شكوى مفتوحة ضد الفني.
    await q(
      `INSERT INTO complaints (complaint_number, order_id, filed_by_user_id, against_user_id, category, severity, title, description, complaint_status, sla_due_at)
       VALUES ($1,$2,$3,$4,'poor_quality','medium',$5,$6,'open', now() + interval '2 days')`,
      [`TESTCMP-${runId}`.slice(0, 24), ids.order, customerUser.id, ids.techUser, `شكوى 360 ${runId}`, `تفاصيل شكوى 360 ${runId}`],
    );

    // محفظة الفني + رصيد.
    const [wallet] = await q(
      `INSERT INTO wallets (owner_user_id, owner_type, balance_cents, pending_balance_cents, total_earned_cents)
       VALUES ($1,'technician',15000,5000,240000) RETURNING id`,
      [ids.techUser],
    );
    ids.wallet = wallet.id;

    // صرف مكتمل.
    await q(
      `INSERT INTO payouts (payout_number, technician_id, wallet_id, amount_cents, net_amount_cents, payout_method, payout_status, requested_at, completed_at)
       VALUES ($1,$2,$3,20000,20000,'bank_transfer','completed', now() - interval '5 days', now() - interval '4 days')`,
      [`TESTPO-${runId}`.slice(0, 24), ids.techProfile, ids.wallet],
    );
  });

  afterAll(async () => {
    try {
      await q(`DELETE FROM payouts WHERE technician_id = $1`, [ids.techProfile]);
      await q(`DELETE FROM wallets WHERE id = $1`, [ids.wallet]);
      await q(`DELETE FROM complaints WHERE order_id = $1`, [ids.order]);
      await q(`DELETE FROM technician_order_cancellations WHERE order_id = $1`, [ids.order]);
      await q(`DELETE FROM cancellation_reasons WHERE id = $1`, [ids.cancellationReason]);
      await q(`DELETE FROM order_assignments WHERE order_id = $1`, [ids.order]);
      await q(`DELETE FROM orders WHERE id = $1`, [ids.order]);
      await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
      await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM technician_schedule_slots WHERE technician_id = $1`, [ids.techProfile]);
      await q(`DELETE FROM technician_zones WHERE technician_id = $1`, [ids.techProfile]);
      await q(`DELETE FROM technician_categories WHERE technician_id = $1`, [ids.techProfile]);
      await q(`DELETE FROM technician_profiles WHERE id = $1`, [ids.techProfile]);
      await q(`DELETE FROM technician_companies WHERE id = $1`, [ids.company]);
      if (users.length) await q(`DELETE FROM users WHERE id = ANY($1)`, [users]);
      await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
      await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
      await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
      await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
      await q(`DELETE FROM countries WHERE id = $1`, [ids.country]);
    } finally {
      if (dataSource?.isInitialized) await dataSource.destroy();
    }
  });

  it('getProfile() — كل الأبعاد الغنية بتتحسب صح من نفس المصادر الحقيقية', async () => {
    const p = await service.getProfile(ids.techProfile);

    expect(p.identity.id).toBe(ids.techProfile);
    expect(p.identity.verificationStatus).toBe('approved');

    expect(p.categories).toHaveLength(1);
    expect(p.zones).toHaveLength(1);

    expect(p.activity.online).toBe(false);

    expect(p.teamRole).not.toBeNull();
    expect(p.teamRole!.companyId).toBe(ids.company);
    expect(p.teamRole!.isOwner).toBe(true);

    expect(p.currentAndUpcomingJobs).toHaveLength(1);
    expect(p.currentAndUpcomingJobs[0].orderId).toBe(ids.order);

    expect(p.blockedDates).toHaveLength(1);

    expect(p.openOpportunitiesCount).toBe(1);

    expect(p.performance.averageRating).toBe(4.5);
    expect(p.performance.completedOrdersCount).toBe(20);
    expect(p.performance.cancelledOrdersCount).toBe(3);

    expect(p.cancellationBehavior.totalCancellations).toBe(1);
    expect(p.cancellationBehavior.recentCancellations).toBe(1);

    expect(p.complaints.openCount).toBe(1);
    expect(p.complaints.totalCount).toBe(1);
    expect(p.complaints.recent).toHaveLength(1);

    expect(p.wallet).not.toBeNull();
    expect(p.wallet!.balanceCents).toBe(15000);
    expect(p.wallet!.pendingBalanceCents).toBe(5000);

    expect(p.recentPayouts).toHaveLength(1);
    expect(p.recentPayouts[0].netAmountCents).toBe(20000);
    expect(p.recentPayouts[0].payoutStatus).toBe('completed');
  });

  it('getProfile() — فني غير موجود بيرمي خطأ واضح', async () => {
    await expect(service.getProfile('00000000-0000-0000-0000-000000000000')).rejects.toThrow();
  });
});
