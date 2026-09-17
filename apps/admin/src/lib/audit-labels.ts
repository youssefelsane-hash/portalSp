/**
 * **ترجمة أفعال سجل النشاط للعربي** (بلاغ مالك 2026-09-17: «كلام مش معروف الكلام ده يعني»).
 *
 * في لقطة حقيقية لصفحة سجل النشاط، الأدمن كان بيقرا `security.access_denied` و
 * `security_event#01a0af01` و`admin` — مفاتيح إنجليزية خام. الصفحة تقنيًا «شغّالة» ووظيفيًا
 * غير مقروءة لموظف عمليات عربي.
 *
 * ### ليه تركيب مش قايمة بـ204 مفتاح
 *
 * في المشروع **204 فعل مختلف** (`grep -rho "action: '[a-z_]*\.[a-z_]*'" apps/api/src`)،
 * وبيزيدوا مع كل ميزة. قايمة ثابتة بالمفاتيح الكاملة كانت هتقدم بعد أول feature وتسيب الأدمن
 * يقرا إنجليزي تاني من غير ما حد يلاحظ.
 *
 * المفتاح دايمًا `entity.verb`، فالترجمة بتتركّب من جزئين: اسم الكيان + الفعل. أي مفتاح جديد
 * بياخد ترجمة معقولة تلقائيًا لو الكيان أو الفعل معروف، ولو مش معروف بيتحوّل لكلمات مقروءة
 * بدل ما يتعرض `snake_case` خام.
 *
 * **المفتاح الخام بيفضل معروض دايمًا** كسطر ثانوي في الجدول — الترجمة راحة قراءة، والمفتاح هو
 * المرجع الدقيق للتشخيص والفلترة.
 */

/** أسماء الكيانات — مجموعة مقفولة نسبيًا (كائنات النطاق نفسها). */
const ENTITY_LABELS: Record<string, string> = {
  academy_course: 'كورس الأكاديمية',
  academy_exam_attempt: 'محاولة اختبار',
  admin_mfa: 'مصادقة الأدمن',
  branding: 'هوية العلامة',
  campaign: 'حملة تسويقية',
  cancellation_reason: 'سبب إلغاء',
  complaint: 'شكوى',
  customer: 'عميل',
  earnings_policy: 'سياسة المستحقات',
  employee: 'موظف',
  feature_flag: 'مفتاح ميزة',
  geo: 'المدن والمناطق',
  installment_application: 'طلب تقسيط',
  installment_document: 'مستند تقسيط',
  installment_plan: 'خطة تقسيط',
  loyalty: 'نقاط الولاء',
  marketing_spend: 'مصروف تسويقي',
  notification_routing_rule: 'قاعدة توجيه إشعار',
  notification_type_config: 'إعداد نوع إشعار',
  order: 'طلب',
  payment: 'دفعة',
  payment_policy: 'سياسة دفع',
  payout: 'صرف مستحقات',
  pricing_field: 'حقل تسعير',
  pricing_rule: 'قاعدة تسعير',
  pricing_rule_test: 'اختبار قاعدة تسعير',
  pricing_template: 'قالب تسعير',
  productivity_suggestion: 'اقتراح إنتاجية',
  project: 'مشروع',
  promo_code: 'كود خصم',
  risk_center: 'مركز المخاطر',
  role: 'دور إداري',
  roles: 'أدوار إدارية',
  security: 'الأمان',
  security_event: 'حدث أمني',
  service: 'خدمة',
  service_addon: 'إضافة خدمة',
  service_category: 'فئة خدمات',
  service_pricing_tier_pricing: 'تسعير فئة فني',
  service_productivity_actual: 'إنتاجية فعلية',
  service_standard_data: 'بيانات قياسية',
  service_zone_pricing: 'تسعير منطقة',
  setting: 'إعداد',
  support_ticket: 'تذكرة دعم',
  technician: 'فني',
  technician_category: 'فئة فني',
  technician_company: 'شركة فنيين',
  technician_company_branch: 'فرع شركة',
  technician_company_staff: 'طاقم شركة',
  technician_kpi: 'مكافأة أداء',
  technician_level_config: 'إعداد مستوى فني',
  technician_progression: 'ترقية فني',
  technician_progression_rule: 'قاعدة ترقية',
  technician_referral: 'ترشيح فني',
  technician_service: 'خدمة فني',
  technician_zone: 'منطقة فني',
  test: 'اختبار داخلي',
  wallet: 'محفظة',
  warranty_claim: 'مطالبة ضمان',
  warranty_plan: 'خطة ضمان',
};

