import { FinalPriceFormulaPayload } from './pricing-formula.types';
import { collectFormulaReferences } from './formula-evaluator';

// فهرس مراجع معادلات خدمة (docs/01B §8/§13/§14) — مصدر واحد لثلاث حاجات:
// 1. منع تغييرات الحقول التدميرية (حذف/تعطيل/تغيير نوع) لما الحقل مستخدم في معادلة نشطة.
// 2. منع تعطيل ثابت/جدول بحث مستخدم في معادلة نشطة ("must not silently break").
// 3. find-usages للواجهة الإدارية (GET pricing-usages).

export interface FormulaReferenceLocation {
  ruleId: string;
  ruleKey: string;
  kind: 'field' | 'constant' | 'lookup' | 'lookup_bound_field';
  key: string;
  extraKey?: string;
  path: string;
}

export interface FormulaReferenceIndex {
  /** field_key → مواضع استخدامه في معادلات نشطة */
  fields: Map<string, FormulaReferenceLocation[]>;
  /** rule_key (constant) → مواضع */
  constants: Map<string, FormulaReferenceLocation[]>;
  /** rule_key (lookup_table) → مواضع (بما فيها ربط الحقل كمدخل منفصل) */
  lookups: Map<string, FormulaReferenceLocation[]>;
}

export async function loadActiveFormulaPayloads(
  rulesRepo: { find(params: unknown): Promise<{ id: string; ruleKey: string; payload: unknown }[]> },
  serviceId: string,
): Promise<{ id: string; ruleId: string; ruleKey: string; payload: FinalPriceFormulaPayload }[]> {
  const rows = await rulesRepo.find({
    where: { serviceId, ruleType: 'formula' as never, isActive: true },
  });
  return rows
    .filter((r) => r.payload != null)
    .map((r) => ({ ...r, ruleId: r.id, payload: r.payload as FinalPriceFormulaPayload }));
}

/** يبني الفهرس من payloads جاهزة — بيتنادى بعد loadActiveFormulaPayloads. */
export function indexFormulaReferences(
  formulas: { ruleId: string; ruleKey: string; payload: FinalPriceFormulaPayload }[],
): FormulaReferenceIndex {
  const index: FormulaReferenceIndex = { fields: new Map(), constants: new Map(), lookups: new Map() };
  const push = (map: Map<string, FormulaReferenceLocation[]>, key: string, loc: FormulaReferenceLocation): void => {
    const list = map.get(key) ?? [];
    list.push(loc);
    map.set(key, list);
  };

  for (const formula of formulas) {
    for (const ref of collectFormulaReferences(formula.payload)) {
      const loc: FormulaReferenceLocation = {
        ruleId: formula.ruleId,
        ruleKey: formula.ruleKey,
        kind: ref.kind,
        key: ref.key,
        extraKey: ref.extraKey,
        path: ref.path,
      };
      switch (ref.kind) {
        case 'field':
        case 'lookup_bound_field':
          // الاثنين بيعتمدوا على وجود الحقل النشط — الاتنين بيحرسوا نفس الحقل
          push(index.fields, ref.key, loc);
          break;
        case 'constant':
          push(index.constants, ref.key, loc);
          break;
        case 'lookup':
          push(index.lookups, ref.key, loc);
          break;
      }
      void ref.extraKey;
    }
  }
  return index;
}
