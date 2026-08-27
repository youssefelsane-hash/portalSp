import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { AdminTechniciansService } from './admin-technicians.service';
import { TechniciansService } from './technicians.service';
import { TechnicianDocumentsService } from './technician-documents.service';
import { User } from '../auth/entities/user.entity';
import { TechnicianProfile } from './entities/technician-profile.entity';
import { TechnicianDocument, DocumentReviewStatus, TechnicianDocumentType } from './entities/technician-document.entity';
import { Service } from '../catalog/entities/service.entity';
import { resolveAvatarUrl } from '../../common/storage/resolve-avatar-url';

/**
 * ADR-0031 — كانت بَقّة حقيقية: صفر ربط بين مستند "صورة شخصية" (technician_documents) و
 * users.avatar_url في أي مسار، لا وقت الرفع ولا وقت اعتماد الأدمن. الاختبار ده بيغطي التصميم
 * المصحَّح المكوَّن من مصدرين منفصلين تمامًا:
 * 1. المعاينة الذاتية (TechnicianDocumentsService.findLatestOfType): بترجع آخر صورة رفعها الفني
 *    نفسه بغض النظر عن حالة المراجعة — فورية، بلا بوابة اعتماد.
 * 2. الأفتار الرسمي (users.avatar_storage_key): بيتحدّث بس لما الأدمن يعتمد المستند
 *    (AdminTechniciansService.reviewDocument())، وبيترجع بعد كده من TechniciansService.getPublicProfile().
 * 3. resolveAvatarUrl() — أولوية دايمًا لـstorageKey (لو موجود) على الرابط الخام.
 */
