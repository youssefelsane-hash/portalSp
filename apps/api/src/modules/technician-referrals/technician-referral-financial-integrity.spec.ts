import { DataSource, In } from 'typeorm';
import { User } from '../auth/entities/user.entity';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { UserDevice } from '../notifications/entities/user-device.entity';
import { Order } from '../orders/entities/order.entity';
import { PLATFORM_SYSTEM_USER_ID, Wallet, WalletOwnerType } from '../payments/entities/wallet.entity';
import { WalletTransaction, WalletTxType } from '../payments/entities/wallet-transaction.entity';
import { WalletsService } from '../payments/wallets.service';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { TechnicianReferralAttribution } from './entities/technician-referral-attribution.entity';
import { TechnicianReferralBonus, TechnicianReferralBonusStatus } from './entities/technician-referral-bonus.entity';
import { TechnicianReferralsService } from './technician-referrals.service';
import { AuditLogService } from '../audit/audit-log.service';
import { AuditLog } from '../audit/entities/audit-log.entity';

describe('Technician referral Phase 4 financial integrity', () => {
  let dataSource: DataSource;
  let service: TechnicianReferralsService;
  let walletsService: WalletsService;
  let auditLog: AuditLogService;
  let platformBalanceBefore = 0;
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
  const defaultSettings = new Map<string, boolean | number | string>([
    ['referral_qr.enabled', true],
    ['referral_qr.qualifying_min_order_status', 'completed'],
    ['referral_qr.reward_mode', 'first_order_only'],
    ['referral_qr.min_order_amount_cents', 0],
    ['referral_qr.bonus_amount_cents', 5000],
    ['referral_qr.reject_duplicate_device', false],
    ['referral_qr.min_minutes_between_bonuses', 0],
    ['referral_qr.max_monthly_bonus_cents_per_technician', 0],
  ]);
  const settings = new Map(defaultSettings);

  async function createOrder(customerIndex: number, label: string): Promise<string> {
    const customer = ids.customers[customerIndex];
    const [order] = await dataSource.query(
      `INSERT INTO orders
         (order_number, customer_id, technician_id, service_id, address_id, service_zone_id,
          order_status, total_amount_cents, technician_earning_cents)
       VALUES ($1,$2,$3,$4,$5,$6,'completed',30000,24000) RETURNING id`,
      // runId قبل الـlabel: `order_number` محدود بـ24 حرف، ولو الـrunId في الآخر بيتقص فيبقى
      // الرقم ثابت بين التشغيلات ⇒ تصادم unique مع صفوف تشغيلة سابقة ما اتنضفتش (حصل فعلًا).
      [`TR${runId}-${label}`.slice(0, 24), customer.profile, ids.techProfile, ids.service, customer.address, ids.zone],
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
        AuditLog,
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

    for (let index = 0; index < 5; index++) {
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
    platformBalanceBefore = (
      await walletsService.getOrCreateWallet(PLATFORM_SYSTEM_USER_ID, WalletOwnerType.PLATFORM)
    ).balanceCents;
    const settingsService = {
      getBoolean: async (key: string, fallback: boolean) => (settings.get(key) as boolean | undefined) ?? fallback,
      getString: async (key: string, fallback: string) => (settings.get(key) as string | undefined) ?? fallback,
      getNumber: async (key: string, fallback: number) => (settings.get(key) as number | undefined) ?? fallback,
    };
    auditLog = new AuditLogService(dataSource.getRepository(AuditLog));
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
      auditLog,
      { notify: async () => undefined } as never,
    );
  });

  beforeEach(() => {
    settings.clear();
    for (const [key, value] of defaultSettings) settings.set(key, value);
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
      await q(
        `DELETE FROM audit_logs
         WHERE entity_type = 'technician_referral_bonus'
           AND entity_id IN (SELECT id FROM technician_referral_bonuses WHERE technician_id = $1)`,
        [ids.techProfile],
      );
      await q(
        `UPDATE technician_referral_bonuses
         SET wallet_debit_tx_id = NULL, wallet_credit_tx_id = NULL
         WHERE technician_id = $1`,
        [ids.techProfile],
      );
      await q(
        `DELETE FROM wallet_transactions
         WHERE reference_type = 'technician_referral_bonus'
           AND (
             reference_id IN (SELECT id FROM technician_referral_bonuses WHERE technician_id = $1)
             OR reference_id = ANY($2::uuid[])
           )`,
        [ids.techProfile, ids.orders],
      );
      await q(`UPDATE wallets SET balance_cents = $1 WHERE owner_user_id = $2`, [
        platformBalanceBefore,
        PLATFORM_SYSTEM_USER_ID,
      ]);
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
    } finally {
      if (dataSource?.isInitialized) await dataSource.destroy();
    }
  });

  it('rolls back the bonus source row when the wallet effect cannot be created', async () => {
    const orderId = await createOrder(0, 'rollback');
    await walletsService.getOrCreateWallet(PLATFORM_SYSTEM_USER_ID, WalletOwnerType.PLATFORM);
    const technicianWallet = await walletsService.getOrCreateWallet(ids.techUser, WalletOwnerType.TECHNICIAN);
    await dataSource.query(`UPDATE wallets SET is_frozen = true, frozen_reason = 'failure injection' WHERE id = $1`, [
      technicianWallet.id,
    ]);
    // فكّ التجميد في finally: لو الاختبار وقع في النص، المحفظة كانت بتفضل مجمّدة في قاعدة البيانات
    // المشتركة، وأي تشغيلة بعدها بتفشل عند reconcilePendingBonuses لأنها بتمسح كل المكافآت
    // المعلّقة — مش بتاعة الفني ده بس (حصل فعلًا).
    try {
      await expect(service.evaluateOrderForBonus(orderId, 'completed')).rejects.toThrow('محفظة الطرف التاني مجمّدة');
      expect(await dataSource.getRepository(TechnicianReferralBonus).findOne({ where: { orderId } })).toBeNull();
    } finally {
      await dataSource.query(`UPDATE wallets SET is_frozen = false, frozen_reason = NULL WHERE id = $1`, [
        technicianWallet.id,
      ]);
    }
  });

  it('rolls back reward money when audit persistence fails and retries with one audit', async () => {
    settings.set('referral_qr.reward_mode', 'every_order');
    const orderId = await createOrder(1, 'audit-rollback');
    const before = (await walletsService.findByUserIdOrThrow(ids.techUser)).balanceCents;
    const failure = jest.spyOn(auditLog, 'record').mockRejectedValueOnce(new Error('simulated bonus audit failure'));

    try {
      await expect(service.evaluateOrderForBonus(orderId, 'completed')).rejects.toThrow('simulated bonus audit failure');
    } finally {
      failure.mockRestore();
    }

    expect(await dataSource.getRepository(TechnicianReferralBonus).findOne({ where: { orderId } })).toBeNull();
    expect((await walletsService.findByUserIdOrThrow(ids.techUser)).balanceCents).toBe(before);

    await service.evaluateOrderForBonus(orderId, 'completed');
    const bonus = await dataSource.getRepository(TechnicianReferralBonus).findOneByOrFail({ orderId });
    expect((await walletsService.findByUserIdOrThrow(ids.techUser)).balanceCents - before).toBe(5000);
    expect(await dataSource.getRepository(WalletTransaction).count({
      where: { referenceType: 'technician_referral_bonus', referenceId: bonus.id },
    })).toBe(2);
    expect(await dataSource.getRepository(AuditLog).count({
      where: { action: 'technician_referral.bonus_credited', entityId: bonus.id },
    })).toBe(1);
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
    const creditedBonus = bonuses.filter((bonus) => bonus.status === TechnicianReferralBonusStatus.CREDITED);
    expect(creditedBonus).toHaveLength(1);
    expect(await dataSource.getRepository(WalletTransaction).count({
      where: { referenceType: 'technician_referral_bonus', referenceId: creditedBonus[0].id },
    })).toBe(2);
  });

  it('enforces the monthly cap atomically for two different customers', async () => {
    settings.set('referral_qr.reward_mode', 'every_order');
    const [{ total }] = await dataSource.query(
      `SELECT COALESCE(SUM(bonus_amount_cents), 0)::int AS total
       FROM technician_referral_bonuses
       WHERE technician_id = $1 AND status = 'credited'
         AND credited_at >= date_trunc('month', now())`,
      [ids.techProfile],
    );
    settings.set('referral_qr.max_monthly_bonus_cents_per_technician', Number(total) + 5000);
    const firstOrder = await createOrder(1, 'cap-a');
    const secondOrder = await createOrder(2, 'cap-b');
    const before = (await walletsService.findByUserIdOrThrow(ids.techUser)).balanceCents;
    await Promise.all([
      service.evaluateOrderForBonus(firstOrder, 'completed'),
      service.evaluateOrderForBonus(secondOrder, 'completed'),
    ]);
    const bonuses = await dataSource.getRepository(TechnicianReferralBonus).find({
      where: { orderId: In([firstOrder, secondOrder]) },
    });
    expect(bonuses.filter((bonus) => bonus.status === TechnicianReferralBonusStatus.CREDITED)).toHaveLength(1);
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

  it('recovers a missed qualifying-order event once from durable order and attribution state', async () => {
    await service.reconcilePendingBonuses(25);
    const orderId = await createOrder(3, 'missed-event');
    const before = (await walletsService.findByUserIdOrThrow(ids.techUser)).balanceCents;

    await service.reconcilePendingBonuses(25);
    const bonus = await dataSource.getRepository(TechnicianReferralBonus).findOneByOrFail({ orderId });
    expect(bonus.status).toBe(TechnicianReferralBonusStatus.CREDITED);
    expect((await walletsService.findByUserIdOrThrow(ids.techUser)).balanceCents - before).toBe(5000);
    expect(await dataSource.getRepository(WalletTransaction).count({
      where: { referenceType: 'technician_referral_bonus', referenceId: bonus.id },
    })).toBe(2);

    await service.reconcilePendingBonuses(25);
    expect(await dataSource.getRepository(TechnicianReferralBonus).count({ where: { orderId } })).toBe(1);
    expect((await walletsService.findByUserIdOrThrow(ids.techUser)).balanceCents - before).toBe(5000);
  });

  it('keeps reward versus terminal transition/revoke financially coherent under concurrency', async () => {
    settings.set('referral_qr.reward_mode', 'every_order');
    const orderId = await createOrder(4, 'reward-revoke');
    const before = (await walletsService.findByUserIdOrThrow(ids.techUser)).balanceCents;

    await Promise.all([
      service.evaluateOrderForBonus(orderId, 'completed'),
      (async () => {
        await dataSource.transaction(async (manager) => {
          const order = await manager
            .createQueryBuilder(Order, 'order')
            .setLock('pessimistic_write')
            .where('order.id = :orderId', { orderId })
            .getOneOrFail();
          order.orderStatus = 'refunded' as Order['orderStatus'];
          await manager.save(order);
        });
        await service.revokeBonusForOrder(orderId, 'انتقال نهائي متزامن');
      })(),
    ]);

    const bonus = await dataSource.getRepository(TechnicianReferralBonus).findOne({ where: { orderId } });
    expect(bonus === null || bonus.status === TechnicianReferralBonusStatus.REVOKED).toBe(true);
    expect((await walletsService.findByUserIdOrThrow(ids.techUser)).balanceCents).toBe(before);
    expect(await dataSource.getRepository(WalletTransaction).count({
      where: { referenceType: 'technician_referral_bonus', referenceId: bonus?.id ?? orderId },
    })).toBe(bonus ? 4 : 0);
  });

  it('rebuilds a durable bonus after the legacy credit-before-save crash without crediting twice', async () => {
    const orderId = await createOrder(4, 'legacy-orphan');
    const platformWallet = await walletsService.findByUserIdOrThrow(PLATFORM_SYSTEM_USER_ID);
    const technicianWallet = await walletsService.findByUserIdOrThrow(ids.techUser);
    const before = technicianWallet.balanceCents;
    const legacy = await walletsService.doubleEntry({
      fromWalletId: platformWallet.id,
      toWalletId: technicianWallet.id,
      amountCents: 5300,
      transactionType: WalletTxType.REFERRAL_REWARD,
      referenceType: 'technician_referral_bonus',
      referenceId: orderId,
      descriptionAr: 'محاكاة crash قديم بعد القيد وقبل سجل المكافأة',
      allowNegativeBalance: true,
    });

    expect((await walletsService.findByUserIdOrThrow(ids.techUser)).balanceCents - before).toBe(5300);
    await service.reconcilePendingBonuses(25);
    const recovered = await dataSource.getRepository(TechnicianReferralBonus).findOneByOrFail({ orderId });
    expect(recovered.status).toBe(TechnicianReferralBonusStatus.CREDITED);
    expect(recovered.bonusAmountCents).toBe(5300);
    expect(recovered.walletDebitTxId).toBe(legacy.debit.id);
    expect(recovered.walletCreditTxId).toBe(legacy.credit.id);
    expect((await walletsService.findByUserIdOrThrow(ids.techUser)).balanceCents - before).toBe(5300);
    expect(await dataSource.getRepository(WalletTransaction).count({
      where: { referenceType: 'technician_referral_bonus', referenceId: orderId },
    })).toBe(2);

    await service.reconcilePendingBonuses(25);
    expect(await dataSource.getRepository(TechnicianReferralBonus).count({ where: { orderId } })).toBe(1);
    expect((await walletsService.findByUserIdOrThrow(ids.techUser)).balanceCents - before).toBe(5300);
  });

  it('recovers and reverses a legacy orphan whose order became refunded before the sweep', async () => {
    const orderId = await createOrder(3, 'legacy-terminal');
    const platformWallet = await walletsService.findByUserIdOrThrow(PLATFORM_SYSTEM_USER_ID);
    const technicianWallet = await walletsService.findByUserIdOrThrow(ids.techUser);
    const before = technicianWallet.balanceCents;
    const legacy = await walletsService.doubleEntry({
      fromWalletId: platformWallet.id,
      toWalletId: technicianWallet.id,
      amountCents: 5400,
      transactionType: WalletTxType.REFERRAL_REWARD,
      referenceType: 'technician_referral_bonus',
      referenceId: orderId,
      descriptionAr: 'قيد قديم سبق انتقال الطلب النهائي',
      allowNegativeBalance: true,
    });
    await dataSource.query(`UPDATE orders SET order_status = 'refunded', deleted_at = now() WHERE id = $1`, [orderId]);

    await service.reconcilePendingBonuses(25);
    const recovered = await dataSource.getRepository(TechnicianReferralBonus).findOneByOrFail({ orderId });
    expect(recovered.status).toBe(TechnicianReferralBonusStatus.REVOKED);
    expect(recovered.walletDebitTxId).toBe(legacy.debit.id);
    expect(recovered.walletCreditTxId).toBe(legacy.credit.id);
    expect((await walletsService.findByUserIdOrThrow(ids.techUser)).balanceCents).toBe(before);
    expect(await dataSource.getRepository(WalletTransaction).count({
      where: { referenceType: 'technician_referral_bonus', referenceId: orderId },
    })).toBe(4);
  });

  it('terminates malformed legacy recovery in manual review instead of retrying forever', async () => {
    const orderId = await createOrder(2, 'legacy-manual');
    const platformWallet = await walletsService.findByUserIdOrThrow(PLATFORM_SYSTEM_USER_ID);
    const technicianWallet = await walletsService.findByUserIdOrThrow(ids.techUser);
    const legacy = await walletsService.doubleEntry({
      fromWalletId: platformWallet.id,
      toWalletId: technicianWallet.id,
      amountCents: 5500,
      transactionType: WalletTxType.REFERRAL_REWARD,
      referenceType: 'technician_referral_bonus',
      referenceId: orderId,
      descriptionAr: 'قيد قديم ناقص يحتاج مراجعة',
      allowNegativeBalance: true,
    });
    await dataSource.getRepository(WalletTransaction).delete(legacy.debit.id);

    await service.reconcilePendingBonuses(25);
    const manual = await dataSource.getRepository(TechnicianReferralBonus).findOneByOrFail({ orderId });
    expect(manual.status).toBe(TechnicianReferralBonusStatus.MANUAL_REVIEW);
    expect(manual.bonusAmountCents).toBe(5500);
    expect(manual.rejectionReason).toContain('غير متسقة');
    await service.reconcilePendingBonuses(25);
    const stillManual = await dataSource.getRepository(TechnicianReferralBonus).findOneByOrFail({ orderId });
    expect(stillManual.status).toBe(TechnicianReferralBonusStatus.MANUAL_REVIEW);
    expect(stillManual.walletDebitTxId).toBeNull();
    expect(await dataSource.getRepository(TechnicianReferralBonus).count({ where: { orderId } })).toBe(1);
  });
});
