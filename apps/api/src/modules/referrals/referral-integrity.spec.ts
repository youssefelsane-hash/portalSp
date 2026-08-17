import { DataSource } from 'typeorm';
import { User } from '../auth/entities/user.entity';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { Order } from '../orders/entities/order.entity';
import { PromoCode } from '../promotions/entities/promo-code.entity';
import { PromoCodeUsage } from '../promotions/entities/promo-code-usage.entity';
import { PromoCodesService } from '../promotions/promo-codes.service';
import { ReferralReward } from './entities/referral-reward.entity';
import { Referral, ReferralStatus } from './entities/referral.entity';
import { ReferralsService } from './referrals.service';

describe('ReferralsService Phase 4 milestone and recovery integrity', () => {
  let dataSource: DataSource;
  let service: ReferralsService;
  const runId = Date.now().toString(36);
  const ids = {
    city: '',
    zone: '',
    category: '',
    service: '',
    referrer: '',
    legacyUser: '',
    referred: [] as Array<{ user: string; profile: string; address: string; order: string }>,
  };

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [User, CustomerProfile, Order, Referral, ReferralReward, PromoCode, PromoCodeUsage],
    });
    await dataSource.initialize();
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    const [country] = await q(`SELECT id FROM countries WHERE iso_code = 'EG' LIMIT 1`);
    const [city] = await q(
      `INSERT INTO cities (country_id, name_ar, name_en, slug) VALUES ($1,$2,$3,$4) RETURNING id`,
      [country.id, `مدينة referral ${runId}`, `Referral City ${runId}`, `referral-standard-city-${runId}`],
    );
    ids.city = city.id;
    const [zone] = await q(
      `INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`,
      [ids.city, `نطاق referral ${runId}`, `Referral Zone ${runId}`],
    );
    ids.zone = zone.id;
    const [category] = await q(
      `INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`,
      [`فئة referral ${runId}`, `Referral Category ${runId}`, `referral-standard-category-${runId}`],
    );
    ids.category = category.id;
    const [catalogService] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days)
       VALUES ($1,$2,$3,'fixed',10000,20,0) RETURNING id`,
      [ids.category, `خدمة referral ${runId}`, `referral-standard-service-${runId}`],
    );
    ids.service = catalogService.id;

    const [referrer] = await q(
      `INSERT INTO users (phone_number, full_name, user_type, referral_code)
       VALUES ($1,$2,'customer',$3) RETURNING id`,
      [`+2075${runId}`.slice(0, 15), `مرشح ${runId}`, `RF${runId}`.toUpperCase().slice(0, 12)],
    );
    ids.referrer = referrer.id;
    const [legacy] = await q(
      `INSERT INTO users (phone_number, full_name, user_type, referral_code)
       VALUES ($1,$2,'customer',NULL) RETURNING id`,
      [`+2076${runId}`.slice(0, 15), `مستخدم قديم ${runId}`],
    );
    ids.legacyUser = legacy.id;

    for (let index = 0; index < 4; index++) {
      const [user] = await q(
        `INSERT INTO users (phone_number, full_name, user_type, referred_by_user_id)
         VALUES ($1,$2,'customer',$3) RETURNING id`,
        [`+2077${runId}${index}`.slice(0, 15), `عميل referral ${index} ${runId}`, ids.referrer],
      );
      const [profile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [user.id]);
      const [address] = await q(
        `INSERT INTO addresses (user_id, street_name, location)
         VALUES ($1,$2,ST_SetSRID(ST_MakePoint(31.25,30.05),4326)::geography) RETURNING id`,
        [user.id, `شارع referral ${index}`],
      );
      const [order] = await q(
        `INSERT INTO orders
           (order_number, customer_id, service_id, address_id, service_zone_id, order_status, total_amount_cents)
         VALUES ($1,$2,$3,$4,$5,'completed',10000) RETURNING id`,
        [`RFI-${index}-${runId}`.slice(0, 24), profile.id, ids.service, address.id, ids.zone],
      );
      ids.referred.push({ user: user.id, profile: profile.id, address: address.id, order: order.id });
    }

    const promoCodes = new PromoCodesService(
      dataSource.getRepository(PromoCode),
      dataSource.getRepository(PromoCodeUsage),
      { record: async () => undefined } as never,
    );
    const settings = {
      getNumber: async (key: string, fallback: number) =>
        ({
          'referral.required_referrals_per_reward': 2,
          'referral.reward_value_egp': 150,
          'referral.reward_validity_days': 90,
        })[key] ?? fallback,
    };
    service = new ReferralsService(
      dataSource.getRepository(User),
      dataSource.getRepository(Referral),
      dataSource,
      {} as never,
      promoCodes,
      settings as never,
      { emit: jest.fn() } as never,
    );
  });

  afterAll(async () => {
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    await q(`DELETE FROM referral_rewards WHERE referrer_user_id = $1`, [ids.referrer]);
    await q(`DELETE FROM promo_codes WHERE restricted_to_user_id = $1`, [ids.referrer]);
    await q(`DELETE FROM referrals WHERE referrer_user_id = $1`, [ids.referrer]);
    await q(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [ids.referred.map((item) => item.order)]);
    await q(`DELETE FROM addresses WHERE id = ANY($1::uuid[])`, [ids.referred.map((item) => item.address)]);
    await q(`DELETE FROM customer_profiles WHERE id = ANY($1::uuid[])`, [ids.referred.map((item) => item.profile)]);
    await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [
      [ids.referrer, ids.legacyUser, ...ids.referred.map((item) => item.user)],
    ]);
    await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
    await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
    await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
    await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    await dataSource.destroy();
  });

  it('recovers missed registration/completion events and issues one durable milestone reward', async () => {
    expect(await service.reconcilePending(2)).toBe(2);
    const completed = await dataSource.getRepository(Referral).count({
      where: { referrerUserId: ids.referrer, status: ReferralStatus.COMPLETED },
    });
    expect(completed).toBe(2);
    const rewards = await dataSource.getRepository(ReferralReward).find({ where: { referrerUserId: ids.referrer } });
    expect(rewards).toHaveLength(1);
    expect(rewards[0].milestoneCount).toBe(2);
    expect(await dataSource.getRepository(PromoCode).count({ where: { restrictedToUserId: ids.referrer } })).toBe(1);
  });

  it('serializes simultaneous milestone completions at the referrer scope', async () => {
    await Promise.all(
      ids.referred.slice(2).map((item) => service.createPendingReferral(ids.referrer, item.user)),
    );
    await Promise.all(
      ids.referred.slice(2).map((item) => service.handleOrderCompleted(item.profile, item.order)),
    );
    const rewards = await dataSource.getRepository(ReferralReward).find({
      where: { referrerUserId: ids.referrer },
      order: { milestoneCount: 'ASC' },
    });
    expect(rewards.map((reward) => reward.milestoneCount)).toEqual([2, 4]);
    expect(await dataSource.getRepository(PromoCode).count({ where: { restrictedToUserId: ids.referrer } })).toBe(2);
  });

  it('returns only the referral code actually persisted during concurrent lazy assignment', async () => {
    const [first, second] = await Promise.all([
      service.getMyReferralInfo(ids.legacyUser),
      service.getMyReferralInfo(ids.legacyUser),
    ]);
    const persisted = await dataSource.getRepository(User).findOneByOrFail({ id: ids.legacyUser });
    expect(first.referralCode).toBe(second.referralCode);
    expect(first.referralCode).toBe(persisted.referralCode);
  });
});
