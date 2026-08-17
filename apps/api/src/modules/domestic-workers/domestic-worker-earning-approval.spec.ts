import { DataSource } from 'typeorm';
import { ApiException } from '../../common/exceptions/api.exception';
import { RedisCacheService } from '../../common/cache/redis-cache.service';
import { AuditLogService } from '../audit/audit-log.service';
import { User } from '../auth/entities/user.entity';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { CustomerProfilesService } from '../customers/customer-profiles.service';
import { PLATFORM_SYSTEM_USER_ID, Wallet, WalletOwnerType } from '../payments/entities/wallet.entity';
import { WalletTransaction } from '../payments/entities/wallet-transaction.entity';
import { WalletsService } from '../payments/wallets.service';
import { Setting } from '../settings/entities/setting.entity';
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
  let dataSource: DataSource;
  let bookingsService: DomesticWorkerBookingsService;
  let approvalsService: DomesticWorkerEarningApprovalsService;
  let walletsService: WalletsService;
  let cache: RedisCacheService;
  let previousCommissionSettingJson: string | null = null;

  const runId = Date.now().toString(36);
  const DOMESTIC_WORKER_COMMISSION_PERCENTAGE = 15;
  const ids = {
    customerUser: '',
    customerProfile: '',
    workerUser: '',
    workerProfile: '',
    adminUser: '',
  };

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
      entities: [User, CustomerProfile, Wallet, WalletTransaction, Setting, DomesticWorkerBooking, DomesticWorkerProfile, DomesticWorkerEarningApproval],
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

    const [existingCommissionSetting] = await q(`SELECT value::text AS value_json FROM settings WHERE key = $1`, [
      'commission.domestic_worker_percentage',
    ]);
    previousCommissionSettingJson = (existingCommissionSetting?.value_json as string | undefined) ?? null;
    await q(
      `INSERT INTO settings (key, value, value_type, group_name, description, is_public, updated_by_user_id)
       VALUES ($1, $2::jsonb, 'number', 'domestic_workers', $3, false, $4)
       ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value,
           value_type = EXCLUDED.value_type,
           group_name = EXCLUDED.group_name,
           description = EXCLUDED.description,
           is_public = EXCLUDED.is_public,
           updated_by_user_id = EXCLUDED.updated_by_user_id,
           updated_at = now()`,
      [
        'commission.domestic_worker_percentage',
        JSON.stringify(DOMESTIC_WORKER_COMMISSION_PERCENTAGE),
        'تثبيت عمولة الخدمات المنزلية داخل الاختبار عشان يفضل حتمي على بيئة TEST المشتركة',
        ids.adminUser,
      ],
    );
    await q(
      `UPDATE settings
       SET updated_by_user_id = NULL, updated_at = now()
       WHERE key = $1 AND value::text = $2`,
      ['commission.domestic_worker_percentage', previousCommissionSettingJson ?? 'null'],
    );

    cache = new RedisCacheService({ get: () => process.env.REDIS_URL ?? 'redis://localhost:6379' } as never);
    const settingsService = new SettingsService(dataSource.getRepository(Setting), {} as unknown as AuditLogService, cache);
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
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
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
    if (previousCommissionSettingJson === null) {
      await q(`DELETE FROM settings WHERE key = $1`, ['commission.domestic_worker_percentage']);
    } else {
      await q(`UPDATE settings SET value = $2::jsonb, updated_by_user_id = NULL, updated_at = now() WHERE key = $1`, [
        'commission.domestic_worker_percentage',
        previousCommissionSettingJson,
      ]);
    }
    await q(`DELETE FROM users WHERE id IN ($1, $2, $3)`, [ids.customerUser, ids.workerUser, ids.adminUser]);
    cache?.onModuleDestroy();
    if (dataSource.isInitialized) {
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
    expect(approval?.amountCents).toBe(25500); // 30000 - 15% عمولة افتراضية
    expect(await workerWalletBalance()).toBe(0);
  });

  it('موافقة الأدمن: الاستحقاق بيتحول رصيد قابل للصرف فعليًا — وموافقة تانية على نفس الصف ترفض (409)، صفر مضاعفة', async () => {
    const bookingId = await insertHourlyBooking('approve', 20000);
    await bookingsService.confirm(ids.workerUser, bookingId);
    await bookingsService.completeHourly(ids.workerUser, bookingId);
    const approval = await pendingApprovalForBooking(bookingId);

    const approved = await approvalsService.approve(ids.adminUser, approval!.id);
    expect(approved.status).toBe(DomesticWorkerEarningApprovalStatus.APPROVED);
    expect(approved.reviewedByUserId).toBe(ids.adminUser);
    expect(approved.reviewedAt).not.toBeNull();
    const balanceAfterFirstApproval = await workerWalletBalance();
    expect(balanceAfterFirstApproval).toBe(17000); // 20000 - 15%

    await expect(approvalsService.approve(ids.adminUser, approval!.id)).rejects.toThrow(ApiException);
    expect(await workerWalletBalance()).toBe(balanceAfterFirstApproval); // صفر مضاعفة
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
});
