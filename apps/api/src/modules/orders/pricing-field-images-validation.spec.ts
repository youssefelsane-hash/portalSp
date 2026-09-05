import { EntityManager } from 'typeorm';
import { OrderCreationService } from './order-creation.service';

type ValidateImages = (
  manager: EntityManager,
  customerId: string,
  customerUserId: string,
  serviceId: string,
  fieldValues: Record<string, string | number | boolean> | undefined,
  orderId?: string,
) => Promise<void>;

const field = {
  id: '10000000-0000-7000-8000-000000000001',
  field_key: 'problem_photos',
  label_ar: 'صور المشكلة',
  is_required: true,
  min_files: 1,
  max_files: 3,
};
const uploadId = '20000000-0000-7000-8000-000000000001';

// الدالة دي بقت في `OrderCreationService` بعد تقسيم `OrdersService` (تدقيق A-1) — الاختبار
// بيمشي وراها لأنه بيختبر **منطق التحقق** نفسه، مش مكان الدالة.
describe('OrderCreationService dynamic pricing-field images', () => {
  const service = Object.create(OrderCreationService.prototype) as OrderCreationService;
  const validate = (service as unknown as { validatePricingFieldImages: ValidateImages }).validatePricingFieldImages.bind(service);

  it('يرفض الحقل الإجباري من غير صورة', async () => {
    const manager = {
      query: jest.fn().mockResolvedValueOnce([field]),
    } as unknown as EntityManager;
    await expect(validate(manager, 'customer-1', 'user-1', 'service-1', {})).rejects.toThrow('محتاج 1 صورة على الأقل');
  });

  it('يرفض reference لا يخص نفس العميل/الخدمة/الحقل', async () => {
    const manager = {
      query: jest
        .fn()
        .mockResolvedValueOnce([field])
        .mockResolvedValueOnce([
          {
            id: uploadId,
            customer_id: 'another-customer',
            service_id: 'service-1',
            field_id: field.id,
            storage_key: 'x.jpg',
            file_url: '/x.jpg',
            file_size_bytes: 10,
            expires_at: new Date(Date.now() + 60_000),
            claimed_order_id: null,
          },
        ]),
    } as unknown as EntityManager;

    await expect(
      validate(manager, 'customer-1', 'user-1', 'service-1', {
        problem_photos: uploadId,
      }),
    ).rejects.toThrow('لا تخص حسابك');
  });

  it('يربط الصورة الصحيحة بالطلب ويمنع تكرار order_media', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([field])
      .mockResolvedValueOnce([
        {
          id: uploadId,
          customer_id: 'customer-1',
          service_id: 'service-1',
          field_id: field.id,
          storage_key: 'pricing-fields/x.jpg',
          file_url: '/uploads/x.jpg',
          file_size_bytes: 100,
          expires_at: new Date(Date.now() + 60_000),
          claimed_order_id: null,
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const manager = { query } as unknown as EntityManager;

    await validate(manager, 'customer-1', 'user-1', 'service-1', { problem_photos: uploadId }, '30000000-0000-7000-8000-000000000001');

    expect(query).toHaveBeenCalledTimes(4);
    expect(query.mock.calls[2][0]).toContain('ON CONFLICT (order_id, pricing_field_upload_id)');
    expect(query.mock.calls[3][0]).toContain('UPDATE pricing_field_uploads');
  });

  it('يرفض عدد صور أكبر من إعداد الحقل قبل أي lookup للملفات', async () => {
    const manager = {
      query: jest.fn().mockResolvedValueOnce([field]),
    } as unknown as EntityManager;
    const ids = [1, 2, 3, 4].map((n) => `20000000-0000-7000-8000-00000000000${n}`).join(',');
    await expect(
      validate(manager, 'customer-1', 'user-1', 'service-1', {
        problem_photos: ids,
      }),
    ).rejects.toThrow('بحد أقصى 3 صور');
    expect(manager.query as jest.Mock).toHaveBeenCalledTimes(1);
  });
});