describe('ADR-0031 — ظهور صورة البروفايل (معاينة ذاتية فورية + أفتار رسمي بعد الاعتماد)', () => {
  let dataSource: DataSource;
  let adminService: AdminTechniciansService;
  let techniciansService: TechniciansService;
  let documentsService: TechnicianDocumentsService;
  const runId = randomUUID().replaceAll('-', '').slice(0, 12);
  const ids = { adminUser: '', techUser: '', techProfile: '', document: '' };

  const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [User, TechnicianProfile, TechnicianDocument, Service],
    });
    await dataSource.initialize();

    const [adminUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'admin') RETURNING id`, [
      `+2050${runId}`.slice(0, 15),
      `أدمن أفتار ${runId}`,
    ]);
    ids.adminUser = adminUser.id;

    const [techUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [
      `+2051${runId}`.slice(0, 15),
      `فني أفتار ${runId}`,
    ]);
    ids.techUser = techUser.id;
    const [techProfile] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, national_id_encrypted, verification_status, current_level)
       VALUES ($1,$2,'x','approved','new') RETURNING id`,
      [ids.techUser, `AVT-${runId}`],
    );
    ids.techProfile = techProfile.id;

    const [document] = await q(
      `INSERT INTO technician_documents (technician_id, document_type, file_url, storage_key, review_status)
       VALUES ($1,'photo','https://example.com/legacy.jpg',$2,'pending') RETURNING id`,
      [ids.techProfile, `technician-documents/${ids.techProfile}/${runId}.jpg`],
    );
    ids.document = document.id;

    documentsService = new TechnicianDocumentsService(dataSource.getRepository(TechnicianDocument), {} as never, {} as never);
    techniciansService = new TechniciansService(
      dataSource.getRepository(TechnicianProfile),
      {} as never,
      {} as never,
      dataSource.getRepository(Service),
      dataSource.getRepository(User),
      { listForTechnician: async () => [] } as never,
      { listApprovedForTechnician: async () => [] } as never,
      {} as never,
      {} as never,
      {} as never,
    );
    adminService = new AdminTechniciansService(
      dataSource.getRepository(TechnicianProfile),
      dataSource.getRepository(TechnicianDocument),
      {} as never,
      {} as never,
      {} as never,
      dataSource.getRepository(Service),
      dataSource.getRepository(User),
      { emit: jest.fn() } as never,
      { record: jest.fn(async () => undefined) } as never,
      {} as never,
      // ADR-0045 §5 — الاعتماد بيسأل عن `technicians.require_national_id_for_approval`.
      { getBoolean: async (_k: string, fallback: boolean) => fallback } as never,
    );
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    await q(`DELETE FROM technician_documents WHERE id = $1`, [ids.document]);
    await q(`DELETE FROM technician_profiles WHERE id = $1`, [ids.techProfile]);
    await q(`DELETE FROM users WHERE id IN ($1,$2)`, [ids.techUser, ids.adminUser]);
    await dataSource.destroy();
  });

  it('المعاينة الذاتية بترجع آخر صورة (pending) فورًا، بلا أي بوابة اعتماد', async () => {
    const latest = await documentsService.findLatestOfType(ids.techProfile, TechnicianDocumentType.PHOTO);
    expect(latest?.id).toBe(ids.document);
    expect(latest?.reviewStatus).toBe(DocumentReviewStatus.PENDING);
  });

  it('قبل الاعتماد: users.avatar_storage_key لسه null، وgetPublicProfile برضو بترجعه null', async () => {
    const profile = await techniciansService.getPublicProfile(ids.techProfile);
    expect(profile.avatarStorageKey).toBeNull();
  });

  it('اعتماد الأدمن للصورة بيحدّث users.avatar_storage_key = document.storageKey', async () => {
    await adminService.reviewDocument(ids.adminUser, ids.techProfile, ids.document, { review_status: DocumentReviewStatus.APPROVED } as never);
    const [user] = await q(`SELECT avatar_storage_key FROM users WHERE id = $1`, [ids.techUser]);
    expect(user.avatar_storage_key).toBe(`technician-documents/${ids.techProfile}/${runId}.jpg`);

    const profile = await techniciansService.getPublicProfile(ids.techProfile);
    expect(profile.avatarStorageKey).toBe(`technician-documents/${ids.techProfile}/${runId}.jpg`);
  });

  it('resolveAvatarUrl(): storageKey موجود بياخد أولوية دايمًا على الرابط الخام', async () => {
    const storage = { getUrl: jest.fn(async (key: string) => `https://cdn.example.com/${key}`) };
    await expect(resolveAvatarUrl(storage as never, 'https://old-raw-url.example.com', 'some/key.jpg')).resolves.toBe(
      'https://cdn.example.com/some/key.jpg',
    );
    await expect(resolveAvatarUrl(storage as never, 'https://old-raw-url.example.com', null)).resolves.toBe(
      'https://old-raw-url.example.com',
    );
    expect(storage.getUrl).toHaveBeenCalledTimes(1);
  });

  it('مستند اترفض مايحدّثش users.avatar_storage_key خالص', async () => {
    const [rejectedDoc] = await q(
      `INSERT INTO technician_documents (technician_id, document_type, file_url, storage_key, review_status)
       VALUES ($1,'photo','https://example.com/x.jpg',$2,'pending') RETURNING id`,
      [ids.techProfile, `technician-documents/${ids.techProfile}/rejected-${runId}.jpg`],
    );
    await adminService.reviewDocument(ids.adminUser, ids.techProfile, rejectedDoc.id, {
      review_status: DocumentReviewStatus.REJECTED,
      rejection_reason: 'صورة غير واضحة',
    } as never);
    const [user] = await q(`SELECT avatar_storage_key FROM users WHERE id = $1`, [ids.techUser]);
    // لسه القيمة من الاعتماد السابق (مش اتغيّرت)، مش null ومش قيمة المستند المرفوض.
    expect(user.avatar_storage_key).toBe(`technician-documents/${ids.techProfile}/${runId}.jpg`);
    await q(`DELETE FROM technician_documents WHERE id = $1`, [rejectedDoc.id]);
  });
});
