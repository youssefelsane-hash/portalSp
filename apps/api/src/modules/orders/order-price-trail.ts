import { Order } from './entities/order.entity';

/**
 * **مسار تكوين سعر العميل — من البيانات التاريخية بس** (ADR-0107، بلاغ مالك 2026-09-17).
 *
 * «أريد داخل تفاصيل كل Order قسمًا حقيقيًا لـCustomer Price Formation يعتمد على نفس الحساب
 * الموجود بالفعل، وليس إعادة حساب موازية… تغيير zone percentage أو pricing tier settings بعد
 * أسبوع لا يجب أن يغيّر تفسير طلب قديم».
 *
 * ### القاعدة الحاكمة للملف ده
 *
 * **مفيش أي استعلام إعدادات ولا قراءة حيّة هنا.** كل رقم بييجي من أعمدة الطلب نفسه (لقطة
 * وقت الإنشاء، migration 0352) أو من أعمدة الرسوم اللي كانت متسجّلة أصلاً. يعني الشرح بيفضل
 * ثابت مهما الأدمن غيّر الإعدادات بعد كده — وده مش تفصيلة، ده الشرط الأساسي.
 *
 * ولأنه بيقرا لقطة مش بيحسب، **مفيش تكرار لخوارزمية التسعير**: الملف ده مابيعرفش يضرب في
 * مضاعف ولا يقصّ على حد، هو بس بيرتّب الأرقام المحفوظة ويجمعها للتأكد.
 *
 * ### تلات أقسام منفصلة عن قصد
 *
 * 1. `formation` — إزاي سعر **العميل** اتكوّن وقت الحجز.
 * 2. `post_booking` — التغييرات اللي حصلت **بعد** الحجز (علاوة المستوى من التوزيع التلقائي،
 *    عروض السعر، شغل إضافي، تعديل إداري).
 * 3. توزيع المستحقات **مش هنا خالص** — معاملات أجر الفني/المساعد مش عوامل رفعت سعر العميل،
 *    وخلطها كان هيخلي الأدمن يفتكر إن العميل دفع زيادة بسببها.
 */

/** مرحلة واحدة في تكوين السعر. `applied = false` معناها المرحلة مالهاش أثر على الطلب ده. */
export interface PriceTrailStage {
  key:
    | 'engine_raw'
    | 'zone_adjustment'
    | 'pricing_tier_multiplier'
    | 'price_clamp'
    | 'inspection_fee'
    | 'emergency_surcharge'
    | 'addons'
    | 'warranty'
    | 'discount';
  label_ar: string;
  applied: boolean;
  /** المبلغ اللي المرحلة دي ضافته (أو الأساس نفسه في `engine_raw`). */
  amount_cents: number;
  /** الإجمالي التراكمي بعد المرحلة دي — بيخلي كل سطر قابل للمراجعة لوحده. */
  running_total_cents: number;
  /** تفصيل المرحلة (النسبة/المضاعف/الحد) بلغة الأدمن، `null` لو المرحلة مجرد مبلغ. */
  detail_ar: string | null;
}

export interface PostBookingPriceChange {
  key: 'approved_quote' | 'level_premium' | 'additional_items' | 'instapay_discount' | 'assessment_fee_credit';
  label_ar: string;
  /** أثر التغيير ده على سعر العميل (سالب = نزّله). */
  amount_cents: number;
  source_ar: string;
  /** وقت التغيير لو متسجّل على الصف المصدر، `null` لو مش متسجّل. */
  at: string | null;
  /**
   * سعر الشغل المرجعي قبل/بعد — **للعروض بس**، لأن العرض المعتمد **بيستبدل** سعر الشغل مش
   * بيضيف عليه. باقي التغييرات إضافة/خصم على الإجمالي فمالهاش «قبل/بعد» بمعنى مختلف عن المبلغ.
   */
  before_cents: number | null;
  after_cents: number | null;
}

/** عرض سعر معتمد — بالترتيب الزمني لقرار العميل. */
export interface ApprovedQuoteRef {
  amountCents: number;
  /** مصدر العرض زي ما هو متسجّل (`technician_onsite`/`admin_remote`/`technician_diagnosis`). */
  source: string;
  decidedAt: Date | string | null;
}

