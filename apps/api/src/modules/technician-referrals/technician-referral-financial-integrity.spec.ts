import { DataSource } from 'typeorm';
import { User } from '../auth/entities/user.entity';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { UserDevice } from '../notifications/entities/user-device.entity';
import { Order } from '../orders/entities/order.entity';
import { PLATFORM_SYSTEM_USER_ID, Wallet, WalletOwnerType } from '../payments/entities/wallet.entity';
import { WalletTransaction } from '../payments/entities/wallet-transaction.entity';
import { WalletsService } from '../payments/wallets.service';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { TechnicianReferralAttribution } from './entities/technician-referral-attribution.entity';
import { TechnicianReferralBonus, TechnicianReferralBonusStatus } from './entities/technician-referral-bonus.entity';
import { TechnicianReferralsService } from './technician-referrals.service';

describe('Technician referral Phase 4 financial integrity', () => {
  let dataSource: DataSource;
  let service: TechnicianReferralsService;
  let walletsService: WalletsService;
  const runId = Date.now().toString(36);
  const ids = {
    city: '',
    zone: '',
    category: '',
    service: '',
    techUser: '',
    techProfile: '',
    customers: [] as Array<{ user: string; profile: string; address: string }>,
    orders: [] as string[],
  };
  const settings = new Map<string, boolean | number | string>([
    ['referral_qr.enabled', true],
    ['referral_qr.qualifying_min_order_status', 'completed'],
    ['referral_qr.reward_mode', 'first_order_only'],
    ['referral_qr.min_order_amount_cents', 0],
    ['referral_qr.bonus_amount_cents', 5000],
    ['referral_qr.reject_duplicate_device', false],
    ['referral_qr.min_minutes_between_bonuses', 0],
    ['referral_qr.max_monthly_bonus_cents_per_technician', 0],
  ]);

  async function createOrder(customerIndex: number, label: string): Promise<string> {
    const customer = ids.customers[customerIndex];
    const [order] = await dataSource.query(
      `INSERT INTO orders
         (order_number, customer_id, technician_id, service_id, address_id, service_zone_id,
          order_status, total_amount_cents, technician_earning_cents)
       VALUES ($1,$2,$3,$4,$5,$6,'completed',30000,24000) RETURNING id`,
      [`TRFI-${label}-${runId}`.slice(0, 24), customer.profile, ids.techProfile, ids.service, customer.address, ids.zone],
    );
    ids.orders.push(order.id);
    return order.id;
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [
        User,
        CustomerProfile,
        UserDevice,
        Order,
        Wallet,
        WalletTransaction,
        TechnicianProfile,
        TechnicianReferralAttribution,
        TechnicianReferralBonus,
      ],
    });
    await dataSource.initialize();
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    const [country] = await q(`SELECT id FROM countries WHERE iso_code = 'EG' LIMIT 1`);
    const [city] = await q(
      `INSERT INTO cities (country_id, name_ar, name_en, slug) VALUES ($1,$2,$3,$4) RETURNING id`,
      [country.id, `مدينة إحالة ${runId}`, `Referral City ${runId}`, `referral-city-${runId}`],
    );
    ids.city = city.id;
    const [zone] = await q(
      `INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`,
      [ids.city, `نطاق إحالة ${runId}`, `Referral Zone ${runId}`],
    );
    ids.zone = zone.id;
    const [category] = await q(
      `INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`,
      [`فئة إحالة ${runId}`, `Referral Category ${runId}`, `referral-category-${runId}`],
    );
    ids.category = category.id;
    const [catalogService] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days)
       VALUES ($1,$2,$3,'fixed',30000,20,0) RETURNING id`,
      [ids.category, `خدمة إحالة ${runId}`, `referral-service-${runId}`],
    );
    ids.service = catalogService.id;

    const [techUser] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`,
      [`+2071${runId}`.slice(0, 15), `فني إحالة ${runId}`],
    );
    ids.techUser = techUser.id;
    const [techProfile] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, years_of_experience, current_level, verification_status)
       VALUES ($1,$2,3,'new','approved') RETURNING id`,
      [ids.techUser, `TRFI${runId}`.slice(0, 20)],
    );
    ids.techProfile = techProfile.id;

    for (let index = 0; index < 3; index++) {
      const [user] = await q(
        `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`,
        [`+2072${runId}${index}`.slice(0, 15), `عميل إحالة ${index} ${runId}`],
      );
      const [profile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [user.id]);
      const [address] = await q(
        `INSERT INTO addresses (user_id, street_name, location)
         VALUES ($1,$2,ST_SetSRID(ST_MakePoint(31.25,30.05),4326)::geography) RETURNING id`,
        [user.id, `شارع إحالة ${index}`],
      );
      ids.customers.push({ user: user.id, profile: profile.id, address: address.id });
      await q(
        `INSERT INTO technician_referral_attributions (technician_id, customer_user_id, referral_token)
         VALUES ($1,$2,$3)`,
        [ids.techProfile, user.id, `TRFI${runId}`.slice(0, 20)],
      );
    }

    walletsService = new WalletsService(
      dataSource.getRepository(Wallet),
      dataSource.getRepository(WalletTransaction),
      dataSource,
    );
    const settingsService = {
      getBoolean: async (key: string, fallback: boolean) => (settings.get(key) as boolean | undefined) ?? fallback,
      getString: async (key: string, fallback: string) => (settings.get(key) as string | undefined) ?? fallback,
      getNumber: async (key: string, fallback: number) => (settings.get(key) as number | undefined) ?? fallback,
    };
    service = new TechnicianReferralsService(
      dataSource.getRepository(TechnicianReferralAttribution),
      dataSource.getRepository(TechnicianReferralBonus),
      dataSource.getRepository(TechnicianProfile),
      dataSource.getRepository(Order),
      dataSource.getRepository(CustomerProfile),
      dataSource.getRepository(UserDevice),
      dataSource.getRepository(WalletTransaction),
      dataSource,
      settingsService as never,
      walletsService,
      { record: async () => undefined } as never,
      { notify: async () => undefined } as never,
    );
  });

  afterAll(async () => {
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    await q(
      `UPDATE technician_referral_bonuses
       SET wallet_debit_tx_id = NULL, wallet_credit_tx_id = NULL
       WHERE technician_id = $1`,
      [ids.techProfile],
    );
    await q(
      `DELETE FROM wallet_transactions
       WHERE reference_type = 'technician_referral_bonus'
         AND reference_id IN (SELECT id FROM technician_referral_bonuses WHERE technician_id = $1)`,
      [ids.techProfile],
    );
    await q(`DELETE FROM technician_referral_bonuses WHERE technician_id = $1`, [ids.techProfile]);
    await q(`DELETE FROM technician_referral_attributions WHERE technician_id = $1`, [ids.techProfile]);
    await q(`DELETE FROM wallets WHERE owner_user_id = $1`, [ids.techUser]);
    await q(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [ids.orders]);
    await q(`DELETE FROM addresses WHERE user_id = ANY($1::uuid[])`, [ids.customers.map((item) => item.user)]);
    await q(`DELETE FROM customer_profiles WHERE id = ANY($1::uuid[])`, [ids.customers.map((item) => item.profile)]);
    await q(`DELETE FROM technician_profiles WHERE id = $1`, [ids.techProfile]);
    await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[ids.techUser, ...ids.customers.map((item) => item.user)]]);
    await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
    await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
    await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
    await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    await dataSource.destroy();
  });

  it('rolls back the bonus source row when the wallet effect cannot be created', async () => {
    const orderId = await createOrder(0, 'rollback');
    await walletsService.getOrCreateWallet(PLATFORM_SYSTEM_USER_ID, WalletOwnerType.PLATFORM);
    const technicianWallet = await walletsService.getOrCreateWallet(ids.techUser, WalletOwnerType.TECHNICIAN);
    await dataSource.query(`UPDATE wallets SET is_frozen = true, frozen_reason = 'failure injection' WHERE id = $1`, [
      technicianWallet.id,
    ]);
    await expect(service.evaluateOrderForBonus(orderId, 'completed')).rejects.toThrow('محفظة الطرف التاني مجمّدة');
    expect(await dataSource.getRepository(TechnicianReferralBonus).findOne({ where: { orderId } })).toBeNull();
    await dataSource.query(`UPDATE wallets SET is_frozen = false, frozen_reason = NULL WHERE id = $1`, [technicianWallet.id]);
  });

  it('serializes two first-order-only rewards for the same customer', async () => {
    const firstOrder = await createOrder(0, 'first-a');
    const secondOrder = await createOrder(0, 'first-b');
    await Promise.all([
      service.evaluateOrderForBonus(firstOrder, 'completed'),
      service.evaluateOrderForBonus(secondOrder, 'completed'),
    ]);
    const bonuses = await dataSource.getRepository(TechnicianReferralBonus).find({
      where: { technicianId: ids.techProfile, customerUserId: ids.customers[0].user },
    });
    expect(bonuses.filter((bonus) => bonus.status === TechnicianReferralBonusStatus.CREDITED)).toHaveLength(1);
    expect(await dataSource.getRepository(WalletTransaction).count({
      where: { referenceType: 'technician_referral_bonus', referenceId: bonuses[0].id },
    })).toBe(2);
  });

  it('enforces the monthly cap atomically for two different customers', async () => {
    settings.set('referral_qr.reward_mode', 'every_order');
    settings.set('referral_qr.max_monthly_bonus_cents_per_technician', 10000);
    const firstOrder = await createOrder(1, 'cap-a');
    const secondOrder = await createOrder(2, 'cap-b');
    const before = (await walletsService.findByUserIdOrThrow(ids.techUser)).balanceCents;
    await Promise.all([
      service.evaluateOrderForBonus(firstOrder, 'completed'),
      service.evaluateOrderForBonus(secondOrder, 'completed'),
    ]);
    const bonuses = await dataSource.getRepository(TechnicianReferralBonus).find({
      where: { technicianId: ids.techProfile },
    });
    expect(bonuses.filter((bonus) => bonus.status === TechnicianReferralBonusStatus.CREDITED)).toHaveLength(2);
    expect(bonuses.filter((bonus) => bonus.status === TechnicianReferralBonusStatus.REJECTED_SUSPICIOUS)).toHaveLength(1);
    expect((await walletsService.findByUserIdOrThrow(ids.techUser)).balanceCents - before).toBe(5000);
  });

  it('reverses a credited bonus once under concurrent revoke calls', async () => {
    const bonus = await dataSource.getRepository(TechnicianReferralBonus).findOneOrFail({
      where: { technicianId: ids.techProfile, status: TechnicianReferralBonusStatus.CREDITED },
    });
    const before = (await walletsService.findByUserIdOrThrow(ids.techUser)).balanceCents;
    await Promise.all([
      service.revokeBonusForOrder(bonus.orderId, 'اختبار إلغاء متزامن'),
      service.revokeBonusForOrder(bonus.orderId, 'اختبار إلغاء متزامن'),
    ]);
    const reloaded = await dataSource.getRepository(TechnicianReferralBonus).findOneByOrFail({ id: bonus.id });
    expect(reloaded.status).toBe(TechnicianReferralBonusStatus.REVOKED);
    expect(before - (await walletsService.findByUserIdOrThrow(ids.techUser)).balanceCents).toBe(bonus.bonusAmountCents);
    expect(await dataSource.getRepository(WalletTransaction).count({
      where: { referenceType: 'technician_referral_bonus', referenceId: bonus.id },
    })).toBe(4);
  });
});
