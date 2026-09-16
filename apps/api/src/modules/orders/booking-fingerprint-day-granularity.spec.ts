import { bookingContextHashWithoutProvider, bookingFingerprintDiff, bookingFingerprintInput, bookingMatchContextHash } from './booking-match-context';
import { PreviewOrderDto } from './dto/preview-order.dto';
import { BookingMatchSelectionMode } from './entities/booking-match-preview.entity';

/**
 * **بصمة الحجز بتقارن يوم المنصّة، مش اللحظة** (بلاغ مالك 2026-09-15، docs/08 §150 بند ١، ADR-0090).
 *
 * البَقّة اللي الاختبار ده بيقفلها اتكرّرت حيًا: شاشة اختيار الفني بتعمل التذكرة بـ`scheduled_at`
 * على منتصف الليل، وإنشاء الطلب بيبعت نفس اليوم + الساعة اللي العميل اختارها — فالحجز كان
 * بيترفض بـ«غيّرت في تفاصيل الحجز بعد ما اخترت الفني (الموعد)» والعميل ماغيّرش أي حاجة.
 *
 * الاختبار ده على الدالة الخالصة مش على المسار الحي عمدًا: الدالة دي هي **المرجع الوحيد**
 * للطرفين (المعاينة والإنشاء)، فتثبيت سلوكها هنا بيغطي كل نداء بيعدّي عليها.
 */
describe('بصمة الحجز — دقة اليوم مش اللحظة', () => {
  const base = {
    service_id: '11111111-1111-7111-8111-111111111111',
    address_id: '22222222-2222-7222-8222-222222222222',
  } as unknown as PreviewOrderDto;

  const technicianId = '33333333-3333-7333-8333-333333333333';
  const mode = 'manual' as BookingMatchSelectionMode;

  const withSchedule = (iso: string) => ({ ...base, scheduled_at: iso }) as PreviewOrderDto;

  // منتصف الليل بتوقيت القاهرة ليوم ٢٠٢٧-٠٣-١٠ = 2027-03-09T22:00:00Z (القاهرة UTC+2 وقتها).
  const midnightCairo = '2027-03-09T22:00:00.000Z';
  const twoPmCairo = '2027-03-10T12:00:00.000Z';

  it('نفس اليوم بساعتين مختلفتين ⇒ **نفس** البصمة (ده اللي كان بيرفض الحجز)', () => {
    expect(bookingMatchContextHash(withSchedule(midnightCairo), mode, technicianId)).toBe(
      bookingMatchContextHash(withSchedule(twoPmCairo), mode, technicianId),
    );
    expect(bookingFingerprintDiff(
      bookingFingerprintInput(withSchedule(midnightCairo)),
      bookingFingerprintInput(withSchedule(twoPmCairo)),
    )).toEqual([]);
  });

  it('يوم مختلف ⇒ بصمة مختلفة — الحارس لسه شغّال', () => {
    const nextDay = '2027-03-11T12:00:00.000Z';
    expect(bookingMatchContextHash(withSchedule(twoPmCairo), mode, technicianId)).not.toBe(
      bookingMatchContextHash(withSchedule(nextDay), mode, technicianId),
    );
    expect(bookingFingerprintDiff(
      bookingFingerprintInput(withSchedule(twoPmCairo)),
      bookingFingerprintInput(withSchedule(nextDay)),
    )).toEqual(['scheduled_at']);
  });

  it('ساعة متأخرة بتعدّي منتصف الليل UTC لكن لسه نفس يوم القاهرة ⇒ نفس البصمة', () => {
    // 2027-03-10 23:30 بتوقيت القاهرة = 2027-03-10T21:30Z — نفس اليوم محليًا، نفس اليوم UTC.
    // والحالة العكسية: 2027-03-11T00:30Z هي 02:30 يوم ١١ بالقاهرة ⇒ يوم تاني فعلاً.
    expect(bookingMatchContextHash(withSchedule('2027-03-10T21:30:00.000Z'), mode, technicianId)).toBe(
      bookingMatchContextHash(withSchedule(twoPmCairo), mode, technicianId),
    );
    expect(bookingMatchContextHash(withSchedule('2027-03-11T00:30:00.000Z'), mode, technicianId)).not.toBe(
      bookingMatchContextHash(withSchedule(twoPmCairo), mode, technicianId),
    );
  });

  it('اختلاف صيغة نفس اللحظة لسه بيدّي نفس البصمة (السلوك الأصلي ما اتكسرش)', () => {
    expect(bookingContextHashWithoutProvider(withSchedule('2027-03-10T12:00:00Z'))).toBe(
      bookingContextHashWithoutProvider(withSchedule('2027-03-10T14:00:00+02:00')),
    );
  });

  it('نطاق الأيام المرن بيتقارن باليوم برضه — الساعة مش فارقة في الطرفين', () => {
    const range = (start: string, end: string) =>
      ({ ...base, scheduled_at: start, scheduled_end_at: end }) as PreviewOrderDto;
    expect(bookingContextHashWithoutProvider(range(midnightCairo, '2027-03-14T22:00:00.000Z'))).toBe(
      bookingContextHashWithoutProvider(range(twoPmCairo, '2027-03-15T09:00:00.000Z')),
    );
  });
});
