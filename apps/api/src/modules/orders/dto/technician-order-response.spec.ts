import { OrderResponseDto, toTechnicianOrderResponseDto } from './order-response.dto';

// docs/08 §60.2 (طلب مالك صريح): «أي حاجة بتتدفع أونلاين بتبان للفني بس إن هي مدفوعة، لكن ما
// بيتبانش الدفع قد إيه … إلا الفلوس الكاش اللي المفروض يستلمها».
//
// الاختبار ده بيقفل على **العقد على السلك**: الحقول الممنوعة لازم تكون `undefined` في الكائن
// الراجع، مش مجرد مخفية في الواجهة. لو حد ضاف حقل مالي جديد للعقد المشترك من غير ما يستثنيه
// هنا، الاختبار ده هو اللي هيمسكه.
const fullOrder: OrderResponseDto = {
  id: 'o1',
  order_number: 'ORD-1',
  service_id: 's1',
  address_id: 'a1',
  technician_id: 't1',
  order_type: 'standard',
  booking_mode: 'individual',
  requested_technician_id: null,
  requested_technician_company_id: null,
  order_status: 'in_progress',
  customer_id: 'c1',
  problem_description: 'حنفية بتنقّط',
  customer_notes: null,
  customer_inputs: null,
  scheduled_at: null,
  scheduled_end_at: null,
  estimated_price_cents: 100_000,
  inspection_fee_cents: 5_000,
  surge_amount_cents: 3_000,
  level_premium_cents: 8_000,
  discount_amount_cents: 2_000,
  promo_code_id: null,
  total_amount_cents: 126_000,
  paid_amount_cents: 60_000,
  direct_paid_amount_cents: 60_000,
  financed_order_amount_cents: 0,
  refunded_amount_cents: 0,
  installment_outstanding_cents: 0,
  amount_due_to_technician_cents: 66_000,
  warranty_plan_id: 'w1',
  warranty_price_cents: 20_000,
  optional_warranty: { name_ar: 'ضمان سنة', coverage_months: 12 },
  deposit_amount_cents: 60_000,
  payment_status: 'partially_paid',
  placed_at: null,
  cancelled_at: null,
  cancellation_reason_id: null,
  cancellation_fee_cents: 0,
  created_at: new Date().toISOString(),
  warranty_expires_at: null,
  original_order_id: null,
  revisit_pinned_technician_id: null,
  revisit_pinned_at: null,
  revisit_released_at: null,
  revisit_release_reason: null,
  building_id: null,
  recurring_template_id: null,
  recurring_occurrence_at: null,
  standard_data_id: null,
  required_technicians: 1,
  required_assistants: 0,
  estimated_duration_days: null,
  pricing_quantity: null,
  customer_cash_confirmed_at: null,
  technician_cash_not_received_at: null,
  duration_minutes: null,
  initial_quote_source: null,
  initial_quote_note: null,
  pricing_period_start: null,
  pricing_period_end: null,
};

const FORBIDDEN_FIELDS = [
  'estimated_price_cents',
  'inspection_fee_cents',
  'surge_amount_cents',
  'level_premium_cents',
  'discount_amount_cents',
  'warranty_price_cents',
  'optional_warranty',
  'deposit_amount_cents',
  'paid_amount_cents',
  'direct_paid_amount_cents',
  'financed_order_amount_cents',
  'refunded_amount_cents',
  'installment_outstanding_cents',
  'amount_due_to_technician_cents',
  // docs/08 §108-B — total_amount_cents بقى ممنوع دايمًا (كان استثناء مشروط وقت الكاش الكامل).
  'total_amount_cents',
] as const;

