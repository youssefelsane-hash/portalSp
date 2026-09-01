'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { fetchService, fetchPricingFields, estimatePrice } from '@/lib/catalog';
import { ServiceDto, PricingFieldDto, PriceEstimateDto } from '@/lib/api-types';
import { fetchCities, fetchAreas, CityDto, AreaDto } from '@/lib/geo-addresses';
import { listAddresses, createAddress, AddressDto } from '@/lib/addresses';
import { fetchPaymentChannels, payWithCard, PaymentChannelDto as PaymentChannel } from '@/lib/payments';
import { createOrder, formatEgp, uploadPricingFieldImage, uploadProblemImage } from '@/lib/orders';
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
  // دقة الوقت (ADR-0031 Slice B) — service.requires_precise_schedule/requires_start_time_only بس،
  // ومربوطة بنفس خطوة اليوم مباشرة (مش سؤال منفصل لاحقًا زي ما كان الحال في الموبايل قبل كده).
  const [preciseTime, setPreciseTime] = useState('');
  const [durationHours, setDurationHours] = useState('');
  const [pricingQuantity, setPricingQuantity] = useState('');
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
    if (service?.pricing_model === 'formula') {
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

  useEffect(() => {
    if (!service || service.pricing_model === 'formula') return;
    const quantityBased = service.pricing_model === 'per_unit' || service.pricing_model === 'monthly';
    const parsedQuantity = Number(pricingQuantity);
    if (quantityBased && (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0)) {
      setEstimate(null);
      return;
    }
    const parsedDuration = Number(durationHours);
    if (service.pricing_model === 'hourly' && (!Number.isFinite(parsedDuration) || parsedDuration <= 0)) {
      setEstimate(null);
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEstimating(true);
    estimatePrice(id, {
      bookingMode,
      pricingQuantity: quantityBased ? parsedQuantity : undefined,
      durationHours: service.pricing_model === 'hourly' ? parsedDuration : undefined,
    })
      .then(setEstimate)
      .catch(() => setEstimate(null))
      .finally(() => setEstimating(false));
  }, [id, service, bookingMode, pricingQuantity, durationHours]);

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
    if ((service?.requires_precise_schedule || service?.requires_start_time_only) && preciseTime) {
      return `${dateStr}T${preciseTime}:00.000Z`;
    }
    return `${dateStr}T00:00:00.000Z`;
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
          duration_hours: service.requires_precise_schedule && durationHours ? Number(durationHours) : undefined,
          pricing_quantity:
            service.pricing_model === 'per_unit' || service.pricing_model === 'monthly'
              ? Number(pricingQuantity)
              : undefined,
          repeat_frequency: requestRemoteQuote ? undefined : repeatFrequency,
          accepted_policy_version_ids: [...acceptedPolicyVersions],
          promo_code: requestRemoteQuote ? undefined : promoCode || undefined,
          field_values: service.pricing_model === 'formula' ? fieldValues : undefined,
          payment_method: !requestRemoteQuote && paymentMethod === 'card' ? 'card' : undefined,
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
  const isQuantityPricing = service.pricing_model === 'per_unit' || service.pricing_model === 'monthly';
  const quantityUnit = service.unit_name_ar || (service.pricing_model === 'monthly' ? 'الشهور' : 'الوحدات');
  const parsedPricingQuantity = Number(pricingQuantity);
  const quantityValid = !isQuantityPricing || (Number.isFinite(parsedPricingQuantity) && parsedPricingQuantity > 0);
  const pricingFieldsValid =
    service.pricing_model !== 'formula' ||
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
  const needsPreciseTime = needsSchedule && scheduleDayMode === 'specific' && (service.requires_precise_schedule || service.requires_start_time_only);
  const canSubmit =
    !!selectedAddressId &&
    (!needsSchedule ||
      (scheduleDayMode === 'specific' ? !!scheduledDate : !!scheduledDate && !!scheduledDateRangeEnd)) &&
    (!needsPreciseTime || !!preciseTime) &&
    (!needsPreciseTime || !service.requires_precise_schedule || !!durationHours) &&
    quantityValid &&
    pricingFieldsValid &&
    priceReady &&
    remoteQuoteValid &&
    (requestRemoteQuote || technicianChoiceMode === 'auto' || !!selectedTechnicianId) &&
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

      {/* قسم "نوع الحجز" اتشال بالكامل (ADR-0048) — «نشيل دول خالص ونحط قواعد على السيستم،
          والسيستم هو اللي بيحدد بناءً على التاريخ». اللي محلّه: التنبيه الأحمر تحت لما العميل
          يختار النهارده. */}

      {needsSchedule && (
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
              {service.requires_precise_schedule && (
                <label className="flex items-center gap-2 text-sm">
                  <span>عدد الساعات المطلوبة</span>
                  <input
                    type="number"
                    min={1}
                    value={durationHours}
                    onChange={(e) => setDurationHours(e.target.value)}
                    className="w-24 rounded-lg border border-border bg-surface px-3 py-2"
                  />
                </label>
              )}
            </div>
          )}
        </section>
      )}

      {service.pricing_model === 'formula' && pricingFields && pricingFields.length > 0 && (
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

      {isQuantityPricing && (
        <section className="mt-6 rounded-xl border border-border bg-surface p-4">
          <h2 className="font-semibold">
            {service.pricing_model === 'monthly' ? 'مدة الاشتراك بالشهور' : 'الكمية المطلوبة'}
          </h2>
          <label className="mt-3 block">
            <span className="mb-1 block text-sm text-muted">عدد {quantityUnit}</span>
            <input
              type="number"
              inputMode={service.quantity_precision > 0 ? 'decimal' : 'numeric'}
              min={service.quantity_min ?? 1}
              max={service.quantity_max ?? undefined}
              step={service.quantity_step ?? (service.quantity_precision > 0 ? 10 ** -service.quantity_precision : 1)}
              value={pricingQuantity}
              onChange={(e) => setPricingQuantity(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface px-4 py-3 outline-none focus:border-primary"
              placeholder={service.pricing_model === 'monthly' ? 'مثال: 3 شهور' : undefined}
            />
          </label>
          <p className="mt-2 text-sm text-muted">
            {service.pricing_model === 'monthly'
              ? 'الإجمالي = السعر الشهري × عدد الشهور، ويظهر لك قبل تأكيد الطلب.'
              : 'السعر يتحدث تلقائيًا حسب الكمية قبل تأكيد الطلب.'}
          </p>
        </section>
      )}

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

      {selectedAddressId && !requestRemoteQuote && (
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
                      onSelect={() => setSelectedTechnicianId(t.id)}
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
      {!requestRemoteQuote && service.allows_recurring_booking && needsSchedule && scheduleDayMode === 'specific' && scheduledDate && (
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

      {!requestRemoteQuote && (
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

      {!requestRemoteQuote && paymentChannels && paymentChannels.some((c) => c.method === 'card' && c.is_available) && (
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
      {postpaidPolicies.length > 0 && (
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
              : estimating
                ? '...'
                : totalCents !== null
                  ? formatEgp(totalCents)
                  : 'يتحدد بعد المعاينة'}
          </span>
        </div>
        {service.pricing_model === 'inspection_then_quote' && !requestRemoteQuote && (
          <p className="mt-1 text-sm text-muted">
            رسوم المعاينة {formatEgp(service.inspection_fee_cents)} — السعر النهائي بعد ما الفني يشوف الشغل
          </p>
        )}
        {technicianChoiceMode === 'auto' && service.pricing_model !== 'inspection_then_quote' && (
          <div className="mt-3 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2.5 text-sm leading-6 text-foreground">
            <p className="font-medium text-primary">السعر الحالي قبل اختيار الفني</p>
            <p className="text-muted">
              قد يزيد الإجمالي حسب مستوى الفني اللي ترشحه المطابقة، وساعتها فرق المستوى هيظهر لك كبند مستقل وواضح.
            </p>
          </div>
        )}
      </section>

      {error && <p className="mt-4 text-sm text-danger">{error}</p>}

      <button
        onClick={handleSubmit}
        disabled={!canSubmit}
        className="mt-6 w-full rounded-lg bg-primary py-3 font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
      >
        {submitting ? 'جاري تأكيد الحجز...' : submitted ? 'تم التأكيد' : 'أكّد الحجز'}
      </button>
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
          <p className="mt-1 text-xs text-danger">
            مش متاح للفترة دي{t.unavailable_reason_ar ? ` — ${t.unavailable_reason_ar}` : ''}
          </p>
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
