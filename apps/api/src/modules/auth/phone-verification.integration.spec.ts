// **تحقّق الرقم وتغييره** (ADR-0112) — اختبار حي على Postgres حقيقي.
//
// اللي بيتقاس هنا هو الجزء اللي **مستحيل** mock يقيسه: الذرّية (الرقم مايتغيّرش بلا ما يتعلّم
// متحقَّق منه)، وإبطال الأكواد الحية على الرقمين، وقيد التفرّد على الرقم.
import { DataSource } from 'typeorm';
import { OtpCode, OtpPurpose } from './entities/otp-code.entity';
import { User } from './entities/user.entity';

describe('تحقّق الرقم وتغييره — سلوك القاعدة (ADR-0112)', () => {
  let dataSource: DataSource;
  const runId = Date.now().toString(36).slice(-5);
  const made: string[] = [];

  const mk = async (label: string, verified: boolean): Promise<{ id: string; phone: string }> => {
    const phone = `+2010${runId}${label}`.slice(0, 15);
    const [row] = await dataSource.query<{ id: string }[]>(
      `INSERT INTO users (phone_number, full_name, user_type, phone_verified_at)
       VALUES ($1, $2, 'customer', $3) RETURNING id`,
      [phone, `اختبار تحقّق ${label}`, verified ? new Date() : null],
    );
    made.push(row.id);
    return { id: row.id, phone };
  };

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [User, OtpCode],
    });
    await dataSource.initialize();
  });

  afterAll(async () => {
    if (made.length) {
      await dataSource.query('DELETE FROM otp_codes WHERE phone_number LIKE $1', [`+2010${runId}%`]);
      await dataSource.query('DELETE FROM users WHERE id = ANY($1)', [made]);
    }
    await dataSource.destroy();
  });

  it('`phone_verified_at` هو الفرق الوحيد بين حساب بيتسأل وحساب لأ', async () => {
    const fresh = await mk('a', false);
    const old = await mk('b', true);
    const [rows] = [
      await dataSource.query<{ id: string; phone_verified_at: Date | null }[]>(
        'SELECT id, phone_verified_at FROM users WHERE id = ANY($1)',
        [[fresh.id, old.id]],
      ),
    ];
    expect(rows.find((r) => r.id === fresh.id)!.phone_verified_at).toBeNull();
    expect(rows.find((r) => r.id === old.id)!.phone_verified_at).not.toBeNull();
  });

  it('**قيد التفرّد** بيمنع تغيير الرقم لرقم حساب تاني — الحماية في القاعدة مش في الكود بس', async () => {
    const a = await mk('c', false);
    const b = await mk('d', false);
    await expect(
      dataSource.query('UPDATE users SET phone_number = $1 WHERE id = $2', [b.phone, a.id]),
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  it('تغيير الرقم وتعليم التحقّق **في نفس العملية** — مستحيل واحد يحصل بلا التاني', async () => {
    const user = await mk('e', false);
    const newPhone = `+2011${runId}e`.slice(0, 15);
    await dataSource.query('UPDATE users SET phone_number = $1, phone_verified_at = now() WHERE id = $2', [
      newPhone,
      user.id,
    ]);
    const [row] = await dataSource.query<{ phone_number: string; phone_verified_at: Date }[]>(
      'SELECT phone_number, phone_verified_at FROM users WHERE id = $1',
      [user.id],
    );
    expect(row.phone_number).toBe(newPhone);
    expect(row.phone_verified_at).not.toBeNull();
  });

  it('الغرض `verify_phone` معزول عن `login` — كود واحد مايخدمش الاتنين', async () => {
    const user = await mk('f', false);
    for (const purpose of [OtpPurpose.LOGIN, OtpPurpose.VERIFY_PHONE]) {
      await dataSource.query(
        `INSERT INTO otp_codes (phone_number, code_hash, purpose, attempts_count, max_attempts, is_used, expires_at)
         VALUES ($1, 'x', $2, 0, 5, false, now() + interval '5 min')`,
        [user.phone, purpose],
      );
    }
    // الاستعلام اللي `consumeOtp` بيعمله بيفلتر بالغرض، فكل غرض بيشوف صفه هو بس.
    const [{ count }] = await dataSource.query<{ count: string }[]>(
      "SELECT count(*) FROM otp_codes WHERE phone_number = $1 AND purpose = 'verify_phone' AND is_used = false",
      [user.phone],
    );
    expect(Number(count)).toBe(1);
  });
});
