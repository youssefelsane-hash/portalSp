import { ArrayMaxSize, ArrayMinSize, IsDateString, IsIn, IsOptional, IsString, Length } from 'class-validator';

// تعديل جماعي سريع للإتاحة (docs/08 §34.3) — الفني بيحدد مجموعة تواريخ (مباشرة أو نطاق يتوسّع في
// الـcontroller قبل ما يوصل هنا) و"block"/"unblock" مرة واحدة، بدل ما يفتح كل يوم لوحده. الافتراض
// الأساسي (ADR-0017) فاضل زي ما هو: غياب صف = متاح، صف `blocked` صريح = الاستثناء الوحيد —
// "unblock" معناها مسح أي استثناء موجود، مش إنشاء صف "available" جديد.
export class BulkSetAvailabilityDto {
  @IsDateString({}, { each: true })
  @ArrayMinSize(1)
  @ArrayMaxSize(366)
  dates: string[];

  @IsIn(['block', 'unblock'])
  action: 'block' | 'unblock';

  @IsOptional()
  @IsString()
  @Length(1, 200)
  notes_ar?: string;
}
