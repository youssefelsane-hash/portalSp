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

  // "مرن — اختار نطاق أيام" (docs/08 §32.3، طلب مالك صريح 2026-08-20) — لو اتبعت مع scheduled_at،
  // الباك-إند بيدوّر على أقرب يوم بينهم (الاتنين شاملين) فيه فني مؤهّل واحد على الأقل فعليًا،
  // ويثبّت الطلب على اليوم ده بدل scheduled_at الحرفي. أقصى 14 يوم فرق — orders.service.ts
  // بيرفض غير كده صراحة (تكرار استعلام أهلية يومي محدود، مش نطاق مفتوح).
  @IsOptional()
  @IsDateString()
  scheduled_at_range_end?: string;

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

  // دقة الوقت (ADR-0031 Slice B) — إجباري لخدمة service.requiresPreciseSchedule=true (جليسة
  // أطفال بالساعة، تنظيف بالساعة...) أو service.requiresHoursOnly=true (ADR-0032)، ممنوع لأي خدمة
  // تانية. تفاصيل فحص التعارض بدقة ساعة كاملة في orders.service.ts.
  @IsOptional()
  @IsNumber()
  @IsPositive()
  duration_hours?: number;

  // وضع "بداية+نهاية" (ADR-0032، migration 0172) — إجباري بس لخدمة service.requiresStartAndEnd=true
  // (عقد شهري/إقامة بمدة محددة)، ممنوع لأي خدمة تانية. لازم يكون بعد scheduled_at — orders.service.ts
  // بيتحقق منها صراحة، وCHECK constraint على مستوى الـDB (chk_orders_scheduled_end_after_start) بيضمنها
  // كخط دفاع أخير.
  @IsOptional()
  @IsDateString()
  scheduled_end_at?: string;

  // "كرّر الحجز ده" (migration 0176) — لو اتبعت، الطلب الحالي بيتعمل بالمسار العادي الكامل
  // زي زمان، **وزي عليه** قالب متكرر بيتإنشاء بنفس الـtransaction (ذرّي) أول موعد له بعد الموعد
  // المحجوز مباشرة (أسبوعي = +7 أيام بنفس التوقيت، شهري = نفس اليوم/التوقيت الشهر الجاي مع
  // clamp لآخر يوم فعلي في الشهر — راجع recurring-schedule.util.ts). مرفوض صراحة للطوارئ
  // وإعادة الزيارة تحت الضمان والخدمات غير مفعّل فيها التكرار وغير المحددة بموعد.
  // yearly متاح في الـAPI للاتساق مع POST /me/recurring-orders — الواجهات بتعرض أسبوعي/شهري.
  @IsOptional()
  @IsIn(['weekly', 'monthly', 'yearly'])
  repeat_frequency?: 'weekly' | 'monthly' | 'yearly';

  // نسخ سياسات/شروط الدفع اللي العميل قبلها (migration 0177) — إجبارية من الباك-إند للطلبات
  // غير المدفوعة مقدّمًا لو الخدمة عليها سياسة required (applies_to=postpaid_service). الباك-إند
  // بيرفض أي طلب بيحاول يتخطى الموافقة حتى لو الواجهة عرضت الـcheckbox.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  accepted_policy_version_ids?: string[];
}