describe('عقد الفني المالي (docs/08 §60.2)', () => {
  it('جزء أونلاين + جزء كاش: الأونلاين واقعة بلا رقم، والكاش بالرقم كامل', () => {
    const dto = toTechnicianOrderResponseDto(fullOrder, {
      cashToCollectCents: 66_000,
      cashCollectedCents: 0,
      myEarningCents: 90_000,
      hasOnlinePayment: true,
      fullyPaidOnline: false,
    });

    expect(dto.cash_to_collect_cents).toBe(66_000);
    expect(dto.cash_collected_cents).toBe(0);
    expect(dto.my_earning_cents).toBe(90_000);
    expect(dto.has_online_payment).toBe(true);
    expect(dto.fully_paid_online).toBe(false);
    // الإجمالي مخفي دايمًا (docs/08 §108-B) — total_amount_cents مش موجود كنوع أصلًا على
    // TechnicianOrderResponseDto، فمفيش داعي نتأكد منه هنا كمان (مغطّى بالتست الشامل تحت).
  });

  // docs/08 §108-B — رجريشن على قصد: كان فيه استثناء بيظهّر total_amount_cents وقت الكاش
  // الكامل ("هو نفسه اللي هيحصّله"). المالك ألغاه صراحةً: محدّش يشوف الإجمالي المُسمّى كده أبدًا،
  // حتى لو الرقم نفسه بيتساوى مع cash_to_collect_cents عمليًا للقائد/الوحيد.
  it('كله كاش: الإجمالي مخفي دايمًا، cash_to_collect_cents بيغطي نفس الاحتياج للقائد', () => {
    const dto = toTechnicianOrderResponseDto(fullOrder, {
      cashToCollectCents: 126_000,
      cashCollectedCents: 0,
      myEarningCents: 90_000,
      hasOnlinePayment: false,
      fullyPaidOnline: false,
    });
    expect(dto.cash_to_collect_cents).toBe(126_000);
  });

  // docs/08 §108-B — عضو طاقم مش قائد بياخد صفر في cash_to_collect_cents حتى لو الطلب كاش
  // بالكامل؛ مش شغله يحصّل حاجة، فمش المفروض يشوف رقم بيسرّب صورة عن إجمالي الطلب.
  it('عضو طاقم (مش قائد): cash_to_collect_cents صفر حتى لو الطلب كاش بالكامل', () => {
    const dto = toTechnicianOrderResponseDto(fullOrder, {
      cashToCollectCents: 0, // PaymentsService.getTechnicianMoneyView() هو اللي بيصفّرها للعضو
      cashCollectedCents: 0,
      myEarningCents: 30_000,
      hasOnlinePayment: false,
      fullyPaidOnline: false,
      isCrewShare: true,
    });
    expect(dto.cash_to_collect_cents).toBe(0);
    expect(dto.my_earning_cents).toBe(30_000);
  });

  it('كله أونلاين: نصيبه هو بس، مفيش كاش ولا إجمالي', () => {
    const dto = toTechnicianOrderResponseDto(fullOrder, {
      cashToCollectCents: 0,
      cashCollectedCents: 0,
      myEarningCents: 90_000,
      hasOnlinePayment: true,
      fullyPaidOnline: true,
    });
    expect(dto.fully_paid_online).toBe(true);
    expect(dto.cash_to_collect_cents).toBe(0);
    expect(dto.my_earning_cents).toBe(90_000);
  });

  it('كل حقول تكوين السعر ونصيب الشركة مش بتخرج على السلك خالص، في كل الحالات', () => {
    for (const hasOnlinePayment of [true, false]) {
      const dto = toTechnicianOrderResponseDto(fullOrder, {
        cashToCollectCents: 1,
        cashCollectedCents: 0,
        myEarningCents: 1,
        hasOnlinePayment,
        fullyPaidOnline: false,
      }) as unknown as Record<string, unknown>;

      for (const field of FORBIDDEN_FIELDS) {
        expect(dto[field]).toBeUndefined();
      }
      // ومش موجودة كمفتاح أصلاً (مش بس قيمتها undefined) — عشان JSON.stringify ما يطلّعهاش.
      expect(Object.keys(dto).filter((k) => (FORBIDDEN_FIELDS as readonly string[]).includes(k))).toEqual([]);
    }
  });

  it('البيانات غير المالية بتفضل زي ما هي (اسم العميل/الخدمة/الحالة مش متأثرين)', () => {
    const dto = toTechnicianOrderResponseDto(
      { ...fullOrder, customer_name: 'أحمد', service_name_ar: 'سباكة' },
      { cashToCollectCents: 0, myEarningCents: 0, hasOnlinePayment: true, fullyPaidOnline: true },
    );
    expect(dto.customer_name).toBe('أحمد');
    expect(dto.service_name_ar).toBe('سباكة');
    expect(dto.order_status).toBe('in_progress');
    expect(dto.problem_description).toBe('حنفية بتنقّط');
  });
});
