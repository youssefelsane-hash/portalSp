import { DataSource } from 'typeorm';
import { ApiException } from '../../common/exceptions/api.exception';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { CustomerFavoriteTechnician } from './entities/customer-favorite-technician.entity';
import { FavoritesService } from './favorites.service';

/**
 * تدقيق T-1 — موديول `favorites` كان **صفر اختبارات** رغم إن فيه تصرّفين لو اتغيّروا بالسهو
 * بيكسروا تجربة العميل من غير ما يفشل أي حاجة:
 *
 * 1. `addFavorite` **idempotent بالتصميم**: الضغط مرتين على نفس الزرار (أو ريكوست مكرّر من
 *    الموبايل) مش خطأ. لو حد شال الفحص ده، القيد الفريد في القاعدة هيرمي 500 بدل ما يعدّي —
 *    وده بالظبط شكل بَقّة بتظهر في الإنتاج بس.
 * 2. `listFavorites` استعلام SQL خام بـ`JOIN` على جدولين وترتيب `created_at DESC`. أي تعديل
 *    في الاستعلام (اسم عمود، نوع الـ join) بيعدّي من `tsc` عادي لأنه نص — الاختبار الحي هو
 *    الحاجة الوحيدة اللي بتمسكه.
 */
describe('FavoritesService (تدقيق T-1) — حي', () => {
  jest.setTimeout(30_000);

  let dataSource: DataSource;
  let service: FavoritesService;

  const runId = Date.now().toString(36);
  let customerId = '';
  let otherCustomerId = '';
  const technicians: { profileId: string; userId: string; name: string }[] = [];

  const q = <T = unknown>(sql: string, params?: unknown[]): Promise<T> => dataSource.query(sql, params) as Promise<T>;

  async function insertTechnician(label: string, stats: { rating: number; ratings: number; orders: number }) {
    const [user] = await q<{ id: string }[]>(
      `INSERT INTO users (phone_number, full_name, user_type, avatar_url)
       VALUES ($1, $2, 'technician', $3) RETURNING id`,
      [`+20f${label}${runId}`.slice(0, 15), `فني ${label} ${runId}`, `https://cdn.test/${label}.png`],
    );
    const [profile] = await q<{ id: string }[]>(
      `INSERT INTO technician_profiles (user_id, technician_code, average_rating, total_ratings_count, completed_orders_count)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [user.id, `TF-${label}-${runId}`.slice(0, 20), stats.rating, stats.ratings, stats.orders],
    );
    const record = { profileId: profile.id, userId: user.id, name: `فني ${label} ${runId}` };
    technicians.push(record);
    return record;
  }

  beforeAll(async () => {
    dataSource = await new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [CustomerFavoriteTechnician, TechnicianProfile],
    }).initialize();

    service = new FavoritesService(
      dataSource.getRepository(CustomerFavoriteTechnician),
      dataSource.getRepository(TechnicianProfile),
    );

    const mkCustomer = async (label: string): Promise<string> => {
      const [row] = await q<{ id: string }[]>(
        `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`,
        [`+20fc${label}${runId}`.slice(0, 15), `عميل ${label} ${runId}`],
      );
      return row.id;
    };
    customerId = await mkCustomer('a');
    otherCustomerId = await mkCustomer('b');
  });

  afterEach(async () => {
    await q(`DELETE FROM customer_favorite_technicians WHERE customer_user_id = ANY($1)`, [
      [customerId, otherCustomerId],
    ]);
  });

  afterAll(async () => {
    const profileIds = technicians.map((t) => t.profileId);
    const userIds = [...technicians.map((t) => t.userId), customerId, otherCustomerId];
    await q(`DELETE FROM customer_favorite_technicians WHERE technician_id = ANY($1)`, [profileIds]);
    await q(`DELETE FROM technician_profiles WHERE id = ANY($1)`, [profileIds]);
    await q(`DELETE FROM users WHERE id = ANY($1)`, [userIds]);
    await dataSource.destroy();
  });

  describe('addFavorite', () => {
    it('بيضيف صف واحد وبيبقى موجود فعلاً في القاعدة', async () => {
      const tech = await insertTechnician('add1', { rating: 4.5, ratings: 10, orders: 20 });
      await service.addFavorite(customerId, tech.profileId);

      const [row] = await q<{ count: string }[]>(
        `SELECT count(*) FROM customer_favorite_technicians WHERE customer_user_id = $1 AND technician_id = $2`,
        [customerId, tech.profileId],
      );
      expect(Number(row.count)).toBe(1);
      expect(await service.isFavorited(customerId, tech.profileId)).toBe(true);
    });

    it('**التصرّف الحاسم**: النداء مرتين مايرميش استثناء ومايعملش صف تاني', async () => {
      const tech = await insertTechnician('add2', { rating: 4, ratings: 3, orders: 5 });
      await service.addFavorite(customerId, tech.profileId);
      await expect(service.addFavorite(customerId, tech.profileId)).resolves.toBeUndefined();

      const [row] = await q<{ count: string }[]>(
        `SELECT count(*) FROM customer_favorite_technicians WHERE customer_user_id = $1 AND technician_id = $2`,
        [customerId, tech.profileId],
      );
      expect(Number(row.count)).toBe(1);
    });

    it('فني مش موجود بيرمي 404 مش يسيب المفتاح الأجنبي يرمي 500', async () => {
      const missing = '01a00000-0000-7000-8000-0000000000aa';
      await expect(service.addFavorite(customerId, missing)).rejects.toBeInstanceOf(ApiException);
      await expect(service.addFavorite(customerId, missing)).rejects.toMatchObject({ status: 404 });
    });

    it('عميلين مختلفين يقدروا يفضّلوا نفس الفني (القيد الفريد على الزوج مش على الفني)', async () => {
      const tech = await insertTechnician('add4', { rating: 5, ratings: 1, orders: 1 });
      await service.addFavorite(customerId, tech.profileId);
      await service.addFavorite(otherCustomerId, tech.profileId);

      expect(await service.isFavorited(customerId, tech.profileId)).toBe(true);
      expect(await service.isFavorited(otherCustomerId, tech.profileId)).toBe(true);
    });
  });

  describe('removeFavorite / isFavorited', () => {
    it('الحذف بيشيل الصف والتفضيل بيرجع false', async () => {
      const tech = await insertTechnician('rm1', { rating: 3, ratings: 2, orders: 4 });
      await service.addFavorite(customerId, tech.profileId);
      await service.removeFavorite(customerId, tech.profileId);
      expect(await service.isFavorited(customerId, tech.profileId)).toBe(false);
    });

    it('حذف تفضيل مش موجود no-op مش خطأ (نفس فلسفة الإضافة)', async () => {
      const tech = await insertTechnician('rm2', { rating: 3, ratings: 2, orders: 4 });
      await expect(service.removeFavorite(customerId, tech.profileId)).resolves.toBeUndefined();
    });

    it('حذف عميل مابيمسّش تفضيل عميل تاني لنفس الفني', async () => {
      const tech = await insertTechnician('rm3', { rating: 3, ratings: 2, orders: 4 });
      await service.addFavorite(customerId, tech.profileId);
      await service.addFavorite(otherCustomerId, tech.profileId);

      await service.removeFavorite(customerId, tech.profileId);
      expect(await service.isFavorited(customerId, tech.profileId)).toBe(false);
      expect(await service.isFavorited(otherCustomerId, tech.profileId)).toBe(true);
    });
  });

  describe('listFavorites — الاستعلام الخام', () => {
    it('بيرجع بيانات الفني الحقيقية من الجدولين (JOIN شغّال، مش أعمدة فاضية)', async () => {
      const tech = await insertTechnician('ls1', { rating: 4.25, ratings: 12, orders: 33 });
      await service.addFavorite(customerId, tech.profileId);

      const [item] = await service.listFavorites(customerId);
      expect(item).toMatchObject({
        technicianId: tech.profileId,
        fullName: tech.name,
        avatarUrl: 'https://cdn.test/ls1.png',
        averageRating: 4.25,
        totalRatingsCount: 12,
        completedOrdersCount: 33,
      });
      expect(item.favoritedAt).toBeInstanceOf(Date);
    });

    it('التقييم بيرجع رقم مش نص (numeric في PG بييجي string من الدرايفر)', async () => {
      const tech = await insertTechnician('ls2', { rating: 4.75, ratings: 8, orders: 9 });
      await service.addFavorite(customerId, tech.profileId);

      const [item] = await service.listFavorites(customerId);
      expect(typeof item.averageRating).toBe('number');
      expect(item.averageRating).toBeCloseTo(4.75, 2);
    });

    it('الترتيب: الأحدث تفضيلاً الأول', async () => {
      const older = await insertTechnician('ls3a', { rating: 4, ratings: 1, orders: 1 });
      const newer = await insertTechnician('ls3b', { rating: 4, ratings: 1, orders: 1 });
      await service.addFavorite(customerId, older.profileId);
      await service.addFavorite(customerId, newer.profileId);
      // بنثبّت الفارق صراحةً — `now()` لاتنين إدخالين ممكن يبقى قريب جدًا فالترتيب يبقى عشوائي.
      await q(
        `UPDATE customer_favorite_technicians SET created_at = now() - interval '1 day'
         WHERE customer_user_id = $1 AND technician_id = $2`,
        [customerId, older.profileId],
      );

      const list = await service.listFavorites(customerId);
      expect(list.map((i) => i.technicianId)).toEqual([newer.profileId, older.profileId]);
    });

    it('بيرجع تفضيلات العميل ده بس — مش تفضيلات عميل تاني', async () => {
      const mine = await insertTechnician('ls4a', { rating: 4, ratings: 1, orders: 1 });
      const theirs = await insertTechnician('ls4b', { rating: 4, ratings: 1, orders: 1 });
      await service.addFavorite(customerId, mine.profileId);
      await service.addFavorite(otherCustomerId, theirs.profileId);

      expect((await service.listFavorites(customerId)).map((i) => i.technicianId)).toEqual([mine.profileId]);
      expect((await service.listFavorites(otherCustomerId)).map((i) => i.technicianId)).toEqual([theirs.profileId]);
    });

    it('عميل مالوش تفضيلات بيرجع مصفوفة فاضية مش null', async () => {
      expect(await service.listFavorites(customerId)).toEqual([]);
    });
  });
});
