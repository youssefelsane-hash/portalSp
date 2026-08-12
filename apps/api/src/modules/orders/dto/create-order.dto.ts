import { ArrayMaxSize, ArrayUnique, IsArray, IsDateString, IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { BookingMode, OrderType } from '../entities/order.entity';

export class CreateOrderDto {
  @IsUUID()
  service_id: string;

  @IsUUID()
  address_id: string;

  @IsOptional()
  @IsEnum(OrderType)
  order_type?: OrderType;

  // هيكل الحجز الجديد (docs/06 §1) — الزرار اللي العميل دوس عليه قبل ما يوصل هنا (فرد/اعتماد/طوارئ).
  // اختياري وبيرجع لـ"individual" بشكل افتراضي — التطبيقات القديمة (لو فيه) تفضل شغالة زي زمان.
  @IsOptional()
  @IsEnum(BookingMode)
  booking_mode?: BookingMode;

  // "اعتماد" — العميل اختار شركة/فريق بعينه من GET /technician-companies بدل ما يسيب المطابقة
  // تختار. تفضيل بس مش ضمان (نفس فلسفة requested_technician_id تحت)، ومسموح بس مع booking_mode=team.
  @IsOptional()
  @IsUUID()
  requested_technician_company_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  problem_description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  customer_notes?: string;

  @IsOptional()
  @IsDateString()
  scheduled_at?: string;

  @IsOptional()
  @IsString()
  @MaxLength(24)
  promo_code?: string;

  // "إعادة الحجز" — تفضيل بس، مش ضمان (تفاصيل في matching/README.md).
  @IsOptional()
  @IsUUID()
  requested_technician_id?: string;

  // "إعادة زيارة" تحت الضمان (docs/08 §7) — لو العميل عنده مشكلة تانية بنفس الخدمة في نفس
  // العنوان قبل ما ضمان الطلب الأصلي يخلص. order_type بيتحدد تلقائيًا لـ"revisit" (بيتجاهل
  // dto.order_type)، والطلب مجاني بالكامل — كل تفاصيل التحقق في orders.service.ts.
  @IsOptional()
  @IsUUID()
  original_order_id?: string;

  // إضافات جاهزة من كتالوج الخدمة نفسها (service_addons) — بتتحط في order_items بـ
  // is_customer_approved=true فوراً (العميل اختارها بنفسه وقت الحجز، مش عرض سعر مستني موافقة).
  // مختلفة عن مسار awaiting_quote_approval (order-items.service.ts) اللي الفني بيقترحه أثناء الشغل.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  addon_ids?: string[];
}
