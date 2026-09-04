#!/usr/bin/env node
/**
 * كاشف انحراف العقد بين الباك-إند والعملاء (docs/08 §132).
 *
 * **فئة البَقّة اللي بيمسكها**: الباك-إند بيرجّع حقل، والواجهة **مابتقراهوش أصلاً**. مفيش
 * استثناء، مفيش خطأ كونسول، مفيش فشل اختبار — الشاشة ببساطة بتعرض حاجة أقل دقة أو مابتعرضش
 * حاجة. الفئة دي ضربت مرتين في يوم واحد:
 *
 *   • `duration_minutes` كانت راجعة من `preview` و`GET /orders/:id` من الأول، والواجهتين
 *     بيقروا `estimated_duration_days` بس ⇒ «المدة المتوقعة: يوم واحد» لشغلانة ساعتين.
 *   • رسايل الإدارة كانت في الإشعار بس ⇒ العميل يفتح الطلب ويلاقيه فاضي من التفاصيل.
 *
 * الأداة بتقارن حقول DTOs الباك-إند بالحقول اللي كل عميل بيقراها فعلاً، وبتطلع تقرير
 * بالمفقودات. **مش بوابة تفشّل البناء**: عميل مش لازم يقرا كل حقل (الأدمن بيقرا حاجات
 * العميل مالوش دعوة بيها والعكس)، فالنتيجة قايمة للمراجعة البشرية مش خطأ.
 *
 *   node scripts/check-contract-drift.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/** حقول أول `interface <name> {...}` في ملف TypeScript. */
function tsInterfaceFields(file, name) {
  const src = read(file);
  const start = src.indexOf(`interface ${name}`);
  if (start < 0) return null;
  const open = src.indexOf('{', start);
  let depth = 0, i = open;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  const body = src.slice(open + 1, i);
  // **الحقول الاختيارية (`?`) بتتستثنى**: وجودها في النوع مايضمنش إن الـendpoint بيبعتها.
  // في العقد ده مثلاً `paid_amount_cents` وإخواتها بتتحقن من `OrderFinancialSummaryResponseDto`
  // في مسارات الأدمن/الفني بس، والعميل مابياخدهاش أصلاً — عدّها كـ«انحراف» كان بيدّي ٦ بلاغات
  // كاذبة تخفي الانحراف الحقيقي. الإجباري بس هو العقد المضمون.
  return new Set([...body.matchAll(/^\s{2}([a-z_][a-z0-9_]*)\s*:/gim)].map((m) => m[1]));
}

