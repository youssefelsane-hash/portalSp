import { DataSource } from 'typeorm';

/**
 * Script 7 Phase 31 (Database Invariants) — بَقّة حقيقية اتلقطت: `wallet_transactions.amount_cents`
 * عنده `CHECK (amount_cents > 0)` من أول يوم، لكن `orders.total_amount_cents`/`payments.amount_cents`/
 * `refunds.amount_cents`/`payouts.amount_cents`/`payouts.net_amount_cents` مالهاش أي CHECK
 * constraint خالص — الحماية الوحيدة كانت validation على مستوى الكود بس. الاختبار ده بيثبت مباشرة
 * (SQL خام، مش عن طريق أي service) إن الداتابيز نفسها بترفض قيمة سالبة دلوقتي، بصرف النظر عن أي
 * bug مستقبلي في كود التطبيق.
 */
describe('قيود CHECK على أعمدة المبالغ المالية الأساسية (Script 7 Phase 31)', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [],
    });
    await dataSource.initialize();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it.each([
    ['orders', 'total_amount_cents', 'chk_orders_total_amount_cents_non_negative'],
    ['payments', 'amount_cents', 'chk_payments_amount_cents_non_negative'],
    ['refunds', 'amount_cents', 'chk_refunds_amount_cents_non_negative'],
    ['payouts', 'amount_cents', 'chk_payouts_amount_cents_non_negative'],
    ['payouts', 'net_amount_cents', 'chk_payouts_net_amount_cents_non_negative'],
  ])('القيد %s.%s (%s) موجود فعليًا في pg_constraint', async (table, column, constraintName) => {
    const [row] = await dataSource.query<{ definition: string }[]>(
      `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname = $1 AND conrelid = $2::regclass`,
      [constraintName, table],
    );
    expect(row).toBeDefined();
    expect(row.definition).toContain(column);
    expect(row.definition).toContain('>= 0');
  });

  it('الداتابيز نفسها بترفض orders.total_amount_cents سالب فعليًا (مش بس فحص الكود)', async () => {
    await expect(
      dataSource.query(
        `INSERT INTO orders (
           order_number, customer_id, service_id, address_id, service_zone_id, order_type, booking_mode,
           order_status, estimated_price_cents, inspection_fee_cents, surge_amount_cents, total_amount_cents,
           payment_status, placed_at, source_channel
         ) VALUES (
           'ORD-INVARIANT-TEST', gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
           'standard', 'individual', 'searching_technician', 0, 0, 0, -100, 'unpaid', now(), 'customer_app'
         )`,
      ),
    ).rejects.toThrow(/chk_orders_total_amount_cents_non_negative/);
  });
});
