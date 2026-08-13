import { computeDispatchDeferredUntil } from './deferred-dispatch.util';

// اختبار وحدة نقي (بدون DB) — بيثبت منطق ADR-0009 بند 1-2 (P0-9): تأجيل بث المطابقة لطلب مجدول
// "بعيد" عن الآن أكتر من matching.deferred_dispatch_lead_hours، إلا لو فيه schedule_slot_id صريح.
describe('computeDispatchDeferredUntil (ADR-0009 بند 1-2، P0-9)', () => {
  const now = new Date('2026-08-13T12:00:00Z');
  const leadHours = 4;

  it('طلب فوري (scheduledAt=null): مايتأجّلش', () => {
    expect(computeDispatchDeferredUntil({ scheduleSlotBooked: false, scheduledAt: null, leadHours, now })).toBeUndefined();
  });

  it('طلب مجدول بعيد (أسبوعين قدام): بيتأجّل لوقت = scheduledAt - leadHours — كان الثغرة', () => {
    const scheduledAt = new Date('2026-08-27T12:00:00Z');
    const result = computeDispatchDeferredUntil({ scheduleSlotBooked: false, scheduledAt, leadHours, now });
    expect(result).toEqual(new Date('2026-08-27T08:00:00Z'));
  });

  it('طلب مجدول قريب (خلال leadHours): مايتأجّلش — نفس سلوك الطلب الفوري بالحرف', () => {
    const scheduledAt = new Date('2026-08-13T14:00:00Z'); // بعد ساعتين بس، leadHours=4
    expect(computeDispatchDeferredUntil({ scheduleSlotBooked: false, scheduledAt, leadHours, now })).toBeUndefined();
  });

  it('طلب مجدول بعيد لكن فيه schedule_slot_id صريح: مايتأجّلش أبدًا — استثناء ADR-0009', () => {
    const scheduledAt = new Date('2026-08-27T12:00:00Z');
    expect(computeDispatchDeferredUntil({ scheduleSlotBooked: true, scheduledAt, leadHours, now })).toBeUndefined();
  });

  it('وقت بدء البث المحسوب فعلياً في الماضي (leadHours كبيرة جداً بالنسبة للموعد): مايتأجّلش', () => {
    // الموعد بعد 3 ساعات بس leadHours=4 يعني وقت البث "المفروض" كان قبل الآن بساعة — يعني قريب.
    const scheduledAt = new Date('2026-08-13T15:00:00Z');
    expect(computeDispatchDeferredUntil({ scheduleSlotBooked: false, scheduledAt, leadHours, now })).toBeUndefined();
  });
});
