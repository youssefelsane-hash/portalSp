import { DataSource, Repository } from 'typeorm';
import { AdminTechniciansService } from './admin-technicians.service';
import { TechnicianProfile } from './entities/technician-profile.entity';
import { User } from '../auth/entities/user.entity';
import { blindIndex, encryptPii, normalizeNationalId } from '../../common/crypto/pii-crypto.util';

/**
 * docs/08 §77-C1 — طلب المالك: «محرك بحث بسيط يكون بيسألك برقم التليفون وبالاسم وبرقم البطاقة
 * اللي هو الناشونال ID». صفحة الفنيين كانت فيها فلتر حالة توثيق **بس**.
 *
 * **الجزء اللي يستاهل اختبار حي مش وحدة**: البحث بالرقم القومي. القيمة متخزّنة مشفّرة
 * بـAES-GCM بـIV عشوائي — نفس الرقم بيدّي نص مختلف كل مرة، فمستحيل `LIKE` أو `=` عليها.
 * البحث بيمر على `national_id_hash` (HMAC حتمي، ADR-0045). الاختبار ده بيثبت إن السلسلة دي
 * شغالة من الطرف للطرف على قاعدة بيانات حقيقية.
 */
describe('AdminTechniciansService.list — البحث بالاسم/التليفون/الكود/الرقم القومي (docs/08 §77-C1)', () => {
  let dataSource: DataSource;
  let service: AdminTechniciansService;
  const runId = Date.now().toString(36).toUpperCase().slice(-6);
  const nationalId = '29001011234567';
  const ids = { userA: '', profileA: '', userB: '', profileB: '' };
  const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

  beforeAll(async () => {
    process.env.PII_ENCRYPTION_KEY ??= 'a'.repeat(64);
    process.env.PII_BLIND_INDEX_KEY ??= 'b'.repeat(64);
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [TechnicianProfile, User],
    });
    await dataSource.initialize();
    service = Object.create(AdminTechniciansService.prototype) as AdminTechniciansService;
    Object.assign(service, {
      technicianProfiles: dataSource.getRepository(TechnicianProfile) as Repository<TechnicianProfile>,
      users: dataSource.getRepository(User) as Repository<User>,
    });

    // فني (أ) — عنده رقم قومي، هو الهدف في كل الاختبارات.
    const [ua] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`,
      [`+2071${runId}`.slice(0, 15), `فني بحث ألفا ${runId}`],
    );
    ids.userA = ua.id;
    const [pa] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, national_id_encrypted, national_id_hash)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [ids.userA, `TSRCH-A-${runId}`, encryptPii(normalizeNationalId(nationalId)), blindIndex(normalizeNationalId(nationalId))],
    );
    ids.profileA = pa.id;

    // فني (ب) — بلا رقم قومي، موجود عشان نتأكد إن البحث بيفلتر فعلاً مش بيرجّع الكل.
    const [ub] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`,
      [`+2072${runId}`.slice(0, 15), `فني بحث بيتا ${runId}`],
    );
    ids.userB = ub.id;
    const [pb] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code) VALUES ($1,$2) RETURNING id`,
      [ids.userB, `TSRCH-B-${runId}`],
    );
    ids.profileB = pb.id;
  });

  afterAll(async () => {
    for (const p of [ids.profileA, ids.profileB]) {
      if (p) await q(`DELETE FROM technician_profiles WHERE id = $1`, [p]);
    }
    for (const u of [ids.userA, ids.userB]) {
      if (u) await q(`DELETE FROM users WHERE id = $1`, [u]);
    }
    await dataSource.destroy();
  });

  it('بالاسم (جزء منه): بيلاقي الفني المطلوب بس', async () => {
    const { items } = await service.list({ search: `ألفا ${runId}` });
    expect(items.map((i) => i.profile.id)).toEqual([ids.profileA]);
  });

  it('برقم الموبايل: بيلاقيه', async () => {
    const { items } = await service.list({ search: `+2071${runId}`.slice(0, 15) });
    expect(items.map((i) => i.profile.id)).toContain(ids.profileA);
  });

  it('بكود الفني: بيلاقيه', async () => {
    const { items } = await service.list({ search: `TSRCH-A-${runId}` });
    expect(items.map((i) => i.profile.id)).toEqual([ids.profileA]);
  });

  // ده الاختبار الجوهري: القيمة المخزّنة مشفّرة عشوائيًا، فنجاح المطابقة دليل إن المسار
  // بيعدّي على الـblind index فعلاً مش على النص.
  it('بالرقم القومي الكامل: بيلاقيه عبر blind index رغم إن القيمة مشفّرة', async () => {
    const { items } = await service.list({ search: nationalId });
    expect(items.map((i) => i.profile.id)).toEqual([ids.profileA]);
  });

  it('الرقم القومي بأرقام عربية: بيتطبّع وبيلاقيه', async () => {
    const arabicDigits = nationalId.replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]);
    const { items } = await service.list({ search: arabicDigits });
    expect(items.map((i) => i.profile.id)).toEqual([ids.profileA]);
  });

  // مطابقة **كاملة أو لأ** — طبيعة الـHMAC. لو ده رجع نتيجة، يبقى البحث بيسرّب بمطابقة جزئية.
  it('جزء من الرقم القومي: **مش** بيلاقي حاجة (مطابقة كاملة بالتصميم)', async () => {
    const { items } = await service.list({ search: nationalId.slice(0, 8) });
    expect(items.map((i) => i.profile.id)).not.toContain(ids.profileA);
  });

  it('بحث فاضي: الفلاتر القديمة لسه شغالة زي ما هي', async () => {
    const { items, meta } = await service.list({ per_page: 5 });
    expect(items.length).toBeLessThanOrEqual(5);
    expect(meta.total).toBeGreaterThanOrEqual(2);
  });
});
