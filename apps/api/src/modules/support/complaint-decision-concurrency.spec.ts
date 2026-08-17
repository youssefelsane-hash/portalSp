import { DataSource } from 'typeorm';
import { User } from '../auth/entities/user.entity';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { Order } from '../orders/entities/order.entity';
import { PLATFORM_SYSTEM_USER_ID, Wallet, WalletOwnerType } from '../payments/entities/wallet.entity';
import { WalletTransaction } from '../payments/entities/wallet-transaction.entity';
import { WalletsService } from '../payments/wallets.service';
import { ComplaintAttachment } from './entities/complaint-attachment.entity';
import {
  Complaint,
  ComplaintResolutionType,
  ComplaintStatus,
} from './entities/complaint.entity';
import { ComplaintMessage } from './entities/complaint-message.entity';
import { SupportService } from './support.service';

describe('SupportService complaint terminal decision concurrency', () => {
  let dataSource: DataSource;
  let walletsService: WalletsService;
  let service: SupportService;
  const runId = Date.now().toString(36);
  const ids = { customerUser: '', customerProfile: '', adminA: '', adminB: '', complaints: [] as string[] };

  async function createComplaint(label: string): Promise<string> {
    const [complaint] = await dataSource.query(
      `INSERT INTO complaints
         (complaint_number, filed_by_user_id, category, severity, title, description, complaint_status, sla_due_at)
       VALUES ($1,$2,'other','medium',$3,$4,'open',now() + interval '24 hours') RETURNING id`,
      [`CMP-P4-${label}-${runId}`.slice(0, 24), ids.customerUser, `شكوى ${label}`, `وصف شكوى ${label}`],
    );
    ids.complaints.push(complaint.id);
    return complaint.id;
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [User, CustomerProfile, Order, Wallet, WalletTransaction, Complaint, ComplaintMessage, ComplaintAttachment],
    });
    await dataSource.initialize();
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    const [customer] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [`+2073${runId}`.slice(0, 15), `عميل شكوى ${runId}`],
    );
    ids.customerUser = customer.id;
    const [profile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customerUser]);
    ids.customerProfile = profile.id;
    const [adminA] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'admin') RETURNING id`,
      [`+2074${runId}a`.slice(0, 15), `أدمن شكوى أ ${runId}`],
    );
    const [adminB] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'admin') RETURNING id`,
      [`+2074${runId}b`.slice(0, 15), `أدمن شكوى ب ${runId}`],
    );
    ids.adminA = adminA.id;
    ids.adminB = adminB.id;

    walletsService = new WalletsService(
      dataSource.getRepository(Wallet),
      dataSource.getRepository(WalletTransaction),
      dataSource,
    );
    await walletsService.getOrCreateWallet(PLATFORM_SYSTEM_USER_ID, WalletOwnerType.PLATFORM);
    await walletsService.getOrCreateWallet(ids.customerUser, WalletOwnerType.CUSTOMER);
    service = new SupportService(
      dataSource.getRepository(Complaint),
      dataSource.getRepository(ComplaintMessage),
      dataSource.getRepository(ComplaintAttachment),
      dataSource.getRepository(Order),
      dataSource,
      {} as never,
      { findByUserIdOrThrow: async () => Promise.reject(new Error('not a technician')) } as never,
      walletsService,
      { record: async () => undefined } as never,
      { emit: () => undefined } as never,
      {} as never,
    );
  });

  afterAll(async () => {
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    await q(`DELETE FROM wallet_transactions WHERE reference_type = 'complaint' AND reference_id = ANY($1::uuid[])`, [
      ids.complaints,
    ]);
    await q(`DELETE FROM complaints WHERE id = ANY($1::uuid[])`, [ids.complaints]);
    await q(`DELETE FROM wallets WHERE owner_user_id = $1`, [ids.customerUser]);
    await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
    await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[ids.customerUser, ids.adminA, ids.adminB]]);
    await dataSource.destroy();
  });

  it('allows exactly one compensated resolve under concurrent admins', async () => {
    const complaintId = await createComplaint('double-resolve');
    const before = (await walletsService.findByUserIdOrThrow(ids.customerUser)).balanceCents;
    const dto = {
      resolution_type: ComplaintResolutionType.PARTIAL_REFUND,
      resolution_notes: 'تعويض معتمد',
      compensation_cents: 12000,
    };
    const results = await Promise.allSettled([
      service.resolve(ids.adminA, complaintId, dto),
      service.resolve(ids.adminB, complaintId, dto),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect((await walletsService.findByUserIdOrThrow(ids.customerUser)).balanceCents - before).toBe(12000);
    expect(await dataSource.getRepository(WalletTransaction).count({
      where: { referenceType: 'complaint', referenceId: complaintId },
    })).toBe(2);
  });

  it('keeps resolve versus reject state coherent with the winning financial effect', async () => {
    const complaintId = await createComplaint('resolve-reject');
    const before = (await walletsService.findByUserIdOrThrow(ids.customerUser)).balanceCents;
    const results = await Promise.allSettled([
      service.resolve(ids.adminA, complaintId, {
        resolution_type: ComplaintResolutionType.PARTIAL_REFUND,
        resolution_notes: 'حل بتعويض',
        compensation_cents: 9000,
      }),
      service.reject(ids.adminB, complaintId, { resolution_notes: 'رفض بعد المراجعة' }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const complaint = await dataSource.getRepository(Complaint).findOneByOrFail({ id: complaintId });
    const balanceDelta = (await walletsService.findByUserIdOrThrow(ids.customerUser)).balanceCents - before;
    const ledgerCount = await dataSource.getRepository(WalletTransaction).count({
      where: { referenceType: 'complaint', referenceId: complaintId },
    });
    if (complaint.complaintStatus === ComplaintStatus.RESOLVED) {
      expect(balanceDelta).toBe(9000);
      expect(ledgerCount).toBe(2);
    } else {
      expect(complaint.complaintStatus).toBe(ComplaintStatus.REJECTED);
      expect(balanceDelta).toBe(0);
      expect(ledgerCount).toBe(0);
    }
  });
});
