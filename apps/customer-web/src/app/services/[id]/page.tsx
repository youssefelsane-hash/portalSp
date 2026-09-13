'use client';

import { use, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { fetchService, fetchPricingFields, estimatePrice } from '@/lib/catalog';
import { ServiceDto, PricingFieldDto, PriceEstimateDto } from '@/lib/api-types';
import { fetchCities, fetchAreas, CityDto, AreaDto } from '@/lib/geo-addresses';
import { listAddresses, createAddress, AddressDto } from '@/lib/addresses';
import { fetchPaymentChannels, payWithCard, PaymentChannelDto as PaymentChannel } from '@/lib/payments';
import {
  createOrder,
  createMatchPreview,
  previewOrder,
  formatEgp,
  uploadPricingFieldImage,
  uploadProblemImage,
  type BookingMatchPreviewDto,
  type PreviewOrderResponseDto,
} from '@/lib/orders';
import { fetchApplicablePolicies } from '@/lib/installments';
import { LiveAmount } from '@/components/live-amount';
import type { ApplicablePaymentPolicyDto } from '@baytak/shared-types';
import {
  fetchTechniciansForService,
  fetchSuggestedDays,
  fetchSuggestedTimes,
  SuggestedDayDto,
  SuggestedTimeDto,
  TechnicianBookingListItemDto,
  TECHNICIAN_LEVEL_LABELS_AR,
} from '@/lib/technicians';
import { ApiError } from '@/lib/api-client';
import { assessmentRoutesForService } from '@/lib/assessment-routes';
import { formatWorkDuration } from '@/lib/work-scope';
import { trackFunnelStage } from '@/lib/funnel';
import { MapPicker } from '@/components/map-picker';
import { clearPendingPromoLinkCode, readPendingPromoLink } from '@/lib/promo-link';/**
 * أسماء وسائل الدفع المقدّم المعروضة للعميل. **الترتيب مش هنا** — السيرفر بيرجّع القايمة
 * مرتّبة (`payment-channels.controller.ts`)، فالواجهة بتعرضها زي ما جت. لو الترتيب اتكرر هنا،
 * أول تغيير في `payments.recommended_method` هيخلّي الويب والتطبيق يقولوا حاجتين مختلفتين.
 */
const PREPAYMENT_LABELS_AR: Record<string, string> = {
  instapay: 'InstaPay',
  card: 'بطاقة الآن',
};



type BookingMode = 'individual' | 'team' | 'emergency';
/**
 * هل الطلب ده **لازم** يتبعت كطلب تقييم بالصور؟
 *
 * نفس الحارس بالحرف في `apps/customer-app` و`apps/api`: لو مسار الصور هو الوحيد المتاح
 * لسياسة الخدمة (ومش طوارئ)، الطلب لازم يتبعت كده وإلا الباك-إند بيرفضه.
 *
 * موجودة على مستوى الموديول عشان `useEffect` — اللي لازم يتنادى قبل أي `return` مبكّر —
 * والرندر اللي بعده يستخدموا **نفس** القاعدة، بدل نسختين ممكن يفرقوا.
 */
function resolveEffectiveRemoteQuote(
  service: ServiceDto | null,
  bookingMode: BookingMode,
  requested: boolean,
): boolean {
  if (!service) return requested;
  const routes = assessmentRoutesForService(service);
  const remoteForced = routes.remote && bookingMode !== 'emergency' && !routes.onsite;
  return remoteForced ? true : requested;
}

function availableBookingModes(service: ServiceDto): BookingMode[] {
  return [
    ...(service.allows_individual ? (['individual'] as const) : []),
    ...(service.allows_team ? (['team'] as const) : []),
    ...(service.allows_emergency ? (['emergency'] as const) : []),
  ];
}

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

export default function ServiceBookingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading, authedFetch } = useAuth();

  const [service, setService] = useState<ServiceDto | null>(null);
  const [pricingFields, setPricingFields] = useState<PricingFieldDto[] | null>(null);
  const [fieldValues, setFieldValues] = useState<Record<string, string | number | boolean>>({});
  const [estimate, setEstimate] = useState<PriceEstimateDto | null>(null);
  const [estimating, setEstimating] = useState(false);

  const [addresses, setAddresses] = useState<AddressDto[] | null>(null);
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
  const [showNewAddressForm, setShowNewAddressForm] = useState(false);
  const [availabilityAddressId, setAvailabilityAddressId] = useState<string | null>(null);
  const [serviceAvailabilityError, setServiceAvailabilityError] = useState<string | null>(null);

  // اقتراح المواعيد (ADR-0088) — **مساعدة مش قيد**: العميل لسه يقدر يكتب أي يوم/ساعة بإيده.
  // الفشل هنا بيتبلع عمدًا: الاقتراح ميزة فوق الفلو، ومينفعش غيابه يمنع الحجز أصلاً.
  const [suggestedDays, setSuggestedDays] = useState<SuggestedDayDto[] | null>(null);
  const [suggestedTimes, setSuggestedTimes] = useState<SuggestedTimeDto[] | null>(null);

  // اختيار الفني قبل الحجز (Script 3 §32-35) — "خلي أسطى يختار" افتراضي/أساسي، "اختار بنفسك"
  // ثانوي، وبيظهر بس لو الخدمة فعلاً بتسمح بأكتر من فني (نفس منطق showBookingModeSelector في
  // apps/customer-app's catalog_navigation.dart — مفيش داعي نعرض اختيار لخدمة مفيهاش بدائل).
  const [technicianChoiceMode, setTechnicianChoiceMode] = useState<'auto' | 'manual'>('auto');
  const [technicians, setTechnicians] = useState<TechnicianBookingListItemDto[] | null>(null);
  const [selectedTechnicianId, setSelectedTechnicianId] = useState<string | null>(null);
  /**
   * ADR-0080 — المنفّذ المختار شركة ولا فني. بيتقري من القايمة نفسها بدل ما يتخزّن كحالة تانية
   * ممكن تنحرف عن `selectedTechnicianId`.
   */
  const selectedProviderIsCompany = Boolean(
    selectedTechnicianId && technicians?.find((t) => t.id === selectedTechnicianId)?.is_company,
  );

  // إعادة ترتيب اختيار الميعاد (docs/08 §83 جزء ب، طلب مالك) — يوم (محدد/مرن) قبل تفاصيل السعر
  // مباشرة، مطابق apps/customer-app's ScheduleSelectionScreen بالحرف. خيار "أقرب وقت ممكن" اتشال
  // نهائيًا هنا زي ما اتشال من الموبايل قبل كده (ADR-0018 §2، بَقّة تعارض وهمي حقيقية) — التاريخ
  // بقى إجباري دايمًا لأي خدمة بتسمح بالجدولة.
  const [scheduleDayMode, setScheduleDayMode] = useState<'specific' | 'flexible'>('specific');
  const [scheduledDate, setScheduledDate] = useState('');
  /**
   * «بدأ الحجز» ≠ «شاف الخدمة» (بلاغ مالك 2026-09-09: أول خانتين في الفنل دايمًا نفس الرقم).
   *
   * الاتنين كانوا بيتبعتوا في نفس الـ`useEffect` بنفس اللحظة، فالتسرّب بينهم صفر بالتعريف
   * والخانة التانية مالهاش أي معلومة زيادة. المرحلة دي بقت تتسجّل عند **أول التزام حقيقي**
   * من العميل — اختيار ميعاد — وده اللي بيخلّي «فتح الصفحة وما كمّلش» رقم ليه معنى.
   *
   * الـref (مش state) عشان التسجيل مايعيدش رندر الصفحة، ومرة واحدة لكل فتحة صفحة.
   */
  const bookingStartedTracked = useRef(false);
  function markBookingStarted() {
    if (bookingStartedTracked.current) return;
    bookingStartedTracked.current = true;
    trackFunnelStage('booking_started', { service_id: id });
  }
  const [scheduledDateRangeEnd, setScheduledDateRangeEnd] = useState('');

  // **وضع الحجز قيمة مشتقة، مش state (ADR-0048، docs/08 §85)** — العميل مابيسألش عنه خالص.
  //
  // مقصود إنها `const` محسوبة مش `useState` + `useEffect`: الوضع **دالة** في التاريخ، ومفيش أي
  // حالة يقدر يبقى فيها مختلف عنه. تخزينه في state كان هيخلق لحظة يكون فيها التاريخ اتغيّر
  // والوضع لسه القديم (وده بالظبط اللي `react-hooks/set-state-in-effect` بيحذّر منه).
  //
  // مقارنة نصية على `YYYY-MM-DD` زي ما `<input type="date">` بيرجّعه — نفس أسلوب `platformDayOf`
  // في الباك-إند بالحرف، بلا أي حساب حدود يوم (البَقّة الموثّقة في `CAIRO_DAY_EXPR`).
  const isSameDayBooking = scheduledDate !== '' && scheduledDate <= new Date().toLocaleDateString('en-CA');
  const bookingMode: BookingMode = isSameDayBooking ? 'emergency' : 'individual';
  // ADR-0060 §4 — دقة الموعد وضعين بس. `start_time` بيطلب ساعة وصول فوق التاريخ، و`full_day`
  // بيطلب التاريخ بس. المدة والكمية والفترة **مابقوش مدخلات جدولة** — بقوا حقول في فورم الخدمة.
  const [preciseTime, setPreciseTime] = useState('');
  // "كرّر الحجز ده" (migration 0176) — undefined = مرة واحدة.
  const [repeatFrequency, setRepeatFrequency] = useState<'weekly' | 'monthly' | 'yearly' | undefined>(undefined);
  // شروط الدفع بعد الخدمة (migration 0177) — إجبارية من الباك-إند: الطلب بيرفض لو مفيش قبول
  const [postpaidPolicies, setPostpaidPolicies] = useState<ApplicablePaymentPolicyDto[]>([]);
  const [problemDescription, setProblemDescription] = useState('');
  const [problemImages, setProblemImages] = useState<Array<{ id: string; previewUrl: string }>>([]);
  const [uploadingProblemImages, setUploadingProblemImages] = useState(false);
  const [problemImageError, setProblemImageError] = useState<string | null>(null);
  const [requestRemoteQuote, setRequestRemoteQuote] = useState(false);
  const [promoCode, setPromoCode] = useState('');

  // رابط QR يوصل أحيانًا قبل تسجيل الدخول، فبنقرأ الكود المحفوظ عند فتح الحجز لا عند التحويل فقط.
  useEffect(() => {
    const linked = readPendingPromoLink();
    if (!linked?.shouldPrefillDiscount) return;
    // التخزين الخارجي يُقرأ بعد أول رندر؛ تأجيل التحديث يمنع render متداخلًا أثناء hydration.
    const timer = window.setTimeout(() => setPromoCode((current) => current || linked.code), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const [paymentChannels, setPaymentChannels] = useState<PaymentChannel[] | null>(null);
  // اختيار العميل **الصريح** بس. `null` = لسه ماختارش، والافتراضي بيتشتق تحت
  // (`effectivePaymentMethod`) بدل ما يتخزّن — تخزينه كان بيحتاج `useEffect` يكتب حالة، وده
  // ممنوع بقاعدة `react-hooks/set-state-in-effect` عندنا، وبيعمل رندر متسلسل بلا داعي.
  // `later` = كاش/محفظة بعد الشغل (غياب دفع مقدّم). الباقي وسائل دفع مسبق حقيقية.
  const [paymentChoice, setPaymentChoice] = useState<'later' | 'card' | 'instapay' | null>(null);
  // العميل اختار يدفع الطلب كامل بدل العربون (طلب مالك 2026-09-11) — نفس اختيار التطبيق.
  const [payFullInsteadOfDeposit, setPayFullInsteadOfDeposit] = useState(false);

  // بند 2-7 — الحجز بقى **تلات خطوات بالظبط**، مفيش صفحة مراجعة رابعة:
  //   1. تفاصيل الشغل والموعد + السعر الحالي (قبل اختيار الفني)
  //   2. العنوان وإكمال الطلب (وصف/صور/تكرار/خصم/دفع/سياسات)
  //   3. اختيار الفني أو الترشيح التلقائي + التأكيد
  const [step, setStep] = useState<1 | 2 | 3>(1);
  // تفكيك السعر الكامل من `POST /orders/preview` — نفس مصدر التطبيق بالحرف. `estimate`
  // (`/services/:id/estimate`) بيفضل للتقدير المبكّر في الخطوة الأولى بس.
  const [orderPreview, setOrderPreview] = useState<PreviewOrderResponseDto | null>(null);
  const [orderPreviewLoading, setOrderPreviewLoading] = useState(false);
  // بند 9-12 — تذكرة المطابقة: الفني وسعره اللي العميل شافه واللي هيتأكد عليه، من الباك-إند.
  const [matchPreview, setMatchPreview] = useState<BookingMatchPreviewDto | null>(null);
  // بصمة المدخلات وقت ما التذكرة اتعملت — بيتقارن بالبصمة الحالية عشان نعرف إنها بايتة.
  const [matchPreviewKey, setMatchPreviewKey] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  // نسخ السياسات اللي العميل وافق عليها فعلاً (checkbox لكل سياسة إجبارية)
  const [acceptedPolicyVersions, setAcceptedPolicyVersions] = useState<Set<string>>(new Set());
  // Idempotency-Key (docs/01 §1.4، migration 0139، Script 7 Phase 9) — lazy initializer بيتنفذ
  // مرة واحدة بس مدى عمر الكومبوننت ده (نفس درس generateIdempotencyKey() في customer-app's
  // payments_repository.dart — توليد مفتاح جديد جوّه handleSubmit نفسها كان هيلغي الحماية لأي
  // retry). أي محاولة تانية (double-click، إعادة إرسال بعد timeout) بتستخدم نفس المفتاح.
  const [orderIdempotencyKey] = useState(() => crypto.randomUUID());

  // شروط ما بعد الخدمة المطبقة على الخدمة دي (لو مفعّلة من الأدمن)
  useEffect(() => {
    fetchApplicablePolicies(id, 'postpaid_service')
      .then(setPostpaidPolicies)
      .catch(() => setPostpaidPolicies([]));
  }, [id]);

  useEffect(() => {
    fetchService(id)
      .then((s) => {
        setService(s);
        // مابنضبطش الوضع من قايمة الخدمة بعد ADR-0048 — بيتحسب من التاريخ في الـeffect تحت.
      })
      .catch(() => setService(null));
  }, [id]);

  // «شاف الخدمة» = فتح الصفحة. بيحصل **من غير أي نداء سيرفر**، فلو ما اتسجّلش من المتصفح
  // مفيش حد هيعرف كام واحد فتح الصفحة وما كمّلش.
  useEffect(() => {
    trackFunnelStage('service_viewed', { service_id: id });
  }, [id]);

  useEffect(() => {
    // ADR-0050 §6 — الفورم الديناميكي مابقاش حكر على `formula`: خدمة «كشف ثم عرض سعر» بتنزل
    // بلا سعر ومحتاجة نفس «الفلتر» عشان الإدارة تقدر تسعّر (طلب مالك صريح).
    if (service?.pricing_model === 'formula' || service?.pricing_model === 'inspection_then_quote') {
      fetchPricingFields(id).then(setPricingFields)
        // فشل التحميل كان بيضيع كـunhandled rejection: القسم يفضل فاضي
        // والمستخدم مش عارف ليه (docs/08 §133).
        .catch((err: unknown) => setError(err instanceof Error ? err.message : 'تعذّر تحميل البيانات'));
    }
  }, [id, service]);

  useEffect(() => {
    if (isAuthenticated) {
      listAddresses(authedFetch).then((list) => {
        setAddresses(list);
        const def = list.find((a) => a.is_default) ?? list[0];
        if (def) setSelectedAddressId(def.id);
        else setShowNewAddressForm(true);
      })
        // فشل التحميل كان بيضيع كـunhandled rejection: القسم يفضل فاضي
        // والمستخدم مش عارف ليه (docs/08 §133).
        .catch((err: unknown) => setError(err instanceof Error ? err.message : 'تعذّر تحميل البيانات'));
      fetchPaymentChannels(authedFetch).then(setPaymentChannels)
        // فشل التحميل كان بيضيع كـunhandled rejection: القسم يفضل فاضي
        // والمستخدم مش عارف ليه (docs/08 §133).
        .catch((err: unknown) => setError(err instanceof Error ? err.message : 'تعذّر تحميل البيانات'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  useEffect(() => {
    if (!selectedAddressId || addresses === null) return;

    const address = addresses.find((item) => item.id === selectedAddressId);
    if (!address?.service_zone_id) return;

    let active = true;
    fetchService(id, address.service_zone_id)
      .then((availableService) => {
        if (!active) return;
        setService(availableService);
        setAvailabilityAddressId(selectedAddressId);
        setServiceAvailabilityError(null);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setAvailabilityAddressId(selectedAddressId);
        setServiceAvailabilityError(
          err instanceof ApiError ? err.message : 'الخدمة دي مش متاحة في العنوان المختار حاليًا',
        );
      });

    return () => {
      active = false;
    };
  }, [addresses, id, selectedAddressId]);

  const debouncedFieldValues = useDebounced(fieldValues, 400);

  useEffect(() => {
    if (!service || service.pricing_model !== 'formula') return;
    const requiredFilled = (pricingFields ?? []).every((field) => {
      const value = debouncedFieldValues[field.field_key];
      if (field.field_type === 'image_upload') {
        const count = typeof value === 'string' ? value.split(',').filter(Boolean).length : 0;
        return count >= (field.min_files ?? (field.is_required ? 1 : 0));
      }
      return !field.is_required || (value !== undefined && value !== '');
    });
    // فلاج تحميل معياري لـfetch effect (نمط React الرسمي لمزامنة نتيجة API مع تغيّر dependencies) —
    // مش derived state بديل عن useMemo، فعلاً استدعاء شبكة async.
    if (!requiredFilled) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEstimate(null);
      return;
    }
    setEstimating(true);
    estimatePrice(id, { bookingMode, fieldValues: debouncedFieldValues })
      .then(setEstimate)
      .catch(() => setEstimate(null))
      .finally(() => setEstimating(false));
  }, [id, service, bookingMode, debouncedFieldValues, pricingFields]);

  // ADR-0060 — الـeffect القديم اللي كان بيسعّر `per_unit`/`monthly`/`hourly` من مدخلات منفصلة
  // اتشال بالكامل. مفيش غير مسارين تسعير: `formula` (الـeffect فوق، من الفورم) و
  // `inspection_then_quote` (مفيش سعر قبل المعاينة أصلاً).

  // اقتراح الأيام (ADR-0088) — بيتنادى أول ما يبقى فيه عنوان مختار، قبل ما العميل يلمس التاريخ.
  // المدة بتتبعت لو التسعير حسبها، عشان الاقتراح يقيس الطاقة بنفس مسطرة الحجز الحقيقي.
  useEffect(() => {
    if (!selectedAddressId || !service?.allows_scheduling) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSuggestedDays(null);
      return;
    }
    let active = true;
    fetchSuggestedDays(authedFetch, {
      serviceId: id,
      addressId: selectedAddressId,
      durationMinutes: estimate?.duration_minutes ?? null,
    })
      .then((res) => { if (active) setSuggestedDays(res.days); })
      // الاقتراح ميزة فوق الفلو — فشله بيخفي الشيبس بس ومابيوقفش الحجز.
      .catch(() => { if (active) setSuggestedDays(null); });
    return () => { active = false; };
  }, [authedFetch, id, selectedAddressId, service?.allows_scheduling, estimate?.duration_minutes]);

  // اقتراح الساعات — بعد ما اليوم يتحدد، ولخدمات «ساعة وصول» بس.
  useEffect(() => {
    if (!selectedAddressId || !scheduledDate || service?.schedule_precision !== 'start_time') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSuggestedTimes(null);
      return;
    }
    let active = true;
    fetchSuggestedTimes(authedFetch, {
      serviceId: id,
      addressId: selectedAddressId,
      day: scheduledDate,
      durationMinutes: estimate?.duration_minutes ?? null,
    })
      .then((res) => { if (active) setSuggestedTimes(res.times); })
      .catch(() => { if (active) setSuggestedTimes(null); });
    return () => { active = false; };
  }, [authedFetch, id, selectedAddressId, scheduledDate, service?.schedule_precision, estimate?.duration_minutes]);

  useEffect(() => {
    if (technicianChoiceMode !== 'manual' || !selectedAddressId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTechnicians(null);
      return;
    }
    fetchTechniciansForService(id, selectedAddressId, {
      bookingMode,
      fieldValues: service?.pricing_model === 'formula' ? debouncedFieldValues : undefined,
    }).then(setTechnicians)
      // فشل التحميل كان بيضيع كـunhandled rejection: القسم يفضل فاضي
      // والمستخدم مش عارف ليه (docs/08 §133).
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'تعذّر تحميل البيانات'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [technicianChoiceMode, selectedAddressId, id, bookingMode, debouncedFieldValues]);

  // **معاينة الطلب الكاملة** — بتتنادى في الخطوة التالتة بس، وبنفس مدخلات `POST /orders`
  // بالظبط (العنوان، الميعاد، المنفّذ المطلوب، كود الخصم، حقول التسعير). ده اللي بيضمن إن
  // الرقم اللي العميل بيشوفه قبل التأكيد هو نفس الرقم اللي هيتسجّل — نفس ضمان التطبيق بالحرف.
  //
  // مسار الصور مستثنى: مفيش سعر خدمة أصلاً وقت الحجز، وطلب معاينة له بيرجّع رقم مالوش معنى.
  useEffect(() => {
    if (step !== 3 || !selectedAddressId || resolveEffectiveRemoteQuote(service, bookingMode, requestRemoteQuote)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOrderPreview(null);
      return;
    }
    let active = true;
    setOrderPreviewLoading(true);
    previewOrder(authedFetch, {
      service_id: id,
      address_id: selectedAddressId,
      booking_mode: bookingMode,
      ...(scheduledDate ? { scheduled_at: computeScheduledAt(scheduledDate) } : {}),
      ...(Object.keys(debouncedFieldValues).length > 0 ? { field_values: debouncedFieldValues } : {}),
      ...(promoCode.trim() ? { promo_code: promoCode.trim() } : {}),
      ...(selectedTechnicianId && technicianChoiceMode === 'manual'
        ? { requested_technician_id: selectedTechnicianId }
        : {}),
    })
      .then((preview) => {
        if (active) setOrderPreview(preview);
      })
      // فشل المعاينة **مايكسرش الصفحة**: الملخص بيرجع لتقدير `estimate`، والتأكيد نفسه لسه
      // بيتحقق في الباك-إند. رمي الخطأ هنا كان هيقفل الحجز على مشكلة عرض.
      .catch(() => {
        if (active) setOrderPreview(null);
      })
      .finally(() => {
        if (active) setOrderPreviewLoading(false);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    step,
    selectedAddressId,
    service,
    requestRemoteQuote,
    id,
    bookingMode,
    scheduledDate,
    preciseTime,
    debouncedFieldValues,
    promoCode,
    selectedTechnicianId,
    technicianChoiceMode,
  ]);

  // مطابق لـ RescheduleSection's fetchRescheduleOptions/rescheduleOrder بالحرف (نفس اتفاقية
  // "T00:00:00.000Z" لليوم المجرّد) — الوقت الدقيق (precise/start-time-only بس) بيتضاف فوق نفس
  // اليوم بنفس الاتفاقية، مطابق create_order_screen.dart's _combinedPreciseScheduledAt.
  function computeScheduledAt(dateStr: string): string | undefined {
    if (!dateStr) return undefined;
    if (service?.schedule_precision === 'start_time' && preciseTime) {
      return `${dateStr}T${preciseTime}:00.000Z`;
    }
    return `${dateStr}T00:00:00.000Z`;
  }

  /** بند 9-12 — بيطلب المرشّح وسعره من الباك-إند قبل الإنشاء، ويقفلهم بتذكرة. */
  async function requestMatchPreview(mode: 'auto' | 'manual', providerId?: string, isCompany = false) {
    if (!selectedAddressId) return;
    setPreviewLoading(true);
    setPreviewError(null);
    setMatchPreview(null);
    try {
      const preview = await createMatchPreview(authedFetch, {
        service_id: service!.id,
        address_id: selectedAddressId,
        selection_mode: mode,
        ...(providerId ? (isCompany ? { requested_technician_company_id: providerId } : { technician_id: providerId }) : {}),
        // نفس اللي بيتبعت في الإنشاء بالحرف — لازم البصمة تطابق، غير كده التذكرة بتبوظ.
        ...(computeScheduledAt(scheduledDate) ? { scheduled_at: computeScheduledAt(scheduledDate) } : {}),
        ...(Object.keys(fieldValues).length ? { field_values: fieldValues } : {}),
        ...(promoCode.trim() ? { promo_code: promoCode.trim() } : {}),
      });
      setMatchPreview(preview);
      setMatchPreviewKey(previewInputsKey);
    } catch (err) {
      // رسالة صريحة بدل كارت فاضي — البند بيمنع أي استبدال أو فشل صامت.
      setPreviewError(
        err instanceof ApiError ? err.message : 'مقدرناش نرشّح لك فني دلوقتي — جرّب تاني',
      );
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleSubmit() {
    if (!service || !selectedAddressId) return;
    if (!effectiveRequestRemoteQuote && technicianChoiceMode === 'manual' && !selectedTechnicianId) return;
    setError(null);
    setSubmitting(true);
    try {
      const order = await createOrder(
        authedFetch,
        {
          service_id: service.id,
          address_id: selectedAddressId,
          booking_mode: effectiveRequestRemoteQuote ? 'individual' : bookingMode,
          // ADR-0080 — الشركة بتتبعت في خانتها، مش في خانة الفني. التذكرة هي مصدر الحقيقة:
          // الباك-إند بيعيد تثبيت الحقل الصح منها ويرفض أي تناقض.
          requested_technician_id:
            !effectiveRequestRemoteQuote && technicianChoiceMode === 'manual' && !selectedProviderIsCompany
              ? (selectedTechnicianId ?? undefined)
              : undefined,
          requested_technician_company_id:
            !effectiveRequestRemoteQuote && technicianChoiceMode === 'manual' && selectedProviderIsCompany
              ? (selectedTechnicianId ?? undefined)
              : undefined,
          problem_description: problemDescription || undefined,
          problem_image_ids: problemImages.map((image) => image.id),
          request_remote_quote: effectiveRequestRemoteQuote || undefined,
          // التاريخ بيتبعت دايمًا دلوقتي (ADR-0048) — هو مدخل الاشتقاق نفسه في الباك-إند.
          scheduled_at: computeScheduledAt(scheduledDate),
          scheduled_at_range_end:
            scheduleDayMode === 'flexible' ? computeScheduledAt(scheduledDateRangeEnd) : undefined,
          repeat_frequency: effectiveRequestRemoteQuote ? undefined : repeatFrequency,
          accepted_policy_version_ids: [...acceptedPolicyVersions],
          promo_code: effectiveRequestRemoteQuote ? undefined : promoCode || undefined,
          field_values: showsDynamicForm ? fieldValues : undefined,
          prepayment_method:
            // رسم التقييم بيتحصّل بالبطاقة بس — مسار تحويلة فورية، مش تحويل بنكي بمراجعة يدوية.
            remoteAssessmentFeeDueCents > 0
              ? 'card'
              : !effectiveRequestRemoteQuote && effectivePaymentMethod !== 'later'
                ? effectivePaymentMethod
                : undefined,
          // بيتبعت بس لما يكون فيه عربون فعلاً والعميل اختار يتخطاه — غير كده `undefined`
          // عشان ما نغيّرش سلوك أي طلب تاني.
          pay_full_amount:
            depositChoiceVisible && payFullInsteadOfDeposit ? true : undefined,
          // بند 12 — قفل السعر: التذكرة اللي العميل شاف عليها الفني والسعر هي نفسها اللي
          // الباك-إند بيعيد التحقق منها. لو المدخلات اتغيّرت أو الفني بقى مش متاح، الإنشاء
          // بيترفض بوضوح بدل ما يستبدل حد في صمت.
          // نفس قاعدة الباك-إند: تذكرة الفني لا تُجمع مع التقييم بالصور. مع المسار البعيد
          // الإدارة بتحدد السعر الأول والتوزيع بيحصل بعد الموافقة، فمفيش منفّذ مقفول وقت
          // الحجز — وإرسال التذكرة كان بيرجّع 400 يقفل العميل عند التأكيد.
          match_preview_id: effectiveRequestRemoteQuote ? undefined : activePreview?.match_preview_id,
        },
        orderIdempotencyKey,
      );
      clearPendingPromoLinkCode(promoCode);
      setSubmitted(true);
      // InstaPay بيروح لصفحة تحويل جوّه الموقع — مفيش redirect لبوابة خارجية. الصفحة نفسها
      // بتجيب بياناتها من `GET /orders/:id/instapay-transfer`، فبنوصّله بـ`replace` من غير ما
      // نمرّر أي حالة: refresh أو رجوع أو فتح الرابط من تاني بيشتغلوا كلهم زي بعض.
      if (!effectiveRequestRemoteQuote && remoteAssessmentFeeDueCents === 0 && effectivePaymentMethod === 'instapay') {
        router.replace(`/orders/${order.id}/instapay`);
        return;
      }
      if (remoteAssessmentFeeDueCents > 0 || (!effectiveRequestRemoteQuote && effectivePaymentMethod === 'card')) {
        const cardResult = await payWithCard(authedFetch, order.id);
        // `assign()` مش `location.href = ...`: قاعدة react-hooks/immutability بتعتبر الإسناد
        // على كائن برّه المكوّن تعديلًا ممنوعًا (خطأ lint حقيقي كان واقف في المشروع). الاتنين
        // نفس السلوك بالظبط — تنقّل بيتسجّل في تاريخ المتصفح — فده تصليح مش التفاف.
        window.location.assign(cardResult.redirect_url);
        return;
      }
      // **`replace` مش `push`** — نفس قرار `pushAndRemoveUntil` في التطبيق بالظبط
      // (بلاغ المالك 2026-09-11). مع `push` كان زرار «رجوع» في المتصفح بيرجّع لصفحة حجز
      // **اتعمل خلاص**، بكل حالتها (الفني المختار، الموعد، السعر) — وإرسالها تاني من هناك
      // بيعمل **طلب تاني حقيقي**. `replace` بيشيل صفحة الحجز من السجل، فالرجوع بيوصّل
      // للمكان اللي العميل كان فيه قبل ما يبدأ.
      router.replace(`/orders/${order.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
      setSubmitted(false);
    } finally {
      setSubmitting(false);
    }
  }

  if (authLoading || !service) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16">
        <div className="h-8 w-2/3 animate-pulse rounded bg-surface-variant" />
        <div className="mt-4 h-40 animate-pulse rounded-xl bg-surface-variant" />
      </div>
    );
  }

  if (!isAuthenticated) {
    // **بوابة الزائر** — نظير `_SignInInvitationSheet` في التطبيق. الفرق اللي اتقفل هنا: النسخة
    // القديمة كانت سطر وزرار وسط صفحة فاضية، والتطبيق بيقول **ليه** محتاجين حساب ويطمّن العميل
    // إنه مش هيبدأ من الأول بعد التسجيل. نفس المعلومة ونفس النبرة، وكارت بدل فراغ.
    return (
      <div className="mx-auto max-w-md px-4 py-12">
        <div className="motion-rise rounded-2xl border border-border bg-surface p-7 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" aria-hidden>
              <path
                d="M12 12a4 4 0 100-8 4 4 0 000 8zM4.5 20a7.5 7.5 0 0115 0"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <h1 className="mt-4 text-lg font-semibold">كمّل حجز «{service.name_ar}»</h1>
          <p className="mt-2 text-sm leading-6 text-muted">
            عشان نحجزلك الخدمة دي محتاجين نعرف عنوانك ونقدر نتواصل معاك. أول ما تسجّل هترجع لنفس
            الصفحة وتكمّل من نفس المكان.
          </p>
          <button
            onClick={() => router.push(`/login?next=/services/${id}`)}
            className="motion-press mt-6 w-full rounded-xl bg-primary px-6 py-3 font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            تسجيل الدخول
          </button>
          <Link href="/search" className="mt-3 inline-block text-sm text-muted hover:text-primary">
            أفضل أتفرّج دلوقتي
          </Link>
        </div>
      </div>
    );
  }

  const modes = availableBookingModes(service);
  // الخدمة لازم تكون بتدعم وضع واحد على الأقل عشان تتحجز أصلاً — مش قايمة اختيارات للعميل بعد
  // ADR-0048، مجرد فحص "قابلة للحجز".
  void modes;
  const allRequiredAccepted =
    postpaidPolicies.filter((p) => p.isRequired).every((p) => acceptedPolicyVersions.has(p.currentVersionId));
  // خيار "أقرب وقت ممكن" اتشال (ADR-0018 §2) — التاريخ إجباري دايمًا لأي خدمة بتسمح بالجدولة
  // ومش طوارئ (الطوارئ مستثناة تمامًا من سؤال الميعاد، نفس catalog_navigation.dart).
  // **الميعاد بقى الخطوة الأولى دايمًا (ADR-0048)** — قبل كده كان بيتخطى لو العميل اختار
  // "طوارئ"؛ الاختيار ده اتشال، والاستعجال نفسه بقى **نتيجة** اختيار النهارده.
  const needsSchedule = service.allows_scheduling;
  // ADR-0050 §6 — «فلتر» أسئلة للعميل على خدمة بلا سعر برضه، مش بس على المعادلة الديناميكية.
  //
  // **ADR-0060 §2** — أقسام «مدة الاشتراك» و«الكمية المطلوبة» المستقلة اتشالت من الشاشة دي
  // بالكامل. الاتنين بقوا **حقول عادية جوّه الفورم الديناميكي**: قالب «بالشهر» بيزرع حقلين
  // تاريخ، وقالب «بالقطعة» بيزرع حقل رقم. سيبهم كأقسام منفصلة كان معناه إن نفس السؤال بيتعرض
  // مرتين على نفس الشاشة — وده بالظبط بلاغ «أربع حقول تاريخ».
  // مسارات التقييم المتاحة فعلاً لسياسة الخدمة (docs/08 §124) — نفس الحارس بالظبط اللي
  // apps/customer-app وapps/api بيستخدموه. `effectiveRequestRemoteQuote` هي القيمة الحقيقية
  // اللي بتتبعت وبتحدد الشاشة: لو مسار الصور هو الوحيد المتاح، الطلب لازم يتبعت كطلب تقييم
  // بالصور — وإلا الباك-إند هيرفضه (بعد إصلاح خرق remote_only، §124-B).
  const routes = assessmentRoutesForService(service);
  const remoteRouteAvailable = routes.remote && bookingMode !== 'emergency';
  const onsiteRouteAvailable = routes.onsite;
  const remoteRouteForced = remoteRouteAvailable && !onsiteRouteAvailable;
  // رسم المعاينة **بعد تطبيق تسعير المنطقة** — مش القيمة الخام من الكتالوج.
  // `service_zone_pricing.inspection_fee_cents` بيستبدل رسم الخدمة حسب منطقة العنوان، فقراءة
  // `service.inspection_fee_cents` مباشرة كانت بتعرض للعميل رقم **مش اللي هيدفعه** (اتلقطت
  // بلقطة شاشة مالك: الكارت 0 ج وملخص السعر تحته 150 ج على نفس الشاشة). المعاينة الحية هي
  // المصدر الوحيد، والكتالوج احتياطي للحظة التحميل بس.
  const resolvedInspectionFeeCents = estimate?.inspection_fee_cents ?? service.inspection_fee_cents;
  const effectiveRequestRemoteQuote = resolveEffectiveRemoteQuote(service, bookingMode, requestRemoteQuote);
  // **بَقّة حقيقية اتلقطت بفحص حي (docs/08 §131)**: الصفحة كانت بتبعت `prepayment_method: undefined`
  // لأي طلب تقييم بالصور، والباك-إند بيرفض بـ«لازم تختار طريقة دفع لرسم التقييم قبل إرسال
  // الصور» لو الخدمة عليها رسم — يعني أي خدمة الأدمن حاطط لها رسم تقييم بالصور مستحيل تتحجز.
  // والاتجاه التاني مطلوب برضه: رسم = صفر مع طريقة دفع بيترفض بـ«الدفع يتم بعد ما الإدارة
  // تحدد السعر». فالقرار ثنائي: الرسم موجود → بطاقة إجباري؛ مش موجود → مفيش دفع خالص.
  const remoteAssessmentFeeDueCents =
    effectiveRequestRemoteQuote && service ? service.remote_assessment_fee_cents : 0;

  const showsDynamicForm =
    service.pricing_model === 'formula' || service.pricing_model === 'inspection_then_quote';
  const pricingFieldsValid =
    !showsDynamicForm ||
    (pricingFields ?? []).every((field) => {
      const value = fieldValues[field.field_key];
      if (field.field_type === 'image_upload') {
        const count = typeof value === 'string' ? value.split(',').filter(Boolean).length : 0;
        return count >= (field.min_files ?? (field.is_required ? 1 : 0));
      }
      return !field.is_required || (value !== undefined && value !== '');
    });
  const priceReady =
    service.pricing_model === 'inspection_then_quote' ||
    (technicianChoiceMode === 'manual' && !!technicians?.find((t) => t.id === selectedTechnicianId)?.final_price_cents) ||
    estimate !== null;
  const remoteQuoteValid = !effectiveRequestRemoteQuote || (problemImages.length > 0 && !isSameDayBooking);
  const needsPreciseTime = needsSchedule && scheduleDayMode === 'specific' && service.schedule_precision === 'start_time';

  // بند 11 — **إبطال المعاينة عند تغيير أي مدخل مؤثر**، بالاشتقاق مش بـeffect بيمسح الحالة:
  // بنقارن بصمة المدخلات دلوقتي ببصمتها وقت ما التذكرة اتعملت. أنضف من ناحية React (مفيش
  // setState جوّه effect ولا رندر متتالي)، وأقرب لطريقة الباك-إند نفسه اللي بيقارن بصمة
  // برضه — فالواجهة والباك-إند بيسألوا نفس السؤال بنفس الطريقة.
  //
  // ومن غيره العميل يفضل شايف كارت فني وسعر محجوزين وهما مابقوش، والباك-إند هيرفض عند التأكيد.
  const previewInputsKey = JSON.stringify({
    selectedAddressId,
    scheduledDate,
    scheduledDateRangeEnd,
    preciseTime,
    scheduleDayMode,
    promoCode: promoCode.trim(),
    effectiveRequestRemoteQuote,
    technicianChoiceMode,
    selectedTechnicianId,
    fieldValues,
  });
  const activePreview = matchPreview !== null && matchPreviewKey === previewInputsKey ? matchPreview : null;

  // بند 6 — شروط إكمال كل خطوة. مبنية من نفس أجزاء `canSubmit` تحت (مفيش قواعد صلاحية موازية):
  // الخطوة 1 = الشغل والموعد، الخطوة 2 = العنوان والسياسات.
  const scheduleComplete =
    !needsSchedule ||
    (scheduleDayMode === 'specific' ? !!scheduledDate : !!scheduledDate && !!scheduledDateRangeEnd);
  const stepOneComplete = scheduleComplete && (!needsPreciseTime || !!preciseTime) && pricingFieldsValid;
  const serviceAvailableForAddress =
    selectedAddressId !== null && availabilityAddressId === selectedAddressId && serviceAvailabilityError === null;
  const selectedAddress = addresses?.find((item) => item.id === selectedAddressId);
  const effectiveServiceAvailabilityError = selectedAddressId && !selectedAddress?.service_zone_id
    ? 'العنوان ده خارج مناطق الخدمة المتاحة حاليًا'
    : availabilityAddressId === selectedAddressId
      ? serviceAvailabilityError
      : null;
  // **المنفّذ متقفل؟** — نفس تعريف الأندرويد بالحرف: الطوارئ ومسار الصور مالهمش اختيار منفّذ
  // أصلاً (أول فني يقبل / الإدارة بتحدد)، وغير كده لازم تذكرة حقيقية: تلقائي = معاينة مطابقة،
  // يدوي = فني/شركة مختارة. من غير الشرط ده الخطوة ٢ بتعدّي والعميل لسه مش عارف مين هينفّذ.
  const providerLocked =
    effectiveRequestRemoteQuote ||
    bookingMode === 'emergency' ||
    (technicianChoiceMode === 'auto' ? !!activePreview : !!selectedTechnicianId);
  const stepTwoComplete = stepOneComplete && serviceAvailableForAddress && providerLocked;

  // **مصدر واحد لتفكيك السعر**: التذكرة المقفولة لو موجودة (نفس الرقم اللي هيتسجّل على الطلب)،
  // وإلا تقدير `POST /orders/preview`. الاتنين نفس الشكل (`PreviewOrderResponseDto`)، فالجدول
  // تحت مابيفرّقش بينهم — وده اللي بيمنع «رقمين مختلفين على نفس الشاشة».
  const priceBreakdown: PreviewOrderResponseDto | null = activePreview?.pricing ?? orderPreview;

  /**
   * فيه عربون مثبّت على السعر المعروض، يعني العميل قدّامه **اختيار حقيقي**: يدفع العربون
   * دلوقتي والباقي كاش للصنايعي بعد الشغل، ولا يخلّص الطلب كله مرة واحدة.
   *
   * مسار «التقييم بالصور» مستثنى: الطلب بيتعمل بإجمالي صفر والسعر بيتحدد بعدين، فمفيش عربون
   * أصلاً يتقرر عليه.
   */
  const depositChoiceVisible =
    !effectiveRequestRemoteQuote &&
    priceBreakdown?.deposit_amount_cents != null &&
    priceBreakdown.deposit_amount_cents > 0;

  /**
   * وسائل الدفع المقدّم المتاحة، **بترتيب السيرفر زي ما جه** (InstaPay فوق ثم الكاش ثم الباقي).
   *
   * بنفلتر على اللي الويب بيعرف يكمّلها فعلاً: البطاقة (تحويلة لبوابة) وInstaPay (صفحة تحويل
   * جوّه الموقع). فوري والتقسيط ليهم مسارات مالهاش واجهة هنا لسه — عرضهم كان هيوصّل العميل
   * لطريق مسدود، وده أسوأ من عدم عرضهم.
   */
  const prepaymentOptions = (paymentChannels ?? []).filter(
    (channel) => channel.is_available && (channel.method === 'instapay' || channel.method === 'card'),
  );

  /**
   * «كاش/محفظة بعد الشغل» = **غياب** دفع مقدّم، ونفس شرط الباك-إند بالحرف
   * (`order-creation.service.ts`): بيترفض لو الخدمة مش بتقبل كاش أو عليها عربون مفروض.
   *
   * ولو العميل اختار يدفع الطلب كامل بدل العربون، هو كده اختار دفع مقدّم — فالخيار ده
   * بيتشال عشان ما يبقاش فيه اختيارين متناقضين ظاهرين مع بعض.
   */
  const cashAfterWorkAllowed =
    service.cash_allowed !== false &&
    !service.deposit_required &&
    !(depositChoiceVisible && payFullInsteadOfDeposit);

  /**
   * الوسيلة اللي الطلب هيتبعت بيها فعلاً — **مشتقّة، مش مخزّنة**.
   *
   * قاعدة الافتراضي هي نفس قاعدة التطبيق بالحرف (`_reconcilePaymentMethodSelection`):
   * **«بعد الشغل» يفضل الافتراضي طول ما هو مسموح**، والترشيح بيغيّر الافتراضي بس لما الدفع
   * المقدّم يبقى **إجباري** أصلاً. فرض InstaPay كافتراضي على كل الطلبات كان هيحوّل الترشيح
   * لإجبار ويكسر العميل اللي عايز يدفع كاش على خدمة بتسمح بيه.
   *
   * ولإن دي اشتقاق مش حالة، أي تغيّر في الخدمة أو في اختيار العربون بيصحّح الوسيلة لوحده:
   * مستحيل يفضل مخزّن عندنا اختيار بقى غير صالح.
   */
  const selectableMethods = new Set<string>([
    ...prepaymentOptions.map((channel) => channel.method),
    ...(cashAfterWorkAllowed ? ['later'] : []),
  ]);
  const effectivePaymentMethod: 'later' | 'card' | 'instapay' =
    paymentChoice && selectableMethods.has(paymentChoice)
      ? paymentChoice
      : cashAfterWorkAllowed
        ? 'later'
        : ((prepaymentOptions.find((channel) => channel.is_recommended) ?? prepaymentOptions[0])
            ?.method as 'card' | 'instapay' | undefined) ?? 'later';

  const canSubmit =
    !!selectedAddressId &&
    serviceAvailableForAddress &&
    (!needsSchedule ||
      (scheduleDayMode === 'specific' ? !!scheduledDate : !!scheduledDate && !!scheduledDateRangeEnd)) &&
    (!needsPreciseTime || !!preciseTime) &&
    pricingFieldsValid &&
    priceReady &&
    remoteQuoteValid &&
    // بند 9 — في الوضع التلقائي التأكيد **محتاج معاينة فعلية**: العميل لازم يكون شاف الفني
    // وسعره قبل ما يأكد. من غير الشرط ده الوضع التلقائي بيرجع «أكّد وإحنا هندوّر بعدين».
    // التعريف اتوحّد في `providerLocked` فوق — كانت نسخة موازية بتفرّق عن شرط الخطوة ٢.
    providerLocked &&
    allRequiredAccepted &&
    !submitting &&
    !submitted;

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      {service.icon_url && (
        // eslint-disable-next-line @next/next/no-img-element -- صور خدمات خارجية من التخزين، مش أصول ثابتة معروفة وقت الـbuild
        <img
          src={service.icon_url}
          alt=""
          loading="eager"
          fetchPriority="high"
          decoding="async"
          className="mb-4 aspect-[3/1] w-full rounded-xl bg-surface-variant object-cover"
        />
      )}
      <h1 className="text-2xl font-bold">{service.name_ar}</h1>
      {service.short_description_ar && <p className="mt-1 text-muted">{service.short_description_ar}</p>}
      {service.warranty_days > 0 && (
        <p className="mt-2 text-sm text-success">ضمان {service.warranty_days} يوم على الشغل ده</p>
      )}

      {/* بند 2-7 — مؤشر الخطوات التلاتة. مفيش خطوة رابعة للمراجعة: المراجعة بتحصل في
          الخطوة التالتة نفسها جنب كارت الفني والسعر النهائي. */}
      <ol className="mt-6 flex items-center gap-2 text-sm">
        {[
          { n: 1 as const, label: 'الشغل والموعد' },
          { n: 2 as const, label: 'العنوان والفني' },
          { n: 3 as const, label: 'التفاصيل والتأكيد' },
        ].map((s) => (
          // `min-w-0` **ضروري**: بلاها `truncate` جوّه العنصر ده مالهاش أي أثر خالص.
          // عنصر الـflex افتراضيًا `min-width: auto`، يعني مايقدرش يصغّر تحت عرض محتواه، فالنص
          // بيفرد العنصر بدل ما يتقص — وشريط الخطوات كان بيتعدّى ٢١ بكسل بره الشاشة عند ٣٩٠
          // بكسل (اتلقط بـ`scripts/sweep-customer.js`، والصفحة دي هي **صفحة الحجز نفسها**).
          <li key={s.n} className="flex min-w-0 flex-1 items-center gap-2">
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors duration-200 ${
                step === s.n
                  ? 'bg-primary text-primary-foreground'
                  : step > s.n
                    ? 'bg-primary/15 text-primary'
                    : 'bg-surface-variant text-muted'
              }`}
            >
              {step > s.n ? '✓' : s.n}
            </span>
            <span className={`truncate transition-colors duration-200 ${step === s.n ? 'font-medium text-foreground' : 'text-muted'}`}>
              {s.label}
            </span>
          </li>
        ))}
      </ol>

      {/* قسم "نوع الحجز" اتشال بالكامل (ADR-0048) — «نشيل دول خالص ونحط قواعد على السيستم،
          والسيستم هو اللي بيحدد بناءً على التاريخ». اللي محلّه: التنبيه الأحمر تحت لما العميل
          يختار النهارده. */}

      {step === 1 && needsSchedule && (
        <section className="motion-rise mt-6">
          <h2 className="mb-3 font-semibold">الموعد</h2>
          <div className="flex gap-2">
            <button
              onClick={() => setScheduleDayMode('specific')}
              className={`rounded-lg border px-4 py-2 text-sm ${scheduleDayMode === 'specific' ? 'border-primary bg-primary/10 text-primary' : 'border-border'}`}
            >
              اختار يوم محدد
            </button>
            {service.allows_date_range_booking && (
              <button
                onClick={() => setScheduleDayMode('flexible')}
                className={`rounded-lg border px-4 py-2 text-sm ${scheduleDayMode === 'flexible' ? 'border-primary bg-primary/10 text-primary' : 'border-border'}`}
              >
                مرن — نطاق أيام
              </button>
            )}
          </div>

          {scheduleDayMode === 'specific' ? (
            <>
              {/* اقتراح الأيام (ADR-0088) — ضغطة واحدة بتحط الموعد. مرتّبة بالأقرب من بين
                  الأيام اللي فيها براح حقيقي، ومحدش بيتقفل عليه: مدخل التاريخ تحت زي ما هو. */}
              {suggestedDays && suggestedDays.length > 0 && (
                <div className="mt-3">
                  <p className="mb-2 text-sm text-muted">أقرب مواعيد فيها متخصصين متاحين:</p>
                  <div className="flex flex-wrap gap-2">
                    {suggestedDays.map((suggestion) => {
                      const isPicked = scheduledDate === suggestion.day;
                      return (
                        <button
                          key={suggestion.day}
                          type="button"
                          onClick={() => {
                            setScheduledDate(suggestion.day);
                            markBookingStarted();
                            setRequestRemoteQuote(false);
                          }}
                          className={`rounded-xl border px-4 py-2 text-right text-sm transition ${
                            isPicked ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/50'
                          }`}
                        >
                          <span className="block font-medium">{formatSuggestedDay(suggestion.day)}</span>
                          <span className="block text-xs text-muted">
                            {suggestion.available_technicians} متخصص متاح
                            {suggestion.is_earliest ? ' · أقرب فرصة' : ''}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-xs text-muted">أو اختار أي يوم تاني بنفسك من تحت</p>
                </div>
              )}
              <input
                type="date"
                value={scheduledDate}
                onChange={(e) => {
                  setScheduledDate(e.target.value);
                  markBookingStarted();
                  if (e.target.value <= new Date().toLocaleDateString('en-CA')) setRequestRemoteQuote(false);
                }}
                className="mt-3 block rounded-lg border border-border bg-surface px-4 py-2"
              />
            </>
          ) : (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                type="date"
                value={scheduledDate}
                onChange={(e) => {
                  setScheduledDate(e.target.value);
                  markBookingStarted();
                  if (e.target.value <= new Date().toLocaleDateString('en-CA')) setRequestRemoteQuote(false);
                }}
                className="rounded-lg border border-border bg-surface px-4 py-2"
              />
              <span className="text-sm text-muted">لحد</span>
              <input
                type="date"
                value={scheduledDateRangeEnd}
                onChange={(e) => setScheduledDateRangeEnd(e.target.value)}
                className="rounded-lg border border-border bg-surface px-4 py-2"
              />
              <p className="mt-1 w-full text-xs text-muted">هنجيبلك أقرب يوم فيه فني متاح جوّه النطاق اللي تختاره</p>
            </div>
          )}

          {/* إخطار «طلب النهارده» (ADR-0048) — مش سؤال، العميل مابيختارش وضع حجز.
              **مراجعة تانية (بلاغ مالك 2026-09-04)**: كان بلون `danger` أحمر وبينص على «رسوم
              استعجال فوق سعر الخدمة» بلا رقم. المالك: «الشكل نفسه يخلي اللي بيطلب الطارئ ده
              يخاف». الإجمالي الحقيقي — وهو **شامل رسم الاستعجال أصلاً** — معروض في ملخص السعر
              تحت في نفس الصفحة وقبل أي تأكيد، فالتحذير بلا رقم كان قلق بلا معلومة. بقى محايد
              اللون وبيقول اللي بيحصل فعلاً. نفس صياغة تطبيق العميل بالحرف. */}
          {isSameDayBooking && (
            <p className="mt-3 rounded-lg border border-border bg-surface px-4 py-3 text-sm text-muted">
              طلب النهارده — هنبدأ ندوّر لك على متخصص متاح على طول. هتشوف السعر النهائي قدامك قبل
              ما تأكّد.
            </p>
          )}

          {needsPreciseTime && (
            <div className="mt-4">
              {suggestedTimes && suggestedTimes.length > 0 && (
                <div className="mb-3">
                  <p className="mb-2 text-sm text-muted">ساعات فاضية في اليوم ده:</p>
                  <div className="flex flex-wrap gap-2">
                    {suggestedTimes.map((slot) => (
                      <button
                        key={slot.time}
                        type="button"
                        onClick={() => setPreciseTime(slot.time)}
                        className={`rounded-xl border px-4 py-2 text-sm transition ${
                          preciseTime === slot.time
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border hover:border-primary/50'
                        }`}
                      >
                        <span className="block font-medium" dir="ltr">{slot.time}</span>
                        <span className="block text-xs text-muted">{slot.free_technicians} متاح</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <label className="flex items-center gap-2 text-sm">
                <span>الساعة</span>
                <input
                  type="time"
                  value={preciseTime}
                  onChange={(e) => setPreciseTime(e.target.value)}
                  className="rounded-lg border border-border bg-surface px-3 py-2"
                />
              </label>
            </div>
          )}
        </section>
      )}

      {step === 1 && showsDynamicForm && pricingFields && pricingFields.length > 0 && (
        <section className="motion-rise mt-6">
          <h2 className="mb-1 font-semibold">تفاصيل الشغل</h2>
          {/* نفس الجملة بالحرف اللي `JobDetailsScreen` في التطبيق بيقولها. الفكرة إن العميل
              يفهم **ليه** بنسأله قبل ما نعرض أي سعر: من غير التفاصيل دي، السعر اللي هيتعرض
              جنب كل فني في القايمة مش هيكون رقمه الحقيقي. */}
          <p className="mb-3 text-sm text-muted">
            دخّل تفاصيل الشغل عشان نقدر نعرضلك السعر النهائي الحقيقي لكل فني في القايمة
          </p>
          <div className="space-y-4">
            {pricingFields
              .slice()
              .sort((a, b) => a.display_order - b.display_order)
              .map((field) => (
                <DynamicPricingField
                  key={field.id}
                  field={field}
                  value={fieldValues[field.field_key]}
                  onChange={(v) => setFieldValues((prev) => ({ ...prev, [field.field_key]: v }))}
                  onUpload={(file) => uploadPricingFieldImage(authedFetch, service.id, field.id, file)}
                />
              ))}
          </div>
        </section>
      )}

      {step === 2 && (
      <section className="motion-rise mt-6">
        <h2 className="mb-3 font-semibold">العنوان</h2>
        {addresses === null ? (
          <div className="h-16 animate-pulse rounded-xl bg-surface-variant" />
        ) : (
          <div className="space-y-2">
            {addresses.map((a) => (
              <label
                key={a.id}
                className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${
                  selectedAddressId === a.id ? 'border-primary bg-primary/5' : 'border-border'
                }`}
              >
                <input
                  type="radio"
                  name="address"
                  checked={selectedAddressId === a.id}
                  onChange={() => {
                    setSelectedAddressId(a.id);
                    setAvailabilityAddressId(null);
                    setServiceAvailabilityError(null);
                    setShowNewAddressForm(false);
                  }}
                  className="mt-1"
                />
                <div>
                  <p className="font-medium">{a.label || a.street_name}</p>
                  <p className="text-sm text-muted">{a.street_name}</p>
                </div>
              </label>
            ))}
            {/* بَقّة حقيقية اتلقطت باختبار حي بمتصفح: الزرار ده toggle، وللعميل الجديد (صفر عناوين)
                الفورم بيتفتح تلقائيًا (useEffect فوق) — فلو الزرار فضل ظاهر بنفس النص "+ عنوان
                جديد"، دوسة عليه بتقفل الفورم المفتوح أصلاً من غير أي بديل واضح (مفيش عنوان تاني
                يتختار). نخفي الزرار خالص لو مفيش عناوين محفوظة أصلاً، ونغيّر نصه لـ"إلغاء" لو
                الفورم مفتوح فعلاً (عميل عنده عناوين واختار يضيف واحد جديد). */}
            {addresses.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setShowNewAddressForm((v) => !v);
                  setSelectedAddressId(null);
                  setAvailabilityAddressId(null);
                  setServiceAvailabilityError(null);
                }}
                className="text-sm text-primary hover:underline"
              >
                {showNewAddressForm ? 'إلغاء' : '+ عنوان جديد'}
              </button>
            )}
            {showNewAddressForm && (
              <NewAddressForm
                authedFetch={authedFetch}
                onCreated={(addr) => {
                  setAddresses((prev) => [...(prev ?? []), addr]);
                  setSelectedAddressId(addr.id);
                  setAvailabilityAddressId(null);
                  setServiceAvailabilityError(null);
                  setShowNewAddressForm(false);
                }}
              />
            )}
          </div>
        )}
        {selectedAddressId &&
          selectedAddress?.service_zone_id &&
          availabilityAddressId !== selectedAddressId &&
          !effectiveServiceAvailabilityError && (
          <p className="mt-2 text-sm text-muted">بنتأكد إن الخدمة متاحة في العنوان...</p>
        )}
        {effectiveServiceAvailabilityError && (
          <p className="mt-2 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
            {effectiveServiceAvailabilityError}
          </p>
        )}
      </section>
      )}

      {/* **اختيار الفني بقى في الخطوة ٢ جنب العنوان (2026-09-11)** — مطابقة حرفية لفلو
          الأندرويد: `catalog_navigation.dart` بيروح `TechnicianSelectionScreen` **قبل**
          `CreateOrderScreen`، والشاشة دي هي اللي بتاخد العنوان كمان. الترتيب القديم (عنوان ←
          تفاصيل ← فني) كان بيخلي العميل يعدّي على كل التفاصيل وهو لسه مش عارف مين هينفّذ ولا
          بكام — وده مصدر «فلو التسعير مختلف» في بلاغ المالك.

          **الطوارئ مستثناة** (`bookingMode !== 'emergency'`) — نفس الاستثناء بالحرف في
          `catalog_navigation.dart`: حجز اليوم بيروح لإنشاء الطلب مباشرة، وأول فني يقبل
          بياخده. سؤال العميل «مين يعمل الشغل؟» في الحالة دي بيوعده باختيار مش موجود. */}
      {step === 2 && selectedAddressId && !effectiveRequestRemoteQuote && bookingMode !== 'emergency' && (
        <section className="motion-rise mt-6">
          <h2 className="mb-3 font-semibold">مين يعمل الشغل؟</h2>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              onClick={() => {
                setTechnicianChoiceMode('auto');
                setSelectedTechnicianId(null);
              }}
              className={`flex-1 rounded-xl border p-3 text-right ${
                technicianChoiceMode === 'auto' ? 'border-primary bg-primary/5' : 'border-border'
              }`}
            >
              <p className="font-medium text-primary">خلي أسطى يختار</p>
              <p className="text-sm text-muted">أسرع فني متاح بالمنطقة، بأفضل تقييم</p>
            </button>
            <button
              onClick={() => setTechnicianChoiceMode('manual')}
              className={`flex-1 rounded-xl border p-3 text-right ${
                technicianChoiceMode === 'manual' ? 'border-primary bg-primary/5' : 'border-border'
              }`}
            >
              <p className="font-medium">اختار بنفسك</p>
              <p className="text-sm text-muted">شوف الفنيين المتاحين وسعر كل واحد</p>
            </button>
          </div>

          {/* بند 9-10 — الترشيح التلقائي بقى **معاينة حقيقية**: العميل بيشوف الفني وسعره
              وتقييمه قبل ما يأكد، مش بيأكد على المجهول. ولو المرشّح بقى مش متاح وقت التأكيد،
              الباك-إند بيرفض ويطلب معاينة جديدة — ممنوع استبدال صامت. */}
          {technicianChoiceMode === 'auto' && (
            <div className="mt-3">
              {activePreview === null ? (
                <button
                  onClick={() => requestMatchPreview('auto')}
                  disabled={previewLoading}
                  className="w-full rounded-xl border border-primary bg-primary/5 px-4 py-3 text-sm font-medium text-primary disabled:opacity-50"
                >
                  {previewLoading ? 'بندوّر على أفضل أسطى...' : 'رشّح لي أفضل أسطى وسعره'}
                </button>
              ) : (
                <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{activePreview.provider.full_name}</p>
                      <p className="text-sm text-muted">
                        {TECHNICIAN_LEVEL_LABELS_AR[
                          activePreview.provider.current_level as keyof typeof TECHNICIAN_LEVEL_LABELS_AR
                        ] ?? activePreview.provider.current_level}
                        {' · '}
                        {activePreview.provider.average_rating.toFixed(1)} ({activePreview.provider.total_ratings_count})
                        {activePreview.provider.distance_km !== null &&
                          ` · ${activePreview.provider.distance_km.toFixed(1)} كم`}
                      </p>
                    </div>
                    <span className="shrink-0 text-lg font-bold text-primary">
                      {formatEgp(activePreview.pricing.total_amount_cents)}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-muted">
                    السعر ده محجوز لك مع الأسطى ده لحد{' '}
                    {new Date(activePreview.expires_at).toLocaleTimeString('ar-EG', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    . لو غيّرت أي تفصيلة هنرشّح من جديد.
                  </p>
                  <button
                    onClick={() => requestMatchPreview('auto')}
                    disabled={previewLoading}
                    className="mt-2 text-sm text-primary underline disabled:opacity-50"
                  >
                    رشّح لي حد تاني
                  </button>
                </div>
              )}
              {previewError && <p className="mt-2 text-sm text-danger">{previewError}</p>}
            </div>
          )}

          {technicianChoiceMode === 'manual' && (
            <div className="motion-list mt-3 space-y-2">
              {technicians === null ? (
                <div className="h-16 animate-pulse rounded-xl bg-surface-variant" />
              ) : technicians.length === 0 ? (
                <p className="text-sm text-muted">مفيش فنيين متاحين في منطقتك دلوقتي للخدمة دي</p>
              ) : (
                technicians.map((t) =>
                  t.is_company ? (
                    <CompanyCard
                      key={t.id}
                      t={t}
                      selected={selectedTechnicianId === t.id}
                      // ADR-0080 — اختيار شركة بيقفل تذكرة زي اختيار فني بالظبط: التوزيع
                      // بيدوّر جوّه الشركة والسعر بيتقفل. قبل كده الكارت كان بيسجّل معرّف
                      // الشركة في `selectedTechnicianId` وبيتبعت كـ`requested_technician_id`
                      // وقت الإنشاء — يعني معرّف شركة في خانة فني، والحجز بيقع.
                      onSelect={() => {
                        setSelectedTechnicianId(t.id);
                        void requestMatchPreview('manual', t.id, true);
                      }}
                    />
                  ) : (
                    <IndividualCard
                      key={t.id}
                      t={t}
                      selected={selectedTechnicianId === t.id}
                      // بند 12 — الاختيار اليدوي بيقفل تذكرة زي التلقائي بالظبط: نفس مصدر السعر
                      // ونفس إعادة التحقق وقت الإنشاء. من غيرها الاختيار اليدوي بيفضل تفضيل
                      // ممكن يتغيّر تحت رجل العميل.
                      onSelect={() => {
                        setSelectedTechnicianId(t.id);
                        void requestMatchPreview('manual', t.id);
                      }}
                    />
                  ),
                )
              )}
            </div>
          )}
        </section>
      )}

      {/* "كرّر الحجز ده" (migration 0176) — الطلب الحالي بيتعمل زي العادة، والمواعيد الجاية بيتولّد
          منها طلبات عادية كاملة بسعر الخدمة وقتها. بيظهر بس للخدمات المفعّل فيها التكرار ومع موعد محدد. */}
      {step === 3 && !effectiveRequestRemoteQuote && service.allows_recurring_booking && needsSchedule && scheduleDayMode === 'specific' && scheduledDate && (
        <section className="motion-rise mt-6">
          <h2 className="mb-2 font-semibold">تكرار الحجز</h2>
          <div className="flex gap-2">
            {(
              [
                { value: '', label: 'مرة واحدة' },
                { value: 'weekly', label: 'أسبوعي' },
                { value: 'monthly', label: 'شهري' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.value || 'none'}
                onClick={() => setRepeatFrequency(opt.value || undefined)}
                className={`rounded-lg border px-4 py-2 text-sm ${
                  (repeatFrequency ?? '') === opt.value ? 'border-primary bg-primary/10 text-primary' : 'border-border'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {repeatFrequency && (
            <p className="mt-2 text-sm text-muted">
              الحجز ده أول موعد، والمواعيد الجاية هيتولّد منها طلبات عادية بنفس التفاصيل — سعر كل موعد بيتحسب بسعر الخدمة وقتها.
            </p>
          )}
        </section>
      )}

      {step === 3 && (
      <section className="motion-rise mt-6">
        <h2 className="mb-2 font-semibold">وصف المشكلة (اختياري)</h2>
        <textarea
          value={problemDescription}
          onChange={(e) => setProblemDescription(e.target.value)}
          maxLength={2000}
          rows={3}
          placeholder="اكتب أي تفاصيل تساعد الفني يجهّز الأدوات المناسبة"
          className="w-full rounded-lg border border-border bg-surface px-4 py-3 outline-none focus:border-primary"
        />
      </section>
      )}

      {step === 3 && (
      <section className="motion-rise mt-6 rounded-xl border border-border bg-surface p-4">
        <h2 className="font-semibold">صور المشكلة (اختياري)</h2>
        <p className="mt-1 text-sm text-muted">الصور بتساعد الفني يجهّز نفسه، ومش مطلوبة للحجز العادي.</p>
        {problemImages.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {problemImages.map((image, index) => (
              <div key={image.id} className="relative h-24 w-24 overflow-hidden rounded-xl bg-surface-variant">
                {/* eslint-disable-next-line @next/next/no-img-element -- معاينة محلية للصورة قبل إنشاء الطلب */}
                <img src={image.previewUrl} alt={`صورة المشكلة ${index + 1}`} className="h-full w-full object-cover" />
                <button
                  type="button"
                  aria-label="حذف الصورة"
                  onClick={() => {
                    setProblemImages((current) => current.filter((item) => item.id !== image.id));
                    if (problemImages.length === 1) setRequestRemoteQuote(false);
                  }}
                  className="absolute end-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-black/70 text-sm text-white"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <label
          className={`mt-3 inline-flex cursor-pointer items-center rounded-lg border border-border px-4 py-2 text-sm hover:border-primary ${
            uploadingProblemImages || problemImages.length >= 10 ? 'pointer-events-none opacity-50' : ''
          }`}
        >
          {uploadingProblemImages ? 'جاري رفع الصور...' : 'إضافة صور'}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="sr-only"
            disabled={uploadingProblemImages || problemImages.length >= 10}
            onChange={async (event) => {
              const files = Array.from(event.target.files ?? []).slice(0, 10 - problemImages.length);
              if (files.length === 0) return;
              setUploadingProblemImages(true);
              setProblemImageError(null);
              try {
                for (const file of files) {
                  const uploaded = await uploadProblemImage(authedFetch, service.id, file);
                  setProblemImages((current) => [
                    ...current,
                    { id: uploaded.id, previewUrl: URL.createObjectURL(file) },
                  ]);
                }
              } catch (uploadError) {
                setProblemImageError(uploadError instanceof Error ? uploadError.message : 'رفع الصورة فشل، حاول تاني');
              } finally {
                setUploadingProblemImages(false);
                event.target.value = '';
              }
            }}
          />
        </label>
        <span className="ms-3 text-xs text-muted">{problemImages.length}/10</span>
        {problemImageError && <p className="mt-2 text-sm text-danger">{problemImageError}</p>}

        {/* ── اختيار مسار التقييم (docs/08 §124) ─────────────────────────────────────────
            قبل كده كان checkbox واحد مربوط بـ`pricing_model === 'inspection_then_quote'` بس،
            بلا أي فحص لسياسة الأدمن — فخدمة سياستها "معاينة في الموقع فقط" كانت تعرض الاختيار
            وتقبله، والباك-إند يرفض الطلب (بلاغ مالك: "مش عارف أعمل معاينة لوحدها"). دلوقتي
            بيتعرض المسار المسموح فعلاً بس، والمسارين مسمّيين صراحة لما الاتنين متاحين. */}
        {remoteRouteAvailable && onsiteRouteAvailable && (
          <div className="mt-4 flex flex-col gap-2">
            <p className="text-sm font-medium text-foreground">إزاي نحدد السعر؟</p>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-surface p-3 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
              <input
                type="radio"
                name="assessment_route"
                checked={requestRemoteQuote}
                disabled={problemImages.length === 0 || isSameDayBooking}
                onChange={() => setRequestRemoteQuote(true)}
                className="mt-1"
              />
              <span>
                <span className="block font-medium">الإدارة تحدد السعر من الصور</span>
                <span className="mt-1 block text-sm text-muted">
                  الإدارة هتبعت السعر، وإنت تقبله أو ترفضه قبل ما الطلب يروح لأي فني
                  {service.remote_assessment_fee_cents > 0 &&
                    ` — رسم التقييم ${formatEgp(service.remote_assessment_fee_cents)}`}
                  .
                </span>
                {problemImages.length === 0 && (
                  <span className="mt-1 block text-xs text-danger">ارفع صورة واحدة على الأقل لتفعيل الاختيار.</span>
                )}
                {isSameDayBooking && (
                  <span className="mt-1 block text-xs text-danger">التسعير بالصور مش متاح لطلب نفس اليوم.</span>
                )}
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-surface p-3 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
              <input
                type="radio"
                name="assessment_route"
                checked={!requestRemoteQuote}
                onChange={() => setRequestRemoteQuote(false)}
                className="mt-1"
              />
              <span>
                <span className="block font-medium">معاينة في الموقع</span>
                <span className="mt-1 block text-sm text-muted">
                  فني بيجي يشوف الشغل ويبعتلك السعر — رسم المعاينة {formatEgp(resolvedInspectionFeeCents)}
                </span>
              </span>
            </label>
          </div>
        )}
        {remoteRouteForced && (
          <div className="mt-4 rounded-xl border border-primary/20 bg-primary/5 p-3">
            <p className="font-medium text-primary">الإدارة تحدد السعر من الصور</p>
            <p className="mt-1 text-sm text-muted">
              الخدمة دي سعرها بيتحدد من الصور — ارفع صور المشكلة وهتستلم عرض سعر
              {service.remote_assessment_fee_cents > 0 &&
                ` — رسم التقييم ${formatEgp(service.remote_assessment_fee_cents)}`}
              .
            </p>
          </div>
        )}
        {!remoteRouteAvailable && onsiteRouteAvailable && (
          <div className="mt-4 rounded-xl border border-border bg-surface-variant p-3">
            <p className="font-medium">معاينة في الموقع</p>
            <p className="mt-1 text-sm text-muted">
              فني بيجي يشوف الشغل ويبعتلك السعر — رسم المعاينة {formatEgp(resolvedInspectionFeeCents)}
            </p>
          </div>
        )}
      </section>
      )}

      {step === 3 && !effectiveRequestRemoteQuote && (
        <section className="motion-rise mt-6">
          <h2 className="mb-2 font-semibold">كود خصم (اختياري)</h2>
          <input
            value={promoCode}
            onChange={(e) => setPromoCode(e.target.value)}
            maxLength={24}
            dir="ltr"
            className="w-full rounded-lg border border-border bg-surface px-4 py-2 outline-none focus:border-primary"
          />
          {readPendingPromoLink()?.shouldPrefillDiscount && readPendingPromoLink()?.code === promoCode.trim().toUpperCase() && (
            <p className="mt-2 text-sm text-muted">اتملى الكود من رابط المشاركة. هنتحقق من صلاحيته قبل تأكيد الطلب.</p>
          )}
        </section>
      )}

      {/* مسار الصور برسم: مفيش اختيار طريقة دفع أصلاً — الكاش ممنوع (مفيش فني رايح يستلمه)
          والدفع بيتم دلوقتي على الرسم بس. القسم بيشرح ده بدل ما العميل يوصل للتأكيد ويترفض. */}
      {step === 3 && remoteAssessmentFeeDueCents > 0 && (
        <section className="motion-rise mt-6 rounded-xl border border-border bg-surface p-4">
          <h2 className="mb-2 font-semibold">رسم التقييم</h2>
          <p className="text-sm text-muted">
            اللي هيتدفع دلوقتي هو رسم التقييم {formatEgp(remoteAssessmentFeeDueCents)} بس — سعر الشغل نفسه
            هيوصلك بعد ما الإدارة تشوف الصور، وموافقتك عليه شرط قبل أي دفع تاني. هتتحوّل لصفحة الدفع
            بالبطاقة بعد ما تأكّد الطلب.
          </p>
        </section>
      )}

      {/* **اختيار العربون ولا الطلب كامل** (طلب مالك 2026-09-11) — نفس اختيار التطبيق بالحرف.
          فيه ناس بتفضّل تخلص الدفع مرة واحدة، وفيه ناس بتفضّل تدفع الأقل دلوقتي والباقي كاش
          للصنايعي؛ الاتنين مسارين مشروعين فالقرار قرار العميل مش جملة خبرية مفروضة عليه. */}
      {step === 3 && depositChoiceVisible && priceBreakdown && (
        <section className="motion-rise mt-6 rounded-xl border border-border bg-surface p-4">
          <h2 className="mb-3 font-semibold">تحب تدفع كام دلوقتي؟</h2>
          <label className="flex items-start gap-3 text-sm">
            <input
              type="radio"
              checked={!payFullInsteadOfDeposit}
              onChange={() => setPayFullInsteadOfDeposit(false)}
              className="mt-1"
            />
            <span>
              <span className="font-medium">
                العربون دلوقتي — {formatEgp(priceBreakdown.deposit_amount_cents ?? 0)}
              </span>
              <span className="mt-0.5 block text-muted">
                والباقي ({formatEgp(priceBreakdown.remaining_amount_cents ?? 0)}) تدفعه كاش للصنايعي بعد الشغل
              </span>
            </span>
          </label>
          <label className="mt-3 flex items-start gap-3 text-sm">
            <input
              type="radio"
              checked={payFullInsteadOfDeposit}
              onChange={() => setPayFullInsteadOfDeposit(true)}
              className="mt-1"
            />
            <span>
              <span className="font-medium">
                الطلب كامل دلوقتي — {formatEgp(priceBreakdown.total_amount_cents)}
              </span>
              <span className="mt-0.5 block text-muted">
                تخلّص الدفع مرة واحدة ومش هيتبقى عليك حاجة بعد الشغل
              </span>
            </span>
          </label>
        </section>
      )}

      {/* الوسائل بتتعرض **بالترتيب اللي السيرفر رجّعه** (InstaPay فوق، الكاش تحتها) مع وسم
          الترشيح جاي من السيرفر كمان — عشان تغيير `payments.recommended_method` من لوحة الأدمن
          يوصل للويب والتطبيق من غير نشر جديد لأي واحد فيهم. */}
      {step === 3 && !effectiveRequestRemoteQuote && prepaymentOptions.length > 0 && (
        <section className="motion-rise mt-6">
          <h2 className="mb-2 font-semibold">طريقة الدفع</h2>
          <div className="flex flex-wrap gap-2">
            {prepaymentOptions.map((channel) => (
              <button
                key={channel.method}
                onClick={() => setPaymentChoice(channel.method as 'card' | 'instapay')}
                className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm ${effectivePaymentMethod === channel.method ? 'border-primary bg-primary/10 text-primary' : 'border-border'}`}
              >
                {PREPAYMENT_LABELS_AR[channel.method] ?? channel.method}
                {channel.is_recommended && channel.recommended_label_ar && (
                  <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-white">
                    {channel.recommended_label_ar}
                  </span>
                )}
              </button>
            ))}
            {/* «بعد الشغل» مش وسيلة في السجل — هو غياب دفع مسبق، فبيتعرض آخر واحد ومش بيترشّح.
                بيتحجب لو الخدمة أصلاً بتفرض دفع مقدّم (عربون أو كاش ممنوع)، لأن الباك-إند
                بيرفضه ساعتها وعرضه كان بيوصّل العميل لرسالة خطأ عند التأكيد. */}
            {cashAfterWorkAllowed && (
              <button
                onClick={() => setPaymentChoice('later')}
                className={`rounded-lg border px-4 py-2 text-sm ${effectivePaymentMethod === 'later' ? 'border-primary bg-primary/10 text-primary' : 'border-border'}`}
              >
                كاش / محفظة بعد الشغل
              </button>
            )}
          </div>
        </section>
      )}

      {/* شروط الدفع بعد الخدمة — لو الأدمن مفعّلها على الخدمة دي. مفيش صندوق فاضي لو
          مفيش سياسات، والباك-إند بيرفض أي طلب بيتخطى الموافقة حتى لو اتخطت الواجهة. */}
      {step === 3 && postpaidPolicies.length > 0 && (
        <section className="motion-rise mt-6 rounded-xl border border-border bg-surface p-4">
          <h2 className="mb-2 font-semibold">شروط الدفع</h2>
          {postpaidPolicies.map((policy) => {
            const checked = acceptedPolicyVersions.has(policy.currentVersionId);
            return (
              <label key={policy.policyId} className="mt-2 flex items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => {
                    const next = new Set(acceptedPolicyVersions);
                    if (e.target.checked) next.add(policy.currentVersionId);
                    else next.delete(policy.currentVersionId);
                    setAcceptedPolicyVersions(next);
                  }}
                  className="mt-1"
                />
                <span>
                  <span className="font-medium">{policy.titleAr}</span>
                  {policy.isRequired && <span className="text-danger"> *</span>}
                  <details className="mt-1">
                    <summary className="cursor-pointer text-muted">اقرأ الشروط</summary>
                    <p className="mt-1 whitespace-pre-line rounded bg-surface-variant p-3 text-xs">{policy.bodyAr}</p>
                  </details>
                </span>
              </label>
            );
          })}
        </section>
      )}

      {/* ── ملخص السعر ────────────────────────────────────────────────────────────────────
          **إعادة بناء 2026-09-11 لمطابقة `create_order_screen.dart` بالحرف** (بلاغ المالك:
          «فلو التسعير مختلف»). فرقين جوهريين اتقفلوا:

          ١. **الملخص بقى في الخطوة التالتة بس.** الأندرويد مابيعرضش أي سعر قبل ما المنفّذ
             يتقفل — `JobDetailsScreen` بتقول صراحةً «دخّل تفاصيل الشغل عشان نقدر نعرضلك السعر
             النهائي الحقيقي لكل فني في القايمة»، وشاشة اختيار الفني مافيهاش أي رقم. الويب كان
             بيعرض «السعر المتوقع» من الخطوة الأولى، وبعدين الرقم يتغيّر بعد اختيار الفني —
             وده اللي خلّى المالك يحس إن فيه تسعيرتين.

          ٢. **صندوق «قد يزيد الإجمالي حسب مستوى الفني» اتشال نهائيًا.** الأندرويد بيعرضه بشرط
             `requestedTechnicianId == null`، وفي مساره ده **مستحيل** يتحقق في حجز عادي:
             `TechnicianSelectionScreen._confirmSelection` بيمرّر `preview.provider.id` حتى في
             الوضع التلقائي. يعني العميل على الأندرويد مابيشوفش الجملة دي أصلاً، وعلى الويب
             كانت بتقعد قدامه طول الخطوتين الأولانيتين. مكانها الطبيعي بقى الرقم المقفول نفسه.

          الجدول تحت بنفس ترتيب `_buildPriceBreakdown` بالحرف: أساسي ← نطاق ← فحص ← إضافات ←
          خصم ← ضمان ← مدة ← فاصل ← إجمالي ← إيداع/باقي. */}
      {step === 3 && (
        <section className="mt-8 rounded-2xl border border-border bg-surface p-4">
          {effectiveRequestRemoteQuote ? (
            <>
              {remoteAssessmentFeeDueCents > 0 && (
                <PriceRow label="رسم التقييم (يتدفع دلوقتي)" value={formatEgp(remoteAssessmentFeeDueCents)} />
              )}
              <p className="mt-1.5 text-sm leading-6 text-muted">
                {remoteAssessmentFeeDueCents > 0
                  ? 'سعر الشغل نفسه هيوصلك بعد ما الإدارة تشوف الصور — وموافقتك عليه شرط قبل أي دفع تاني.'
                  : 'مفيش أي مبلغ بيتدفع دلوقتي. الإدارة هتشوف الصور وتبعتلك السعر، وإنت توافق أو ترفض.'}
              </p>
            </>
          ) : showsDynamicForm && !pricingFieldsValid ? (
            <p className="text-sm text-muted">كمّل بيانات السعر فوق عشان نحسبلك السعر</p>
          ) : (estimating || orderPreviewLoading) && !priceBreakdown ? (
            <p className="text-sm text-muted">بيتحسب السعر...</p>
          ) : !priceBreakdown ? (
            <p className="text-sm text-muted">كمّل بيانات الحجز عشان نعرضلك السعر</p>
          ) : (
            <>
              <PriceRow label="السعر الأساسي" value={formatEgp(priceBreakdown.base_price_cents)} />
              {/* بند 10/29 — النطاق من **حقول العرض** مش من min/max_price_cents: دول حدود قصّ
                  للمحرك، وعرضهم كنطاق للعميل ممنوع بالنص. وللخدمات «نطاق تقديري» بس. */}
              {priceBreakdown.price_certainty_mode === 'estimated_range' &&
                priceBreakdown.display_price_min_cents !== null &&
                priceBreakdown.display_price_max_cents !== null && (
                  <p className="mt-0.5 text-xs text-muted">
                    نطاق تقديري: {formatEgp(priceBreakdown.display_price_min_cents)} –{' '}
                    {formatEgp(priceBreakdown.display_price_max_cents)}
                  </p>
                )}
              {priceBreakdown.inspection_fee_cents > 0 && (
                <PriceRow label="رسوم الفحص" value={formatEgp(priceBreakdown.inspection_fee_cents)} />
              )}
              {/* رسوم الطوارئ **مابتتعرضش كبند مستقل للعميل** — بتفضل في الإجمالي واللقطة
                  المالية وشاشة الأدمن زي ما هي. نفس القاعدة بالحرف في التطبيق. */}
              {priceBreakdown.addons_total_cents > 0 && (
                <PriceRow label="الإضافات" value={`+${formatEgp(priceBreakdown.addons_total_cents)}`} />
              )}
              {priceBreakdown.discount_cents > 0 && (
                <PriceRow
                  label={`الخصم${priceBreakdown.discount_source === 'building' ? ' (العمارة)' : priceBreakdown.discount_source === 'promo_code' ? ' (كود الخصم)' : ''}`}
                  value={`-${formatEgp(priceBreakdown.discount_cents)}`}
                  tone="success"
                />
              )}
              {priceBreakdown.warranty_price_cents > 0 && (
                <PriceRow
                  label="الضمان الاختياري"
                  value={`+${formatEgp(priceBreakdown.warranty_price_cents)}`}
                  tone="info"
                />
              )}
              {service.pricing_model === 'inspection_then_quote' && (
                <p className="mt-0.5 text-xs text-muted">
                  السعر النهائي بعد ما الفني يشوف الشغل
                </p>
              )}
              {formatWorkDuration(priceBreakdown.duration_minutes, priceBreakdown.estimated_duration_days) !== null && (
                <p className="mt-0.5 text-xs text-muted">
                  المدة المتوقعة:{' '}
                  {formatWorkDuration(priceBreakdown.duration_minutes, priceBreakdown.estimated_duration_days)}
                </p>
              )}

              <div className="my-3 border-t border-border" />

              <div className="flex items-center justify-between">
                <span className="font-semibold">الإجمالي</span>
                {/* بيومض عند كل تغيّر — العميل يعرف إن اختياره أثّر في السعر من غير ما يدوّر (§122). */}
                <LiveAmount
                  className="text-xl font-bold text-primary"
                  value={formatEgp(priceBreakdown.total_amount_cents)}
                />
              </div>

              {priceBreakdown.deposit_amount_cents !== null && (
                <div className="mt-2">
                  <PriceRow
                    label="المطلوب دلوقتي (إيداع)"
                    value={formatEgp(priceBreakdown.deposit_amount_cents)}
                    bold
                    tone="primary"
                  />
                  <PriceRow
                    label="الباقي بعد ما الشغل يخلص"
                    value={formatEgp(priceBreakdown.remaining_amount_cents ?? 0)}
                  />
                </div>
              )}

              {(estimating || orderPreviewLoading) && <p className="mt-1 text-xs text-muted">بيتحدّث...</p>}
            </>
          )}
        </section>
      )}

      {error && <p className="mt-4 text-sm text-danger">{error}</p>}

      {/* بند 6 — التنقل بين الخطوات. زرار «التالي» مايعديش خطوة ناقصة، وزرار التأكيد مش
          موجود أصلاً غير في الخطوة التالتة: العميل مايقدرش يأكد قبل ما يشوف الفني وسعره. */}
      <div className="mt-6 flex gap-3">
        {step > 1 && (
          <button
            onClick={() => setStep((step - 1) as 1 | 2 | 3)}
            className="rounded-lg border border-border px-5 py-3 font-medium"
          >
            رجوع
          </button>
        )}
        {step < 3 ? (
          <button
            onClick={() => setStep((step + 1) as 1 | 2 | 3)}
            disabled={step === 1 ? !stepOneComplete : !stepTwoComplete}
            className="flex-1 rounded-lg bg-primary py-3 font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            التالي
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="flex-1 rounded-lg bg-primary py-3 font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? 'جاري تأكيد الحجز...' : submitted ? 'تم التأكيد' : 'أكّد الحجز'}
          </button>
        )}
      </div>
      {step === 1 && !stepOneComplete && (
        <p className="mt-2 text-sm text-muted">كمّل تفاصيل الشغل والموعد عشان تعدّي للخطوة الجاية.</p>
      )}
      {step === 2 && !stepTwoComplete && (
        <p className="mt-2 text-sm text-muted">اختار عنوان ووافق على الشروط المطلوبة عشان تعدّي.</p>
      )}
    </div>
  );
}

/**
 * سطر واحد في تفكيك السعر — نظير `_buildPriceLine` في `create_order_screen.dart` بالحرف.
 *
 * موجود كمكوّن مستقل عشان كل السطور تاخد **نفس** المسافة والوزن والمحاذاة تلقائيًا. لما كانت
 * السطور مكتوبة كـ`<p>` منفصلة، كل واحد كان بياخد `mt-1`/`text-sm` بالإيد — والنتيجة سطور
 * الفلوس مش على نفس الشبكة البصرية، وده أول حاجة بتخلي ملخص سعر يبان «مش مظبوط».
 */
function PriceRow({
  label,
  value,
  bold,
  tone,
}: {
  label: string;
  value: string;
  bold?: boolean;
  tone?: 'success' | 'info' | 'primary';
}) {
  const toneClass =
    tone === 'success' ? 'text-success' : tone === 'info' ? 'text-info' : tone === 'primary' ? 'text-primary' : '';
  return (
    <div className={`flex items-baseline justify-between gap-4 py-1 text-sm ${bold ? 'font-semibold' : ''}`}>
      <span className={tone === 'primary' ? 'text-primary' : 'text-muted'}>{label}</span>
      <span className={`tabular-nums ${toneClass}`} dir="ltr">
        {value}
      </span>
    </div>
  );
}

function DynamicPricingField({
  field,
  value,
  onChange,
  onUpload,
}: {
  field: PricingFieldDto;
  value: string | number | boolean | undefined;
  onChange: (value: string | number | boolean) => void;
  onUpload: (file: File) => Promise<{ id: string; file_url: string }>;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const label = `${field.label_ar}${field.is_required ? ' *' : ''}${field.unit_ar ? ` (${field.unit_ar})` : ''}`;

  if (field.field_type === 'image_upload') {
    const ids = typeof value === 'string' ? value.split(',').filter(Boolean) : [];
    const minimum = field.min_files ?? (field.is_required ? 1 : 0);
    const maximum = field.max_files ?? 5;
    return (
      <div className="rounded-xl border border-border bg-surface p-4">
        <p className="font-medium">{label}</p>
        <p className={`mt-1 text-sm ${ids.length >= minimum ? 'text-muted' : 'text-danger'}`}>
          {minimum > 0 ? `ارفع من ${minimum} إلى ${maximum} صور` : `حتى ${maximum} صور`} ({ids.length}/{maximum})
        </p>
        {ids.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {ids.map((id, index) => (
              <div key={id} className="relative h-20 w-20 overflow-hidden rounded-xl bg-surface-variant">
                {previews[id] ? (
                  // eslint-disable-next-line @next/next/no-img-element -- معاينة محلية قبل إنشاء الطلب
                  <img src={previews[id]} alt={`صورة ${index + 1}`} className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full items-center justify-center text-xs text-muted">صورة {index + 1}</span>
                )}
                <button
                  type="button"
                  aria-label="حذف الصورة"
                  onClick={() => onChange(ids.filter((candidate) => candidate !== id).join(','))}
                  className="absolute end-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-black/70 text-sm text-white"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <label className={`mt-3 inline-flex cursor-pointer items-center rounded-lg border px-4 py-2 text-sm ${uploading || ids.length >= maximum ? 'pointer-events-none opacity-50' : 'hover:border-primary'}`}>
          {uploading ? 'جاري رفع الصور...' : 'اختار صور'}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="sr-only"
            disabled={uploading || ids.length >= maximum}
            onChange={async (event) => {
              const files = Array.from(event.target.files ?? []).slice(0, maximum - ids.length);
              if (files.length === 0) return;
              setUploading(true);
              setUploadError(null);
              const nextIds = [...ids];
              try {
                for (const file of files) {
                  const uploaded = await onUpload(file);
                  nextIds.push(uploaded.id);
                  setPreviews((current) => ({ ...current, [uploaded.id]: URL.createObjectURL(file) }));
                  onChange(nextIds.join(','));
                }
              } catch (error) {
                setUploadError(error instanceof Error ? error.message : 'رفع الصورة فشل، حاول مرة ثانية');
              } finally {
                setUploading(false);
                event.target.value = '';
              }
            }}
          />
        </label>
        {uploadError && <p className="mt-2 text-sm text-danger">{uploadError}</p>}
      </div>
    );
  }

  if (field.field_type === 'dropdown' && field.options) {
    return (
      <label className="block">
        <span className="mb-1 block text-sm text-muted">{label}</span>
        <select
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg border border-border bg-surface px-4 py-2 outline-none focus:border-primary"
        >
          <option value="" disabled>
            اختر...
          </option>
          {field.options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label_ar}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (field.field_type === 'checkbox') {
    return (
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
        <span>{label}</span>
      </label>
    );
  }

  // number/area/length/volume/slider — كلهم مدخل رقمي بوحدة مختلفة، date/time نصيّة بسيطة.
  if (field.field_type === 'date' || field.field_type === 'time') {
    return (
      <label className="block">
        <span className="mb-1 block text-sm text-muted">{label}</span>
        <input
          type={field.field_type}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg border border-border bg-surface px-4 py-2 outline-none focus:border-primary"
        />
      </label>
    );
  }

  return (
    <label className="block">
      <span className="mb-1 block text-sm text-muted">{label}</span>
      <input
        type="number"
        value={(value as number) ?? ''}
        min={field.min_value ?? undefined}
        max={field.max_value ?? undefined}
        onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        className="w-full rounded-lg border border-border bg-surface px-4 py-2 outline-none focus:border-primary"
      />
    </label>
  );
}

function NewAddressForm({
  authedFetch,
  onCreated,
}: {
  authedFetch: <T>(path: string, options?: RequestInit) => Promise<T>;
  onCreated: (addr: AddressDto) => void;
}) {
  const [cities, setCities] = useState<CityDto[] | null>(null);
  const [areas, setAreas] = useState<AreaDto[] | null>(null);
  const [cityId, setCityId] = useState('');
  const [areaId, setAreaId] = useState('');
  const [streetName, setStreetName] = useState('');
  const [buildingNumber, setBuildingNumber] = useState('');
  const [floorNumber, setFloorNumber] = useState('');
  const [apartmentNumber, setApartmentNumber] = useState('');
  const [landmark, setLandmark] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCities().then(setCities)
      // فشل التحميل كان بيضيع كـunhandled rejection: القسم يفضل فاضي
      // والمستخدم مش عارف ليه (docs/08 §133).
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'تعذّر تحميل البيانات'));
  }, []);

  useEffect(() => {
    if (cityId) {
      fetchAreas(cityId).then(setAreas)
        // فشل التحميل كان بيضيع كـunhandled rejection: القسم يفضل فاضي
        // والمستخدم مش عارف ليه (docs/08 §133).
        .catch((err: unknown) => setError(err instanceof Error ? err.message : 'تعذّر تحميل البيانات'));
    } else {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAreas(null);
    }
    setAreaId('');
  }, [cityId]);

  const canSubmit = cityId && areaId && streetName.trim().length >= 2 && latitude && longitude;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const addr = await createAddress(authedFetch, {
        city_id: cityId,
        area_id: areaId,
        street_name: streetName,
        building_number: buildingNumber || undefined,
        floor_number: floorNumber || undefined,
        apartment_number: apartmentNumber || undefined,
        landmark: landmark || undefined,
        latitude: Number(latitude),
        longitude: Number(longitude),
      });
      onCreated(addr);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-border p-4">
      <div className="grid grid-cols-2 gap-3">
        <select value={cityId} onChange={(e) => setCityId(e.target.value)} className="rounded-lg border border-border bg-surface px-3 py-2">
          <option value="">المدينة</option>
          {cities?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name_ar}
            </option>
          ))}
        </select>
        <select value={areaId} onChange={(e) => setAreaId(e.target.value)} disabled={!areas} className="rounded-lg border border-border bg-surface px-3 py-2">
          <option value="">المنطقة</option>
          {areas?.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name_ar}
            </option>
          ))}
        </select>
      </div>
      <input
        value={streetName}
        onChange={(e) => setStreetName(e.target.value)}
        placeholder="اسم الشارع"
        className="w-full rounded-lg border border-border bg-surface px-3 py-2"
      />
      <div className="grid grid-cols-3 gap-3">
        <input value={buildingNumber} onChange={(e) => setBuildingNumber(e.target.value)} placeholder="رقم العمارة" className="rounded-lg border border-border bg-surface px-3 py-2" />
        <input value={floorNumber} onChange={(e) => setFloorNumber(e.target.value)} placeholder="الدور" className="rounded-lg border border-border bg-surface px-3 py-2" />
        <input value={apartmentNumber} onChange={(e) => setApartmentNumber(e.target.value)} placeholder="الشقة" className="rounded-lg border border-border bg-surface px-3 py-2" />
      </div>
      <input value={landmark} onChange={(e) => setLandmark(e.target.value)} placeholder="علامة مميزة (اختياري)" className="w-full rounded-lg border border-border bg-surface px-3 py-2" />
      <MapPicker
        latitude={latitude ? Number(latitude) : null}
        longitude={longitude ? Number(longitude) : null}
        onChange={(lat, lng) => {
          setLatitude(String(lat));
          setLongitude(String(lng));
        }}
      />
      {error && <p className="text-sm text-danger">{error}</p>}
      <button type="submit" disabled={!canSubmit || busy} className="w-full rounded-lg bg-primary py-2 font-medium text-primary-foreground disabled:opacity-50">
        {busy ? 'جاري الحفظ...' : 'حفظ العنوان'}
      </button>
    </form>
  );
}

// بادج توثيق صغيرة (docs/08 §83 جزء ج) — مطابقة TrustBadge في apps/customer-app بصريًا.
function TrustBadge() {
  return (
    <span className="inline-flex items-center gap-0.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary" title="فني موثّق">
      ✓
    </span>
  );
}

// شارة إحصائية صغيرة داخل كارت الشركة — مطابقة _CompanyTag في technician_marketplace_screen.dart.
function CompanyTag({ label, emphasized }: { label: string; emphasized?: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-1 text-xs ${
        emphasized ? 'bg-primary font-semibold text-primary-foreground' : 'bg-surface-variant text-muted'
      }`}
    >
      {label}
    </span>
  );
}

// كارت فني فردي في "اختار بنفسك" (docs/08 §83 جزء ج) — توازي مع _buildCard في
// technician_marketplace_screen.dart: صورة/fallback، بادج توثيق، شارة مستوى، تحذير تعارض جدولة.
function IndividualCard({
  t,
  selected,
  onSelect,
}: {
  t: TechnicianBookingListItemDto;
  selected: boolean;
  onSelect: () => void;
}) {
  const conflicted = t.availability_status === 'schedule_conflicted';
  return (
    <label
      className={`motion-rise motion-press flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors ${
        selected ? 'border-primary bg-primary/5' : 'border-border'
      } ${conflicted ? 'opacity-70' : ''}`}
    >
      <input type="radio" name="technician" checked={selected} onChange={onSelect} className="mt-1.5" />
      {t.avatar_url ? (
        // eslint-disable-next-line @next/next/no-img-element -- صور فنيين خارجية من التخزين، مش أصول ثابتة معروفة وقت الـbuild
        <img
          src={t.avatar_url}
          alt=""
          width={48}
          height={48}
          loading="lazy"
          decoding="async"
          className="h-12 w-12 shrink-0 rounded-full bg-surface-variant object-cover"
        />
      ) : (
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-surface-variant text-lg">👤</div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="font-medium">{t.full_name}</p>
          {t.is_verified && <TrustBadge />}
          <span className="rounded-full bg-surface-variant px-2 py-0.5 text-xs">
            {TECHNICIAN_LEVEL_LABELS_AR[t.technician_level] ?? t.technician_level}
          </span>
        </div>
        {conflicted && (
          <>
            <p className="mt-1 text-xs text-danger">
              مش متاح للفترة دي{t.unavailable_reason_ar ? ` — ${t.unavailable_reason_ar}` : ''}
            </p>
            {/* ADR-0059 §6 — الاقتراح بقى تاريخ حقيقي (أقرب يوم فاضي فعلاً بتقويم القاهرة).
                الكارت هنا مكانش بيعرضه خالص رغم إن الـAPI بترجّعه من زمان — تطبيق العميل بس
                هو اللي كان بيستخدمه. */}
            <p className="mt-0.5 text-xs text-muted">
              {t.available_again_at
                ? `الفني متاح من ${new Date(t.available_again_at).toLocaleDateString('ar-EG', { day: 'numeric', month: 'numeric' })}`
                : 'الفني ده مش متاح خلال الشهر الجاي'}
            </p>
          </>
        )}
        <p className="mt-1 text-sm text-muted">
          {t.total_ratings_count > 0 ? `⭐ ${t.average_rating.toFixed(1)} (${t.total_ratings_count})` : 'فني جديد'}
          {t.distance_km !== null ? ` · ${t.distance_km} كم` : ''}
        </p>
        {t.on_time_rate !== null && <p className="text-xs text-muted">الالتزام بالمواعيد: {t.on_time_rate}%</p>}
      </div>
      {t.final_price_cents !== null && (
        <span className="shrink-0 font-semibold text-primary">{formatEgp(t.final_price_cents)}</span>
      )}
    </label>
  );
}

// كارت شركة/فريق (docs/08 §83 جزء ج، ADR-0031) — توازي مع _buildCompanyCard: شريط علوي ملوّن،
// بادجات إحصائية، "يتقرا كشركة من نظرة" (طلب مالك أصلي، docs/08 §62.2) — مش نسخة باهتة من الفردي.
function CompanyCard({
  t,
  selected,
  onSelect,
}: {
  t: TechnicianBookingListItemDto;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <label
      className={`motion-rise motion-press block cursor-pointer overflow-hidden rounded-xl border-2 transition-colors ${
        selected ? 'border-primary' : 'border-primary/40'
      }`}
    >
      <input type="radio" name="technician" checked={selected} onChange={onSelect} className="sr-only" />
      <div className="flex items-center gap-2 bg-primary/10 px-3 py-2">
        <span aria-hidden>🏢</span>
        <span className="flex-1 font-bold">{t.full_name}</span>
        {t.is_verified && <TrustBadge />}
      </div>
      <div className="p-3">
        <div className="flex flex-wrap gap-1.5">
          <CompanyTag label={t.is_commercial_company ? 'شركة مسجّلة' : 'فريق عمل'} emphasized />
          <CompanyTag label={`${t.staff_count ?? 0} فني`} />
          {(t.branch_count ?? 0) > 0 && <CompanyTag label={`${t.branch_count} فرع`} />}
          {t.completed_orders_count > 0 && <CompanyTag label={`${t.completed_orders_count} طلب مكتمل`} />}
          {t.total_ratings_count > 0 && <CompanyTag label={`⭐ ${t.average_rating.toFixed(1)} (${t.total_ratings_count})`} />}
          {t.distance_km !== null && <CompanyTag label={`${t.distance_km} كم`} />}
        </div>
        <p className="mt-2 text-xs text-muted">فريق كامل بيقدر يغطّي الشغل الكبير، ومسؤولية الشغل على الشركة نفسها.</p>
        {t.final_price_cents !== null && (
          <p className="mt-2 text-lg font-bold text-primary">{formatEgp(t.final_price_cents)}</p>
        )}
      </div>
    </label>
  );
}

/**
 * «الخميس ١٧ سبتمبر» من YYYY-MM-DD — بلا مكتبة تواريخ.
 *
 * الـstring بيتقسم بالإيد مش بـ`new Date(day)`: الأخيرة بتقرا التاريخ المجرّد كـUTC، فبتطلع
 * اليوم اللي قبله لأي متصفح شرق جرينتش — وده بالظبط نفس فئة البَقّة اللي ADR-0059 §6 اتكتب
 * عشانها في الباك-إند.
 */
function formatSuggestedDay(day: string): string {
  const [year, month, dayOfMonth] = day.split('-').map(Number);
  const date = new Date(year, month - 1, dayOfMonth);
  return date.toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' });
}
