import { ValidationPipe, ArgumentMetadata } from '@nestjs/common';
import { CreateBookingMatchPreviewDto } from './dto/create-booking-match-preview.dto';
import { CreateOrderDto } from './dto/create-order.dto';

/**
 * **عقد الواجهة مع `POST /orders/match-preview` و`POST /orders`.**
 *
 * الـValidationPipe العالمي شغّال بـ`forbidNonWhitelisted: true`، يعني **أي حقل بتبعته الواجهة
 * ومش متعرّف على الـDTO بيرجّع 400** — مش بيتجاهل بهدوء. ده أخطر نوع فشل في شغل واجهة: الكود
 * بيبني ويعدّي typecheck، والمسار بيقع بس وقت التشغيل عند العميل.
 *
 * الاختبار ده بيمرّر **نفس شكل الجسم اللي customer-web بيبعته بالحرف** على نفس الـpipe.
 */
describe('عقد جسم معاينة المطابقة وإنشاء الطلب (بند 11/12)', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const meta = (metatype: unknown): ArgumentMetadata => ({ type: 'body', metatype: metatype as never });

  const SERVICE_ID = '00000000-0000-4000-8000-000000000001';
  const ADDRESS_ID = '00000000-0000-4000-8000-000000000002';
  const TECH_ID = '00000000-0000-4000-8000-000000000003';
  const PREVIEW_ID = '00000000-0000-4000-8000-000000000004';

  it('جسم «رشّح لي أفضل أسطى» زي ما الواجهة بتبعته بالظبط', async () => {
    const body = {
      service_id: SERVICE_ID,
      address_id: ADDRESS_ID,
      selection_mode: 'auto',
      scheduled_at: '2026-09-20T09:00:00.000Z',
      field_values: { rooms: 3, urgent: false, note: 'حاجة' },
      promo_code: 'WELCOME10',
    };
    await expect(pipe.transform(body, meta(CreateBookingMatchPreviewDto))).resolves.toMatchObject({
      selection_mode: 'auto',
      service_id: SERVICE_ID,
    });
  });

  it('جسم الاختيار اليدوي بيحمل technician_id', async () => {
    const body = {
      service_id: SERVICE_ID,
      address_id: ADDRESS_ID,
      selection_mode: 'manual',
      technician_id: TECH_ID,
    };
    await expect(pipe.transform(body, meta(CreateBookingMatchPreviewDto))).resolves.toMatchObject({
      selection_mode: 'manual',
      technician_id: TECH_ID,
    });
  });

  it('وضع اختيار مش من الاتنين بيترفض', async () => {
    await expect(
      pipe.transform(
        { service_id: SERVICE_ID, address_id: ADDRESS_ID, selection_mode: 'whatever' },
        meta(CreateBookingMatchPreviewDto),
      ),
    ).rejects.toBeDefined();
  });

  it('أي حقل مش متعرّف بيترفض — ده اللي بيخلي الاختبار ده يستاهل', async () => {
    await expect(
      pipe.transform(
        { service_id: SERVICE_ID, address_id: ADDRESS_ID, selection_mode: 'auto', totally_made_up: 1 },
        meta(CreateBookingMatchPreviewDto),
      ),
    ).rejects.toBeDefined();
  });

  it('جسم إنشاء الطلب بتذكرة المعاينة بيعدّي — ده اللي بيقفل السعر', async () => {
    const body = {
      service_id: SERVICE_ID,
      address_id: ADDRESS_ID,
      booking_mode: 'individual',
      scheduled_at: '2026-09-20T09:00:00.000Z',
      field_values: { rooms: 3 },
      accepted_policy_version_ids: [],
      problem_image_ids: [],
      match_preview_id: PREVIEW_ID,
    };
    await expect(pipe.transform(body, meta(CreateOrderDto))).resolves.toMatchObject({
      match_preview_id: PREVIEW_ID,
    });
  });
});
