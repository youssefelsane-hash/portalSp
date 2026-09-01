import { PricingModel } from '../catalog/entities/service.entity';
import { PricingContext } from './pricing-context';
import { FormulaNode } from './pricing-formula.types';
import { dateDiff } from './pricing-temporal';

/**
 * **سجل طرق حساب السعر — المصدر الوحيد** (ADR-0050 §1).
 *
 * قبل الملف ده كانت معرفة كل طريقة متفرّقة على تلات أماكن: `switch` بيبني شجرة السعر في
 * `pricing-engine.service.ts`، و`if` بيتحقق من المدخل المطلوب في `catalog.service.ts`، و`switch`
 * تالت بيحدد «الوحدة» لسعر المنطقة المطلق في نفس الملف. إضافة طريقة أو تعديل معنى واحدة كان
 * لازم يتعمل في التلاتة، ولو اتنسي واحد بيغلط بصمت.
 *
 * دلوقتي كل طريقة **صف واحد** بيقول تلات حاجات:
 * 1. `requires` — إيه المدخل اللي لازم يتبعت من العميل عشان الحساب يبقى ممكن.
 * 2. `buildPrice` — شجرة `FormulaNode` بتحسب السعر. **نفس النوع بالحرف** اللي المعادلة
 *    الديناميكية بتستخدمه، وبتتنفّذ في نفس `evaluateFormulaNode()` — يعني مفيش «محرك تاني».
 * 3. `unitsForZoneOverride` — «الوحدة» اللي سعر المنطقة المطلق بيتضرب فيها.
 *
 * ده اللي بيحقق طلب المالك الحرفي في الاتجاهين: «أنا عايز كل الكلام ده يكون موجود» (الأسماء
 * كلها لسه اختيارات مفهومة للأدمن) و«الهدف مش إن يبقى في حاجتين بيعملوا نفس الحاجة» (مفيش
 * منطق حساب مكرر — الاختيار بيتحوّل لشجرة وخلاص).
 */

/** المدخل الإضافي اللي الطريقة محتاجاه من العميل. */
export type PricingMethodRequirement = 'none' | 'duration' | 'quantity' | 'period';

export interface PricingMethodDescriptor {
  key: PricingModel;
  labelAr: string;
  /** شرح سطر واحد للأدمن — نفس النص اللي بيظهر تحت قايمة «طريقة حساب السعر». */
  descriptionAr: string;
  /** معنى `base_price_cents` للطريقة دي («سعر الساعة» مش «السعر الأساسي»). */
  rateLabelAr: string;
  requires: PricingMethodRequirement;
  /** رسالة الرفض لو المدخل المطلوب ناقص. */
  missingInputMessageAr: string;
  buildPrice(rateNode: FormulaNode): FormulaNode;
  unitsForZoneOverride(context: PricingContext): number;
}

const QUANTITY: FormulaNode = { type: 'field_ref', field_key: 'quantity' };
const DURATION_HOURS: FormulaNode = { type: 'field_ref', field_key: 'duration_hours' };

/**
 * عدد شهور الفوترة بين بداية الفترة ونهايتها (ADR-0050 §4).
 *
 * `ceil` مقصودة: أي جزء من شهر بيتحسب شهر كامل — دي السياسة الفعلية لأي اشتراك، و`exact` كانت
 * هتدّي كسور زي 2.36 شهر على الفاتورة. و`max(…, 1)` بتضمن إن أقصر فترة ممكنة لسه شهر واحد.
 */
const BILLED_MONTHS: FormulaNode = {
  type: 'max',
  operands: [
    { type: 'date_diff', from: { kind: 'period_start' }, to: { kind: 'period_end' }, unit: 'months', rounding: 'ceil' },
    { type: 'literal', value: 1 },
  ],
};

