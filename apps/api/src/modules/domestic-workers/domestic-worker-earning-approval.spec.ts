import { DataSource } from 'typeorm';
import { ApiException } from '../../common/exceptions/api.exception';
import { User } from '../auth/entities/user.entity';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { CustomerProfilesService } from '../customers/customer-profiles.service';
import { PLATFORM_SYSTEM_USER_ID, Wallet, WalletOwnerType } from '../payments/entities/wallet.entity';
import { WalletTransaction } from '../payments/entities/wallet-transaction.entity';
import { WalletsService } from '../payments/wallets.service';
import { SettingsService } from '../settings/settings.service';
import { DomesticWorkerBookingsService } from './domestic-worker-bookings.service';
import { DomesticWorkerEarningApprovalsService } from './domestic-worker-earning-approvals.service';
import { DomesticWorkersService } from './domestic-workers.service';
import { DomesticWorkerBooking, DomesticWorkerBookingStatus, DomesticWorkerBookingType } from './entities/domestic-worker-booking.entity';
import { DomesticWorkerEarningApproval, DomesticWorkerEarningApprovalStatus } from './entities/domestic-worker-earning-approval.entity';
import { DomesticWorkerProfile } from './entities/domestic-worker-profile.entity';

// اختبار حي ضد Postgres حقيقي — بيثبت قرار المالك الصريح (docs/08 §25.1، 2026-08-15): أرباح
// العمالة المنزلية ممنوع تتحول رصيد قابل للصرف تلقائيًا عند قبول الحجز ولا قبل تنفيذ الخدمة،
// وبعد الاكتمال بتدخل "pending"، ومتترجعش رصيد فعلي إلا بموافقة أدمن — مفروضة من الباك-إند نفسه
// (فحص حالة صريح بيمنع موافقة/رفض مزدوج)، مش مجرد زرار واجهة.
describe('طابور موافقة أرباح العمالة المنزلية — pending لحد موافقة أدمن (docs/08 §25.1)', () => {
  jest.setTimeout(30_000);

  let dataSource: DataSource;
  let bookingsService: DomesticWorkerBookingsService;
  let approvalsService: DomesticWorkerEarningApprovalsService;
  let walletsService: WalletsService;

  const runId = Date.now().toString(36);
  const DOMESTIC_WORKER_COMMISSION_PERCENTAGE = 15;
  const ids = {
    customerUser: '',
    customerProfile: '',
    workerUser: '',
    workerProfile: '',
    adminUser: '',
  };
  const bookingIds: string[] = [];

  async function insertHourlyBooking(label: string, priceCents: number): Promise<string> {
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    const [{ next_human_readable_number: bookingNumber }] = await dataSource.query<{ next_human_readable_number: string }[]>(
      "SELECT next_human_readable_number('DWB')",
    );
    const [row] = await q(
      `INSERT INTO domestic_worker_bookings
         (booking_number, customer_id, worker_id, address_id, specialty, booking_type, scheduled_at, duration_hours, price_cents, status)
       VALUES ($1,$2,$3,
         (SELECT id FROM addresses WHERE user_id = $4 LIMIT 1),
         'cleaning_hourly', 'hourly', now() + interval '1 day', 3, $5, 'pending_confirmation')
       RETURNING id`,
      [`TESTDWEA-${label}`.slice(0, 24), ids.customerProfile, ids.workerProfile, ids.customerUser, priceCents],
    );
    bookingIds.push(row.id as string);
    return row.id as string;
  }

  async function insertMonthlyBooking(label: string, priceCents: number, dueForRenewal = false): Promise<string> {
    const [row] = await dataSource.query(
      `INSERT INTO domestic_worker_bookings
         (booking_number, customer_id, worker_id, address_id, specialty, booking_type, scheduled_at,
          auto_renew, current_period_end_at, price_cents, status, confirmed_at)
       VALUES ($1,$2,$3,
         (SELECT id FROM addresses WHERE user_id = $4 LIMIT 1),
         'live_in_maid_monthly', 'monthly_live_in', now() + interval '1 day',
         $5, CASE WHEN $5 THEN now() - interval '1 day' ELSE NULL END, $6,
         CASE WHEN $5 THEN 'active'::domestic_worker_booking_status ELSE 'pending_confirmation'::domestic_worker_booking_status END,
         CASE WHEN $5 THEN now() - interval '1 month' ELSE NULL END)
       RETURNING id`,
      [`TESTDWEA-${label}`.slice(0, 24), ids.customerProfile, ids.workerProfile, ids.customerUser, dueForRenewal, priceCents],
    );
    bookingIds.push(row.id as string);
    return row.id as string;
  }

  async function workerWalletBalance(): Promise<number> {
    const [row] = await dataSource.query(`SELECT balance_cents FROM wallets WHERE owner_user_id = $1`, [ids.workerUser]);
    return row ? Number(row.balance_cents) : 0;
  }

  async function pendingApprovalForBooking(bookingId: string): Promise<DomesticWorkerEarningApproval | null> {
    return dataSource.getRepository(DomesticWorkerEarningApproval).findOne({ where: { bookingId } });
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [User, CustomerProfile, Wallet, WalletTransaction, DomesticWorkerBooking, DomesticWorkerProfile, DomesticWorkerEarningApproval],
    });
    await dataSource.initialize();
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

    const [customerUser] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [`+2024${runId}`.slice(0, 15), `عميل اختبار ${runId}`],
    );
    ids.customerUser = customerUser.id;
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customerUser]);
    ids.customerProfile = customerProfile.id;
    await q(
      `INSERT INTO addresses (user_id, street_name, location) VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography)`,
      [ids.customerUser, `شارع اختبار ${runId}`],
    );

    const [workerUser] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'domestic_worker') RETURNING id`,
      [`+2025${runId}`.slice(0, 15), `شغالة اختبار ${runId}`],
    );
    ids.workerUser = workerUser.id;
    const [workerProfile] = await q(
      `INSERT INTO domestic_worker_profiles (user_id, worker_code, hourly_rate_cents) VALUES ($1,$2,10000) RETURNING id`,
      [ids.workerUser, `DW${runId}`.slice(0, 20)],
    );
    ids.workerProfile = workerProfile.id;

    const [adminUser] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'admin') RETURNING id`,
      [`+2026${runId}`.slice(0, 15), `أدمن اختبار ${runId}`],
    );
    ids.adminUser = adminUser.id;

    // The integration test does not need a real Redis client for one deterministic setting.
    const settingsService = {
      getNumber: async () => DOMESTIC_WORKER_COMMISSION_PERCENTAGE,
    } as unknown as SettingsService;
    walletsService = new WalletsService(dataSource.getRepository(Wallet), dataSource.getRepository(WalletTransaction), dataSource);
    const customerProfilesService = new CustomerProfilesService(dataSource.getRepository(CustomerProfile), dataSource);
    const workersService = new DomesticWorkersService(dataSource.getRepository(DomesticWorkerProfile), { record: async () => undefined } as never);

    await walletsService.getOrCreateWallet(PLATFORM_SYSTEM_USER_ID, WalletOwnerType.PLATFORM);
    const customerWallet = await walletsService.getOrCreateWallet(ids.customerUser, WalletOwnerType.CUSTOMER);
    await q(`UPDATE wallets SET balance_cents = 1000000 WHERE id = $1`, [customerWallet.id]);

    bookingsService = new DomesticWorkerBookingsService(
      dataSource.getRepository(DomesticWorkerBooking),
      dataSource.getRepository(DomesticWorkerProfile),
      dataSource.getRepository(DomesticWorkerEarningApproval),
      dataSource,
      customerProfilesService,
      {} as never, // addressesService — مش متنادى، الاختبار بيعمل insert مباشر للحجز
      workersService,
      walletsService,
      settingsService,
    );

    approvalsService = new DomesticWorkerEarningApprovalsService(
      dataSource.getRepository(DomesticWorkerEarningApproval),
      dataSource,
      walletsService,
      { record: async () => undefined } as never,
    );
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
      await q(
        `DELETE FROM wallet_transactions
         WHERE reference_type IN ('domestic_worker_booking', 'domestic_worker_earning_approval')
           AND (
             reference_id = ANY($1::uuid[])
             OR reference_id IN (
               SELECT id FROM domestic_worker_earning_approvals WHERE worker_user_id = $2
             )
           )`,
        [bookingIds, ids.workerUser],
      );
      await q(`DELETE FROM domestic_worker_earning_approvals WHERE worker_user_id = $1`, [ids.workerUser]);
      await q(`DELETE FROM wallet_transactions WHERE wallet_id IN (SELECT id FROM wallets WHERE owner_user_id IN ($1, $2))`, [
        ids.workerUser,
        ids.customerUser,
      ]);
      await q(`DELETE FROM wallets WHERE owner_user_id IN ($1, $2)`, [ids.workerUser, ids.customerUser]);
      await q(`DELETE FROM domestic_worker_bookings WHERE customer_id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM domestic_worker_profiles WHERE id = $1`, [ids.workerProfile]);
      await q(`DELETE FROM addresses WHERE user_id = $1`, [ids.customerUser]);
      await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM users WHERE id IN ($1, $2, $3)`, [ids.customerUser, ids.workerUser, ids.adminUser]);
    } finally {
      await dataSource.destroy();
    }
  });

  it('تأكيد حجز بالساعة: العميل بيتخصم بس — صفر أرباح pending وصفر رصيد للشغالة قبل الاكتمال', async () => {
    const bookingId = await insertHourlyBooking('confirm', 30000);
    await bookingsService.confirm(ids.workerUser, bookingId);

    const booking = await dataSource.getRepository(DomesticWorkerBooking).findOne({ where: { id: bookingId } });
    expect(booking?.status).toBe(DomesticWorkerBookingStatus.CONFIRMED);
    expect(await pendingApprovalForBooking(bookingId)).toBeNull();
    expect(await workerWalletBalance()).toBe(0);
  });

  it('اكتمال الزيارة: استحقاق الشغالة بيدخل pending — لسه صفر رصيد قابل للصرف', async () => {
    const bookingId = await insertHourlyBooking('complete', 30000);
    await bookingsService.confirm(ids.workerUser, bookingId);
    await bookingsService.completeHourly(ids.workerUser, bookingId);

    const approval = await pendingApprovalForBooking(bookingId);
    expect(approval?.status).toBe(DomesticWorkerEarningApprovalStatus.PENDING);
    expect(approval?.sourceKey).toBe('hourly-completion');
    expect(approval?.amountCents).toBe(25500); // 30000 - 15% عمولة افتراضية
    expect(await workerWalletBalance()).toBe(0);
  });

  it('approve×approve: طلب واحد فقط يحوّل الاستحقاق إلى رصيد، والثاني يرى الحالة النهائية', async () => {
    const bookingId = await insertHourlyBooking('approve', 20000);
    await bookingsService.confirm(ids.workerUser, bookingId);
    await bookingsService.completeHourly(ids.workerUser, bookingId);
    const approval = await pendingApprovalForBooking(bookingId);

    const balanceBefore = await workerWalletBalance();
    const outcomes = await Promise.allSettled([
      approvalsService.approve(ids.adminUser, approval!.id),
      approvalsService.approve(ids.adminUser, approval!.id),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
    expect(await workerWalletBalance()).toBe(balanceBefore + 17000); // 20000 - 15%
  });

  it('رفض الأدمن: الاستحقاق بيتقفل rejected بسبب موثّق — صفر تحويل لمحفظة الشغالة', async () => {
    const bookingId = await insertHourlyBooking('reject', 20000);
    await bookingsService.confirm(ids.workerUser, bookingId);
    await bookingsService.completeHourly(ids.workerUser, bookingId);
    const approval = await pendingApprovalForBooking(bookingId);
    const balanceBefore = await workerWalletBalance();

    const rejected = await approvalsService.reject(ids.adminUser, approval!.id, 'شكوى عميل على الخدمة');
    expect(rejected.status).toBe(DomesticWorkerEarningApprovalStatus.REJECTED);
    expect(rejected.rejectionReason).toBe('شكوى عميل على الخدمة');
    expect(await workerWalletBalance()).toBe(balanceBefore);

    // مينفعش توافق على صف اترفض بالفعل
    await expect(approvalsService.approve(ids.adminUser, approval!.id)).rejects.toThrow(ApiException);
  });

  it('approve×reject: قرار نهائي واحد فقط يفوز ولا يمكن أن تنفصل حالة الصف عن أثر المحفظة', async () => {
    const bookingId = await insertHourlyBooking('decision-race', 10000);
    await bookingsService.confirm(ids.workerUser, bookingId);
    await bookingsService.completeHourly(ids.workerUser, bookingId);
    const approval = await pendingApprovalForBooking(bookingId);
    const balanceBefore = await workerWalletBalance();

    const outcomes = await Promise.allSettled([
      approvalsService.approve(ids.adminUser, approval!.id),
      approvalsService.reject(ids.adminUser, approval!.id, 'قرار رفض متزامن'),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const persisted = await pendingApprovalForBooking(bookingId);
    expect([DomesticWorkerEarningApprovalStatus.APPROVED, DomesticWorkerEarningApprovalStatus.REJECTED]).toContain(
      persisted?.status,
    );
    expect(await workerWalletBalance()).toBe(
      balanceBefore + (persisted?.status === DomesticWorkerEarningApprovalStatus.APPROVED ? 8500 : 0),
    );
  });

  it('إلغاء حجز شهري يبطل الاستحقاق pending ذريًا، وصفحة أدمن قديمة لا تستطيع اعتماده', async () => {
    const bookingId = await insertMonthlyBooking('cancel-invalidates', 30000);
    await bookingsService.confirm(ids.workerUser, bookingId);
    const approval = await pendingApprovalForBooking(bookingId);
    expect(approval?.status).toBe(DomesticWorkerEarningApprovalStatus.PENDING);

    await bookingsService.cancel(ids.customerUser, bookingId, { reason: 'إلغاء قبل اعتماد الاستحقاق' });
    const invalidated = await pendingApprovalForBooking(bookingId);
    expect(invalidated?.status).toBe(DomesticWorkerEarningApprovalStatus.INVALIDATED);
    await expect(approvalsService.approve(ids.adminUser, approval!.id)).rejects.toThrow(ApiException);
  });

  it('نسختان من sweep تجددان الفترة المستحقة مرة واحدة فقط وتنتجان استحقاقًا واحدًا', async () => {
    const bookingId = await insertMonthlyBooking('renew-race', 12000, true);
    const balanceBefore = Number(
      (await dataSource.query(`SELECT balance_cents FROM wallets WHERE owner_user_id = $1`, [ids.customerUser]))[0].balance_cents,
    );
    const before = await dataSource.getRepository(DomesticWorkerBooking).findOneByOrFail({ id: bookingId });

    const sweeps = await Promise.all([bookingsService.sweep(), bookingsService.sweep()]);
    expect(sweeps.reduce((sum, result) => sum + result.renewed, 0)).toBe(1);

    const after = await dataSource.getRepository(DomesticWorkerBooking).findOneByOrFail({ id: bookingId });
    expect(after.currentPeriodEndAt!.getTime()).toBeGreaterThan(before.currentPeriodEndAt!.getTime());
    const approvals = await dataSource.getRepository(DomesticWorkerEarningApproval).find({ where: { bookingId } });
    expect(approvals).toHaveLength(1);
    expect(approvals[0].sourceKey).toBe(`monthly:${after.currentPeriodEndAt!.toISOString()}`);
    const customerBalance = Number(
      (await dataSource.query(`SELECT balance_cents FROM wallets WHERE owner_user_id = $1`, [ids.customerUser]))[0].balance_cents,
    );
    expect(customerBalance).toBe(balanceBefore - 12000);
  });

  it('عطل بنية عابر يرجع transaction كاملة ويظل قابلًا للاسترداد في الدورة التالية', async () => {
    const bookingId = await insertMonthlyBooking('renew-recovery', 9000, true);
    const before = await dataSource.getRepository(DomesticWorkerBooking).findOneByOrFail({ id: bookingId });
    const balanceBefore = Number(
      (await dataSource.query(`SELECT balance_cents FROM wallets WHERE owner_user_id = $1`, [ids.customerUser]))[0].balance_cents,
    );
    const failure = jest.spyOn(walletsService, 'doubleEntry').mockRejectedValueOnce(new Error('transient database failure'));

    const failedSweep = await bookingsService.sweep();
    failure.mockRestore();
    expect(failedSweep.renewed).toBe(0);
    const afterFailure = await dataSource.getRepository(DomesticWorkerBooking).findOneByOrFail({ id: bookingId });
    expect(afterFailure.autoRenew).toBe(true);
    expect(afterFailure.currentPeriodEndAt?.getTime()).toBe(before.currentPeriodEndAt?.getTime());
    expect(await dataSource.getRepository(DomesticWorkerEarningApproval).count({ where: { bookingId } })).toBe(0);

    // The next scheduler tick can safely retry the same durable period cursor.
    const recoveredSweep = await bookingsService.sweep();
    expect(recoveredSweep.renewed).toBe(1);
    expect(await dataSource.getRepository(DomesticWorkerEarningApproval).count({ where: { bookingId } })).toBe(1);
    const balanceAfter = Number(
      (await dataSource.query(`SELECT balance_cents FROM wallets WHERE owner_user_id = $1`, [ids.customerUser]))[0].balance_cents,
    );
    expect(balanceAfter).toBe(balanceBefore - 9000);
  });
});
