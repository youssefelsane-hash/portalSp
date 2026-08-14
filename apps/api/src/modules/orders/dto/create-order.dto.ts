import { ArrayMaxSize, ArrayUnique, IsArray, IsDateString, IsEnum, IsIn, IsNumber, IsObject, IsOptional, IsPositive, IsString, IsUUID, MaxLength } from 'class-validator';
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

  // نظام العمائر (docs/08 §13، ADR-0003) — كود العمارة المطبوع/الممسوح بالـ QR. متبادل استبعادياً
  // مع promo_code (مش الاتنين مع بعض) — القرار موثّق في ADR-0003.
  @IsOptional()
  @IsString()
  @MaxLength(20)
  building_code?: string;

  // محرك التسعير الديناميكي (docs/08 §1، ADR-0001) — لازم لخدمات pricing_model=formula بس
  // (نفس شكل PricingEngineService.evaluate()'s rawFieldValues بالحرف). العميل بيجيبها من
  // GET /services/:id/pricing-fields وبيملاها في فورم ديناميكي قبل ما يوصل هنا. لو الخدمة مش
  // formula، الحقل ده بيتجاهَل بأمان في CatalogService.estimate().
  @IsOptional()
  @IsObject()
  field_values?: Record<string, string | number | boolean>;

  // الجدولة الحقيقية للفني (docs/08 §2-§3، ADR-0002) — العميل اختار سلوت `available` محدد من
  // جدول فني بعينه (GET /technicians/:id/schedule) بدل ما يسيب المطابقة تختار/يستخدم تفضيل عام.
  // متبادل استبعادياً مع الطوارئ وإعادة الزيارة — تفاصيل كاملة في orders.service.ts.
  @IsOptional()
  @IsUUID()
  schedule_slot_id?: string;

  // محرك الإنتاجية (docs/06 §3.3-§3.6) — العميل اختار صف بيانات قياسية (GET /services/:id/standard-data)
  // ودخل الكمية/المساحة المطلوبة، فالباك-إند بيحسب الطاقم/المدة فعليًا (CatalogService.estimateDuration())
  // ويسجّلهم على الطلب. الاتنين لازم يتبعتوا مع بعض أو ولا واحد فيهم — قرار عمل من المالك.
  @IsOptional()
  @IsUUID()
  standard_data_id?: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  requested_units?: number;

  // دفع قبل التوزيع (ADR-0013 §3/§4 — "PAY BEFORE DISPATCH") — اختياري بالكامل، لو مبعتش
  // الطلب بيتوزّع فورًا زي السلوك الحالي (دفع بعد الشغل عبر collect-cash/pay-with-wallet/...).
  // لو "card" أو "instapay"، الطلب بيتعمل PENDING_PAYMENT بدل SEARCHING_TECHNICIAN، والتوزيع
  // بيتأجل لحد ما POST /orders/:id/pay-with-card أو pay-with-instapay يتأكد فعليًا. كاش/محفظة
  // مالهمش داعي هنا — دفعهم بيحصل بعد اكتمال الشغل زي زمان، مش قبل التوزيع.
  @IsOptional()
  @IsIn(['card', 'instapay'])
  payment_method?: 'card' | 'instapay';
}
