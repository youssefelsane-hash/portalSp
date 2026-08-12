import { ServiceStandardData } from '../entities/service-standard-data.entity';

// محرك الإنتاجية (docs/06 §3.1-§3.6) — نسخة عامة للعميل، بحقول محدودة عمدًا. القيم الداخلية
// (أجور، إنتاجية، حد أدنى عمالة) مُستبعدة صراحة — docs/06 §3.6: "التكلفة الداخلية مش المفروض
// تتعرض للعميل". العميل محتاج بس id (يبعته لـ POST /services/:id/estimate-duration) واسم نوع
// التنفيذ/الوحدة عشان يعرف يملا الفورم صح.
export interface StandardDataResponseDto {
  id: string;
  execution_type_ar: string;
  unit_ar: string;
}

export function toStandardDataResponseDto(row: ServiceStandardData): StandardDataResponseDto {
  return {
    id: row.id,
    execution_type_ar: row.executionTypeAr,
    unit_ar: row.unitAr,
  };
}
