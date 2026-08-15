import { DataSource } from 'typeorm';
import { AdminReportsService } from './admin-reports.service';

// اختبار حي ضد Postgres حقيقي — تحقق §22.2 (docs/08): "سجل إلغاء الفني لازم يبقى قابل للقياس من
// الأدمن". الفحص الأولي (بالكود الفعلي) لقى الميزة دي ALREADY EXISTS بالكامل — technician_profiles
// .cancelled_orders_count بيتحدّث فعليًا من ORDER_STATUS_CHANGED_EVENT (technician-stats.processor.ts،
// اتأكد حي في سيشن سابقة موثّقة في orders/README.md)، ومعروض في 3 أماكن: صفحة تفاصيل الفني،
// صفحة تقارير الأدمن (Reports → "أداء الفنيين"، قابلة للترتيب تصاعدي/تنازلي)، ومعدل الإلغاء
// العام على البروفايل العام. الاختبار ده بيتأكد من جزء واحد ناقص التحقق: GET /admin/reports/technicians
// مع sort_by=cancelled_orders فعلاً بيرتّب صح (مش بس العمود موجود في القاعدة).
describe('AdminReportsService.techniciansReport() sort_by=cancelled_orders — §22.2 (docs/08)', () => {
  let dataSource: DataSource;
  let service: AdminReportsService;
  const runId = Date.now().toString(36);
  let techLowId: string;
  let techHighId: string;
  let userLowId: string;
  let userHighId: string;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
    });
    await dataSource.initialize();

    // techniciansReport() بيستخدم dataSource.query خام بس — باقي الـrepos المحقونة في الكونستركتور
    // مش مستخدمة في الميثود ده، فـstub بسيط كافي (نفس نمط باقي اختبارات السيشن دي).
    service = new AdminReportsService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      dataSource,
    );

    const [userLow] = await dataSource.query(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`,
      [`+2027${runId}1`.slice(0, 15), `فني قليل إلغاء ${runId}`],
    );
    userLowId = userLow.id;
    const [userHigh] = await dataSource.query(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`,
      [`+2027${runId}2`.slice(0, 15), `فني كتير إلغاء ${runId}`],
    );
    userHighId = userHigh.id;

    const [techLow] = await dataSource.query(
      `INSERT INTO technician_profiles
         (user_id, technician_code, national_id_encrypted, current_level, cancelled_orders_count, completed_orders_count)
       VALUES ($1, $2, 'x', 'new', 1, 10) RETURNING id`,
      [userLowId, `TC-LO-${runId}`],
    );
    techLowId = techLow.id;
    const [techHigh] = await dataSource.query(
      `INSERT INTO technician_profiles
         (user_id, technician_code, national_id_encrypted, current_level, cancelled_orders_count, completed_orders_count)
       VALUES ($1, $2, 'x', 'new', 9, 10) RETURNING id`,
      [userHighId, `TC-HI-${runId}`],
    );
    techHighId = techHigh.id;
  });

  afterAll(async () => {
    await dataSource.query(`DELETE FROM technician_profiles WHERE id IN ($1, $2)`, [techLowId, techHighId]);
    await dataSource.query(`DELETE FROM users WHERE id IN ($1, $2)`, [userLowId, userHighId]);
    await dataSource.destroy();
  });

  it('desc — الفني الأكتر إلغاءً بيطلع الأول', async () => {
    const result = await service.techniciansReport({ sort_by: 'cancelled_orders', order: 'desc', page: 1, per_page: 100 });
    const ids = result.items.map((r) => r.technician_id);
    const lowIndex = ids.indexOf(techLowId);
    const highIndex = ids.indexOf(techHighId);
    expect(highIndex).toBeGreaterThanOrEqual(0);
    expect(lowIndex).toBeGreaterThanOrEqual(0);
    expect(highIndex).toBeLessThan(lowIndex);
  });

  it('asc — الفني الأقل إلغاءً بيطلع الأول', async () => {
    const result = await service.techniciansReport({ sort_by: 'cancelled_orders', order: 'asc', page: 1, per_page: 100 });
    const ids = result.items.map((r) => r.technician_id);
    const lowIndex = ids.indexOf(techLowId);
    const highIndex = ids.indexOf(techHighId);
    expect(lowIndex).toBeLessThan(highIndex);
  });

  it('الرقم المرجوع مطابق تمامًا للمخزّن — صفر تحويل غلط', async () => {
    const result = await service.techniciansReport({ sort_by: 'cancelled_orders', order: 'desc', page: 1, per_page: 100 });
    const row = result.items.find((r) => r.technician_id === techHighId);
    expect(row?.cancelled_orders_count).toBe(9);
  });
});
