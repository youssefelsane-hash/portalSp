import { TechnicianKind } from '../technicians/entities/technician-profile.entity';

/** نوع عضوية الطاقم في الطلب — مطابق للـCHECK في `order_team_members.member_type` (migration 0075). */
export type CrewMemberType = 'team_member' | 'assistant';

/**
 * **نقطة الفرض الوحيدة لقاعدة الفلوس** (ADR-0050، docs/08 §94، طلب مالك مباشر).
 *
 * الشخص المعلّم في بروفايله كـ`assistant` بيشارك **دايمًا** كـ`member_type='assistant'`، مهما كان
 * اللي طلبه اللي بيضيفه. ده اللي بيضمن إن نسبة المساعد (`crew.assistant_share_ratio`) تتطبّق على
 * **الشخص** مش على لافتة بتتحدد لحظة الإضافة.
 *
 * ليه ده مهم ماليًا: `resolveParticipants()` (crew-earnings.service.ts) بتقرا `member_type` وبتضرب
 * فيه نسبة المساعد قبل ما `splitCrewEarnings()` تشوف أي حاجة، والناتج بيتسجّل snapshot في
 * `order_earning_shares` وبيحرّك المحافظ. من غير الفرض ده، نفس الشخص كان ممكن ياخد 100% من حصته
 * في طلب و65% في طلب تاني حسب إزاي حد ضمّه — بلاغ المالك الأصلي بالظبط.
 *
 * **الاتجاه واحد عمدًا**: فني كامل ممكن ينضم كـ`assistant` في شغلانة معيّنة (ده قرار تشغيلي
 * مشروع — فني كبير بيساعد في شغلانة)، لكن مساعد **ما ينفعش** ينضم كـ`team_member` بنصيب كامل.
 */
export function resolveEffectiveMemberType(requested: CrewMemberType, technicianKind: TechnicianKind): CrewMemberType {
  return technicianKind === TechnicianKind.ASSISTANT ? 'assistant' : requested;
}
