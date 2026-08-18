import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { AuditLogService } from '../audit/audit-log.service';
import { StorageService } from '../../common/storage/storage.service';
import { OrderMediaService } from './order-media.service';
import { Order } from './entities/order.entity';
import { OrderMedia, OrderMediaType } from './entities/order-media.entity';
import { TechniciansService } from '../technicians/technicians.service';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { TechnicianCompany } from '../technicians/entities/technician-company.entity';
import { User } from '../auth/entities/user.entity';

// اختبار حي ضد Postgres حقيقي — Script 2 Part G finding #41 (Attachment E2E). صور طلبات العملاء
// خصوصية جداً (بيوت العملاء، تفاصيل داخلية — راجع finding #38)، والفني اللي كان بيقدر يشوف صور
// طلب مش بتاعه كانت بَقّة BOLA حقيقية اتصلحت قبل كده (`listForTechnician()`، راجع تعليق الدالة
// في order-media.service.ts). الاختبار ده بيثبت حدود التفويض دي حيّة على PostgreSQL حقيقي —
// فني معيّن على الطلب يقدر يرفع/يشوف، فني تاني مش معيّن عليه يترفض برسالة عامة (404 "مش بتاعك"،
// مش 403 يسرّب وجود الطلب — نفس نمط `findOneOwnedOrThrow` بتاع العميل).
describe('OrderMediaService — حدود تفويض المرفقات (Script 2 Part G finding #41)', () => {
  let dataSource: DataSource;
  let service: OrderMediaService;
  const runId = randomUUID().replaceAll('-', '').slice(0, 12);
  const ids = {
    category: '',
    service: '',
    address: '',
    assignedTechUser: '',
    assignedTechProfile: '',
    otherTechUser: '',
    otherTechProfile: '',
    customerUser: '',
    customerProfile: '',
    order: '',
  };
  const createdMediaIds: string[] = [];

  async function safeStep(label: string, fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[order-media-authorization.spec] فشلت خطوة "${label}":`, err);
    }
  }

  const fakeStorage: StorageService = {
    save: async (key: string) => `https://example.test/${key}`,
    getUrl: async (key: string) => `https://example.test/${key}`,
    delete: async () => undefined,
  };

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Order, OrderMedia, TechnicianProfile, TechnicianCompany, User],
    });
    await dataSource.initialize();
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

    const [country] = await q(`SELECT id FROM countries WHERE iso_code = 'EG' LIMIT 1`);
    if (!country) throw new Error('الفيكستشر ده محتاج بلد EG متزروع مسبقًا');

    const [zone] = await q(
      `INSERT INTO service_zones (city_id, name_ar, name_en)
       SELECT id, $1, $2 FROM cities WHERE country_id = $3 LIMIT 1 RETURNING id`,
      [`نطاق اختبار ${runId}`, `Test Zone ${runId}`, country.id],
    );
    const [category] = await q(
      `INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`,
      [`فئة اختبار ${runId}`, `Test Category ${runId}`, `test-category-media-auth-${runId}`],
    );
    ids.category = category.id;
    const [serviceRow] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents) VALUES ($1,$2,$3,'fixed',10000) RETURNING id`,
      [ids.category, `خدمة اختبار ${runId}`, `test-service-media-auth-${runId}`],
    );
    ids.service = serviceRow.id;

    const [assignedTechUser] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`,
      [`+2040${runId}`.slice(0, 15), `فني معيّن ${runId}`],
    );
    ids.assignedTechUser = assignedTechUser.id;
    const [assignedTechProfile] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, years_of_experience, current_level) VALUES ($1,$2,3,'new') RETURNING id`,
      [ids.assignedTechUser, `TCMA1${runId}`.slice(0, 20)],
    );
    ids.assignedTechProfile = assignedTechProfile.id;

    const [otherTechUser] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`,
      [`+2041${runId}`.slice(0, 15), `فني تاني ${runId}`],
    );
    ids.otherTechUser = otherTechUser.id;
    const [otherTechProfile] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, years_of_experience, current_level) VALUES ($1,$2,3,'new') RETURNING id`,
      [ids.otherTechUser, `TCMA2${runId}`.slice(0, 20)],
    );
    ids.otherTechProfile = otherTechProfile.id;

    const [customerUser] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [`+2042${runId}`.slice(0, 15), `عميل اختبار ${runId}`],
    );
    ids.customerUser = customerUser.id;
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [
      ids.customerUser,
    ]);
    ids.customerProfile = customerProfile.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, street_name, location)
       VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography) RETURNING id`,
      [ids.customerUser, `شارع اختبار ${runId}`],
    );
    ids.address = address.id;

    const [order] = await q(
      `INSERT INTO orders (order_number, customer_id, technician_id, service_id, address_id, service_zone_id, order_status, payment_status, total_amount_cents, placed_at, work_started_at)
       VALUES ($1,$2,$3,$4,$5,$6,'in_progress','unpaid',20000, now(), now()) RETURNING id`,
      [`TESTMA-${runId}`.slice(0, 24), ids.customerProfile, ids.assignedTechProfile, ids.service, ids.address, zone.id],
    );
    ids.order = order.id;

    const techniciansService = new TechniciansService(
      dataSource.getRepository(TechnicianProfile),
      dataSource.getRepository(TechnicianCompany),
      dataSource.getRepository(User),
      {} as never,
      {} as never,
      { record: async () => undefined } as unknown as AuditLogService,
      {} as never,
    );

    service = new OrderMediaService(dataSource.getRepository(Order), dataSource.getRepository(OrderMedia), techniciansService, fakeStorage);
  });

  afterEach(async () => {
    if (!dataSource?.isInitialized || createdMediaIds.length === 0) {
      createdMediaIds.length = 0;
      return;
    }
    const idsToClean = [...createdMediaIds];
    createdMediaIds.length = 0;
    await safeStep('حذف order_media المُنشأة في الاختبار', () =>
      dataSource.query(`DELETE FROM order_media WHERE id = ANY($1::uuid[])`, [idsToClean]),
    );
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    if (ids.order) await safeStep('حذف order_media المتبقية', () => q(`DELETE FROM order_media WHERE order_id = $1`, [ids.order]));
    if (ids.order) await safeStep('حذف الطلب', () => q(`DELETE FROM orders WHERE id = $1`, [ids.order]));
    if (ids.address) await safeStep('حذف العنوان', () => q(`DELETE FROM addresses WHERE id = $1`, [ids.address]));
    if (ids.customerProfile) await safeStep('حذف بروفايل العميل', () => q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]));
    if (ids.assignedTechProfile) {
      await safeStep('حذف بروفايل الفني المعيّن', () => q(`DELETE FROM technician_profiles WHERE id = $1`, [ids.assignedTechProfile]));
    }
    if (ids.otherTechProfile) {
      await safeStep('حذف بروفايل الفني التاني', () => q(`DELETE FROM technician_profiles WHERE id = $1`, [ids.otherTechProfile]));
    }
    const userIds = [ids.assignedTechUser, ids.otherTechUser, ids.customerUser].filter(Boolean);
    if (userIds.length) await safeStep('حذف المستخدمين', () => q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [userIds]));
    if (ids.service) await safeStep('حذف الخدمة', () => q(`DELETE FROM services WHERE id = $1`, [ids.service]));
    if (ids.category) await safeStep('حذف الفئة', () => q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]));
    await dataSource.destroy();
  });

  const fakeFile = { buffer: Buffer.from('fake-image-bytes'), mimetype: 'image/jpeg', originalname: 'photo.jpg', size: 17 };

  it('الفني المعيّن على الطلب يقدر يرفع صورة ويشوفها', async () => {
    const media = await service.upload(ids.assignedTechUser, ids.order, OrderMediaType.BEFORE_PHOTO, undefined, fakeFile);
    createdMediaIds.push(media.id);

    const listed = await service.listForTechnician(ids.assignedTechUser, ids.order);
    expect(listed.map((m) => m.id)).toContain(media.id);
  });

  it('فني تاني مش معيّن على الطلب يترفض برسالة عامة (404، مش 403) لو حاول يشوف صور الطلب — BOLA', async () => {
    await expect(service.listForTechnician(ids.otherTechUser, ids.order)).rejects.toMatchObject({
      code: 'VAL_001',
      message: 'الطلب غير موجود أو مش بتاعك',
    });
  });

  it('فني تاني مش معيّن على الطلب يترفض برضه لو حاول يرفع صورة على الطلب ده', async () => {
    await expect(service.upload(ids.otherTechUser, ids.order, OrderMediaType.BEFORE_PHOTO, undefined, fakeFile)).rejects.toMatchObject({
      code: 'VAL_001',
      message: 'الطلب غير موجود أو مش بتاعك',
    });
  });

  it('طلب بـid عشوائي (تخمين) يترفض بنفس الرسالة العامة — مايفرقش بين "مش موجود" و"مش بتاعك"', async () => {
    await expect(service.listForTechnician(ids.assignedTechUser, randomUUID())).rejects.toMatchObject({
      code: 'VAL_001',
      message: 'الطلب غير موجود أو مش بتاعك',
    });
  });
});