/** كل مفاتيح `json['...']` اللي كلاس Dart بيقراها. */
function dartJsonKeys(file) {
  return new Set([...read(file).matchAll(/json\[['"]([a-z_][a-z0-9_]*)['"]\]/g)].map((m) => m[1]));
}

/**
 * حقول الباك-إند اللي مالهاش لازمة عند عميل بعينه — **بقرار، مش بسهو**. أي حقل هنا لازم يكون
 * ليه سبب مكتوب، عشان القايمة ما تبقاش سلة زبالة تخفي الانحراف الحقيقي.
 */
const INTENTIONAL = {
  // مشترك بين العميلين — حقول **مش من عقد العميل** أصلاً أو مالهاش معنى عرض.
  _shared: new Set([
    // معرّفات داخلية: العرض بيستخدم الاسم/الكائن مش الـUUID.
    'customer_id', 'service_zone_id', 'address_id', 'technician_id', 'promo_code_id',
    'warranty_plan_id', 'standard_data_id', 'building_id', 'requested_technician_company_id',
    'created_by_admin_user_id', 'source_channel', 'recurring_template_id', 'recurring_occurrence_at',
    'idempotency_key', 'booking_context_hash', 'selected_match_preview_id', 'matching_attempt_count',
    'settlement_policy_version', 'calculation_algorithm_version',
    // أرقام المنصّة والفني — ممنوعة على العميل بالتصميم (docs/08 §60.2).
    'commission_rate_applied', 'platform_commission_cents', 'commissionable_base_cents',
    'worker_pool_cents', 'technician_earning_cents', 'assistant_daily_wage_cents_snapshot',
    // إثراء خاص بعارض تاني (`viewerExtras`) — بيتحقن لمسار الفني/الأدمن بس.
    'customer_name', 'customer_phone', 'customer_user_id', 'is_new_for_technician',
    'service_name_ar', 'team_shortage', 'team_members_needed', 'team_leader_name',
    // دفاتر إعادة الزيارة الداخلية — العميل بيشوف «إعادة زيارة تحت الضمان» كنص، مش الحقول دي.
    'revisit_pinned_technician_id', 'revisit_pinned_at', 'revisit_released_at', 'revisit_release_reason',
    // مدخلات العميل نفسه — هو اللي كتبها، معروضة في مكانها مش كحقل خام.
    'customer_inputs', 'customer_notes', 'pricing_period_start', 'pricing_period_end',
    'pricing_quantity', 'scheduled_end_at',
    // حالة مشتقّة: الواجهة بتشتق العرض من `order_status` مش من دول.
    'price_status', 'assessment_type',
    // رسم الاستعجال **مابيتعرضش كبند مستقل** بقرار مالك (docs/08 بند 5/13) — داخل الإجمالي.
    'surge_amount_cents',
    // رسوم التقييم: اتشرحت للعميل عبر `customer_notices` (ADR-0071) بدل أرقام خام.
    'remote_assessment_fee_cents', 'assessment_fee_credit_cents',
    // معاينة السعر: تفاصيل بتتعرض في شاشة الحجز نفسها، مش في سجل الطلب.
    'level_price_multiplier', 'emergency_sla_minutes', 'addons',
    'required_technicians', 'required_assistants',
  ]),
  'customer-web': new Set([
    // عرض الضمان الاختياري (upsell) لسه مش جزء من رحلة الحجز في الويب — الأرقام المدفوعة
    // فعلاً (`warranty_price_cents`) معروضة، اللي ناقص هو **عرض الشراء** نفسه، وده بند
    // تكافؤ متتبَّع مش انحراف عقد.
    'optional_warranty',
  ]),
  'customer-app': new Set([]),
};
const intentional = (client) => new Set([...INTENTIONAL._shared, ...(INTENTIONAL[client] || [])]);

const CONTRACTS = [
  {
    name: 'الطلب (OrderResponseDto)',
    backend: () => tsInterfaceFields('apps/api/src/modules/orders/dto/order-response.dto.ts', 'OrderResponseDto'),
    clients: {
      'customer-web': () => tsInterfaceFields('apps/customer-web/src/lib/orders.ts', 'OrderResponseDto'),
      'customer-app': () => dartJsonKeys('apps/customer-app/lib/features/orders/models.dart'),
    },
  },
  {
    name: 'معاينة السعر (PreviewOrderResponseDto)',
    backend: () => tsInterfaceFields('apps/api/src/modules/orders/dto/preview-order-response.dto.ts', 'PreviewOrderResponseDto'),
    clients: {
      'customer-web': () => tsInterfaceFields('apps/customer-web/src/lib/orders.ts', 'PreviewOrderResponseDto'),
      'customer-app': () => dartJsonKeys('apps/customer-app/lib/features/orders/models.dart'),
    },
  },
];

let drift = 0;
for (const c of CONTRACTS) {
  const backend = c.backend();
  if (!backend) { console.log(`⚠️  ${c.name}: مالقيتش تعريف الباك-إند`); continue; }
  console.log(`\n═══ ${c.name} — ${backend.size} حقل في الباك-إند`);
  for (const [client, get] of Object.entries(c.clients)) {
    const fields = get();
    if (!fields) { console.log(`  ⚠️  ${client}: مالقيتش التعريف`); continue; }
    const missing = [...backend].filter((f) => !fields.has(f) && !intentional(client).has(f));
    if (missing.length === 0) { console.log(`  ✅ ${client}: بيقرا كل حاجة ذات صلة`); continue; }
    drift += missing.length;
    console.log(`  ❌ ${client}: ${missing.length} حقل الباك-إند بيرجّعه والواجهة مابتقراهوش`);
    missing.forEach((f) => console.log(`       • ${f}`));
  }
}
console.log(`\n${drift === 0 ? '✅ صفر انحراف' : `⚠️  ${drift} حقل محتاج مراجعة — كل واحد يا يتقرا يا يتضاف لـINTENTIONAL بسبب مكتوب`}`);
