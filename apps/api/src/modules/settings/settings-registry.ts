/**
 * **سجل مفاتيح الإعدادات — مصدر الحقيقة الوحيد** (تدقيق C-3، D-2، L-1، L-3، A-5، T-2).
 *
 * ## المشكلة اللي الملف ده موجود عشانها
 *
 * قيمة الإعداد كانت عايشة في **مكانين مستقلين** بلا أي رابط بينهم: ثابت `_FALLBACK` في الكود
 * (٦٥ ثابت)، وصف في جدول `settings`. مفيش حاجة كانت بتضمن تطابقهم، فاتولدت فئتَي خلل بتعيشوا
 * بلا ما حد يلاحظ — و**١٦٦٧ اختبار كانوا بيعدّوا نضاف فوقهم**:
 *
 *   • **مفتاح الكود بيقراه ومالوش صف** ⇒ الأدمن **مش قادر يضبطه أبدًا**. `SettingsService.update()`
 *     بينده `getOrThrow()` اللي بيرمي 404، ومفيش endpoint إنشاء إعداد أصلاً. كل ضبط توزيع
 *     الطوارئ الخمسة كان كده — hardcoded فعليًا، تغييره محتاج migration + deploy.
 *   • **صف مالوش قارئ** ⇒ الأدمن بيعدّله، بيشوف رسالة نجاح، **ومفيش أي حاجة بتحصل**. ١٤ مفتاح
 *     كانوا كده، منهم `otp.expiry_minutes` (الأدمن يفتكر إنه بيضبط أمان الـOTP) و
 *     `pricing.default_commission_percent` (بيفتكر إنه بيضبط فلوس) و`matching.radius_km_*`
 *     (بيفتكر إنه بيوسّع نطاق البحث، والنطاق الحقيقي بيتحدد بـ`technician_zones` أصلاً).
 *
 * المشروع نفسه كتب الحكم ده في migration `0260`: «إعداد ظاهر في لوحة الإدارة ومالوش أي أثر أسوأ
 * من مفيش إعداد». الفئة اتعالجت وقتها بمفتاح واحد، وفضلت تتراكم.
 *
 * ## القاعدة اللي بيفرضها
 *
 * أي مفتاح إعدادات لازم يبقى **هنا**، وأي مفتاح هنا لازم يبقى **في القاعدة**، بنفس النوع.
 * `settings-registry.spec.ts` بيقارن الاتجاهين على قاعدة حيّة وبيفشل لو أي طرف اختلف — يعني
 * الفئتين دول مايقدروش يرجعوا من غير ما اختبار يقع. ده الاختبار اللي كان هيمنع C-3 و D-2 و
 * L-1 و L-3 كلهم من الأساس.
 *
 * **`default` هنا = نفس قيمة الـfallback في الكود بالحرف.** مش قيمة جديدة ولا «تحسين» — الغرض
 * إن السجل يوصف النظام القايم بالظبط، فإضافته صفر تغيير سلوك.
 */

export type SettingValueType = 'number' | 'boolean' | 'string' | 'json';

export interface SettingDefinition {
  type: SettingValueType;
  /** نفس قيمة الـfallback في الكود — بتتزرع في القاعدة وقت الـmigration. */
  default: unknown;
  /** مجموعة العرض في لوحة الأدمن (`group_name` في الجدول). */
  group: string;
  /** بيظهر للأدمن جنب المفتاح — لازم يقول **إيه اللي بيتغيّر فعلاً** لما القيمة تتغيّر. */
  description: string;
}

