/**
 * **هل الطلب ده «طلب شركة»؟** (توضيح المالك 2026-09-15)
 *
 * > «طالما الشركة كسبت، خلاص كده إحنا ركنا بقى الناس اللي برا الشركة كلهم، الشركة كده كده
 * >  خلاص هي كسبت. نخش بقى عادي جوّه الشركة، بنختار أي شخص بالأوتوماتيك اللي هو أعلى شخص
 * >  كفاءة وأقرب شخص.»
 *
 * القاعدة مكتوبة هنا كدالة بالاسم — مش شرط inline — لأنها بتتقري في **مكانين** في جولة
 * التوزيع (التوسيع العادي، والتوسيع للمشغولين)، وأي اختلاف بينهم بيرجّع نفس التسريب من باب
 * واحد بس.
 *
 * **ليه `requested_technician_company_id` مش `assigned_company_id`**: `assigned_company_id`
 * بيتكتب **وقت التعيين** (`resolveAssignedCompanyId`) — يعني وقت التوزيع لسه فاضي. الحقل
 * اللي بيحمل اختيار العميل من لحظة الإنشاء هو `requested_technician_company_id`، وهو اللي
 * السعر اتحسب بمعامله (ADR-0042) واللي العميل شايف اسمه.
 */
export function isCompanyScopedOrder(order: { requestedTechnicianCompanyId: string | null }): boolean {
  return order.requestedTechnicianCompanyId !== null && order.requestedTechnicianCompanyId !== undefined;
}