export interface OrderPriceTrail {
  order_id: string;
  /** `false` لطلبات قبل migration 0352 — اللقطة مش موجودة، والشرح الجزئي بيتعلّم عليه. */
  formation_snapshot_available: boolean;
  stages: PriceTrailStage[];
  /** إجمالي وقت إنشاء الطلب = مجموع المراحل المطبّقة. */
  total_at_booking_cents: number;
  /** الإجمالي المسجّل حاليًا على الطلب. */
  current_total_cents: number;
  post_booking: PostBookingPriceChange[];
  /**
   * هل المراحل بتجمع للإجمالي المسجّل؟ لو `false` يبقى فيه فرق محتاج تفسير — بيتعرض للأدمن
   * صراحةً بدل ما يبقى جدول بيبان متماسك وهو ناقص.
   */
  reconciles: boolean;
  unexplained_cents: number;
  notes_ar: string[];
}

const egp = (cents: number) => `${(cents / 100).toLocaleString('ar-EG-u-nu-latn', { minimumFractionDigits: 2 })} ج.م`;

// `Record<string, ...>` عن قصد (القيمة جاية من لقطة محفوظة على الطلب، ممكن تكون فئة قديمة
// اتشالت من الـenum) — فأي فئة جديدة لازم تتضاف هنا بالإيد، الـtypechecker مش هيمسكها.
const TIER_LABELS_AR: Record<string, string> = {
  beginner: 'مبتدئ',
  standard: 'قياسي',
  advanced: 'متقدم',
  expert: 'خبير',
};

const QUOTE_SOURCE_AR: Record<string, string> = {
  technician_onsite: 'معاينة على الأرض',
  admin_remote: 'تقييم إداري بالصور',
  technician_diagnosis: 'تشخيص الفني وقت التنفيذ',
};

const isoOrNull = (value: Date | string | null): string | null =>
  value === null ? null : value instanceof Date ? value.toISOString() : value;

const MULTIPLIER_SOURCE_AR: Record<string, string> = {
  pricing_tier: 'فئة مهارة التسعير',
  company: 'معامل سعر الشركة',
  none: 'بلا مضاعف',
};

/** مبالغ مش على صف الطلب نفسه — بتتمرّر صريحة عشان الدالة تفضل نقية وتتختبر بلا قاعدة. */
export interface OrderPriceTrailExtras {
  /**
   * مجموع بنود `order_items` بنوع `addon`.
   *
   * **مش** من `orders.addons_amount_cents`: العمود ده موجود في السكيما لكن **مفيش أي كود
   * بيكتب فيه** (اتأكدنا بالبحث) — الإضافات بتتسجّل كبنود في `order_items` من وقت الحجز.
   * قراءته كانت هتطلّع صفر دايمًا وتخلي الجدول «متماسك» وهو ناقص فعلاً.
   */
  addonsTotalCents: number;
  /** مجموع بنود الشغل الإضافي المعتمدة بعد الحجز (`spare_part`/`extra_labor` وخلافه). */
  additionalItemsTotalCents: number;
  /**
   * العروض المعتمدة على الطلب مرتّبة بوقت قرار العميل.
   *
   * لازم تيجي من برّه: العرض بيغيّر سعر الشغل بعد الحجز (`inspection_quote` /
   * `diagnosis_revision` في `OrderFinancialFinalizationService`)، وبدونه كان أثره بيظهر
   * للأدمن كـ«فرق غير مفسَّر» رغم إنه أكبر بند في مسار «التقييم ثم عرض السعر».
   */
  approvedQuotes: ApprovedQuoteRef[];
}

/**
 * مصدر خصم الحجز بالاسم — الأدمن لازم يعرف الرقم جاي منين، مش «خصم» ومفيش تفسير.
 *
 * بنقرا `promo_code_id`/`building_id` من صف الطلب نفسه (لقطة تاريخية)، مش من جداول الأكواد —
 * فحتى لو الكود اتشال أو العمارة اتغيّرت نسبتها بعدين، السطر ده يفضل صادق.
 */
function bookingDiscountSource(order: Order): string {
  const sources: string[] = [];
  if (order.promoCodeId) sources.push('كود خصم');
  if (order.buildingId) sources.push('خصم عمارة');
  if (sources.length === 0) {
    return 'خصم مسجّل على الطلب بلا كود خصم ولا عمارة مربوطين — يحتاج مراجعة في سجل النشاط.';
  }
  return `${sources.join(' + ')} — بيتخصم من الإجمالي وقت الحجز. حافز InstaPay مش هنا (مكانه تحت في تغييرات بعد الحجز).`;
}

