'use client';

import { use, useEffect, useState } from 'react';
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
  formatEgp,
  uploadPricingFieldImage,
  uploadProblemImage,
  type BookingMatchPreviewDto,
} from '@/lib/orders';
import { fetchApplicablePolicies } from '@/lib/installments';
import type { ApplicablePaymentPolicyDto } from '@baytak/shared-types';
import { fetchTechniciansForService, TechnicianBookingListItemDto, TECHNICIAN_LEVEL_LABELS_AR } from '@/lib/technicians';
import { ApiError } from '@/lib/api-client';
import { MapPicker } from '@/components/map-picker';

type BookingMode = 'individual' | 'team' | 'emergency';
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

  // اختيار الفني قبل الحجز (Script 3 §32-35) — "خلي أسطى يختار" افتراضي/أساسي، "اختار بنفسك"
  // ثانوي، وبيظهر بس لو الخدمة فعلاً بتسمح بأكتر من فني (نفس منطق showBookingModeSelector في
  // apps/customer-app's catalog_navigation.dart — مفيش داعي نعرض اختيار لخدمة مفيهاش بدائل).
  const [technicianChoiceMode, setTechnicianChoiceMode] = useState<'auto' | 'manual'>('auto');
  const [technicians, setTechnicians] = useState<TechnicianBookingListItemDto[] | null>(null);
  const [selectedTechnicianId, setSelectedTechnicianId] = useState<string | null>(null);

  // إعادة ترتيب اختيار الميعاد (docs/08 §83 جزء ب، طلب مالك) — يوم (محدد/مرن) قبل تفاصيل السعر
  // مباشرة، مطابق apps/customer-app's ScheduleSelectionScreen بالحرف. خيار "أقرب وقت ممكن" اتشال
  // نهائيًا هنا زي ما اتشال من الموبايل قبل كده (ADR-0018 §2، بَقّة تعارض وهمي حقيقية) — التاريخ
  // بقى إجباري دايمًا لأي خدمة بتسمح بالجدولة.
  const [scheduleDayMode, setScheduleDayMode] = useState<'specific' | 'flexible'>('specific');
  const [scheduledDate, setScheduledDate] = useState('');
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

  const [paymentChannels, setPaymentChannels] = useState<PaymentChannel[] | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'later' | 'card'>('later');

  // بند 2-7 — الحجز بقى **تلات خطوات بالظبط**، مفيش صفحة مراجعة رابعة:
  //   1. تفاصيل الشغل والموعد + السعر الحالي (قبل اختيار الفني)
  //   2. العنوان وإكمال الطلب (وصف/صور/تكرار/خصم/دفع/سياسات)
  //   3. اختيار الفني أو الترشيح التلقائي + التأكيد
  const [step, setStep] = useState<1 | 2 | 3>(1);
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

  useEffect(() => {
    // ADR-0050 §6 — الفورم الديناميكي مابقاش حكر على `formula`: خدمة «كشف ثم عرض سعر» بتنزل
    // بلا سعر ومحتاجة نفس «الفلتر» عشان الإدارة تقدر تسعّر (طلب مالك صريح).
    if (service?.pricing_model === 'formula' || service?.pricing_model === 'inspection_then_quote') {
      fetchPricingFields(id).then(setPricingFields);
    }
  }, [id, service]);

  useEffect(() => {
    if (isAuthenticated) {
      listAddresses(authedFetch).then((list) => {
        setAddresses(list);
        const def = list.find((a) => a.is_default) ?? list[0];
        if (def) setSelectedAddressId(def.id);
        else setShowNewAddressForm(true);
      });
      fetchPaymentChannels(authedFetch).then(setPaymentChannels);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

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

  useEffect(() => {
    if (technicianChoiceMode !== 'manual' || !selectedAddressId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTechnicians(null);
      return;
    }
    fetchTechniciansForService(id, selectedAddressId, {
      bookingMode,
      fieldValues: service?.pricing_model === 'formula' ? debouncedFieldValues : undefined,
    }).then(setTechnicians);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [technicianChoiceMode, selectedAddressId, id, bookingMode, debouncedFieldValues]);

  const totalCents =
    (technicianChoiceMode === 'manual' &&
      technicians?.find((t) => t.id === selectedTechnicianId)?.final_price_cents) ||
    estimate?.estimated_total_cents ||
    service?.base_price_cents ||
    null;

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
  async function requestMatchPreview(mode: 'auto' | 'manual', technicianId?: string) {
    if (!selectedAddressId) return;
    setPreviewLoading(true);
    setPreviewError(null);
    setMatchPreview(null);
    try {
      const preview = await createMatchPreview(authedFetch, {
        service_id: service!.id,
        address_id: selectedAddressId,
        selection_mode: mode,
        ...(technicianId ? { technician_id: technicianId } : {}),
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
    if (!requestRemoteQuote && technicianChoiceMode === 'manual' && !selectedTechnicianId) return;
    setError(null);
    setSubmitting(true);
    try {
      const order = await createOrder(
        authedFetch,
        {
          service_id: service.id,
          address_id: selectedAddressId,
          booking_mode: requestRemoteQuote ? 'individual' : bookingMode,
          requested_technician_id:
            !requestRemoteQuote && technicianChoiceMode === 'manual' ? (selectedTechnicianId ?? undefined) : undefined,
          problem_description: problemDescription || undefined,
          problem_image_ids: problemImages.map((image) => image.id),
          request_remote_quote: requestRemoteQuote || undefined,
          // التاريخ بيتبعت دايمًا دلوقتي (ADR-0048) — هو مدخل الاشتقاق نفسه في الباك-إند.
          scheduled_at: computeScheduledAt(scheduledDate),
          scheduled_at_range_end:
            scheduleDayMode === 'flexible' ? computeScheduledAt(scheduledDateRangeEnd) : undefined,
          repeat_frequency: requestRemoteQuote ? undefined : repeatFrequency,
          accepted_policy_version_ids: [...acceptedPolicyVersions],
          promo_code: requestRemoteQuote ? undefined : promoCode || undefined,
          field_values: showsDynamicForm ? fieldValues : undefined,
          payment_method: !requestRemoteQuote && paymentMethod === 'card' ? 'card' : undefined,
          // بند 12 — قفل السعر: التذكرة اللي العميل شاف عليها الفني والسعر هي نفسها اللي
          // الباك-إند بيعيد التحقق منها. لو المدخلات اتغيّرت أو الفني بقى مش متاح، الإنشاء
          // بيترفض بوضوح بدل ما يستبدل حد في صمت.
          match_preview_id: activePreview?.match_preview_id,
        },
        orderIdempotencyKey,
      );
      setSubmitted(true);
      if (!requestRemoteQuote && paymentMethod === 'card') {
        const cardResult = await payWithCard(authedFetch, order.id);
        window.location.href = cardResult.redirect_url;
        return;
      }
      router.push(`/orders/${order.id}`);
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
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <p className="mb-4 text-lg">لازم تسجّل دخول الأول عشان تكمّل الحجز</p>
        <button
          onClick={() => router.push(`/login?next=/services/${id}`)}
          className="rounded-lg bg-primary px-6 py-3 font-medium text-primary-foreground hover:opacity-90"
        >
          تسجيل الدخول
        </button>
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
  const remoteQuoteValid = !requestRemoteQuote || (problemImages.length > 0 && !isSameDayBooking);
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
    requestRemoteQuote,
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
  const stepTwoComplete = stepOneComplete && !!selectedAddressId && allRequiredAccepted && remoteQuoteValid;

  const canSubmit =
    !!selectedAddressId &&
    (!needsSchedule ||
      (scheduleDayMode === 'specific' ? !!scheduledDate : !!scheduledDate && !!scheduledDateRangeEnd)) &&
    (!needsPreciseTime || !!preciseTime) &&
    pricingFieldsValid &&
    priceReady &&
    remoteQuoteValid &&
    // بند 9 — في الوضع التلقائي التأكيد **محتاج معاينة فعلية**: العميل لازم يكون شاف الفني
    // وسعره قبل ما يأكد. من غير الشرط ده الوضع التلقائي بيرجع «أكّد وإحنا هندوّر بعدين».
    (requestRemoteQuote ||
      (technicianChoiceMode === 'auto' ? !!activePreview : !!selectedTechnicianId)) &&
    allRequiredAccepted &&
    !submitting &&
    !submitted;

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      {service.icon_url && (
        // eslint-disable-next-line @next/next/no-img-element -- صور خدمات خارجية من التخزين، مش أصول ثابتة معروفة وقت الـbuild
        <img src={service.icon_url} alt="" className="mb-4 aspect-[3/1] w-full rounded-xl object-cover" />
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
          { n: 2 as const, label: 'العنوان والتفاصيل' },
          { n: 3 as const, label: 'الفني والتأكيد' },
        ].map((s) => (
          <li key={s.n} className="flex flex-1 items-center gap-2">
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                step === s.n
                  ? 'bg-primary text-primary-foreground'
                  : step > s.n
                    ? 'bg-primary/15 text-primary'
                    : 'bg-surface-variant text-muted'
              }`}
            >
              {step > s.n ? '✓' : s.n}
            </span>
            <span className={`truncate ${step === s.n ? 'font-medium text-foreground' : 'text-muted'}`}>
              {s.label}
            </span>
          </li>
        ))}
      </ol>

      {/* قسم "نوع الحجز" اتشال بالكامل (ADR-0048) — «نشيل دول خالص ونحط قواعد على السيستم،
          والسيستم هو اللي بيحدد بناءً على التاريخ». اللي محلّه: التنبيه الأحمر تحت لما العميل
          يختار النهارده. */}

      {step === 1 && needsSchedule && (
        <section className="mt-6">
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
            <input
              type="date"
              value={scheduledDate}
              onChange={(e) => {
                setScheduledDate(e.target.value);
                if (e.target.value <= new Date().toLocaleDateString('en-CA')) setRequestRemoteQuote(false);
              }}
              className="mt-3 rounded-lg border border-border bg-surface px-4 py-2"
            />
          ) : (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                type="date"
                value={scheduledDate}
                onChange={(e) => {
                  setScheduledDate(e.target.value);
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

          {/* **التنبيه الأحمر (ADR-0048، طلب مالك صريح)**: «لو اختار الموعد ده النهاردة، السيستم
              يبعتله رسالة بالأحمر إن طالما اخترت النهاردة فمعناها كأنك طوارئ عشان يجيلك الشخص
              بسرعة، وبتتحسب عليه رسوم الطوارئ». إخطار مش سؤال — العميل مابيختارش وضع حجز. */}
          {isSameDayBooking && (
            <p className="mt-3 rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
              طالما اخترت النهارده، الطلب بيتعامل كخدمة مستعجلة عشان الفني يوصلك بسرعة — وبيتحسب
              عليه رسوم استعجال فوق سعر الخدمة. لو مش مستعجل، اختار بكرة أو أي يوم بعده والسعر
              يفضل عادي.
            </p>
          )}

          {needsPreciseTime && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
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
        <section className="mt-6">
          <h2 className="mb-3 font-semibold">تفاصيل الشغل</h2>
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
      <section className="mt-6">
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
                  setShowNewAddressForm(false);
                }}
              />
            )}
          </div>
        )}
      </section>
      )}

      {step === 3 && selectedAddressId && !requestRemoteQuote && (
        <section className="mt-6">
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
            <div className="mt-3 space-y-2">
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
                      onSelect={() => setSelectedTechnicianId(t.id)}
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
      {step === 2 && !requestRemoteQuote && service.allows_recurring_booking && needsSchedule && scheduleDayMode === 'specific' && scheduledDate && (
        <section className="mt-6">
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

      {step === 2 && (
      <section className="mt-6">
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

      {step === 2 && (
      <section className="mt-6 rounded-xl border border-border bg-surface p-4">
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

        {service.pricing_model === 'inspection_then_quote' && (
          <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 p-3">
            <input
              type="checkbox"
              checked={requestRemoteQuote}
              disabled={problemImages.length === 0 || isSameDayBooking}
              onChange={(event) => setRequestRemoteQuote(event.target.checked)}
              className="mt-1"
            />
            <span>
              <span className="block font-medium text-primary">خلّي الإدارة تحدد السعر من الصور</span>
              <span className="mt-1 block text-sm text-muted">
                الإدارة هتبعت السعر، وإنت تقبله أو ترفضه قبل ما الطلب يروح لأي فني.
              </span>
              {problemImages.length === 0 && (
                <span className="mt-1 block text-xs text-danger">ارفع صورة واحدة على الأقل لتفعيل الاختيار.</span>
              )}
              {isSameDayBooking && (
                <span className="mt-1 block text-xs text-danger">التسعير بالصور مش متاح لطلب نفس اليوم.</span>
              )}
            </span>
          </label>
        )}
      </section>
      )}

      {step === 2 && !requestRemoteQuote && (
        <section className="mt-6">
          <h2 className="mb-2 font-semibold">كود خصم (اختياري)</h2>
          <input
            value={promoCode}
            onChange={(e) => setPromoCode(e.target.value)}
            maxLength={24}
            dir="ltr"
            className="w-full rounded-lg border border-border bg-surface px-4 py-2 outline-none focus:border-primary"
          />
        </section>
      )}

      {step === 2 && !requestRemoteQuote && paymentChannels && paymentChannels.some((c) => c.method === 'card' && c.is_available) && (
        <section className="mt-6">
          <h2 className="mb-2 font-semibold">طريقة الدفع</h2>
          <div className="flex gap-2">
            <button
              onClick={() => setPaymentMethod('later')}
              className={`rounded-lg border px-4 py-2 text-sm ${paymentMethod === 'later' ? 'border-primary bg-primary/10 text-primary' : 'border-border'}`}
            >
              كاش / محفظة بعد الشغل
            </button>
            <button
              onClick={() => setPaymentMethod('card')}
              className={`rounded-lg border px-4 py-2 text-sm ${paymentMethod === 'card' ? 'border-primary bg-primary/10 text-primary' : 'border-border'}`}
            >
              بطاقة الآن
            </button>
          </div>
        </section>
      )}

      {/* شروط الدفع بعد الخدمة — لو الأدمن مفعّلها على الخدمة دي. مفيش صندوق فاضي لو
          مفيش سياسات، والباك-إند بيرفض أي طلب بيتخطى الموافقة حتى لو اتخطت الواجهة. */}
      {step === 2 && postpaidPolicies.length > 0 && (
        <section className="mt-6 rounded-xl border border-border bg-surface p-4">
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

      <section className="mt-8 rounded-xl border border-border bg-surface p-4">
        <div className="flex items-center justify-between">
          <span className="text-muted">{requestRemoteQuote ? 'السعر' : 'السعر المتوقع'}</span>
          <span className="text-xl font-bold text-primary">
            {requestRemoteQuote
              ? 'الإدارة هتحدده من الصور'
              : activePreview
                ? // السعر المقفول مع الفني اللي اتعرض — نفس الرقم اللي هيتسجّل على الطلب.
                  formatEgp(activePreview.pricing.total_amount_cents)
                : estimating
                  ? '...'
                  : totalCents !== null
                    ? formatEgp(totalCents)
                    : 'يتحدد بعد المعاينة'}
          </span>
        </div>
        {/* بند 10 — النطاق التقديري بنفس صياغة customer-app بالحرف (Web/Flutter parity).
            الأرقام من **حقول العرض** مش من min/max_price_cents: دول حدود قصّ للمحرك، وعرضهم
            كنطاق للعميل ممنوع بالنص في البند 29.
            لما تبقى في تذكرة مطابقة، السعر بقى مقفول برقم واحد فالنطاق مالوش لازمة. */}
        {!activePreview &&
          !requestRemoteQuote &&
          estimate?.price_certainty_mode === 'estimated_range' &&
          estimate.display_price_min_cents !== null &&
          estimate.display_price_max_cents !== null && (
            <p className="mt-1 text-sm text-muted">
              نطاق تقديري: {formatEgp(estimate.display_price_min_cents)} –{' '}
              {formatEgp(estimate.display_price_max_cents)}
            </p>
          )}
        {service.pricing_model === 'inspection_then_quote' && !requestRemoteQuote && (
          <p className="mt-1 text-sm text-muted">
            رسوم المعاينة {formatEgp(service.inspection_fee_cents)} — السعر النهائي بعد ما الفني يشوف الشغل
          </p>
        )}
        {technicianChoiceMode === 'auto' && !activePreview && service.pricing_model !== 'inspection_then_quote' && (
          <div className="mt-3 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2.5 text-sm leading-6 text-foreground">
            <p className="font-medium text-primary">السعر الحالي قبل اختيار الفني</p>
            <p className="text-muted">
              قد يزيد الإجمالي حسب مستوى الفني اللي ترشحه المطابقة، وساعتها فرق المستوى هيظهر لك كبند مستقل وواضح.
            </p>
          </div>
        )}
      </section>

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
    fetchCities().then(setCities);
  }, []);

  useEffect(() => {
    if (cityId) {
      fetchAreas(cityId).then(setAreas);
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
      className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${
        selected ? 'border-primary bg-primary/5' : 'border-border'
      } ${conflicted ? 'opacity-70' : ''}`}
    >
      <input type="radio" name="technician" checked={selected} onChange={onSelect} className="mt-1.5" />
      {t.avatar_url ? (
        // eslint-disable-next-line @next/next/no-img-element -- صور فنيين خارجية من التخزين، مش أصول ثابتة معروفة وقت الـbuild
        <img src={t.avatar_url} alt="" className="h-12 w-12 shrink-0 rounded-full object-cover" />
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
      className={`block cursor-pointer overflow-hidden rounded-xl border-2 ${
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