export const SETTINGS_REGISTRY: Record<string, SettingDefinition> = {

  // ── booking ───────────────────────────────────────────────────────────
  // الاتنين دول **الاختبار الجديد هو اللي لقاهم** — التدقيق اليدوي فاتهم لأنهم مكتوبين على أكتر
  // من سطر (`getNumber(\n  'key',`) فالبحث النصّي السريع ما شافهمش. نفس فئة C-3 بالظبط.
  'booking.match_preview_candidate_limit': { type: 'number', default: 25, group: 'booking', description: 'أقصى عدد فنيين مرشّحين بيتحسبوا في معاينة المطابقة قبل الحجز (السقف الصلب 100)' },
  'booking.match_preview_ttl_seconds': { type: 'number', default: 300, group: 'booking', description: 'مدة صلاحية معاينة المطابقة بالثانية قبل ما تتحسب من جديد (السقف الصلب 1800)' },

  // ── assistant_matching ────────────────────────────────────────────────
  'assistant_matching.batch_size': { type: 'number', default: 10, group: 'assistant_matching', description: 'عدد المساعدين المرشّحين اللي بيتبعتلهم عرض في كل بث' },
  'assistant_matching.pool_matching_enabled': { type: 'boolean', default: true, group: 'assistant_matching', description: 'مفتاح إيقاف عام لبث فرص المساعدة لمجمع المساعدين' },
  'assistant_matching.response_timeout_seconds': { type: 'number', default: 120, group: 'assistant_matching', description: 'مهلة رد المساعدين على عرض المطابقة بالثانية' },

  // ── campaigns ─────────────────────────────────────────────────────────
  'campaigns.abandoned_intent_delay_minutes': { type: 'number', default: 60, group: 'campaigns', description: 'بعد كام دقيقة من "العميل بص على خدمة وما حجزش" يتبعت التذكير. القيمة على الحملة نفسها بتغلب دي لو متحددة.' },
  'campaigns.enabled': { type: 'boolean', default: true, group: 'campaigns', description: 'تشغيل/إيقاف محرك الحملات التسويقية بالكامل. إقفالها بيوقّف كل الإعلانات التلقائية فورًا بلا أي أثر على إشعارات الطلبات.' },
  'campaigns.inactive_customer_days': { type: 'number', default: 90, group: 'campaigns', description: 'العميل اللي ما دخلش من أكتر من كده ما بياخدش إعلانات — حساب ميت، والإرسال ليه بيضر سمعة المُرسِل.' },
  'campaigns.max_per_customer_per_week': { type: 'number', default: 2, group: 'campaigns', description: 'أقصى عدد إشعارات تسويقية للعميل الواحد في الأسبوع — **فوق كل الحملات مجتمعة**. أهم حاجز ضد السبام: مهما فعّل الأدمن حملات، السقف ده بيحكمهم كلهم.' },
  'campaigns.periodic_interval_days': { type: 'number', default: 4, group: 'campaigns', description: 'كل كام يوم يتبعت إعلان دوري للعميل الواحد (لو مفيش مانع تاني).' },
  'campaigns.quiet_hours_end': { type: 'string', default: '06:00', group: 'campaigns', description: 'نهاية ساعات الهدوء للإعلانات (UTC).' },
  'campaigns.quiet_hours_start': { type: 'string', default: '21:00', group: 'campaigns', description: 'بداية ساعات الهدوء للإعلانات (UTC) — مفيش إعلان جوّه النطاق ده. أوسع من ساعات هدوء الطلبات عمدًا: الإعلان مالوش أي استعجال.' },
  'campaigns.sweep_batch_size': { type: 'number', default: 200, group: 'campaigns', description: 'أقصى عدد إشعارات تسويقية في الدورة الواحدة — بيمنع أي دفعة ضخمة مفاجئة.' },

  // ── cancellation ──────────────────────────────────────────────────────
  'cancellation.auto_rematch_enabled': { type: 'boolean', default: true, group: 'cancellation', description: 'لما فني يلغي طلب مش مختار يدويًا من العميل — نرجّعه فورًا للمطابقة التلقائية (true) ولا نستنى العميل يختار بديل بنفسه (false)' },
  'cancellation.min_minutes_before_scheduled_start': { type: 'number', default: 60, group: 'cancellation', description: 'أقل عدد دقايق قبل موعد الطلب المجدول (لو موجود) اللي بعده الإلغاء الذاتي بيتمنع' },
  'cancellation.technician_self_cancel_enabled': { type: 'boolean', default: true, group: 'cancellation', description: 'هل مسموح للفني يلغي طلب اتقبله بنفسه (تفعيل/تعطيل عام للميزة كلها)' },
  'cancellation.window_minutes_after_acceptance': { type: 'number', default: 10, group: 'cancellation', description: 'عدد الدقايق المسموحة بعد قبول الفني للطلب اللي يقدر يلغي فيها بنفسه من غير تدخّل الدعم' },

  // ── commission ────────────────────────────────────────────────────────
  'commission.emergency_adjustment_percentage': { type: 'number', default: 5, group: 'commission', description: 'فرق عمولة إضافي (نقاط مئوية) لطلبات "طوارئ" — فوق عمولة الخدمة الأساسية وفرق مستوى الفني، قيمة افتراضية تجريبية مش نهائية' },
  'commission.individual_adjustment_percentage': { type: 'number', default: 0, group: 'commission', description: 'فرق عمولة إضافي (نقاط مئوية) لطلبات "أفراد" — فوق عمولة الخدمة الأساسية وفرق مستوى الفني' },
  'commission.team_adjustment_percentage': { type: 'number', default: 0, group: 'commission', description: 'فرق عمولة إضافي (نقاط مئوية) لطلبات "اعتماد" — فوق عمولة الخدمة الأساسية وفرق مستوى الفني' },

  // ── homepage ──────────────────────────────────────────────────────────
  'homepage.hero_images': { type: 'json', default: [], group: 'homepage', description: 'Ordered homepage hero image URLs (up to 4) shared by customer web and mobile' },
  'homepage.search_content': { type: 'json', default: {"title":"محتاج مساعدة في إيه؟","eyebrow":"أساعدك إزاي؟","description":"قول لينا مشكلتك بكلامك العادي، أو تصفّح الفئات تحت","placeholder":"وصّف مشكلتك... زي \"المياه بتنزل من تحت الحوض\""}, group: 'homepage', description: 'Customer homepage search eyebrow, title, description, and input placeholder shared by web and mobile' },
  'homepage.tips': { type: 'json', default: [{"body":"شوف تقييمات الفنيين وعدد الشغلانات اللي خلّصوها قبل ما تأكّد الحجز — كل حاجة ظاهرة قدامك في بروفايله.","title":"إزاي تختار الفني المناسب لشغلانتك؟","image_url":null},{"body":"اسأل عن الضمان، ومدة التنفيذ المتوقعة، وهل السعر شامل قطع الغيار ولا لأ.","title":"أسئلة تسألها قبل أي شغلانة كهرباء","image_url":null},{"body":"الصيانة الدورية بتوفّرلك فلوس على المدى الطويل — اعرف إمتى تحتاج كل نوع.","title":"الفرق بين الصيانة الدورية والطارئة","image_url":null}], group: 'homepage', description: 'كروت "نصايح مفيدة" المعروضة أسفل الصفحة الرئيسية (customer-web/customer-app) — عنوان/نص/رابط صورة اختياري لكل كارت، قابلة للتعديل بالكامل من الأدمن' },
  'homepage.trust_message': { type: 'string', default: 'ضمان حقيقي على كل شغلانة — لو في أي عيب بعد التسليم بنرجع نصلحه', group: 'homepage', description: 'رسالة الثقة/الضمان المعروضة في hero الصفحة الرئيسية (customer-web) — قابلة للتعديل بحرية من الأدمن' },

  // ── installments ──────────────────────────────────────────────────────
  'installments.auto_collection_enabled': { type: 'boolean', default: true, group: 'installments', description: 'تشغيل التحصيل التلقائي للأقساط المستحقة بوسائل الدفع المحفوظة — لا يُفعّل إلا بعد التحقق من دعم البوابة للتحصيل المتكرر فعليًا' },
  'installments.max_auto_attempts': { type: 'number', default: 3, group: 'installments', description: 'أقصى عدد محاولات تحصيل تلقائية لكل قسط — بعدها يفضل overdue مرئي للتدخل اليدوي' },
  'installments.retry_backoff_days': { type: 'number', default: 3, group: 'installments', description: 'عدد الأيام بين محاولات إعادة تحصيل القسط الفاشل' },

  // ── kpi ───────────────────────────────────────────────────────────────
  'kpi.enabled': { type: 'boolean', default: true, group: 'kpi', description: 'تفعيل/تعطيل محرك الـKPI الشهري بالكامل' },
  'kpi.expose_approval_notes_to_technician': { type: 'boolean', default: false, group: 'kpi', description: 'إظهار ملاحظات الأدمن الداخلية للفني في شاشة الـKPI بتاعته' },
  'kpi.min_completed_jobs_for_eligibility': { type: 'number', default: 3, group: 'kpi', description: 'أقل عدد طلبات مكتملة في الشهر عشان الفني يبقى مؤهّل لمكافأة مقترحة' },
  'kpi.monthly_max_bonus_cents': { type: 'number', default: 500000, group: 'kpi', description: 'أقصى مكافأة شهرية للفني الواحد بالقرش (افتراضي 5000 جنيه) — الأدمن العادي مايقدرش يتخطاها' },
  'kpi.negative_rating_threshold': { type: 'number', default: 2, group: 'kpi', description: 'التقييم (من 5) اللي يساويه أو أقل منه يُحسب "تقييم سلبي"' },
  'kpi.ops_can_override_suggested_amount': { type: 'boolean', default: true, group: 'kpi', description: 'العمليات تقدر تعتمد مبلغ مختلف عن المقترح (جوّه الحدود) بدل ما تكون ملزمة بالرقم المقترح بالظبط' },
  'kpi.penalty_points_per_upheld_complaint': { type: 'number', default: 20, group: 'kpi', description: 'نقاط تُخصم من بُعد الشكاوى لكل شكوى مثبتة (upheld) الشهر ده' },
  'kpi.serious_complaint_zero_score': { type: 'boolean', default: true, group: 'kpi', description: 'شكوى حرجة (critical) مثبتة تصفّر الـKPI الشهري بالكامل تلقائيًا' },
  'kpi.weight_acceptance': { type: 'number', default: 15, group: 'kpi', description: 'وزن بُعد معدل قبول عروض الطلبات' },
  'kpi.weight_cancellation': { type: 'number', default: 15, group: 'kpi', description: 'وزن بُعد معدل الإلغاء من الفني (سلبي)' },
  'kpi.weight_complaints': { type: 'number', default: 15, group: 'kpi', description: 'وزن بُعد الشكاوى المثبتة (سلبي)' },
  'kpi.weight_completion': { type: 'number', default: 15, group: 'kpi', description: 'وزن بُعد معدل إتمام الطلبات المقبولة' },
  'kpi.weight_rating': { type: 'number', default: 30, group: 'kpi', description: 'وزن بُعد متوسط التقييم' },
  'kpi.weight_revenue': { type: 'number', default: 10, group: 'kpi', description: 'وزن بُعد الإيراد النسبي مقارنة بمتوسط الفنيين الشهر ده' },

  // ── legal_entity ──────────────────────────────────────────────────────
  'legal.commercial_register': { type: 'string', default: '', group: 'legal_entity', description: 'رقم السجل التجاري.' },
  'legal.company_name_ar': { type: 'string', default: 'الصانع جروب', group: 'legal_entity', description: 'الاسم القانوني للجهة المشغّلة بالعربي.' },
  'legal.company_name_en': { type: 'string', default: 'ELSANE Group', group: 'legal_entity', description: 'الاسم القانوني للجهة المشغّلة بالإنجليزي — بيظهر جنب علامة حقوق النشر ©.' },
  'legal.legal_address': { type: 'string', default: '', group: 'legal_entity', description: 'العنوان القانوني المسجَّل للشركة. مطلوب من Google Play قبل النشر.' },
  'legal.platform_name_ar': { type: 'string', default: 'أسطى', group: 'legal_entity', description: 'اسم المنصة بالعربي كما يظهر في كل الواجهات والمستندات القانونية.' },
  'legal.platform_name_en': { type: 'string', default: 'OSTA', group: 'legal_entity', description: 'اسم المنصة بالإنجليزي.' },
  'legal.privacy_email': { type: 'string', default: '', group: 'legal_entity', description: 'بريد طلبات الخصوصية وحقوق أصحاب البيانات (قانون 151 لسنة 2020). لو فاضي بيتعرض بريد الدعم بدله.' },
  'legal.support_email': { type: 'string', default: '', group: 'legal_entity', description: 'بريد الدعم الرسمي. مطلوب من Google Play في صفحة السياسة وفي Store Listing.' },
  'legal.support_phone': { type: 'string', default: '', group: 'legal_entity', description: 'رقم التواصل الرسمي المعلن.' },
  'legal.tax_id': { type: 'string', default: '', group: 'legal_entity', description: 'الرقم الضريبي.' },
  'legal.website_url': { type: 'string', default: '', group: 'legal_entity', description: 'الموقع الرسمي للمنصة. لازم يبدأ https:// وإلا بيتجاهَل.' },

  // ── limits ────────────────────────────────────────────────────────────
  'orders.cancellation_free_window_min': { type: 'number', default: 5, group: 'limits', description: 'مهلة الإلغاء المجاني بالدقايق' },
  'orders.no_show_visit_fee_cents': { type: 'number', default: 5000, group: 'limits', description: 'رسوم الزيارة الفاشلة (عدم حضور/رفض شغل ضروري) اللي الأدمن بيطبّقها على الطلبات المدفوعة مسبقًا بالقرش' },
  'orders.payment_timeout_minutes': { type: 'number', default: 15, group: 'limits', description: 'إلغاء تلقائي لطلب PENDING_PAYMENT لو الدفع ماتمش' },
  'payouts.auto_approve_limit_cents': { type: 'number', default: 100000, group: 'limits', description: 'أقصى مبلغ صرف بدون مراجعة بشرية' },
  'payouts.min_amount_cents': { type: 'number', default: 20000, group: 'limits', description: 'أقل مبلغ صرف مسموح' },

  // ── loyalty ───────────────────────────────────────────────────────────
  'loyalty.earn_points_per_100_egp_spent': { type: 'number', default: 1, group: 'loyalty', description: 'نقاط الولاء المكتسبة لكل 100 جنيه إنفاق عند اكتمال الطلب' },
  'loyalty.points_expiry_months': { type: 'number', default: 12, group: 'loyalty', description: 'بعد كام شهر تنتهي نقاط الولاء المكتسبة (0 = ماتنتهيش أبدًا). التغيير بيسري على النقاط الجديدة بس — النقاط القديمة بتحتفظ بتاريخ انتهائها المتسجّل وقت اكتسابها.' },

  // ── matching ──────────────────────────────────────────────────────────
  'matching.batch_size': { type: 'number', default: 5, group: 'matching', description: 'عدد الفنيين في كل دفعة توزيع' },
  'matching.broaden_to_busy_after_round': { type: 'number', default: 4, group: 'matching', description: 'رقم الجولة اللي بعدها يتوسّع البحث لفنيين مرتبطين لكن مشغولين حاليًا' },
  'matching.company_large_job_boost': { type: 'number', default: 3, group: 'matching', description: 'زيادة معتدلة في ترتيب ممثل الشركة المسجلة للشغل الكبير عند كفاية طاقمها (0 = تعطيل)' },
  'matching.company_large_job_min_crew': { type: 'number', default: 4, group: 'matching', description: 'أقل إجمالي أفراد مطلوب في طلب فريق قبل تطبيق أفضلية الشركة المسجلة (افتراضي 4)' },
  'matching.daily_capacity_minutes': { type: 'number', default: 720, group: 'matching', description: 'أقصى دقايق شغل للفني في اليوم الواحد (720 = 12 ساعة). لو المحجوز في اليوم + الشغلانة الجديدة عدّى الرقم ده، الفني مايترشّحش لليوم ده.' },
  'matching.distance_weight': { type: 'number', default: 0, group: 'matching', description: 'وزن المسافة الأساسي في ترتيب المطابقة — كل كيلومتر بيخصم القيمة دي من نتيجة الفني. 0 = المسافة كاسر تعادل بس (افتراضي)' },
  // 2.0 معايَرة على أوزان المستوى (0/10/20/30/40، الفرق ١٠): كل ٥ كم = فرق مستوى كامل، فالقرب
  // بيغلب المستوى جوّه المدينة. تفاصيل المعايرة في migration 0264 §3.
  'matching.distance_weight_emergency': { type: 'number', default: 2.0, group: 'matching', description: 'وزن المسافة لطلبات الطوارئ — كل كيلومتر بيخصم القيمة دي من نتيجة الفني. 2.0 يعني كل ٥ كم = فرق مستوى فني كامل، فالأقرب بيسبق. لو أقل من الأساسي، الأساسي بيسري' },
  'matching.distance_weight_low_value': { type: 'number', default: 0, group: 'matching', description: 'وزن المسافة للشغلانات الرخيصة (أقل من أو يساوي matching.low_value_order_cents) — تكلفة الانتقال بتاكل هامش الشغلانة' },
  'matching.distance_weight_near_term': { type: 'number', default: 0, group: 'matching', description: 'وزن المسافة للطلبات خلال نافذة matching.near_term_request_hours (48 ساعة افتراضيًا) — مفيش مساحة لإعادة توزيع، فالأقرب أضمن' },
  'matching.emergency_batch_size': { type: 'number', default: 10, group: 'matching', description: 'عدد الفنيين في أول دفعة بث لطلب الطوارئ' },
  'matching.emergency_escalation_after_rounds': { type: 'number', default: 2, group: 'matching', description: 'عدد جولات الطوارئ الفاشلة قبل تصعيد الطلب للإدارة' },
  'matching.emergency_max_technicians_contacted': { type: 'number', default: 40, group: 'matching', description: 'أقصى عدد فنيين يتواصل معاهم النظام لطلب طوارئ واحد قبل التصعيد' },
  'matching.emergency_response_timeout_seconds': { type: 'number', default: 20, group: 'matching', description: 'مهلة رد الفني على عرض طوارئ بالثانية قبل الجولة اللي بعدها' },
  'matching.emergency_subsequent_batch_size': { type: 'number', default: 10, group: 'matching', description: 'عدد الفنيين في كل دفعة بث تالية لطلب الطوارئ' },
  'matching.fairness_decline_weight': { type: 'number', default: 0.5, group: 'matching', description: 'وزن الفرصة المرفوضة الحديثة في حساب العدالة، نسبة لوزن الطلب المؤكد الفعلي (0 = الرفض بلا أثر، 1 = زي المؤكد بالظبط)' },
  'matching.fairness_lookback_days': { type: 'number', default: 7, group: 'matching', description: 'نافذة الأيام اللي نموذج العدالة بيراجعها لحساب توزيع الشغل الحديث للفني' },
  'matching.fairness_weight': { type: 'number', default: 0, group: 'matching', description: 'وزن مكوّن العدالة في ترتيب المطابقة — 0 = معطّل تمامًا (الترتيب زي ما هو دلوقتي)، لحد ما يتفعّل صراحة' },
  'matching.low_value_order_cents': { type: 'number', default: 15000, group: 'matching', description: 'حد «الشغلانة الرخيصة» بالقرش (15000 = 150 جنيه) — الطلب تحته بياخد وزن المسافة المخصّص للشغل الرخيص' },
  'matching.near_term_request_hours': { type: 'number', default: 48, group: 'matching', description: 'الشغل اللي معاده خلال العدد ده من الساعات بيتبعت للفنيين كـ"طلب" محتاج قبول (زي الطوارئ) بدل التعيين التلقائي. 0 = تعطيل (كل غير الطوارئ يتعيّن تلقائي).' },
  'matching.near_term_round_timeouts_minutes': { type: 'string', default: '5,15,30', group: 'matching', description: 'مهلة كل موجة بث للشغل القريب بالدقايق، مفصولة بفاصلة — الموجة الأولى 5 دقايق، التانية 15، التالتة 30. أي موجة بعد كده بتاخد آخر قيمة.' },
  'matching.offer_heavy_workload_technicians': { type: 'boolean', default: true, group: 'matching', description: 'فني تصنيفه HEAVY (شاغل يوم كامل/مدة متعددة الأيام) يتعرضله فرصة اختيارية برضه؟ false = يتستبعد تمامًا زي القديم' },
  'matching.preferred_crew_max_size': { type: 'number', default: 10, group: 'matching', description: 'أقصى عدد أعضاء مقبولين في الفريق المفضّل الدائم لكل فني (docs/08 §36.16)' },
  'matching.recovery_batch_size': { type: 'number', default: 25, group: 'matching', description: 'أقصى عدد طلبات يأخذ دوره في جولة استرداد واحدة' },
  'matching.recovery_initial_backoff_seconds': { type: 'number', default: 60, group: 'matching', description: 'مهلة إعادة المحاولة الأولى للطلب الذي لم يجد فنيًا؛ تتضاعف تدريجيًا لمنع حجب الطلبات الجديدة' },
  'matching.recovery_interval_seconds': { type: 'number', default: 60, group: 'matching', description: 'عدد الثواني بين جولات استرداد الطلبات التي ما زالت تبحث عن فني' },
  'matching.recovery_max_backoff_seconds': { type: 'number', default: 3600, group: 'matching', description: 'أقصى مهلة بين محاولات مطابقة الطلب العالق، بالثواني' },
  'matching.reliability_baseline_rating': { type: 'number', default: 4, group: 'matching', description: 'خط أساس التقييم المتوقّع — فني فوقه ياخد أولوية إضافية، تحته خصم (نسبة لـreliability_weight)' },
  'matching.reliability_min_ratings_count': { type: 'number', default: 3, group: 'matching', description: 'أقل عدد تقييمات مطلوب قبل ما الموثوقية تأثر على الترتيب — فني تحت العدد ده محايد تمامًا (صفر تأثير سلبي/إيجابي)' },
  'matching.reliability_weight': { type: 'number', default: 0, group: 'matching', description: 'وزن تقييم الفني (average_rating) في ترتيب المطابقة — 0 = معطّل بالكامل (افتراضي)' },
  'matching.tie_break_threshold': { type: 'number', default: 0, group: 'matching', description: 'الفرق بين نتيجتين مرشّحين اللي تحتهم يُعتبروا "متعادلين" لكسر التعادل الموزون عشوائيًا — 0 = معطّل (ترتيب حتمي زي القديم)' },
  'matching.work_opportunity_exclusive_seconds': { type: 'number', default: 7200, group: 'matching', description: 'مدة حصرية العرض الاختياري الأول؛ بعدها يظل العرض صالحًا لكن يمكن توسيعه بالتوازي لفني آخر' },
  'matching.workload_balance_weight': { type: 'number', default: 2, group: 'matching', description: 'وزن يتطرح من أولوية مستوى الفني (order_priority_weight) عن كل طلب نشط عليه حاليًا — عشان التوزيع يبقى متوازن مش دايمًا نفس الفني الأعلى مستوى/الأقرب (0 = تعطيل)' },

  'matching.max_rounds': { type: 'number', default: 4, group: 'matching', description: 'أقصى عدد جولات بث للطلب العادي قبل ما المطابقة تتوقف وتتصعّد' },
  // ── notification_engine ───────────────────────────────────────────────
  'notification_engine.action_required_max_reminders': { type: 'number', default: 24, group: 'notification_engine', description: 'أقصى عدد تذكيرات لأي action_required قبل ما يفضل ساكت (مش resolved)' },
  'notification_engine.action_required_reminder_interval_minutes': { type: 'number', default: 60, group: 'notification_engine', description: 'كل قد إيه يتكرر تذكير action_required لحد ما يتحل (بالدقايق)' },
  'notification_engine.critical_offer_reminder_ratios': { type: 'json', default: [0.5,0.85], group: 'notification_engine', description: 'نِسَب مواقع تذكيرات عرض الطوارئ (critical_offer) جوّه نافذة الصلاحية نفسها (0-1، مثلاً 0.5 = نص المهلة) — قابلة للتعديل الكامل، صفر قيم دائمة' },
  'notification_engine.quiet_hours_end': { type: 'string', default: '08:00', group: 'notification_engine', description: 'نهاية ساعات الهدوء (UTC، HH:MM)' },
  'notification_engine.quiet_hours_start': { type: 'string', default: '22:00', group: 'notification_engine', description: 'بداية ساعات الهدوء (UTC، HH:MM) — تذكيرات action_required بتتأجل لبعدها' },
  'notification_engine.scheduled_job_day_before_hour_utc': { type: 'number', default: 8, group: 'notification_engine', description: 'الساعة (UTC) صبح اليوم اللي قبل الموعد لتذكير scheduled_job — لو الموعد بعيد بما يكفي' },
  'notification_engine.scheduled_job_pre_appointment_minutes': { type: 'number', default: 120, group: 'notification_engine', description: 'قد إيه قبل الموعد نفسه يتبعت آخر تذكير scheduled_job' },
  'notification_engine.scheduled_job_reminder_after_minutes': { type: 'number', default: 60, group: 'notification_engine', description: 'أول تذكير scheduled_job بعد كام دقيقة من القبول لو الفني لسه ما فتحش الإشعار الأول' },

  // ── ops ───────────────────────────────────────────────────────────────
  'ops.queue_watchdog_check_interval_minutes': { type: 'number', default: 2, group: 'ops', description: 'كل قد إيه (بالدقايق) الـwatchdog بيفحص الطوابير' },
  'ops.queue_watchdog_enabled': { type: 'boolean', default: true, group: 'ops', description: 'تفعيل/تعطيل مراقبة تعليق طوابير BullMQ (matching-rounds/customer-stats/technician-stats) — لو اتعطّل، مفيش exit تلقائي للـprocess حتى لو طابور معلّق' },
  'ops.queue_watchdog_shutdown_grace_seconds': { type: 'number', default: 10, group: 'ops', description: 'مهلة الإغلاق الرشيق بالثواني قبل الخروج القسري لما الـwatchdog يكتشف طابور توزيع معلّق (لازم تفضل أقل من TimeoutStopSec في systemd)' },
  'ops.queue_watchdog_stall_threshold_minutes': { type: 'number', default: 5, group: 'ops', description: 'أقل عدد دقايق تفضل فيها أقدم وظيفة واقفة في الطابور (مع إن Redis نفسه متاح ومتجاوَب) قبل ما نعتبرها Worker معلّق ونعمل exit نظيف للـprocess' },

  // ── orders ────────────────────────────────────────────────────────────
  'crew.optional_assistant_enabled': { type: 'boolean', default: true, group: 'orders', description: 'يسمح لفني الشغلانة الفردية إنه يضم مساعد اختياري. الاختياري عمره ما يتحسب "نقص طاقم" — مفيش تصعيد ولا كارت أحمر.' },
  'crew.optional_assistant_max_per_order': { type: 'number', default: 1, group: 'orders', description: 'أقصى عدد مساعدين اختياريين في الشغلانة الفردية الواحدة (طلب المالك: واحد بس).' },
  'orders.crew_shortage_escalation_hours_before': { type: 'number', default: 24, group: 'orders', description: 'قد إيه قبل موعد طلب الفريق (بالساعات) نصعّد للأدمن لو الطاقم لسه ناقص' },
  'orders.max_work_sessions_per_order': { type: 'number', default: 3, group: 'orders', description: 'أقصى عدد زيارات لطلب واحد (استكمال الشغل يوم تاني). بعده لازم تدخّل الدعم.' },
  'orders.technician_reschedule_max_requests': { type: 'number', default: 2, group: 'orders', description: 'أقصى عدد طلبات تأجيل يستطيع الفني إرسالها لنفس الطلب قبل تدخل الدعم' },
  'revisit.original_technician_response_hours': { type: 'number', default: 48, group: 'orders', description: 'مهلة رد الفني الأصلي على إعادة زيارة مثبّتة عليه (بالساعات). بعدها بتظهر عند الأدمن كبند محتاج تصرّف — التحرير قرار أدمن مش تلقائي لأن وراه خصم مالي.' },

  // ── payments ──────────────────────────────────────────────────────────
  'crew.assistant_share_ratio': { type: 'number', default: 0.65, group: 'payments', description: 'نسبة حصة المساعد من حصة الفني في نفس المستوى داخل الطاقم (0.65 = المساعد بياخد 65% من اللي الفني بياخده). بتتضرب في وزن المستوى، مش بديل عنه.' },
  'earnings.v2_cutover_enabled': { type: 'boolean', default: false, group: 'payments', description: 'Enable policy version 2 for newly created paid orders only after readiness reaches 100%.' },
  'earnings.v2_shadow_enabled': { type: 'boolean', default: true, group: 'payments', description: 'Compare legacy and V2 results without posting V2 wallet movements.' },
  'payments.card_enabled': { type: 'boolean', default: true, group: 'payments', description: 'إظهار الدفع بالبطاقة عبر Paymob للعملاء عند اكتمال الإعداد' },
  'payments.cash_enabled': { type: 'boolean', default: true, group: 'payments', description: 'تفعيل الدفع كاش (تسليم مباشر للفني) — لو اتعطّل، العميل ميقدرش يأكّد تسليم كاش ولا يختاره كوسيلة دفع جديدة' },
  'payments.fawry_enabled': { type: 'boolean', default: false, group: 'payments', description: 'تفعيل الدفع بكود فوري المرجعي (Fawry) — معطّل افتراضيًا، مش أولوية V1 (ADR-0013)' },
  'payments.installments_enabled': { type: 'boolean', default: true, group: 'payments', description: 'إتاحة خطط التقسيط المرتبطة بالخدمات عند جاهزية Paymob' },
  'payments.instapay_confirmation_window_hours': { type: 'number', default: 24, group: 'payments', description: 'مدة صلاحية كود تحويل InstaPay قبل ما يتطلب إعادة الدفع من جديد (ساعات)' },
  'payments.instapay_enabled': { type: 'boolean', default: true, group: 'payments', description: 'إظهار InstaPay للعملاء عند اكتمال بيانات المستلم' },
  'payments.instapay.ipa_address': { type: 'string', default: '', group: 'payments', description: 'عنوان IPA أو رقم موبايل InstaPay المسجّل — بيتعرض للعميل كتعليمات تحويل. فاضي = InstaPay معطّلة (isConfigured=false)' },
  'payments.instapay.qr_image': { type: 'string', default: '', group: 'payments', description: 'صورة QR لاستقبال تحويلات InstaPay — إما "storage://<key>" لملف مرفوع من لوحة الأدمن، أو رابط https خارجي. فاضي = مفيش QR (العميل بيشوف تعليمات التحويل النصية بس)' },
  'payments.instapay.recipient_name': { type: 'string', default: '', group: 'payments', description: 'الاسم اللي بيتعرض للعميل مع عنوان IPA فوق (يتطمّن إنه بيحوّل للجهة الصح). فاضي = InstaPay معطّلة' },
  'payments.wallet_enabled': { type: 'boolean', default: true, group: 'payments', description: 'إتاحة الدفع من محفظة العميل' },
  'payments.webhook_processing_stale_minutes': { type: 'number', default: 5, group: 'payments', description: 'بعدها تعتبر محاولة webhook processing عالقة وقابلة للاسترداد' },
  'payments.webhook_recovery_base_delay_seconds': { type: 'number', default: 30, group: 'payments', description: 'أول مهلة لإعادة معالجة webhook فاشل؛ يتضاعف التأخير لكل محاولة' },
  'payments.webhook_recovery_batch_size': { type: 'number', default: 25, group: 'payments', description: 'أقصى عدد webhooks يستعيده الفحص الدوري في الدفعة الواحدة' },
  'payments.webhook_recovery_max_attempts': { type: 'number', default: 5, group: 'payments', description: 'أقصى عدد محاولات معالجة webhook فاشل قبل المراجعة اليدوية' },
  'technician_debt.alert_age_days': { type: 'number', default: 14, group: 'payments', description: 'ADR-0041: عدد أيام استمرار المديونية اللي بعدها تتحسب "قديمة". الحالة alert بتيجي لما العتبتين يتعدّوا مع بعض.' },
  'technician_debt.alert_threshold_cents': { type: 'number', default: 50000, group: 'payments', description: 'ADR-0041: مديونية الفني اللي فوقها تتحسب "تستاهل انتباه". بالقرش (50000 = 500 ج.م.).' },

  // ── payments_paymob ───────────────────────────────────────────────────
  'payments.paymob.api_key': { type: 'string', default: '', group: 'payments_paymob', description: 'Paymob API key (secret, encrypted)' },
  'payments.paymob.base_url': { type: 'string', default: 'https://accept.paymob.com', group: 'payments_paymob', description: 'Paymob API base URL' },
  'payments.paymob.hmac_secret': { type: 'string', default: '', group: 'payments_paymob', description: 'Paymob webhook HMAC secret (secret, encrypted)' },
  'payments.paymob.integration_id_card': { type: 'string', default: '', group: 'payments_paymob', description: 'Paymob card integration ID' },
  'payments.paymob.integration_id_mobile_wallet': { type: 'string', default: '', group: 'payments_paymob', description: 'Optional Paymob mobile-wallet integration ID' },
  'payments.paymob.public_key': { type: 'string', default: '', group: 'payments_paymob', description: 'Paymob Unified Checkout public key' },
  'payments.paymob.secret_key': { type: 'string', default: '', group: 'payments_paymob', description: 'Paymob Intention API secret key (secret, encrypted)' },

  // ── pricing ───────────────────────────────────────────────────────────
  'commission_base.discount_reduces_technician_share': { type: 'boolean', default: false, group: 'pricing', description: 'false = الخصم (كوبون/عمارة) بيتحمّله نصيب الشركة وحدها، والفني بياخد على سعر الشغل الكامل قبل الخصم.' },
  'commission_base.include_additional_items': { type: 'boolean', default: true, group: 'pricing', description: 'البنود الإضافية المعتمدة أثناء الشغل داخل الوعاء (طلب مالك صريح: "ده برضه بيعتبر ضمن الشغل").' },
  'commission_base.include_addons': { type: 'boolean', default: true, group: 'pricing', description: 'إضافات الكتالوج المختارة وقت الحجز داخل الوعاء — شغل إضافي حقيقي بينفّذه الفني.' },
  'commission_base.include_emergency_surcharge': { type: 'boolean', default: false, group: 'pricing', description: 'رسوم الطوارئ الإضافية: false = 100% للشركة.' },
  'commission_base.include_inspection_fee': { type: 'boolean', default: true, group: 'pricing', description: 'رسوم المعاينة داخل الوعاء — الفني هو اللي بينزل المعاينة فعلاً.' },
  'commission_base.include_installment_interest': { type: 'boolean', default: false, group: 'pricing', description: 'فوائد/رسوم التقسيط: false = 100% للشركة (طلب مالك صريح).' },
  'commission_base.include_level_premium': { type: 'boolean', default: true, group: 'pricing', description: 'مضاعف مستوى الفني داخل وعاء العمولة — ليفل أعلى يعني فلوس أكتر للفني نفسه (طلب مالك صريح).' },
  'commission_base.include_warranty': { type: 'boolean', default: false, group: 'pricing', description: 'سعر الضمان الاختياري: false = 100% للشركة (طلب مالك صريح — ده كان أصل البلاغ).' },
  'commission_base.include_zone_surge': { type: 'boolean', default: false, group: 'pricing', description: 'مضاعف المنطقة/التضخم: false = الزيادة دي 100% للشركة، الفني مالوش نصيب فيها.' },
  'emergency.sla_minutes': { type: 'number', default: 60, group: 'pricing', description: 'الوقت المعلن للعميل ("هيوصلك خلال X دقيقة") لطلبات الطوارئ — رقم معلن بس، مش ETA محسوب من مسار/زحمة فعلية، قيمة افتراضية تجريبية مش نهائية' },
  'pricing.auto_match_level_premium': { type: 'string', default: 'charge', group: 'pricing', description: 'لما المطابقة التلقائية تعيّن فني مستواه بيزوّد السعر: charge = الفرق يتضاف للطلب كسطر "فني مميّز" (السلوك المطلوب من المالك)؛ absorb = الشركة تتحمّله والسعر ما يتغيّرش.' },
  'pricing.emergency_surcharge_percentage': { type: 'number', default: 20, group: 'pricing', description: 'رسوم إضافية صريحة (نسبة مئوية) على السعر التقديري لطلبات "طوارئ" — بتتعرض للعميل قبل التأكيد (orders.surge_amount_cents)، قيمة افتراضية تجريبية مش نهائية' },
  'warranty.default_days': { type: 'number', default: 14, group: 'pricing', description: 'مدة الضمان الافتراضية' },

  // ── productivity ──────────────────────────────────────────────────────
  'productivity.default_evaluation_period_months': { type: 'number', default: 1, group: 'productivity', description: 'عدد الشهور الافتراضي لتجميع بيانات الإنتاجية لو مفيش months مبعوت في الطلب' },
  'productivity.metrics_config': { type: 'json', default: {"complaint_rate":{"weight":15,"enabled":true,"direction":"lower_is_better","minSampleSize":1},"acceptance_rate":{"weight":10,"enabled":true,"direction":"higher_is_better","minSampleSize":1},"completion_rate":{"weight":15,"enabled":true,"direction":"higher_is_better","minSampleSize":1},"customer_rating":{"weight":10,"enabled":true,"direction":"higher_is_better","minSampleSize":1},"completed_orders":{"target":20,"weight":20,"enabled":true,"direction":"higher_is_better","minSampleSize":1},"cancellation_rate":{"weight":15,"enabled":true,"direction":"lower_is_better","minSampleSize":1},"monthly_kpi_score":{"weight":5,"enabled":true,"direction":"higher_is_better","minSampleSize":1},"revenue_delivered":{"target":5000000,"weight":10,"enabled":true,"direction":"higher_is_better","minSampleSize":1}}, group: 'productivity', description: 'تفعيل/وزن/اتجاه/حجم عينة أدنى لكل مقياس إنتاجية — قابل للتعديل الكامل من /settings (محرر JSON العام)، صفر قيم دائمة في الكود' },

  // ── productivity_learning ─────────────────────────────────────────────
  'productivity_learning.min_change_percentage': { type: 'number', default: 5, group: 'productivity_learning', description: 'أقل نسبة فرق بين الإنتاجية الحالية والمقترحة عشان نولّد اقتراح (تفادي اقتراحات تافهة)' },
  'productivity_learning.min_sample_size': { type: 'number', default: 5, group: 'productivity_learning', description: 'أقل عدد observations قبل ما نولّد اقتراح تحديث إنتاجية' },

  // ── projects ──────────────────────────────────────────────────────────
  'projects.milestone_auto_approve_hours': { type: 'number', default: 72, group: 'projects', description: 'ساعات الموافقة التلقائية للمرحلة إذا العميل ما ردش' },

  // ── recurring ─────────────────────────────────────────────────────────
  'recurring.materialization_lead_time_hours': { type: 'number', default: 96, group: 'recurring', description: 'عدد الساعات قبل موعد الحجز المتكرر التي يتحول فيها إلى طلب فعلي لبدء المطابقة والدفع مبكرًا' },

  // ── referral ──────────────────────────────────────────────────────────
  'referral.recovery_batch_size': { type: 'number', default: 25, group: 'referral', description: 'أقصى عدد إحالات معلقة يفحصها مسار الاسترداد في الدورة الواحدة' },
  'referral.required_referrals_per_reward': { type: 'number', default: 10, group: 'referral', description: 'عدد الترشيحات المكتملة (أول طلب فعلي للمُرشَّح) المطلوبة لاستحقاق مكافأة واحدة' },
  'referral.reward_validity_days': { type: 'number', default: 90, group: 'referral', description: 'عدد أيام صلاحية كود مكافأة الترشيح من تاريخ الإصدار' },
  'referral.reward_value_egp': { type: 'number', default: 150, group: 'referral', description: 'قيمة كود الخصم اللي بيتصدر تلقائياً كمكافأة ترشيح (بالجنيه) — تقريب لساعة خدمة قياسية' },

  // ── referral_qr ───────────────────────────────────────────────────────
  'referral_qr.bonus_amount_cents': { type: 'number', default: 5000, group: 'referral_qr', description: 'مكافأة الفني بالقرش لكل طلب مؤهّل (افتراضي 50 جنيه — قابل للتعديل بالكامل)' },
  'referral_qr.enabled': { type: 'boolean', default: true, group: 'referral_qr', description: 'تفعيل/تعطيل نظام ترشيح QR للفني بالكامل' },
  'referral_qr.max_monthly_bonus_cents_per_technician': { type: 'number', default: 0, group: 'referral_qr', description: 'أقصى مكافآت ترشيح شهرية لكل فني بالقرش (صفر = بلا حد أقصى)' },
  'referral_qr.min_minutes_between_bonuses': { type: 'number', default: 0, group: 'referral_qr', description: 'أقل مدة بالدقايق بين مكافأتين متتاليتين لنفس الفني — منع إساءة استخدام (صفر = معطّل)' },
  'referral_qr.min_order_amount_cents': { type: 'number', default: 0, group: 'referral_qr', description: 'أقل قيمة طلب بالقرش عشان يستحق المكافأة (صفر = بلا حد أدنى)' },
  'referral_qr.qualifying_min_order_status': { type: 'string', default: 'completed', group: 'referral_qr', description: 'أقل حالة طلب لاستحقاق المكافأة: accepted أو work_completed أو completed' },
  'referral_qr.reject_duplicate_device': { type: 'boolean', default: true, group: 'referral_qr', description: 'رفض المكافأة لو العميل بيستخدم نفس جهاز الفني أو عميل تاني اتكافأ عليه الفني قبل كده' },
  'referral_qr.reward_mode': { type: 'string', default: 'first_order_only', group: 'referral_qr', description: 'first_order_only = أول طلب مؤهّل بس، every_order = كل طلب مؤهّل' },

  // ── reviews ───────────────────────────────────────────────────────────
  'reviews.google_review_url': { type: 'string', default: '', group: 'reviews', description: 'رابط صفحة تقييم Google الحقيقي (Google Business Profile) — فاضي = الاقتراح متوقف تلقائيًا لحد ما يتحط' },
  'reviews.min_rating_for_google_prompt': { type: 'number', default: 4, group: 'reviews', description: 'أقل overall_rating (من 5) عشان نقترح على العميل يقيّم على Google كمان' },

  // ── social ────────────────────────────────────────────────────────────
  'social.facebook_graph_access_token': { type: 'string', default: '', group: 'social', description: 'مفتاح Facebook Graph API لجلب معاينات لينكات انستجرام/فيسبوك (oEmbed)' },

  // ── support ───────────────────────────────────────────────────────────
  'support.email': { type: 'string', default: '', group: 'support', description: 'إيميل الدعم (اختياري)' },
  'support.enabled': { type: 'boolean', default: false, group: 'support', description: 'إظهار قسم "تواصل معنا" في التطبيقات — false لحد ما الأرقام تتملى' },
  'support.help_url': { type: 'string', default: '', group: 'support', description: 'رابط صفحة مساعدة/موقع (اختياري، لازم يبدأ https://)' },
  'support.phone_number': { type: 'string', default: '', group: 'support', description: 'رقم تليفون خدمة العملاء (بصيغة دولية، مثال: +201001234567)' },
  'support.whatsapp_number': { type: 'string', default: '', group: 'support', description: 'رقم واتساب خدمة العملاء (أرقام بس، بصيغة دولية بلا +، مثال: 201001234567)' },

  // ── technicians ───────────────────────────────────────────────────────
  'technicians.require_national_id_for_approval': { type: 'boolean', default: true, group: 'technicians', description: 'لازم يكون للفني رقم قومي مسجّل قبل ما الأدمن يقدر يعتمده (approved). إقفالها بيسمح باعتماد فني بلا هوية دائمة — استخدمها لحالات استثنائية بس.' },
  // ── catalog ───────────────────────────────────────────────────────────
  'catalog.most_requested_window_days': { type: 'number', default: 90, group: 'catalog', description: 'نافذة الأيام اللي بيتحسب عليها «الأكثر طلبًا» في الكتالوج' },
  // ── ranking ───────────────────────────────────────────────────────────
  'ranking.bayesian_min_samples': { type: 'number', default: 5, group: 'ranking', description: 'أقل عدد تقييمات قبل ما متوسط الفني يُحسب بوزنه الكامل في الترتيب' },
  'ranking.bayesian_prior_mean': { type: 'number', default: 4.0, group: 'ranking', description: 'المتوسط المرجعي اللي بيتسحب ناحيته تقييم الفني قليل العينات (تنعيم بايزي)' },
  // ── security ──────────────────────────────────────────────────────────
  'security.dedup_window_seconds': { type: 'number', default: 300, group: 'security', description: 'نافذة تجميع الأحداث الأمنية المتطابقة في حدث واحد بدل صفوف مكررة' },
  'security.repeated_denial_burst_threshold': { type: 'number', default: 5, group: 'security', description: 'عدد الرفضات المتتالية اللي بعدها يتسجّل حدث «رفض متكرر»' },
  'security.repeated_denial_burst_window_seconds': { type: 'number', default: 900, group: 'security', description: 'النافذة الزمنية اللي بيتحسب فيها عدّاد الرفض المتكرر' },
  'security.repeated_denial_escalate_threshold': { type: 'number', default: 5, group: 'security', description: 'عدد تكرارات الحدث اللي بعدها يتصعّد لخطورة أعلى' },
  // ── workforce ─────────────────────────────────────────────────────────
  'workforce.idle_threshold_seconds': { type: 'number', default: 300, group: 'workforce', description: 'بعد كام ثانية بلا نشاط يتحوّل الموظف من ACTIVE لـIDLE' },
};

/** كل مفاتيح السجل — بيتستخدم في الاختبار والـmigrations. */
export const REGISTERED_SETTING_KEYS = Object.keys(SETTINGS_REGISTRY);

/** القيمة الافتراضية المسجّلة لمفتاح، أو `undefined` لو المفتاح مش مسجّل أصلاً. */
export function registeredDefault<T = unknown>(key: string): T | undefined {
  return SETTINGS_REGISTRY[key]?.default as T | undefined;
}
