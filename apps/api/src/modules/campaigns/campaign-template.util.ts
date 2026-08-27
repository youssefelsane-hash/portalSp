/**
 * ملء قوالب الحملات (ADR-0046 §2).
 *
 * الأدمن بيكتب رسالة واحدة فيها `{{service_name}}`، والمحرك بيطلّع منها عشرات الرسايل بأسماء
 * خدمات حقيقية — ده اللي بيحقق «كل مرة مختلف» من غير ما الأدمن يكتب مية رسالة.
 */

export type TemplateVariables = Record<string, string | null | undefined>;

/** المتغيّرات المعروفة — أي `{{...}}` تاني بيتشال بدل ما يتعرض للعميل كنص خام. */
export const KNOWN_TEMPLATE_VARIABLES = ['service_name', 'category_name', 'customer_name'] as const;

/**
 * بيستبدل المتغيّرات المعروفة، **وبيشيل** أي متغيّر غير معروف أو قيمته فاضية.
 *
 * ليه الشيل مش السيب؟ لو الأدمن كتب `{{prcie}}` بالغلط، العميل ميشوفش `{{prcie}}` في إشعار —
 * ده بيبان كعطل في المنتج. بنشيله وننضّف المسافات الزيادة.
 */
export function renderCampaignTemplate(template: string, variables: TemplateVariables): string {
  const replaced = template.replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (_match, key: string) => {
    const value = variables[key];
    return value ? value : '';
  });

  return replaced
    .replace(/[ \t]{2,}/g, ' ') // مسافات ناتجة عن متغيّر اتشال
    .replace(/\s+([،.؟!])/g, '$1') // مسافة قبل علامة ترقيم بعد الشيل
    .trim();
}

/** بيرجّع أسماء المتغيّرات المستخدمة في قالب — الأدمن بيشوفها وقت الكتابة عشان يعرف إيه المتاح. */
export function extractTemplateVariables(template: string): string[] {
  const matches = template.matchAll(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g);
  return Array.from(new Set(Array.from(matches, (m) => m[1])));
}

/** متغيّرات مكتوبة غلط أو غير مدعومة — تحذير للأدمن وقت الحفظ، مش رفض. */
export function unknownTemplateVariables(template: string): string[] {
  return extractTemplateVariables(template).filter(
    (name) => !(KNOWN_TEMPLATE_VARIABLES as readonly string[]).includes(name),
  );
}
