import { DataSource } from 'typeorm';

/**
 * ADR-0053 / بوابة P0-1 في docs/23 — «Google لا يعتبر تعطيل الحساب وحده حذفًا كاملًا».
 *
 * الاختبار الحي ده بيقفل على إن الحذف **بيمسح البيانات الشخصية فعليًا** من الداتابيز، مش بيقلب
 * `is_active` وخلاص — وإن السجلات المالية بتفضل سليمة في نفس الوقت. الفحص بيتعمل بـSQL خام على
 * الصفوف نفسها عمدًا: لو اتفحص عبر الـservice كان ممكن يعدّي وهو مش شايف إن الاسم لسه مخزَّن.
 */
describe('ADR-0053 — حذف الحساب بيخفي الهوية فعليًا', () => {
  let dataSource: DataSource;
  const runId = Date.now().toString(36) + Math.floor(Math.random() * 1e5).toString(36);
  const ids = { user: '', address: '', device: '' };

  const q = <T = any>(sql: string, params?: unknown[]): Promise<T[]> => dataSource.query(sql, params);

  /** نفس الجملة الذرّية اللي في AuthService.anonymizeUserData() — مُعاد استخدامها عبر الـservice نفسه. */
  async function anonymize(userId: string) {
    const { AuthService } = await import('./auth.service');
    const service = Object.create(AuthService.prototype) as {
      users: { manager: DataSource['manager'] };
      anonymizeUserData: (id: string) => Promise<void>;
    };
    service.users = { manager: dataSource.manager };
    await service.anonymizeUserData(userId);
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [],
    });
    await dataSource.initialize();

    const [user] = await q(
      `INSERT INTO users (phone_number, full_name, email, user_type, avatar_url, avatar_storage_key, last_login_ip, referral_code, metadata)
       VALUES ($1,$2,$3,'customer','https://cdn/a.png','avatars/a.png','1.2.3.4',$4,'{"k":"v"}'::jsonb) RETURNING id`,
      [`+2077${runId}`.slice(0, 15), `عميل حذف ${runId}`, `del-${runId}@example.com`, `RF${runId}`.slice(0, 12)],
    );
    ids.user = user.id;

    const [address] = await q(
      `INSERT INTO addresses (user_id, label, street_name, building_number, floor_number, apartment_number,
                              landmark, contact_name, contact_phone, delivery_notes, location)
       VALUES ($1,'البيت','شارع الهرم التفصيلي','12','3','7','جنب الصيدلية','أحمد','+201000000000','الجرس التاني',
               ST_SetSRID(ST_MakePoint(31.234567, 30.123456), 4326)::geography) RETURNING id`,
      [ids.user],
    );
    ids.address = address.id;

    const [device] = await q(
      `INSERT INTO user_devices (user_id, device_id, fcm_token, platform, is_active, last_active_at)
       VALUES ($1,$2,'fcm-secret-token','android',true, now()) RETURNING id`,
      [ids.user, `dev-${runId}`],
    );
    ids.device = device.id;
  }, 30000);

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      await q(`DELETE FROM user_devices WHERE user_id = $1`, [ids.user]);
      await q(`DELETE FROM addresses WHERE user_id = $1`, [ids.user]);
      await q(`DELETE FROM users WHERE id = $1`, [ids.user]);
    } finally {
      await dataSource.destroy();
    }
  }, 20000);

  it('بيمسح كل البيانات الشخصية من صف المستخدم، مش بيقلب is_active وبس', async () => {
    await anonymize(ids.user);

    const [row] = await q<{
      full_name: string;
      phone_number: string;
      email: string | null;
      avatar_url: string | null;
      avatar_storage_key: string | null;
      password_hash: string | null;
      last_login_ip: string | null;
      referral_code: string | null;
      metadata: Record<string, unknown>;
      is_active: boolean;
      deleted_at: string | null;
    }>(`SELECT * FROM users WHERE id = $1`, [ids.user]);

    expect(row.full_name).toBe('مستخدم محذوف');
    expect(row.phone_number).toBe('DELETED');
    expect(row.email).toBeNull();
    expect(row.avatar_url).toBeNull();
    expect(row.avatar_storage_key).toBeNull();
    expect(row.last_login_ip).toBeNull();
    expect(row.referral_code).toBeNull();
    expect(row.metadata).toEqual({});
    expect(row.is_active).toBe(false);
    expect(row.deleted_at).not.toBeNull();
    // مفيش أي أثر للاسم أو الإيميل أو الرقم الأصلي في الصف كله.
    expect(JSON.stringify(row)).not.toContain(runId);
  }, 20000);

  it('بينضّف نص العنوان بالكامل وبيخشّن الإحداثيات لمستوى الحي مش البيت', async () => {
    const [row] = await q<{
      street_name: string;
      label: string | null;
      landmark: string | null;
      contact_name: string | null;
      contact_phone: string | null;
      delivery_notes: string | null;
      building_number: string | null;
      lon: number;
      lat: number;
    }>(
      `SELECT street_name, label, landmark, contact_name, contact_phone, delivery_notes, building_number,
              ST_X(location::geometry) AS lon, ST_Y(location::geometry) AS lat
         FROM addresses WHERE id = $1`,
      [ids.address],
    );

    expect(row.street_name).toBe('عنوان محذوف');
    expect(row.label).toBeNull();
    expect(row.landmark).toBeNull();
    expect(row.contact_name).toBeNull();
    expect(row.contact_phone).toBeNull();
    expect(row.delivery_notes).toBeNull();
    expect(row.building_number).toBeNull();
    // 31.234567 → 31.23 و30.123456 → 30.12 (خانتين عشريتين ≈ 1.1 كم).
    expect(Number(row.lon)).toBeCloseTo(31.23, 6);
    expect(Number(row.lat)).toBeCloseTo(30.12, 6);
  }, 20000);

  it('بيمسح أجهزة الإشعارات فعليًا — مفيش FCM token متخزَّن لحد انسحب', async () => {
    const rows = await q(`SELECT id FROM user_devices WHERE user_id = $1`, [ids.user]);
    expect(rows).toHaveLength(0);
  }, 20000);

  it('رقم الهاتف الأصلي بيتحرّر لتسجيل جديد (الفهرس الفريد جزئي)', async () => {
    const freed = `+2077${runId}`.slice(0, 15);
    const [reused] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [freed, `عميل جديد ${runId}`],
    );
    expect(reused.id).toBeDefined();
    await q(`DELETE FROM users WHERE id = $1`, [reused.id]);
  }, 20000);

  it('حذف حسابين ورا بعض مايصطدمش في الفهرس الفريد (phone_number = DELETED للاتنين)', async () => {
    const [second] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [`+2078${runId}`.slice(0, 15), `عميل تاني ${runId}`],
    );
    await expect(anonymize(second.id)).resolves.toBeUndefined();

    const rows = await q<{ id: string }>(`SELECT id FROM users WHERE phone_number = 'DELETED' AND id = ANY($1::uuid[])`, [
      [ids.user, second.id],
    ]);
    expect(rows).toHaveLength(2);
    await q(`DELETE FROM users WHERE id = $1`, [second.id]);
  }, 20000);
});
