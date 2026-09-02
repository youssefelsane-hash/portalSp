import { PricingFieldType } from './entities/service-pricing-field.entity';
import { FinalPriceFormulaPayload, FormulaNode } from './pricing-formula.types';

/**
 * **قوالب التسعير** (ADR-0060 §2) — بديل «طرق حساب السعر» القديمة.
 *
 * قبل كده كان `services.pricing_model` بيحمل ست قيم، وكل واحدة **وضع تشغيل** ليه مسار تحقق
 * ومدخلات خاصة (`pricing_quantity`, `duration_hours`, `period_start/end`). ده اللي طلّع بلاغ
 * المالك حرفيًا: خدمة شهرية بتطلب «عدد الوحدات» مفيش شاشة بتطلبه، وأربع حقول تاريخ على نفس
 * الشاشة لأن وضع الجدولة والحساب الشهري وحقول الفورم تلاتتهم بيطلبوا نفس الحاجة.
 *
 * دلوقتي مفيش أوضاع. فيه **معادلة واحدة** لكل خدمة، والقوالب دي مجرد **نقطة بداية بتتولّد
 * مرة واحدة** جوّه البانِي: بتزرع الحقول اللي القالب محتاجها في `service_pricing_fields`،
 * وبتكتب شجرة `final_price` في `service_pricing_rules`. بعد كده الخدمة معادلة عادية بالكامل،
 * والأدمن يعدّل فيها زي أي معادلة تانية — مفيش أي فرع في الكود بيسأل «دي كانت أنهي قالب؟».
 *
 * **ملحوظة تصميم مهمة**: القالب الشهري بيزرع **حقلين تاريخ عاديين** في الفورم وبيقرا منهم
 * بـ`kind: 'field'` — مش من `period_start`/`period_end` النظاميين. ده اللي بيخلي مصدر التواريخ
 * **واحد** في المنظومة كلها (الفورم الديناميكي)، وبيقفل عرض «أربع حقول تاريخ» بنيويًا مش بشرط
 * في الواجهة.
 */

export enum PricingTemplateKey {
  FIXED = 'fixed',
  HOURLY = 'hourly',
  DAILY = 'daily',
  MONTHLY = 'monthly',
  PER_UNIT = 'per_unit',
}

/**
 * مفاتيح حقول القوالب. متعمّد إنها **مش** نفس مفاتيح سياق النظام المحجوزة في
 * `PRICING_CONTEXT_FIELD_KEYS` (`quantity`, `duration_hours`…) — دي حقول بيملاها العميل في
 * الفورم، ودي قيم بيحسبها النظام. تسميتهم بنفس الاسم كان هيخفي أي منهم بيتقرا فعلاً.
 */
export const TEMPLATE_FIELD_KEYS = {
  hours: 'hours',
  days: 'days',
  units: 'units',
  periodStart: 'period_start',
  periodEnd: 'period_end',
} as const;

export interface PricingTemplateField {
  fieldKey: string;
  labelAr: string;
  fieldType: PricingFieldType;
  unitAr: string | null;
  minValue: string | null;
  maxValue: string | null;
  displayOrder: number;
}

export interface PricingTemplateDescriptor {
  key: PricingTemplateKey;
  labelAr: string;
  descriptionAr: string;
  /** معنى «السعر» اللي الأدمن بيدخله للقالب ده. */
  rateLabelAr: string;
  fields: PricingTemplateField[];
  /** الشجرة اللي بتتكتب في `final_price`. `rateCents` هو الرقم اللي الأدمن دخّله. */
  formula(rateCents: number): FormulaNode;
}

function numberField(
  fieldKey: string,
  labelAr: string,
  unitAr: string,
  minValue: string,
  maxValue: string,
): PricingTemplateField {
  return { fieldKey, labelAr, fieldType: PricingFieldType.NUMBER, unitAr, minValue, maxValue, displayOrder: 10 };
}

function dateField(fieldKey: string, labelAr: string, displayOrder: number): PricingTemplateField {
  return { fieldKey, labelAr, fieldType: PricingFieldType.DATE, unitAr: null, minValue: null, maxValue: null, displayOrder };
}

const rate = (rateCents: number): FormulaNode => ({ type: 'literal', value: rateCents });
const ref = (fieldKey: string): FormulaNode => ({ type: 'field_ref', field_key: fieldKey });