/** الأفعال المشتركة — دي اللي بتغطي أغلب المفاتيح. */
const VERB_LABELS: Record<string, string> = {
  access_denied: 'رفض وصول',
  acknowledged: 'تم الإقرار',
  added: 'إضافة',
  adjusted: 'تعديل',
  applied: 'تطبيق',
  approved: 'موافقة',
  assign: 'تعيين',
  assigned: 'تعيين',
  blocked: 'حظر',
  cancelled: 'إلغاء',
  clone: 'استنساخ',
  cloned: 'استنساخ',
  closed: 'إغلاق',
  comment_added: 'إضافة تعليق',
  completed: 'إكمال',
  created: 'إنشاء',
  deactivated: 'تعطيل',
  declared: 'إقرار',
  deleted: 'حذف',
  investigating: 'قيد الفحص',
  paid: 'تم الصرف',
  permissions_changed: 'تغيير صلاحيات',
  purge: 'تنظيف',
  re_declared: 'إعادة إقرار',
  recorded: 'تسجيل',
  rejected: 'رفض',
  removed: 'إزالة',
  reset: 'تصفير',
  resolved: 'حل',
  reviewed: 'مراجعة',
  revoke: 'سحب',
  revoked: 'سحب',
  set_permissions: 'ضبط صلاحيات',
  status_changed: 'تغيير حالة',
  submitted: 'تقديم',
  suspended: 'إيقاف',
  unblocked: 'فك حظر',
  updated: 'تعديل',
  viewed: 'عرض',
  // أفعال مركّبة (مفعول + فعل) — بتتكرر بين أكتر من كيان فمكانها هنا مش في الترجمات الكاملة.
  area_created: 'إنشاء منطقة',
  area_deleted: 'حذف منطقة',
  area_updated: 'تعديل منطقة',
  asset_removed: 'مسح أصل بصري',
  asset_uploaded: 'رفع أصل بصري',
  assistant_approved: 'الموافقة على مساعد',
  assistant_rejected: 'رفض مساعد',
  assistant_removed: 'إزالة مساعد',
  assistant_requested: 'طلب مساعد',
  certificate_reviewed: 'مراجعة شهادة',
  city_created: 'إنشاء مدينة',
  city_deleted: 'حذف مدينة',
  city_updated: 'تعديل مدينة',
  document_reviewed: 'مراجعة مستند',
  level_updated: 'تعديل مستوى',
  media_cleared: 'مسح صورة',
  media_uploaded: 'رفع صورة',
  milestone_approved: 'الموافقة على مرحلة',
  milestone_completed: 'إكمال مرحلة',
  milestone_rejected: 'رفض مرحلة',
  milestone_started: 'بدء مرحلة',
  milestones_created: 'إنشاء مراحل',
  order_adjustment_created: 'إنشاء تعديل على مستوى الطلب',
  order_adjustment_disabled: 'تعطيل تعديل على مستوى الطلب',
  order_linked: 'ربط طلب',
  quote_approved: 'الموافقة على عرض سعر',
  quote_created: 'إنشاء عرض سعر',
  quote_sent: 'إرسال عرض سعر',
  service_commission_updated: 'تعديل عمولة خدمة',
  service_level_override_upserted: 'ضبط استثناء مستوى لخدمة',
  service_override_reset: 'تصفير استثناءات خدمة',
  service_skill_override_upserted: 'ضبط استثناء مهارة لخدمة',
  service_zone_created: 'إنشاء نطاق خدمة',
  service_zone_deleted: 'حذف نطاق خدمة',
  service_zone_updated: 'تعديل نطاق خدمة',
  severity_updated: 'تعديل درجة الخطورة',
  signal_verdict_recorded: 'تسجيل حكم على إشارة خطر',
  skill_updated: 'تعديل مهارة',
  technician_adjustment_created: 'إنشاء تعديل على مستوى الفني',
  warranty_issued: 'إصدار ضمان',
  admin_assigned: 'تعيين بواسطة الأدمن',
  admin_removed: 'إزالة بواسطة الأدمن',
  bonus_credited: 'إضافة مكافأة',
  bonus_manual_review: 'مكافأة تحت مراجعة يدوية',
  bonus_rejected: 'رفض مكافأة',
  bonus_revoked: 'سحب مكافأة',
  withdrawn: 'سحب',
};