const DESCRIPTORS: Record<PricingModel, PricingMethodDescriptor> = {
  [PricingModel.FIXED]: {
    key: PricingModel.FIXED,
    labelAr: 'سعر ثابت',
    descriptionAr: 'سعر واحد للخدمة مهما كانت المدة أو الكمية.',
    rateLabelAr: 'السعر (جنيه)',
    requires: 'none',
    missingInputMessageAr: '',
    buildPrice: (rate) => rate,
    unitsForZoneOverride: () => 1,
  },
  [PricingModel.HOURLY]: {
    key: PricingModel.HOURLY,
    labelAr: 'بالساعة',
    descriptionAr: 'السعر = سعر الساعة × عدد الساعات اللي العميل حجزها.',
    rateLabelAr: 'سعر الساعة (جنيه)',
    requires: 'duration',
    missingInputMessageAr: 'الخدمة دي محسوبة بالساعة — لازم تحدد المدة أو وقت البداية والنهاية',
    buildPrice: (rate) => ({ type: 'multiply', operands: [DURATION_HOURS, rate] }),
    unitsForZoneOverride: (context) => context.durationHours ?? 1,
  },
  [PricingModel.PER_UNIT]: {
    key: PricingModel.PER_UNIT,
    labelAr: 'بالوحدة/بالقطعة',
    descriptionAr: 'السعر = سعر الوحدة × الكمية اللي العميل حددها (قطعة، متر، جهاز…).',
    rateLabelAr: 'سعر الوحدة (جنيه)',
    requires: 'quantity',
    missingInputMessageAr: 'الخدمة دي محسوبة بالوحدة — لازم تحدد الكمية',
    buildPrice: (rate) => ({ type: 'multiply', operands: [QUANTITY, rate] }),
    unitsForZoneOverride: (context) => context.quantity ?? 1,
  },
  [PricingModel.MONTHLY]: {
    key: PricingModel.MONTHLY,
    labelAr: 'شهري (بفترة تاريخين)',
    descriptionAr:
      'العميل بيختار تاريخ بداية وتاريخ نهاية، والنظام بيحسب عدد شهور الفوترة بينهم بالتقويم (أي جزء من شهر = شهر كامل).',
    rateLabelAr: 'السعر الشهري (جنيه)',
    requires: 'period',
    missingInputMessageAr: 'الاشتراك الشهري لازم يتحدد بتاريخ بداية وتاريخ نهاية',
    buildPrice: (rate) => ({ type: 'multiply', operands: [BILLED_MONTHS, rate] }),
    unitsForZoneOverride: (context) => billedMonths(context),
  },
  [PricingModel.INSPECTION_THEN_QUOTE]: {
    key: PricingModel.INSPECTION_THEN_QUOTE,
    labelAr: 'كشف ثم عرض سعر',
    descriptionAr: 'مفيش سعر خدمة وقت الحجز — بيتحصّل رسم الكشف بس، والسعر النهائي بيتبعت بعد المعاينة.',
    rateLabelAr: 'السعر الأساسي (جنيه) — مش مستخدم في الحساب',
    requires: 'none',
    missingInputMessageAr: '',
    buildPrice: () => ({ type: 'literal', value: 0 }),
    unitsForZoneOverride: () => 1,
  },
  [PricingModel.FORMULA]: {
    key: PricingModel.FORMULA,
    labelAr: 'معادلة ديناميكية',
    descriptionAr: 'السعر بيتحسب من الحقول والقواعد اللي إنت بانيها في محرك التسعير تحت — أقوى وأمرن اختيار.',
    rateLabelAr: 'السعر الأساسي (جنيه) — المعادلة هي اللي بتحكم',
    requires: 'none',
    missingInputMessageAr: '',
    // الشجرة بتيجي من `service_pricing_rules` مش من هنا — الصف ده موجود عشان السجل يفضل
    // شامل لكل قيم `PricingModel` (أي قيمة جديدة هتفشّل التحقق هنا بدل ما تعدّي بصمت).
    buildPrice: (rate) => rate,
    unitsForZoneOverride: () => 1,
  },
};

/** عدد شهور الفوترة من السياق — نفس دلالة `BILLED_MONTHS` بالظبط، بس خارج الشجرة. */
export function billedMonths(context: PricingContext): number {
  if (!context.periodStart || !context.periodEnd) return 1;
  const months = dateDiff(context.periodStart, context.periodEnd, { unit: 'months', rounding: 'ceil' });
  return Math.max(months, 1);
}

export function pricingMethod(model: PricingModel): PricingMethodDescriptor {
  return DESCRIPTORS[model];
}

export function allPricingMethods(): PricingMethodDescriptor[] {
  return Object.values(DESCRIPTORS);
}

/**
 * هل مدخلات السياق كافية للطريقة دي؟ بترجّع رسالة الرفض أو `null`.
 *
 * الفحص ده كان `if` منفصل في `catalog.service.ts` لكل طريقة — دلوقتي بيقرا من نفس الصف اللي
 * بيبني الشجرة، فمستحيل يفترقوا.
 */
export function missingPricingInput(model: PricingModel, context: PricingContext): string | null {
  const descriptor = pricingMethod(model);
  switch (descriptor.requires) {
    case 'duration':
      return context.durationHours === null ? descriptor.missingInputMessageAr : null;
    case 'quantity':
      return context.quantity === null ? descriptor.missingInputMessageAr : null;
    case 'period':
      return context.periodStart === null || context.periodEnd === null ? descriptor.missingInputMessageAr : null;
    case 'none':
      return null;
  }
}