const TEMPLATES: Record<PricingTemplateKey, PricingTemplateDescriptor> = {
  [PricingTemplateKey.FIXED]: {
    key: PricingTemplateKey.FIXED,
    labelAr: 'سعر ثابت',
    descriptionAr: 'سعر واحد للخدمة مهما كانت المدة أو الكمية. مفيش أي حقل بيتطلب من العميل.',
    rateLabelAr: 'السعر (جنيه)',
    fields: [],
    formula: (rateCents) => rate(rateCents),
  },
  [PricingTemplateKey.HOURLY]: {
    key: PricingTemplateKey.HOURLY,
    labelAr: 'بالساعة',
    descriptionAr: 'العميل بيحدد عدد الساعات، والسعر = سعر الساعة × الساعات.',
    rateLabelAr: 'سعر الساعة (جنيه)',
    fields: [numberField(TEMPLATE_FIELD_KEYS.hours, 'عدد الساعات المطلوبة', 'ساعة', '1', '24')],
    formula: (rateCents) => ({ type: 'multiply', operands: [ref(TEMPLATE_FIELD_KEYS.hours), rate(rateCents)] }),
  },
  [PricingTemplateKey.DAILY]: {
    key: PricingTemplateKey.DAILY,
    labelAr: 'باليوم',
    descriptionAr: 'العميل بيحدد عدد الأيام، والسعر = سعر اليوم × الأيام.',
    rateLabelAr: 'سعر اليوم (جنيه)',
    fields: [numberField(TEMPLATE_FIELD_KEYS.days, 'عدد الأيام المطلوبة', 'يوم', '1', '365')],
    formula: (rateCents) => ({ type: 'multiply', operands: [ref(TEMPLATE_FIELD_KEYS.days), rate(rateCents)] }),
  },
  [PricingTemplateKey.MONTHLY]: {
    key: PricingTemplateKey.MONTHLY,
    labelAr: 'بالشهر (فترة تاريخين)',
    descriptionAr:
      'العميل بيختار تاريخ بداية وتاريخ نهاية، والنظام بيحسب شهور الفوترة بينهم بتقويم القاهرة (أي جزء من شهر = شهر كامل).',
    rateLabelAr: 'السعر الشهري (جنيه)',
    fields: [
      dateField(TEMPLATE_FIELD_KEYS.periodStart, 'تاريخ بداية الاشتراك', 10),
      dateField(TEMPLATE_FIELD_KEYS.periodEnd, 'تاريخ نهاية الاشتراك', 20),
    ],
    // `ceil` مقصودة: أي جزء من شهر شهر كامل — دي سياسة أي اشتراك، و`exact` كانت هتدّي كسور زي
    // 2.36 شهر على الفاتورة. و`max(…, 1)` بتضمن إن أقصر فترة ممكنة لسه شهر واحد.
    formula: (rateCents) => ({
      type: 'multiply',
      operands: [
        {
          type: 'max',
          operands: [
            {
              type: 'date_diff',
              from: { kind: 'field', field_key: TEMPLATE_FIELD_KEYS.periodStart },
              to: { kind: 'field', field_key: TEMPLATE_FIELD_KEYS.periodEnd },
              unit: 'months',
              rounding: 'ceil',
            },
            { type: 'literal', value: 1 },
          ],
        },
        rate(rateCents),
      ],
    }),
  },
  [PricingTemplateKey.PER_UNIT]: {
    key: PricingTemplateKey.PER_UNIT,
    labelAr: 'بالقطعة/بالوحدة',
    descriptionAr: 'العميل بيحدد الكمية (قطعة، متر، جهاز…)، والسعر = سعر الوحدة × الكمية.',
    rateLabelAr: 'سعر الوحدة (جنيه)',
    fields: [numberField(TEMPLATE_FIELD_KEYS.units, 'الكمية المطلوبة', 'وحدة', '1', '1000')],
    formula: (rateCents) => ({ type: 'multiply', operands: [ref(TEMPLATE_FIELD_KEYS.units), rate(rateCents)] }),
  },
};

export function pricingTemplate(key: PricingTemplateKey): PricingTemplateDescriptor {
  return TEMPLATES[key];
}

export function allPricingTemplates(): PricingTemplateDescriptor[] {
  return Object.values(TEMPLATES);
}

export function isPricingTemplateKey(value: string): value is PricingTemplateKey {
  return Object.prototype.hasOwnProperty.call(TEMPLATES, value);
}

/** حمولة قاعدة `final_price` الجاهزة للحفظ — نفس الشكل اللي البانِي بيحفظه بالظبط. */
export function pricingTemplateFinalPricePayload(
  key: PricingTemplateKey,
  rateCents: number,
  minPriceCents: number | null = null,
  maxPriceCents: number | null = null,
): FinalPriceFormulaPayload {
  return {
    price_cents: pricingTemplate(key).formula(rateCents),
    ...(minPriceCents !== null ? { min_price_cents: { type: 'literal' as const, value: minPriceCents } } : {}),
    ...(maxPriceCents !== null ? { max_price_cents: { type: 'literal' as const, value: maxPriceCents } } : {}),
  };
}
