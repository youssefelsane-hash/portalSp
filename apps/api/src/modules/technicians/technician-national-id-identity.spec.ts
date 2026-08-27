import { DataSource } from 'typeorm';
import { ApiException } from '../../common/exceptions/api.exception';
import { blindIndex, normalizeNationalId } from '../../common/crypto/pii-crypto.util';
import { TechnicianIdentityService } from './technician-identity.service';
import { TechnicianProfile, TechnicianVerificationStatus } from './entities/technician-profile.entity';
import { User, UserType } from '../auth/entities/user.entity';

process.env.PII_ENCRYPTION_KEY = process.env.PII_ENCRYPTION_KEY ?? 'test-pii-encryption-key-32-characters';

// ADR-0045 / docs/08 §74-ب — الرقم القومي كهوية دائمة للفني. الاختبارات دي بتشتغل على Postgres
// حقيقي عشان الفهرس الفريد الجزئي نفسه يتفحص، مش بس منطق التطبيق فوقه.
describe('TechnicianIdentityService — الرقم القومي كهوية دائمة (ADR-0045)', () => {
  let dataSource: DataSource;
  let service: TechnicianIdentityService;
  const runId = Date.now().toString(36);
  const ids = { userA: '', profileA: '', userB: '', profileB: '', userC: '', profileC: '', adminUser: '' };
  const securityEvents: { eventType: string; severity: string; attemptedValue: unknown }[] = [];

  const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

  /** رقم قومي صالح الشكل (14 رقم) وفريد لكل تشغيلة — عشان ما يتصادمش مع صفوف تشغيلة سابقة. */
  function makeNationalId(suffix: string): string {
    const digits = `${Date.now()}${suffix}`.replace(/\D/g, '');
    return digits.slice(-14).padStart(14, '2');
  }

  async function insertTechnician(label: string): Promise<{ userId: string; profileId: string }> {
    const [user] = await q(
      `INSERT INTO users (phone_number, full_name, user_type, phone_verified_at)
       VALUES ($1,$2,$3, now()) RETURNING id`,
      [`+2019${label}${runId}`.slice(0, 15), `فني هوية ${label} ${runId}`, UserType.TECHNICIAN],
    );
    const [profile] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, years_of_experience, current_level, verification_status, is_available)
       VALUES ($1,$2,3,'new','pending',true) RETURNING id`,
      [user.id, `NID${label}${runId}`.slice(0, 20)],
    );
    return { userId: user.id, profileId: profile.id };
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [TechnicianProfile, User],
    });
    await dataSource.initialize();

    const a = await insertTechnician('a');
    ids.userA = a.userId;
    ids.profileA = a.profileId;
    const b = await insertTechnician('b');
    ids.userB = b.userId;
    ids.profileB = b.profileId;
    const c = await insertTechnician('c');
    ids.userC = c.userId;
    ids.profileC = c.profileId;

    const [admin] = await q(
      `INSERT INTO users (phone_number, full_name, user_type, phone_verified_at)
       VALUES ($1,$2,$3, now()) RETURNING id`,
      [`+2018${runId}`.slice(0, 15), `أدمن هوية ${runId}`, UserType.ADMIN],
    );
    ids.adminUser = admin.id;

    service = new TechnicianIdentityService(
      dataSource.getRepository(TechnicianProfile),
      dataSource,
      { record: jest.fn(async () => undefined) } as never,
      {
        recordDenial: jest.fn(async (params: { eventType: string; severity: string; attemptedValue: unknown }) => {
          securityEvents.push(params);
        }),
      } as never,
    );
  });

  afterAll(async () => {
    try {
      await q(`DELETE FROM technician_profiles WHERE id IN ($1,$2,$3)`, [ids.profileA, ids.profileB, ids.profileC]);
      await q(`DELETE FROM users WHERE id IN ($1,$2,$3,$4)`, [ids.userA, ids.userB, ids.userC, ids.adminUser]);
    } finally {
      if (dataSource?.isInitialized) await dataSource.destroy();
    }
  });

  it('التطبيع بيحوّل الأرقام العربية ويشيل المسافات — نفس البطاقة = نفس الهاش', () => {
    // من غير التطبيع ده، نفس البطاقة مكتوبة من كيبورد عربي بتدّي هاش مختلف والتفرّد بيتلف بالكامل.
    expect(normalizeNationalId('٢٩٨٠١٠١٢٣٤٥٦٧٨')).toBe('29801012345678');
    expect(normalizeNationalId('298 0101 234-5678')).toBe('29801012345678');
    expect(blindIndex(normalizeNationalId('٢٩٨٠١٠١٢٣٤٥٦٧٨'))).toBe(blindIndex('29801012345678'));
  });

  it('بيرفض أي رقم مش 14 خانة', async () => {
    await expect(
      service.setNationalId({
        technicianProfileId: ids.profileA,
        rawNationalId: '12345',
        actorUserId: ids.userA,
        source: 'technician',
      }),
    ).rejects.toThrow('الرقم القومي لازم يكون 14 رقم بالظبط');
  });

  it('بيتسجّل ويتشفّر، والرقم بيترجع صحيح للأدمن بس', async () => {
    const nationalId = makeNationalId('11');
    await service.setNationalId({
      technicianProfileId: ids.profileA,
      rawNationalId: nationalId,
      actorUserId: ids.userA,
      source: 'technician',
    });

    const [row] = await q(
      `SELECT national_id_encrypted, national_id_hash, national_id_set_by_user_id FROM technician_profiles WHERE id = $1`,
      [ids.profileA],
    );
    // القيمة المخزّنة مش النص الخام — تسريب الجدول مايديش البطاقات.
    expect(row.national_id_encrypted.startsWith('enc:v1:')).toBe(true);
    expect(row.national_id_encrypted).not.toContain(nationalId);
    expect(row.national_id_hash).toBe(blindIndex(nationalId));
    expect(row.national_id_set_by_user_id).toBe(ids.userA);

    expect(await service.revealNationalId(ids.profileA)).toBe(nationalId);
  });

  it('فني تاني بنفس الرقم بيترفض، والمحاولة بتتسجّل كحدث أمني بلا تسريب صاحب الرقم', async () => {
    const nationalId = await service.revealNationalId(ids.profileA);
    securityEvents.length = 0;

    const attempt = service.setNationalId({
      technicianProfileId: ids.profileB,
      rawNationalId: nationalId!,
      actorUserId: ids.userB,
      source: 'technician',
    });
    await expect(attempt).rejects.toThrow('الرقم القومي ده مسجّل بالفعل');
    // الرسالة نفسها ما فيهاش أي تلميح لمين الرقم — وإلا أي حد بيجرّب أرقام يستخرج قاعدة هوية.
    await expect(attempt).rejects.toMatchObject({ code: 'TECH_003' });

    expect(securityEvents).toHaveLength(1);
    expect(securityEvents[0].eventType).toBe('duplicate_identity_attempt');
    // التفاصيل الكاملة (مين ماسك الرقم) بتعيش في الحدث الأمني للأدمن بس.
    expect(JSON.stringify(securityEvents[0].attemptedValue)).toContain('conflicting_accounts');

    const [row] = await q(`SELECT national_id_hash FROM technician_profiles WHERE id = $1`, [ids.profileB]);
    expect(row.national_id_hash).toBeNull(); // ما اتكتبش حاجة
  });

  it('نفس القيمة لنفس الفني = عملية بلا أثر، مش خطأ', async () => {
    const nationalId = await service.revealNationalId(ids.profileA);
    await expect(
      service.setNationalId({
        technicianProfileId: ids.profileA,
        rawNationalId: nationalId!,
        actorUserId: ids.adminUser,
        source: 'admin',
      }),
    ).resolves.toBeDefined();
  });

  it('الفني مش بيقدر يغيّر رقمه بعد الاعتماد — بس الأدمن بيقدر', async () => {
    await q(`UPDATE technician_profiles SET verification_status = 'approved' WHERE id = $1`, [ids.profileA]);
    const newId = makeNationalId('22');

    // الحماية الجوهرية: من غيرها، فني اتحظر يغيّر رقمه ويسجّل من تاني كشخص جديد.
    await expect(
      service.setNationalId({
        technicianProfileId: ids.profileA,
        rawNationalId: newId,
        actorUserId: ids.userA,
        source: 'technician',
      }),
    ).rejects.toMatchObject({ code: 'TECH_004' });

    // الأدمن بيقدر — تصحيح غلطة إدخال لازم يفضل ممكن.
    await expect(
      service.setNationalId({
        technicianProfileId: ids.profileA,
        rawNationalId: newId,
        actorUserId: ids.adminUser,
        source: 'admin',
      }),
    ).resolves.toBeDefined();
    expect(await service.revealNationalId(ids.profileA)).toBe(newId);

    await q(`UPDATE technician_profiles SET verification_status = 'pending' WHERE id = $1`, [ids.profileA]);
  });

  it('حساب محظور بيفضل ماسك رقمه — ده جوهر الطلب', async () => {
    await q(`UPDATE users SET is_blocked = true WHERE id = $1`, [ids.userA]);
    const nationalId = await service.revealNationalId(ids.profileA);
    securityEvents.length = 0;

    await expect(
      service.setNationalId({
        technicianProfileId: ids.profileC,
        rawNationalId: nationalId!,
        actorUserId: ids.userC,
        source: 'technician',
      }),
    ).rejects.toMatchObject({ code: 'TECH_003' });

    // الحساب المحظور بيرفع خطورة الحدث: ده بالظبط "الفني اللي عمل مشكلة بيحاول يرجع".
    expect(securityEvents[0].severity).toBe('high');

    await q(`UPDATE users SET is_blocked = false WHERE id = $1`, [ids.userA]);
  });

  it('حساب متشال (deleted_at) بيحرّر الرقم — والتعارض التاريخي بيفضل ظاهر للأدمن', async () => {
    await q(`UPDATE technician_profiles SET deleted_at = now() WHERE id = $1`, [ids.profileA]);
    const nationalId = await service.revealNationalId(ids.profileA);

    const updated = await service.setNationalId({
      technicianProfileId: ids.profileC,
      rawNationalId: nationalId!,
      actorUserId: ids.userC,
      source: 'technician',
    });
    expect(updated.nationalIdHash).toBe(blindIndex(normalizeNationalId(nationalId!)));

    // مش مانع، بس الأدمن لازم يشوف إن الشخص ده كان عندنا قبل كده.
    const summary = await service.summaryFor(updated);
    expect(summary.linkedAccountCodes.length).toBeGreaterThanOrEqual(1);
    expect(summary.maskedNationalId).toMatch(/^\*+\d{4}$/);

    await q(`UPDATE technician_profiles SET deleted_at = NULL, national_id_hash = NULL, national_id_encrypted = NULL WHERE id = $1`, [
      ids.profileA,
    ]);
  });

  it('الفهرس الفريد الجزئي هو الضمان الحقيقي — كتابة مباشرة متجاوزة للتطبيق بتترفض', async () => {
    // فحص التطبيق بيدّي رسالة مفهومة؛ الفهرس بيمسك السباق (طلبين متزامنين بنفس الرقم) وأي
    // كتابة برّه الخدمة. الاختبار ده بيثبّت إن الضمان في القاعدة مش في الكود بس.
    const [{ national_id_hash: hash }] = await q(`SELECT national_id_hash FROM technician_profiles WHERE id = $1`, [
      ids.profileC,
    ]);
    expect(hash).not.toBeNull();
    await expect(
      q(`UPDATE technician_profiles SET national_id_hash = $1 WHERE id = $2`, [hash, ids.profileB]),
    ).rejects.toThrow(/uq_technician_national_id_active/);
  });

  it('ApiException بترجع كود واضح للواجهة مش خطأ عام', async () => {
    const err = await service
      .setNationalId({
        technicianProfileId: ids.profileB,
        rawNationalId: 'abc',
        actorUserId: ids.userB,
        source: 'technician',
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiException);
  });
});
