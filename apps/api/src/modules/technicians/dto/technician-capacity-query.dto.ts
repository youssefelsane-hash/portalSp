import { IsDateString } from 'class-validator';

// معاينة القدرة الاستيعابية للأدمن (docs/08 §34.4) — يوم واحد بالظبط، مفيش نطاق (المعاينة سؤال
// "الفني ده متاح إمتى" بس، مش استعلام تقويم كامل).
export class TechnicianCapacityQueryDto {
  @IsDateString()
  date: string;
}
