import { resolveClientChannel } from './client-channel';
import { OrderSourceChannel } from './entities/order.entity';

/**
 * **بَقّة بيانات حقيقية اتلقطت بـknip (docs/08 §133)**: الأداة شاورت إن
 * `OrderSourceChannel.WEB` عضو مُصدَّر **محدش بيستخدمه**. الفحص طلّع إن
 * `sourceChannel` كان مثبّت على `customer_app` لأي طلب مش مركز اتصال — يعني كل طلب من
 * `customer-web` كان بيتسجّل إنه من تطبيق الموبايل، وأي تقرير عن مصادر الطلبات بيكدب.
 */
describe('resolveClientChannel — قناة العميل من الهيدر (docs/08 §133)', () => {
  it('بيقرا القيم المعروفة زي ما هي', () => {
    expect(resolveClientChannel('web')).toBe(OrderSourceChannel.WEB);
    expect(resolveClientChannel('customer_app')).toBe(OrderSourceChannel.CUSTOMER_APP);
    expect(resolveClientChannel('b2b_portal')).toBe(OrderSourceChannel.B2B_PORTAL);
    expect(resolveClientChannel('whatsapp')).toBe(OrderSourceChannel.WHATSAPP);
  });

  it('بيتسامح مع المسافات وحالة الحروف — هيدر مش سبب لرفض طلب', () => {
    expect(resolveClientChannel('  WEB  ')).toBe(OrderSourceChannel.WEB);
  });

  it('هيدر ناقص أو مش معروف بيرجّع الافتراضي الآمن بدل ما يرمي', () => {
    expect(resolveClientChannel(undefined)).toBe(OrderSourceChannel.CUSTOMER_APP);
    expect(resolveClientChannel('')).toBe(OrderSourceChannel.CUSTOMER_APP);
    expect(resolveClientChannel('حاجة-مالهاش-معنى')).toBe(OrderSourceChannel.CUSTOMER_APP);
  });

  it('**`call_center` مايتقبلش من هيدر عميل** — وإلا أي عميل يزوّر مصدر طلبه', () => {
    // القيمة دي بتتحدد من صلاحية الأدمن في `OrdersService.create()` بس.
    expect(resolveClientChannel('call_center')).toBe(OrderSourceChannel.CUSTOMER_APP);
  });
});
