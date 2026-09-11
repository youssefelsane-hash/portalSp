import Link from 'next/link';
import { ServiceCategoryDto } from '@/lib/api-types';
import { CatalogImage } from './catalog-image';

/// نظير `apps/customer-app/lib/features/catalog/category_tile.dart` بالحرف: **صورة مربّعة فوق،
/// والاسم تحتها برّه الكارت**.
///
/// كان على الويب: صندوق بارتفاع ثابت 104px، بحدود وخلفية، جوّاه أيقونة 32px والاسم — ولمّا
/// مفيش صورة (وده الوضع الافتراضي لحد ما الأدمن يرفع) كان بيعرض **أول حرف من الاسم في دايرة
/// ملوّنة**. الأندرويد كان بيعرض صندوق صورة محايد. فنفس الفئة بشكلين مختلفين تمامًا على
/// المنصتين — وده بلاغ المالك 2026-09-11 بالحرف.
///
/// **مصدر الصورة `cover_image_url ?? icon_url`** — نفس `ServiceCategory.cardImageUrl` في
/// الأندرويد. الويب كان بيقرا `icon_url` بس، و`cover_image_url` (اللي الأدمن بيرفع فيه صورة
/// الغلاف فعلاً) مكانش موجود في نوع الويب أصلاً.
export function CategoryTile({ category }: { category: ServiceCategoryDto }) {
  const image = category.cover_image_url || category.icon_url;
  return (
    <Link
      href={`/categories/${category.id}`}
      className="motion-rise motion-press group flex flex-col gap-2 rounded-xl outline-offset-4"
    >
      <div className="overflow-hidden rounded-xl ring-1 ring-transparent transition-[transform,box-shadow] duration-200 group-hover:-translate-y-0.5 group-hover:ring-primary">
        <CatalogImage src={image} aspect="1 / 1" rounded="rounded-xl" sizeHint="(max-width: 640px) 45vw, 160px" />
      </div>
      {/* تلات أسطر كحد أقصى، نفس الأندرويد — بتستوعب اسم فئة وصفي من غير ما الصف يتكسر. */}
      <span className="line-clamp-3 text-center text-sm font-semibold leading-tight text-foreground group-hover:text-primary">
        {category.name_ar}
      </span>
    </Link>
  );
}
