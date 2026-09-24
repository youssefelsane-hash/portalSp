import { DataSource } from 'typeorm';
import * as bcrypt from 'bcryptjs';

/**
 * تستات حية على Postgres حقيقي للسلوك اللي ADR-0109 بيعد بيه — على مستوى القاعدة.
 *
 * الغرض: القواعد اللي لو اتكسرت يبقى فيه **استيلاء على حسابات** أو **حساب مقفول للأبد**.
 * مسار الـAPI الكامل متغطّى بالتحقق الحي، وده بيحرس الثوابت اللي مالهاش علاقة بالنقل.
 */
describe('رمز الدخول — ثوابت القاعدة (ADR-0109)', () => {
  let ds: DataSource;
  const runId = Date.now().toString(36).slice(-6);
  const made: string[] = [];

  const mkUser = async (label: string, pin: string | null) => {
    const hash = pin === null ? null : await bcrypt.hash(pin, 4);
    const [row] = await ds.query(
      `INSERT INTO users (phone_number, full_name, user_type, pin_hash, pin_set_at)
       VALUES ($1,$2,'customer',$3,$4) RETURNING id`,
      [`+2017${runId}${label}`.slice(0, 15), `pin-${runId}-${label}`, hash, hash ? new Date() : null],
    );
    made.push(row.id);
    return row.id as string;
  };

  beforeAll(async () => {
    ds = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak_main',
    });
    await ds.initialize();
  });

  afterAll(async () => {
    if (made.length) await ds.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [made]);
    await ds.destroy();
  });

  it('الرمز عمره ما يتخزّن خام — الهاش مش بيحتوي الرمز', async () => {
    const id = await mkUser('a', '1357');
    const [row] = await ds.query(`SELECT pin_hash FROM users WHERE id=$1`, [id]);
    expect(row.pin_hash).not.toContain('1357');
    expect(row.pin_hash.startsWith('$2')).toBe(true);
    expect(await bcrypt.compare('1357', row.pin_hash)).toBe(true);
  });

  it('**مستحيل** حساب يتقفل وهو مالوش رمز أصلاً (chk_users_pin_state)', async () => {
    const id = await mkUser('b', null);
    // قفل على حساب بلا رمز = حساب متقفل برّه على credential مش موجود. القيد بيمنعها.
    await expect(
      ds.query(`UPDATE users SET pin_locked_until = now() + interval '1 hour' WHERE id=$1`, [id]),
    ).rejects.toThrow(/chk_users_pin_state/);
    await expect(
      ds.query(`UPDATE users SET pin_failed_attempts = 3 WHERE id=$1`, [id]),
    ).rejects.toThrow(/chk_users_pin_state/);
  });

  it('الحساب اللي ليه رمز يقدر يتقفل عادي', async () => {
    const id = await mkUser('c', '2580');
    await ds.query(
      `UPDATE users SET pin_failed_attempts = 5, pin_locked_until = now() + interval '1 minute' WHERE id=$1`,
      [id],
    );
    const [row] = await ds.query(`SELECT pin_failed_attempts, pin_locked_until FROM users WHERE id=$1`, [id]);
    expect(Number(row.pin_failed_attempts)).toBe(5);
    expect(row.pin_locked_until).not.toBeNull();
  });

  it('مسح الرمز (استرجاع الأدمن) بيرجّع الحساب لحالة سليمة مش لحالة مقفولة', async () => {
    const id = await mkUser('d', '9713');
    await ds.query(
      `UPDATE users SET pin_failed_attempts = 5, pin_locked_until = now() + interval '1 hour' WHERE id=$1`,
      [id],
    );
    // نفس اللي `adminResetPin` بيعمله بالظبط — ولازم يعدّي من القيد.
    await ds.query(
      `UPDATE users SET pin_hash=NULL, pin_set_at=NULL, pin_failed_attempts=0, pin_locked_until=NULL WHERE id=$1`,
      [id],
    );
    const [row] = await ds.query(`SELECT pin_hash, pin_locked_until FROM users WHERE id=$1`, [id]);
    expect(row.pin_hash).toBeNull();
    expect(row.pin_locked_until).toBeNull();
  });

  it('رقم الموبايل لسه هوية الحساب — الفريدة ماتأثرتش', async () => {
    const phone = `+2018${runId}z`.slice(0, 15);
    const [first] = await ds.query(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,'dup','customer') RETURNING id`,
      [phone],
    );
    made.push(first.id);
    await expect(
      ds.query(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,'dup2','customer')`, [phone]),
    ).rejects.toThrow();
  });

  it('المفتاح `auth.login_method` موجود في القاعدة بقيمة pin', async () => {
    const [row] = await ds.query(`SELECT value FROM settings WHERE key='auth.login_method'`);
    expect(row?.value).toBe('pin');
  });

  it('صلاحية الاسترجاع مسجّلة ومربوطة بـsuper_admin', async () => {
    const [perm] = await ds.query(`SELECT id FROM permissions WHERE name='users.reset_pin'`);
    expect(perm).toBeDefined();
    const [link] = await ds.query(
      `SELECT 1 AS ok FROM role_permissions rp
         JOIN roles r ON r.id = rp.role_id AND r.is_super_admin = true
        WHERE rp.permission_id = $1 LIMIT 1`,
      [perm.id],
    );
    expect(link?.ok).toBe(1);
  });
});
