import { DataSource } from 'typeorm';
import { CatalogService } from '../catalog/catalog.service';
import { Service } from '../catalog/entities/service.entity';
import { ServiceCategory } from '../catalog/entities/service-category.entity';
import { TechnicianOrderExecutionController } from './technician-order-execution.controller';
import { Order, OrderStatus, BookingMode } from './entities/order.entity';
import { OrdersService } from './orders.service';
import { PaymentsService } from '../payments/payments.service';
import { AddressesService } from '../customers/addresses.service';
import { ApiException } from '../../common/exceptions/api.exception';

/**
 * بَقّة حقيقية من بلاغ المالك (docs/08 §64.أ، لقطة شاشة): تطبيق الفني بيفتح على شاشة فاضية
 * مكتوب فيها **«الخدمة غير موجودة»** وبس.
 *
 * الجذر: `toDto()` في technician-order-execution.controller.ts كانت بتجيب اسم الخدمة بـ
 * `catalogService.findServiceOrThrow()` — واللي بتفلتر `is_active = true` (وTypeORM بتستبعد
 * المحذوف soft-delete تلقائيًا). يعني أي طلب قائم خدمته اتوقفت من الأدمن **بعد** إنشائه:
 *   - `GET /technician/orders/upcoming-confirmed` و`/overdue` و`/active` بيرموا 404،
 *   - وتطبيق الفني بيحط رسالة الخطأ مكان الشاشة كلها (شاشة فاضية تمامًا)،
 *   - وكل أفعال التنفيذ (رايح/وصلت/بدأت/خلصت) بترمي 404 كمان — يعني الفني **مش قادر يشتغل**.
 *
 * القاعدة اللي الاختبار ده بيثبّتها: اسم الخدمة على طلب قائم بيان تاريخي للعرض، مش بوابة صلاحية.
 * حالة الكتالوج بتحكم **إنشاء** طلب جديد بس.
 */
describe('عرض طلب الفني بعد إيقاف الخدمة من الكتالوج (docs/08 §64.أ)', () => {
  let dataSource: DataSource;
  let catalogService: CatalogService;
  const runId = Date.now().toString(36);
  const ids = { category: '', service: '' };
  const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Service, ServiceCategory],
    });
    await dataSource.initialize();

    const [category] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة خدمة موقوفة ${runId}`,
      `Inactive Service Category ${runId}`,
      `inactive-service-cat-${runId}`,
    ]);
    ids.category = category.id;
    const [service] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days, is_active)
       VALUES ($1,$2,$3,'fixed',30000,20,0,true) RETURNING id`,
      [ids.category, `خدمة هتتوقف ${runId}`, `inactive-service-${runId}`],
    );
    ids.service = service.id;

    // CatalogService الحقيقي، بس بالمستودعات اللي المسار ده بيستعملها فعلاً (قراءة خدمة).
    catalogService = new CatalogService(
      dataSource.getRepository(ServiceCategory),
      dataSource.getRepository(Service),
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
    );
  }, 20000);

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
    await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
    await dataSource.destroy();
  });

  it('الخدمة الموقوفة: findServiceOrThrow بترمي 404 (وده صح لمسار إنشاء الطلب) لكن findServiceForDisplay بترجّعها', async () => {
    await q(`UPDATE services SET is_active = false WHERE id = $1`, [ids.service]);

    await expect(catalogService.findServiceOrThrow(ids.service)).rejects.toBeInstanceOf(ApiException);

    const forDisplay = await catalogService.findServiceForDisplay(ids.service);
    expect(forDisplay).not.toBeNull();
    expect(forDisplay!.nameAr).toContain('خدمة هتتوقف');
  });

  it('الخدمة المحذوفة soft-delete: العرض لسه بيرجّع الاسم (طلب قديم لازم يفضل مقروء)', async () => {
    await q(`UPDATE services SET deleted_at = now() WHERE id = $1`, [ids.service]);

    const forDisplay = await catalogService.findServiceForDisplay(ids.service);
    expect(forDisplay).not.toBeNull();
    expect(forDisplay!.nameAr).toContain('خدمة هتتوقف');

    await q(`UPDATE services SET deleted_at = NULL, is_active = true WHERE id = $1`, [ids.service]);
  });

  it('خدمة مش موجودة خالص بترجّع null بدل ما ترمي — العرض بيكمل باسم فاضي بدل ما الشاشة تقع', async () => {
    const missing = await catalogService.findServiceForDisplay('00000000-0000-7000-8000-000000000000');
    expect(missing).toBeNull();
  });

  it('الكونترولر: قايمة الشغل المؤكّد بترجع بنجاح حتى لو الخدمة موقوفة (كانت 404 بتفضّي الشاشة)', async () => {
    await q(`UPDATE services SET is_active = false WHERE id = $1`, [ids.service]);

    const order = Object.assign(new Order(), {
      id: '00000000-0000-7000-8000-00000000aaaa',
      orderNumber: `TVIS-${runId}`.slice(0, 24),
      serviceId: ids.service,
      addressId: '00000000-0000-7000-8000-00000000bbbb',
      customerId: '00000000-0000-7000-8000-00000000cccc',
      technicianId: '00000000-0000-7000-8000-00000000dddd',
      orderStatus: OrderStatus.TECHNICIAN_ASSIGNED,
      bookingMode: BookingMode.INDIVIDUAL,
      totalAmountCents: 30000,
      technicianEarningCents: 24000,
      technicianViewedAt: null,
      createdAt: new Date(),
      scheduledAt: new Date(Date.now() + 86_400_000),
    });

    const controller = new TechnicianOrderExecutionController(
      { findUpcomingConfirmedForTechnician: async () => [order] } as unknown as OrdersService,
      null as never,
      null as never,
      null as never,
      {
        findByIdOrThrow: async () => ({
          id: order.addressId,
          streetName: 'شارع الاختبار',
          location: { type: 'Point', coordinates: [31.26, 30.06] },
        }),
      } as unknown as AddressesService,
      { findContactInfoOrThrow: async () => ({ name: 'عميل', phone: '+20100' }) } as never,
      null as never,
      {
        getTechnicianMoneyView: async () => ({
          cashToCollectCents: 30000,
          myEarningCents: 24000,
          hasOnlinePayment: false,
          fullyPaidOnline: false,
        }),
      } as unknown as PaymentsService,
      catalogService,
      null as never,
    );

    const rows = await controller.listUpcomingConfirmed({ sub: 'user' } as never);
    expect(rows).toHaveLength(1);
    expect(rows[0].service_name_ar).toContain('خدمة هتتوقف');

    await q(`UPDATE services SET is_active = true WHERE id = $1`, [ids.service]);
  });
});