function bookingDiscountNone(order: Order, instapayCents: number): string {
  if (instapayCents > 0) {
    return 'مفيش خصم وقت الحجز. الخصم اللي على الطلب ده كله حافز InstaPay بعد الحجز (تحت).';
  }
  return order.promoCodeId || order.buildingId
    ? 'فيه كود/عمارة مربوطين بالطلب بس قيمة الخصم طلعت صفر.'
    : 'مفيش كود خصم ولا خصم عمارة على الطلب ده.';
}

/**
 * بيبني المسار من صف الطلب + مبالغ البنود.
 *
 * **دالة نقية**: مفيش استعلام ولا قراءة إعدادات جوّاها، فالشرح بيفضل ثابت لأي طلب تاريخي.
 */
export function buildOrderPriceTrail(order: Order, extras: OrderPriceTrailExtras): OrderPriceTrail {
  const stages: PriceTrailStage[] = [];
  const notes: string[] = [];
  const hasSnapshot = order.pricingEngineRawCents !== null && order.pricingWorkPriceCents !== null;

  let running = 0;
  const push = (stage: Omit<PriceTrailStage, 'running_total_cents'>) => {
    if (stage.applied) running += stage.amount_cents;
    stages.push({ ...stage, running_total_cents: running });
  };

  if (hasSnapshot) {
    push({
      key: 'engine_raw',
      label_ar: 'ناتج محرك التسعير',
      applied: true,
      amount_cents: order.pricingEngineRawCents!,
      detail_ar: 'السعر قبل أي تعديل تجاري — مخرج المعادلة/البيانات القياسية للخدمة.',
    });

    const zoneAdj = order.pricingZoneAdjustmentCents ?? 0;
    const zonePct = order.pricingZoneModifierPercentage === null ? null : Number(order.pricingZoneModifierPercentage);
    push({
      key: 'zone_adjustment',
      label_ar: 'تعديل المنطقة',
      applied: zonePct !== null && zoneAdj !== 0,
      amount_cents: zoneAdj,
      detail_ar:
        zonePct === null
          ? 'مفيش تسعير منطقة سارٍ على الخدمة دي وقت الحجز.'
          : `${zonePct > 0 ? '+' : ''}${zonePct}% على ناتج المحرك ⇒ ${egp(zoneAdj)}`,
    });

    const tierAdj = order.pricingTierAdjustmentCents ?? 0;
    const multiplier = order.pricingMultiplierSnapshot === null ? 1 : Number(order.pricingMultiplierSnapshot);
    const source = order.pricingMultiplierSource ?? 'none';
    const tierName = order.pricingTierSnapshot ? (TIER_LABELS_AR[order.pricingTierSnapshot] ?? order.pricingTierSnapshot) : null;
    push({
      key: 'pricing_tier_multiplier',
      label_ar: 'مضاعف المنفّذ',
      applied: tierAdj !== 0,
      amount_cents: tierAdj,
      detail_ar:
        source === 'none'
          ? 'المنفّذ مكانش معروف وقت التسعير، فمفيش مضاعف اتطبّق (شوف التغييرات بعد الحجز تحت).'
          : `${MULTIPLIER_SOURCE_AR[source] ?? source}${tierName ? ` (${tierName})` : ''} ×${multiplier} ⇒ ${egp(tierAdj)}`,
    });

    const clampDelta = order.pricingClampDeltaCents ?? 0;
    push({
      key: 'price_clamp',
      label_ar: 'قصّ الحد الأدنى/الأقصى',
      applied: clampDelta !== 0,
      amount_cents: clampDelta,
      detail_ar:
        clampDelta === 0
          ? 'السعر كان جوّه حدود الخدمة، فمفيش قصّ.'
          : order.pricingClampApplied === 'min'
            ? `السعر كان أقل من الحد الأدنى للخدمة، فاترفع ${egp(clampDelta)}`
            : `السعر كان أعلى من الحد الأقصى للخدمة، فاتنزّل ${egp(Math.abs(clampDelta))}`,
    });
  } else {
    notes.push(
      'الطلب ده اتعمل قبل تسجيل لقطة مراحل التسعير (migration 0352)، فمراحل «المحرك/المنطقة/المضاعف/القصّ» مش متاحة له. الرسوم تحت متسجّلة عادي.',
    );
    push({
      key: 'engine_raw',
      label_ar: 'سعر الشغل وقت الحجز',
      applied: true,
      amount_cents: order.estimatedPriceCents ?? 0,
      detail_ar: 'من `orders.estimated_price_cents` — الإجمالي بعد المراحل التجارية بلا تفصيل.',
    });
  }

  push({
    key: 'inspection_fee',
    label_ar: 'رسم الكشف',
    applied: (order.inspectionFeeCents ?? 0) !== 0,
    amount_cents: order.inspectionFeeCents ?? 0,
    detail_ar: 'رسم الكشف السارِي على الخدمة في منطقة العنوان وقت الحجز.',
  });
  push({
    key: 'emergency_surcharge',
    label_ar: 'رسوم الاستعجال',
    applied: (order.surgeAmountCents ?? 0) !== 0,
    amount_cents: order.surgeAmountCents ?? 0,
    detail_ar: 'بتتحسب على (سعر الشغل + رسم الكشف) لطلبات نفس اليوم بس.',
  });
  push({
    key: 'addons',
    label_ar: 'الإضافات',
    applied: extras.addonsTotalCents !== 0,
    amount_cents: extras.addonsTotalCents,
    detail_ar: 'إضافات الكتالوج اللي العميل اختارها وقت الحجز (بنود `order_items` بنوع addon).',
  });
  push({
    key: 'warranty',
    label_ar: 'الضمان الإضافي',
    applied: (order.warrantyPriceCents ?? 0) !== 0,
    amount_cents: order.warrantyPriceCents ?? 0,
    detail_ar: 'خطة ضمان اختيارية — السعر لقطة من الخطة وقت الحجز.',
  });
  /*
    خصم **وقت الحجز** بس = `discount_amount_cents` ناقص حافز InstaPay.

    `instapay_discount_cents` **جزء من** `discount_amount_cents` مش زيادة عليه (شوف تعليق العمود
    في `Order`): `applyInstaPayDiscount()` بتعمل `discountAmountCents += discountCents`. فطرح
    العمود كله هنا كان بيحصّل الحافز مرتين — مرة كخصم حجز ومرة في «تغييرات بعد الحجز» — والفرق
    كان يظهر للأدمن كـ«غير مفسّر» (بلاغ المالك 2026-09-17). والحافز أصلاً مش خصم حجز: هو بيحصل
    وقت تأكيد التحويل بعد إنشاء الطلب، فمكانه الصح تحت.

    الطرح مقصوص عند صفر: الحالة الوحيدة اللي كانت بتخليه سالب (تحديث السعر من تذكرة معاينة بديلة
    وهو بيدوس على الخصم) اتقفلت في `consumeReplacementPreview()`، وبنسجّل ملاحظة لو حصلت برضه
    بدل ما نطلّع رقم مقلوب.
  */
  const instapayCents = order.instapayDiscountCents ?? 0;
  const totalDiscountCents = order.discountAmountCents ?? 0;
  const bookingDiscountCents = Math.max(0, totalDiscountCents - instapayCents);
  if (totalDiscountCents - instapayCents < 0) {
    notes.push(
      'حالة غير متوقعة: حافز InstaPay المسجّل أكبر من إجمالي الخصم على الطلب. الخصم وقت الحجز اتعرض صفر بدل رقم سالب — يحتاج مراجعة يدوية.',
    );
  }
  push({
    key: 'discount',
    label_ar: 'الخصم وقت الحجز',
    applied: bookingDiscountCents !== 0,
    // `-0` مش قيمة مقبولة في عقد بيتقري ويتقارن — الصفر صفر.
    amount_cents: bookingDiscountCents === 0 ? 0 : -bookingDiscountCents,
    detail_ar: bookingDiscountCents === 0 ? bookingDiscountNone(order, instapayCents) : bookingDiscountSource(order),
  });

  const totalAtBooking = running;
  const currentTotal = order.totalAmountCents ?? 0;

  const postBooking: PostBookingPriceChange[] = [];

  /*
    العروض المعتمدة — **استبدال لسعر الشغل مش إضافة عليه**، وده مش اختيار عرض هنا، ده اللي
    `inspection-quote.service.ts` بتعمله بالظبط:

      عرض أول:       delta = quote.amount_cents - assessment_fee_credit
      مراجعة تشخيص:  delta = quote.amount_cents - estimated_price_cents (سعر الشغل قبلها)

    يعني أثر العرض على سعر العميل = قيمة العرض ناقص المرجع اللي قبله، والرصيد (خصم رسم التقييم)
    بند منفصل تحت بقيمته. المرجع الأول هو سعر الشغل وقت الحجز، وكل عرض بعد كده مرجعه العرض
    اللي قبله — فسلسلة المراجعات بتتفسّر كلها بلا تحصيل مزدوج.
  */
  let quoteReferenceCents = order.pricingWorkPriceCents ?? order.estimatedPriceCents ?? 0;
  for (const quote of extras.approvedQuotes) {
    const deltaCents = quote.amountCents - quoteReferenceCents;
    postBooking.push({
      key: 'approved_quote',
      label_ar: quote.source === 'technician_diagnosis' ? 'مراجعة سعر بعد التشخيص' : 'عرض سعر معتمد',
      amount_cents: deltaCents,
      source_ar: `${QUOTE_SOURCE_AR[quote.source] ?? quote.source} — العميل وافق على ${egp(quote.amountCents)} بدل ${egp(quoteReferenceCents)}. العرض بيستبدل سعر الشغل، فالأثر على الإجمالي هو الفرق بس.`,
      at: isoOrNull(quote.decidedAt),
      before_cents: quoteReferenceCents,
      after_cents: quote.amountCents,
    });
    quoteReferenceCents = quote.amountCents;
  }

  if ((order.levelPremiumCents ?? 0) !== 0) {
    postBooking.push({
      key: 'level_premium',
      label_ar: 'علاوة مستوى المنفّذ',
      amount_cents: order.levelPremiumCents!,
      source_ar:
        'اتضافت **بعد** التعيين التلقائي: الفني مكانش معروف وقت التسعير الأول، فالمضاعف مادخلش في السعر الأصلي. الفني المختار يدويًا مضاعفه داخل السعر من الأول، فمفيش علاوة تانية (مفيش تحصيل مزدوج).',
      at: null,
      before_cents: null,
      after_cents: null,
    });
  }
  if (extras.additionalItemsTotalCents !== 0) {
    postBooking.push({
      key: 'additional_items',
      label_ar: 'بنود شغل إضافي',
      amount_cents: extras.additionalItemsTotalCents,
      source_ar:
        'بنود الفني المعتمدة بعد بداية الشغل (قطع غيار/أجر إضافي) — العميل وافق عليها، فهي زيادة حقيقية على سعر الحجز.',
      at: null,
      before_cents: null,
      after_cents: null,
    });
  }
  if ((order.assessmentFeeCreditCents ?? 0) !== 0) {
    postBooking.push({
      key: 'assessment_fee_credit',
      label_ar: 'خصم رسم التقييم',
      amount_cents: -(order.assessmentFeeCreditCents ?? 0),
      source_ar: 'رسم التقييم اللي العميل دفعه اتحسب من سعر العرض بدل ما يتحصّل مرتين.',
      at: null,
      before_cents: null,
      after_cents: null,
    });
  }
  if (instapayCents !== 0) {
    postBooking.push({
      key: 'instapay_discount',
      label_ar: 'حافز الدفع بـInstaPay',
      amount_cents: -instapayCents,
      source_ar:
        'هدية اختيار العميل للدفع بـInstaPay — اتطبّقت وقت بدء التحويل، بعد إنشاء الطلب (ADR-0089/ADR-0091). القيمة من إعداد `payments.instapay_discount_egp` وقتها. مسجّلة جوّه `discount_amount_cents` كجزء منه، فمش متحسبة تاني في خصم الحجز فوق.',
      at: null,
      before_cents: null,
      after_cents: null,
    });
  }

  const explained = totalAtBooking + postBooking.reduce((sum, c) => sum + c.amount_cents, 0);
  const unexplained = currentTotal - explained;
  if (unexplained !== 0 && hasSnapshot) {
    notes.push(
      `فيه ${egp(Math.abs(unexplained))} فرق بين مجموع المراحل والإجمالي المسجّل — غالبًا عرض سعر أو شغل إضافي أو تعديل إداري بعد الحجز. راجع بنود العرض والتسلسل الزمني تحت.`,
    );
  }

  return {
    order_id: order.id,
    formation_snapshot_available: hasSnapshot,
    stages,
    total_at_booking_cents: totalAtBooking,
    current_total_cents: currentTotal,
    post_booking: postBooking,
    reconciles: unexplained === 0,
    unexplained_cents: unexplained,
    notes_ar: notes,
  };
}
