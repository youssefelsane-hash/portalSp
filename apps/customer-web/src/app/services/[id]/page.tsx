'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { fetchService, fetchPricingFields, estimatePrice } from '@/lib/catalog';
import { ServiceDto, PricingFieldDto, PriceEstimateDto } from '@/lib/api-types';
import { fetchCities, fetchAreas, CityDto, AreaDto } from '@/lib/geo-addresses';
import { listAddresses, createAddress, AddressDto } from '@/lib/addresses';
import { fetchPaymentChannels, payWithCard, PaymentChannelDto as PaymentChannel } from '@/lib/payments';
import { createOrder, formatEgp } from '@/lib/orders';
import { ApiError } from '@/lib/api-client';

type BookingMode = 'individual' | 'team' | 'emergency';
const BOOKING_MODE_LABELS: Record<BookingMode, string> = {
  individual: 'فني واحد',
  team: 'فريق',
  emergency: 'طوارئ',
};

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
  const [bookingMode, setBookingMode] = useState<BookingMode>('individual');
  const [estimate, setEstimate] = useState<PriceEstimateDto | null>(null);
  const [estimating, setEstimating] = useState(false);

  const [addresses, setAddresses] = useState<AddressDto[] | null>(null);
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
  const [showNewAddressForm, setShowNewAddressForm] = useState(false);

  const [scheduleType, setScheduleType] = useState<'asap' | 'later'>('asap');
  const [scheduledAt, setScheduledAt] = useState('');
  const [problemDescription, setProblemDescription] = useState('');
  const [promoCode, setPromoCode] = useState('');

  const [paymentChannels, setPaymentChannels] = useState<PaymentChannel[] | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'later' | 'card'>('later');

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    fetchService(id)
      .then((s) => {
        setService(s);
        const modes = availableBookingModes(s);
        if (modes.length > 0) setBookingMode(modes[0]);
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
    const requiredFilled = (pricingFields ?? [])
      .filter((f) => f.is_required)
      .every((f) => debouncedFieldValues[f.field_key] !== undefined && debouncedFieldValues[f.field_key] !== '');
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEstimating(true);
    estimatePrice(id, { bookingMode })
      .then(setEstimate)
      .catch(() => setEstimate(null))
      .finally(() => setEstimating(false));
  }, [id, service, bookingMode]);

  const totalCents = estimate?.estimated_total_cents ?? service?.base_price_cents ?? null;

  async function handleSubmit() {
    if (!service || !selectedAddressId) return;
    setError(null);
    setSubmitting(true);
    try {
      const order = await createOrder(authedFetch, {
        service_id: service.id,
        address_id: selectedAddressId,
        booking_mode: bookingMode,
        problem_description: problemDescription || undefined,
        scheduled_at: scheduleType === 'later' && scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
        promo_code: promoCode || undefined,
        field_values: service.pricing_model === 'formula' ? fieldValues : undefined,
        payment_method: paymentMethod === 'card' ? 'card' : undefined,
      });
      setSubmitted(true);
      if (paymentMethod === 'card') {
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
  const canSubmit = !!selectedAddressId && (scheduleType === 'asap' || !!scheduledAt) && !submitting && !submitted;

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-bold">{service.name_ar}</h1>
      {service.short_description_ar && <p className="mt-1 text-muted">{service.short_description_ar}</p>}
      {service.warranty_days > 0 && (
        <p className="mt-2 text-sm text-success">ضمان {service.warranty_days} يوم على الشغل ده</p>
      )}

      {modes.length > 1 && (
        <section className="mt-6">
          <h2 className="mb-2 font-semibold">نوع الحجز</h2>
          <div className="flex gap-2">
            {modes.map((m) => (
              <button
                key={m}
                onClick={() => setBookingMode(m)}
                className={`rounded-lg border px-4 py-2 text-sm ${
                  bookingMode === m ? 'border-primary bg-primary/10 text-primary' : 'border-border'
                }`}
              >
                {BOOKING_MODE_LABELS[m]}
              </button>
            ))}
          </div>
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
                />
              ))}
          </div>
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

      {service.allows_scheduling && (
        <section className="mt-6">
          <h2 className="mb-3 font-semibold">الموعد</h2>
          <div className="flex gap-2">
            <button
              onClick={() => setScheduleType('asap')}
              className={`rounded-lg border px-4 py-2 text-sm ${scheduleType === 'asap' ? 'border-primary bg-primary/10 text-primary' : 'border-border'}`}
            >
              أقرب وقت ممكن
            </button>
            <button
              onClick={() => setScheduleType('later')}
              className={`rounded-lg border px-4 py-2 text-sm ${scheduleType === 'later' ? 'border-primary bg-primary/10 text-primary' : 'border-border'}`}
            >
              حدد موعد
            </button>
          </div>
          {scheduleType === 'later' && (
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              className="mt-3 rounded-lg border border-border bg-surface px-4 py-2"
            />
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

      {paymentChannels && paymentChannels.some((c) => c.method === 'card' && c.is_available) && (
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

      <section className="mt-8 rounded-xl border border-border bg-surface p-4">
        <div className="flex items-center justify-between">
          <span className="text-muted">السعر المتوقع</span>
          <span className="text-xl font-bold text-primary">
            {estimating ? '...' : totalCents !== null ? formatEgp(totalCents) : 'يتحدد بعد المعاينة'}
          </span>
        </div>
        {service.pricing_model === 'inspection_then_quote' && (
          <p className="mt-1 text-sm text-muted">
            رسوم المعاينة {formatEgp(service.inspection_fee_cents)} — السعر النهائي بعد ما الفني يشوف الشغل
          </p>
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
}: {
  field: PricingFieldDto;
  value: string | number | boolean | undefined;
  onChange: (value: string | number | boolean) => void;
}) {
  const label = `${field.label_ar}${field.is_required ? ' *' : ''}${field.unit_ar ? ` (${field.unit_ar})` : ''}`;

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
      {/* اختيار موقع حقيقي بالخريطة فجوة معروفة (docs/16) — إدخال يدوي مؤقت لحد ما نضيف Maps picker. */}
      <div className="grid grid-cols-2 gap-3">
        <input
          value={latitude}
          onChange={(e) => setLatitude(e.target.value)}
          placeholder="خط العرض (latitude)"
          dir="ltr"
          className="rounded-lg border border-border bg-surface px-3 py-2"
        />
        <input
          value={longitude}
          onChange={(e) => setLongitude(e.target.value)}
          placeholder="خط الطول (longitude)"
          dir="ltr"
          className="rounded-lg border border-border bg-surface px-3 py-2"
        />
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      <button type="submit" disabled={!canSubmit || busy} className="w-full rounded-lg bg-primary py-2 font-medium text-primary-foreground disabled:opacity-50">
        {busy ? 'جاري الحفظ...' : 'حفظ العنوان'}
      </button>
    </form>
  );
}
