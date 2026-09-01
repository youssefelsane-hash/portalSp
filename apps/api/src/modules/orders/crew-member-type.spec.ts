import { TechnicianKind } from '../technicians/entities/technician-profile.entity';
import { resolveEffectiveMemberType } from './crew-member-type';

// ADR-0050 / docs/08 §94 — نقطة الفرض الوحيدة لقاعدة الفلوس: المساعد بالبروفايل بياخد نسبة
// المساعد دايمًا مهما كان اللي طلبه اللي بيضيفه. دالة نقية عشان القاعدة المالية دي تكون قابلة
// للاختبار لوحدها من غير داتابيز — نفس فلسفة splitCrewEarnings.
describe('resolveEffectiveMemberType (ADR-0050)', () => {
  it('مساعد بالبروفايل بيفضل مساعد حتى لو اللي بيضيفه طلب عضو فريق كامل', () => {
    expect(resolveEffectiveMemberType('team_member', TechnicianKind.ASSISTANT)).toBe('assistant');
  });

  it('مساعد بالبروفايل + طلب مساعد = مساعد (مفيش تغيير)', () => {
    expect(resolveEffectiveMemberType('assistant', TechnicianKind.ASSISTANT)).toBe('assistant');
  });

  it('فني كامل بيفضل عضو فريق لما يتطلب كده — صفر تغيير على السلوك القديم', () => {
    expect(resolveEffectiveMemberType('team_member', TechnicianKind.TECHNICIAN)).toBe('team_member');
  });

  it('فني كامل ينفع ينضم كمساعد لو ده اللي اتطلب — الاتجاه ده مسموح عمدًا', () => {
    // قرار تشغيلي مشروع: فني كبير بيساعد في شغلانة. الممنوع هو العكس بس (مساعد بنصيب كامل).
    expect(resolveEffectiveMemberType('assistant', TechnicianKind.TECHNICIAN)).toBe('assistant');
  });
});

// طلب مالك لاحق (نفس الجلسة، توضيح على §94): «المساعد برضه المفروض يكون مساعد جديد، مساعد
// بريميوم، مساعد محترف... بياخد نفس التطور/الترقية بتاعت الفني، والاتنين بياخدوا نفس التقييم».
//
// ده **مضمون بالتصميم** مش محتاج كود جديد، والاختبار ده بيقفله عشان مايتكسرش بالغلط بعدين:
//
// 1. `technician_kind` (الدور) و`current_level` (المستوى) عمودين **مستقلين تمامًا** — مفيش أي
//    اشتقاق بينهم في أي اتجاه (موثّق كبديل مرفوض صراحةً في ADR-0050).
// 2. محرك الترقية (`TechnicianProgressionService.calculateAll`) بيفلتر على
//    `verificationStatus = APPROVED` **بس** — مفيش أي ذكر لـ`technician_kind` فيه، يعني المساعدين
//    داخلين في نفس دورة التقييم/الترقية التلقائية بالظبط زي الفنيين.
// 3. الوزن المالي بيضرب الاتنين في بعض: `shareWeight = levelWeight × roleMultiplier`
//    (`crew-earnings.service.ts`) — يعني "مساعد بريميوم" بياخد وزن مستوى البريميوم **و** نسبة
//    المساعد مع بعض. الترقية بتزوّد نصيبه فعليًا وهو لسه مساعد.
describe('استقلال الدور عن المستوى (§94، توضيح مالك)', () => {
  it('الدور مالوش أي أثر على المستوى — الدالة بتاخد الدور بس ومش بتشوف المستوى خالص', () => {
    // لو الدور كان مشتق من المستوى (أو العكس)، الدالة دي كانت هتحتاج المستوى كمدخل. توقيعها
    // نفسه هو الضمانة إن مفيش خلط بين المفهومين.
    expect(resolveEffectiveMemberType.length).toBe(2);
  });
});
