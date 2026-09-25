// **تنشيط الموظف الجديد** (ADR-0111) — اختبار حي على Postgres حقيقي، بلا mocks.
//
// البلاغ: «إزاي موظف بيسجل أول مرة على الرغم إن الأدمين بيحط رقمه بس؟»
//
// اللي كان بيحصل (مقيس على API شغّال): الحساب بيتعمل بـ`pin_hash = NULL` وخلاص، وكل الأبواب
// مقفولة — الدخول برمز 401، OTP 410 (`auth.login_method='pin'`)، تسجيل جديد 409،
// و`POST /auth/pin` 401 (محتاج جلسة الموظف مش قادر يعملها). يعني الحساب **مستحيل** يُستخدم.
import { DataSource } from 'typeorm';
import { issuePinSetupCode } from '../auth/pin-setup';
import { PinResetToken } from '../auth/entities/pin-reset-token.entity';
import { User } from '../auth/entities/user.entity';

describe('تصريح تعيين الرمز — مصدر واحد للاسترجاع والتنشيط (ADR-0111)', () => {
  let dataSource: DataSource;
  const runId = Date.now().toString(36);
  const made: string[] = [];

  const mkUser = async (label: string, withPin: boolean): Promise<string> => {
    const [row] = await dataSource.query<{ id: string }[]>(
      `INSERT INTO users (phone_number, full_name, user_type, pin_hash, pin_set_at)
       VALUES ($1, $2, 'admin', $3, $4) RETURNING id`,
      [
        `+2016${runId}${label}`.slice(0, 15),
        `اختبار تنشيط ${label}`,
        withPin ? '$2a$12$abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRS' : null,
        withPin ? new Date() : null,
      ],
    );
    made.push(row.id);
    return row.id;
  };

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [User, PinResetToken],
    });
    await dataSource.initialize();
  });

  afterAll(async () => {
    if (made.length) {
      await dataSource.query('DELETE FROM pin_reset_tokens WHERE user_id = ANY($1)', [made]);
      await dataSource.query('DELETE FROM users WHERE id = ANY($1)', [made]);
    }
    await dataSource.destroy();
  });

  it('تنشيط موظف جديد: كود ١٠ أرقام، مخزّن مجزّأ، والحساب لسه بلا رمز', async () => {
    const userId = await mkUser('a', false);
    const issuer = await mkUser('i', true);

    const { code, expiresAt } = await dataSource.transaction((m) =>
      issuePinSetupCode(m, { userId, issuedByUserId: issuer, clearExistingPin: false }),
    );

    expect(code).toMatch(/^\d{10}$/);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());

    const [token] = await dataSource.query<{ code_hash: string; issued_by_user_id: string }[]>(
      'SELECT code_hash, issued_by_user_id FROM pin_reset_tokens WHERE user_id = $1 AND used_at IS NULL',
      [userId],
    );
    // **الكود عمره ما يتخزّن صريح** — نفس سياسة رمز الدخول بالحرف.
    expect(token.code_hash).not.toContain(code);
    expect(token.code_hash.startsWith('$2')).toBe(true);
    expect(token.issued_by_user_id).toBe(issuer);
  });

  it('**التنشيط مابيمسحش رمز موجود** — إصدار كود بالغلط مايقفلش موظف شغّال برّه', async () => {
    const userId = await mkUser('b', true);
    const issuer = await mkUser('j', true);
    const before = await dataSource.query<{ pin_hash: string }[]>('SELECT pin_hash FROM users WHERE id = $1', [userId]);

    await dataSource.transaction((m) =>
      issuePinSetupCode(m, { userId, issuedByUserId: issuer, clearExistingPin: false }),
    );

    const after = await dataSource.query<{ pin_hash: string }[]>('SELECT pin_hash FROM users WHERE id = $1', [userId]);
    expect(after[0].pin_hash).toBe(before[0].pin_hash);
  });

  it('**الاسترجاع بيمسح الرمز** — الفرق الوحيد بين الحالتين', async () => {
    const userId = await mkUser('c', true);
    const issuer = await mkUser('k', true);

    await dataSource.transaction((m) =>
      issuePinSetupCode(m, { userId, issuedByUserId: issuer, clearExistingPin: true }),
    );

    const [row] = await dataSource.query<{ pin_hash: string | null; pin_failed_attempts: number }[]>(
      'SELECT pin_hash, pin_failed_attempts FROM users WHERE id = $1',
      [userId],
    );
    expect(row.pin_hash).toBeNull();
    expect(Number(row.pin_failed_attempts)).toBe(0);
  });

  it('كود جديد **بيبطّل** كل الأكواد الحية القديمة — مايبقاش تصريحين على نفس الحساب', async () => {
    const userId = await mkUser('d', false);
    const issuer = await mkUser('l', true);

    await dataSource.transaction((m) =>
      issuePinSetupCode(m, { userId, issuedByUserId: issuer, clearExistingPin: false }),
    );
    await dataSource.transaction((m) =>
      issuePinSetupCode(m, { userId, issuedByUserId: issuer, clearExistingPin: false }),
    );

    const [{ count }] = await dataSource.query<{ count: string }[]>(
      'SELECT count(*) FROM pin_reset_tokens WHERE user_id = $1 AND used_at IS NULL AND deleted_at IS NULL',
      [userId],
    );
    expect(Number(count)).toBe(1);
  });
});
