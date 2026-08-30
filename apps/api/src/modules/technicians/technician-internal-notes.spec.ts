import { DataSource } from 'typeorm';
import { TechnicianInternalNote } from './entities/technician-internal-note.entity';
import { TechnicianInternalNotesService } from './technician-internal-notes.service';

describe('TechnicianInternalNotesService — ملاحظات ملف الفني الداخلية', () => {
  let dataSource: DataSource;
  let service: TechnicianInternalNotesService;
  const runId = Date.now().toString(36).toUpperCase().slice(-7);
  const ids = { technicianUser: '', technician: '', admin: '' };
  const query = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [TechnicianInternalNote],
    });
    await dataSource.initialize();
    service = new TechnicianInternalNotesService(dataSource.getRepository(TechnicianInternalNote), dataSource);

    const [technicianUser] = await query(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1, $2, 'technician') RETURNING id`,
      [`+2077${runId}`.slice(0, 15), `فني ملاحظات ${runId}`],
    );
    ids.technicianUser = technicianUser.id;
    const [technician] = await query(
      `INSERT INTO technician_profiles (user_id, technician_code) VALUES ($1, $2) RETURNING id`,
      [ids.technicianUser, `TNOTE-${runId}`],
    );
    ids.technician = technician.id;
    const [admin] = await query(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1, $2, 'admin') RETURNING id`,
      [`+2078${runId}`.slice(0, 15), `موظف إدارة ${runId}`],
    );
    ids.admin = admin.id;
  }, 30000);

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    await query(`DELETE FROM technician_internal_notes WHERE technician_id = $1`, [ids.technician]);
    await query(`DELETE FROM technician_profiles WHERE id = $1`, [ids.technician]);
    await query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[ids.technicianUser, ids.admin]]);
    await dataSource.destroy();
  });

  it('يحفظ سجل ملاحظات باسم الكاتب والأحدث أولًا', async () => {
    await service.add(ids.technician, ids.admin, '  العميل اشتكى من التأخير مرة واحدة  ');
    await new Promise((resolve) => setTimeout(resolve, 10));
    await service.add(ids.technician, ids.admin, 'تم التواصل وتأكيد مواعيد الأسبوع القادم');

    const notes = await service.list(ids.technician);
    expect(notes).toHaveLength(2);
    expect(notes[0].note).toBe('تم التواصل وتأكيد مواعيد الأسبوع القادم');
    expect(notes[0].authorFullName).toBe(`موظف إدارة ${runId}`);
    expect(notes[1].note).toBe('العميل اشتكى من التأخير مرة واحدة');
  });

  it('لا يعرض ملاحظات فني آخر', async () => {
    await expect(service.list('00000000-0000-0000-0000-000000000000')).resolves.toEqual([]);
  });
});
