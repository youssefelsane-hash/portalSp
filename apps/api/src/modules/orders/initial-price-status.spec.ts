import { PriceCertaintyMode } from '../catalog/entities/service.entity';
import { OrderPriceStatus } from './entities/order.entity';
import { initialPriceStatus } from './initial-price-status';

/**
 * بَقّة حقيقية اتلقطت وأنا بوصّل زرار «إرسال سعر بعد المعاينة» (بند 14): خدمة «يحتاج تقييم»
 * متحجوزة بمعاينة في الموقع كانت بتتسجّل `confirmed` وهي مالهاش سعر خالص.
 *
 * الأثر مش تجميلي: أي مسار بيسأل «الطلب ده محتاج سعر؟» كان بيجاوب غلط — الزرار في تطبيق الفني،
 * وطابور التقييم في الأدمن، وتوجيه الطلب المدفوع.
 */
describe('حالة السعر وقت إنشاء الطلب (ADR-0063، بند 14)', () => {
  const base = {
    hasLockedMatchPreview: false,
    remoteQuoteRequested: false,
    priceCertaintyMode: PriceCertaintyMode.CONFIRMED_PRICE,
  };

  it('«يحتاج تقييم» بمعاينة في الموقع → بيستنى التقييم، مش «مؤكد»', () => {
    expect(
      initialPriceStatus({ ...base, priceCertaintyMode: PriceCertaintyMode.ASSESSMENT_REQUIRED }),
    ).toBe(OrderPriceStatus.WAITING_ASSESSMENT);
  });

  it('«يحتاج تقييم» بالصور → بيستنى التقييم برضه', () => {
    expect(
      initialPriceStatus({
        ...base,
        remoteQuoteRequested: true,
        priceCertaintyMode: PriceCertaintyMode.ASSESSMENT_REQUIRED,
      }),
    ).toBe(OrderPriceStatus.WAITING_ASSESSMENT);
  });

  it('«نطاق تقديري» → مبدئي', () => {
    expect(
      initialPriceStatus({ ...base, priceCertaintyMode: PriceCertaintyMode.ESTIMATED_RANGE }),
    ).toBe(OrderPriceStatus.PROVISIONAL);
  });

  it('«سعر مؤكد» → مؤكد', () => {
    expect(initialPriceStatus(base)).toBe(OrderPriceStatus.CONFIRMED);
  });

  it('تذكرة معاينة مقفولة بتغلب كل حاجة — السعر اتقفل وقت المعاينة', () => {
    expect(
      initialPriceStatus({
        ...base,
        hasLockedMatchPreview: true,
        priceCertaintyMode: PriceCertaintyMode.ESTIMATED_RANGE,
      }),
    ).toBe(OrderPriceStatus.LOCKED);
  });
});