/** أفعال بعينها التركيب فيها بيطلع ركيك أو ناقص — دي بترجمة كاملة. */
const EXACT_LABELS: Record<string, string> = {
  'customer.deleted': 'حذف حساب عميل',
  'employee.session_revoked': 'إلغاء جلسة موظف',
  'geo.zone_catalog_availability_updated': 'تعديل خدمات نطاق',
  'loyalty.manual_credit': 'إضافة نقاط ولاء يدويًا',
  'order.assistant_assigned_manually': 'تعيين مساعد يدويًا',
  'order.cancelled_by_admin': 'إلغاء الطلب بواسطة الأدمن',
  'order.cash_dispute_resolved_confirmed': 'حل نزاع كاش — تأكيد التحصيل',
  'order.cash_dispute_resolved_retry': 'حل نزاع كاش — إعادة المحاولة',
  'order.created_for_customer': 'إنشاء طلب نيابة عن عميل',
  'order.crew_member_added': 'إضافة عضو للطاقم',
  'order.crew_member_removed': 'إزالة عضو من الطاقم',
  'order.crew_member_replaced': 'استبدال عضو في الطاقم',
  'order.failed_visit_resolved': 'حل زيارة فاشلة',
  'order.instapay_discount_applied': 'تطبيق خصم InstaPay',
  'order.price_adjusted_by_admin': 'تعديل سعر الطلب يدويًا',
  'order.reassigned_by_admin': 'إعادة تعيين الفني',
  'order.refund_failed_needs_manual_review': 'فشل استرداد — يحتاج مراجعة',
  'order.refund_reconciliation_required': 'استرداد يحتاج تسوية',
  'order.refund_withheld_for_completed_visit': 'حجز استرداد لزيارة منفّذة',
  'order.rescheduled_by_admin': 'تأجيل الطلب بواسطة الأدمن',
  'order.revisit_released': 'إطلاق زيارة إعادة',
  'order.technician_cancelled': 'إلغاء الفني للطلب',
  'payment.instapay_confirmed_manually': 'تأكيد تحويل InstaPay يدويًا',
  'payment.instapay_rejected_manually': 'رفض تحويل InstaPay يدويًا',
  'payment_policy.version_published': 'نشر نسخة سياسة دفع',
  'security.access_denied': 'محاولة وصول مرفوضة',
  'setting.updated': 'تعديل إعداد',
  'technician.debt_settlement_recorded': 'تسجيل تسوية مديونية',
  'technician.kind_changed': 'تغيير نوع الفني',
  'technician.pricing_tier_changed': 'تغيير فئة تسعير الفني',
  'technician.service_allowed': 'السماح بخدمة للفني',
  'technician.service_excluded': 'استثناء خدمة من الفني',
  'technician_company.ownership_transferred': 'نقل ملكية الشركة',
  'technician_company.price_multiplier_changed': 'تغيير معامل سعر الشركة',
  'wallet.adjusted': 'تعديل رصيد محفظة',
};

/** أسماء أدوار الفاعل — «admin» في عمود الفاعل مكانت بتقول حاجة. */
const ACTOR_ROLE_LABELS: Record<string, string> = {
  admin: 'أدمن',
  super_admin: 'أدمن عام',
  employee: 'موظف',
  technician: 'فني',
  customer: 'عميل',
  system: 'النظام',
};

/** `snake_case` → كلمات مفصولة، للمفاتيح اللي ملهاش ترجمة لسه. */
const humanize = (raw: string) => raw.replace(/_/g, ' ');

/** اسم الكيان بالعربي (أو المفتاح الخام مقروءًا لو مش معروف). */
export function auditEntityLabel(entityType: string): string {
  return ENTITY_LABELS[entityType] ?? humanize(entityType);
}

/**
 * الفعل بالعربي: ترجمة كاملة لو موجودة، وإلا «فعل — كيان» مركّبة، وإلا المفتاح مقروءًا.
 *
 * بترجع دايمًا نص غير فاضي، فالجدول مايبانش فيه خانة فاضية لمفتاح جديد.
 */
export function auditActionLabel(action: string): string {
  const exact = EXACT_LABELS[action];
  if (exact) return exact;
  const dot = action.indexOf('.');
  if (dot === -1) return humanize(action);
  const entity = action.slice(0, dot);
  const verb = action.slice(dot + 1);
  const verbAr = VERB_LABELS[verb];
  const entityAr = ENTITY_LABELS[entity];
  if (verbAr && entityAr) return `${verbAr} ${entityAr}`;
  if (verbAr) return `${verbAr} — ${humanize(entity)}`;
  if (entityAr) return `${entityAr} — ${humanize(verb)}`;
  return humanize(action);
}

export function auditActorRoleLabel(role: string | null | undefined): string {
  if (!role) return '—';
  return ACTOR_ROLE_LABELS[role] ?? humanize(role);
}
