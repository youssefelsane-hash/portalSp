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
  key: 'level_premium' | 'additional_items' | 'instapay_discount' | 'assessment_fee_credit';
  label_ar: string;
  amount_cents: number;
  source_ar: string;
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

const TIER_LABELS_AR: Record<string, string> = {
  beginner: 'مبتدئ',
  standard: 'قياسي',
  expert: 'خبير',
};

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
  push({
    key: 'discount',
    label_ar: 'الخصم',
    applied: (order.discountAmountCents ?? 0) !== 0,
    amount_cents: -(order.discountAmountCents ?? 0),
    detail_ar: 'كود خصم أو كود عمارة — بيتخصم من الإجمالي قبل الدفع.',
  });

  const totalAtBooking = running;
  const currentTotal = order.totalAmountCents ?? 0;

  const postBooking: PostBookingPriceChange[] = [];
  if ((order.levelPremiumCents ?? 0) !== 0) {
    postBooking.push({
      key: 'level_premium',
      label_ar: 'علاوة مستوى المنفّذ',
      amount_cents: order.levelPremiumCents!,
      source_ar:
        'اتضافت **بعد** التعيين التلقائي: الفني مكانش معروف وقت التسعير الأول، فالمضاعف مادخلش في السعر الأصلي. الفني المختار يدويًا مضاعفه داخل السعر من الأول، فمفيش علاوة تانية (مفيش تحصيل مزدوج).',
    });
  }
  if ((order.instapayDiscountCents ?? 0) !== 0) {
    postBooking.push({
      key: 'instapay_discount',
      label_ar: 'خصم InstaPay',
      amount_cents: -(order.instapayDiscountCents ?? 0),
      source_ar: 'اتطبّق وقت تأكيد التحويل، بعد إنشاء الطلب (ADR-0089).',
    });
  }
  if (extras.additionalItemsTotalCents !== 0) {
    postBooking.push({
      key: 'additional_items',
      label_ar: 'بنود شغل إضافي',
      amount_cents: extras.additionalItemsTotalCents,
      source_ar:
        'بنود الفني المعتمدة بعد بداية الشغل (قطع غيار/أجر إضافي) — العميل وافق عليها، فهي زيادة حقيقية على سعر الحجز.',
    });
  }
  if ((order.assessmentFeeCreditCents ?? 0) !== 0) {
    postBooking.push({
      key: 'assessment_fee_credit',
      label_ar: 'خصم رسم التقييم',
      amount_cents: -(order.assessmentFeeCreditCents ?? 0),
      source_ar: 'رسم التقييم اتحسب من إجمالي الطلب بعد اعتماد السعر.',
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
