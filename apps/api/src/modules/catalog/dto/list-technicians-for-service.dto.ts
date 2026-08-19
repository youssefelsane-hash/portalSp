import { Transform } from 'class-transformer';
import { IsIn, IsObject, IsOptional, IsUUID } from 'class-validator';
import { BOOKING_MODE_FILTER_VALUES, BookingModeFilter } from './list-services.dto';

export class ListTechniciansForServiceDto {
  @IsUUID()
  address_id: string;

  // خدمات pricing_model=formula (docs/08 §1) — لو العميل ملى تفاصيل الشغل بالفعل (فورم ديناميكي
  // قبل شاشة اختيار الفني)، السعر النهائي الحقيقي لكل فني مرشّح (بعد مضاعف مستواه) بيظهر هنا —
  // نفس فلسفة "مفيش مفاجأة سعر بعد التأكيد" المطبّقة على باقي نماذج التسعير. من غيرها،
  // final_price_cents بيرجع null صراحة لخدمات formula (زي ما كان دايمًا) بدل ما يرفض الطلب كله.
  // مُبعتة كـJSON مُرمّز في query string (GET مالوش body) — نفس نمط أي مرشّح كائن في REST APIs.
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  })
  @IsObject()
  field_values?: Record<string, string | number | boolean>;

  // مضاعف سعر مستوى الفني (docs/08) — لازم نعرف لو الحجز طوارئ عشان السعر النهائي المعروض لكل
  // فني مرشّح يشمل رسوم الطوارئ بالظبط زي اللي هيتحصّل فعليًا لو العميل أكّد بيه. نفس نمط
  // list-services.dto.ts's BookingModeFilter (تكرار بسيط بدل import من orders module).
  @IsOptional()
  @IsIn(BOOKING_MODE_FILTER_VALUES)
  booking_mode?: BookingModeFilter;

  // سياسة إلغاء الفني (docs/10) — بيستخدمه العميل وقت اختيار فني بديل بعد ما فني لغى، عشان
  // القايمة متعرضش نفس الفني اللي لغى تاني (اختياري، مش مؤثر على مسار الاختيار قبل الحجز العادي).
  @IsOptional()
  @IsUUID()
  exclude_technician_id?: string;

  // ترتيب القايمة (Script 6 Part 8) — recommended (افتراضي، الأنسب حسب محرك التوصية) منفصل عمداً
  // عن الفرز اليدوي البسيط (lowest_price/highest_rating) اللي العميل بيختاره بنفسه — Part 8 §
  // "Sorting is NOT the same as default ranking".
  @IsOptional()
  @IsIn(['recommended', 'lowest_price', 'highest_rating'])
  sort?: 'recommended' | 'lowest_price' | 'highest_rating';
}
