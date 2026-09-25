'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { listAddresses, AddressDto } from '@/lib/addresses';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';

const PROJECT_TYPES = [
  { value: 'finishing', label: 'تشطيب شقة', description: 'تشطيب كامل من المحارة لحد التسليم' },
  { value: 'renovation', label: 'تجديد', description: 'تجديد مساحة موجودة أو تغيير كبير' },
  { value: 'move_in', label: 'تجهيز شقة جديدة', description: 'تجهيز البيت قبل السكن والنقل' },
  { value: 'multi_service', label: 'مشروع متعدد الخدمات', description: 'أكثر من تخصص في مشروع واحد' },
  { value: 'other', label: 'مشروع آخر', description: 'احكي لنا التفاصيل ونرتبها معك' },
] as const;

interface CreatedProject {
  id: string;
  project_number: string;
  name_ar: string;
}

function addressLabel(address: AddressDto): string {
  return [address.label, address.street_name, address.building_number ? `عمارة ${address.building_number}` : null]
    .filter(Boolean)
    .join('، ');
}

export default function CreateProjectPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading, authedFetch } = useAuth();
  const idempotencyKey = useRef<string | null>(null);
  const [addresses, setAddresses] = useState<AddressDto[] | null>(null);
  const [projectType, setProjectType] = useState<(typeof PROJECT_TYPES)[number]['value']>('finishing');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [addressId, setAddressId] = useState('');
  const [budget, setBudget] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedProject | null>(null);

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated) {
      router.replace('/login?next=/projects/new');
      return;
    }
    let cancelled = false;
    listAddresses(authedFetch)
      .then((items) => {
        if (cancelled) return;
        setAddresses(items);
        const preferred = items.find((item) => item.is_default) ?? items[0];
        if (preferred) setAddressId(preferred.id);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'تعذّر تحميل العناوين');
      });
    return () => {
      cancelled = true;
    };
  }, [authedFetch, isAuthenticated, isLoading, router]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || !addressId || busy) return;
    setBusy(true);
    setError(null);
    idempotencyKey.current ??= crypto.randomUUID();
    const budgetEgp = budget.trim() === '' ? null : Number(budget);
    try {
      const project = await authedFetch<CreatedProject>('/me/projects', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey.current },
        body: JSON.stringify({
          project_type: projectType,
          name_ar: name.trim(),
          address_id: addressId,
          ...(description.trim() ? { description_ar: description.trim() } : {}),
          ...(budgetEgp && budgetEgp > 0 ? { budget_estimate_cents: Math.round(budgetEgp * 100) } : {}),
        }),
      });
      setCreated(project);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'تعذّر إرسال طلب المشروع، حاول تاني');
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        <section className="overflow-hidden rounded-3xl border border-border bg-surface shadow-sm">
          <div className="bg-primary px-6 py-8 text-primary-foreground sm:px-9">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15 text-2xl">✓</div>
            <h1 className="mt-5 text-2xl font-bold">وصلنا طلب مشروعك</h1>
            <p className="mt-2 text-sm text-primary-foreground/80" dir="ltr">{created.project_number}</p>
          </div>
          <div className="space-y-4 p-6 sm:p-9">
            <NextStep number="1" text="فريق أسطى هيراجع التفاصيل اللي بعتهالنا." />
            <NextStep number="2" text="هنتواصل معك لتحديد معاينة على الطبيعة." />
            <NextStep number="3" text="بعد المعاينة هيوصلك عرض سعر مفصّل تراجعه وتوافق عليه." />
            <div className="flex flex-col gap-3 pt-3 sm:flex-row">
              <Link href={`/projects/${created.id}`} className="motion-press rounded-xl bg-primary px-5 py-3 text-center font-semibold text-primary-foreground">
                تابع المشروع
              </Link>
              <Link href="/projects" className="motion-press rounded-xl border border-border px-5 py-3 text-center font-semibold">
                كل مشاريعي
              </Link>
            </div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
      <header className="mb-7">
        <p className="text-sm font-semibold text-accent">مشروعات البيت</p>
        <h1 className="mt-1 text-3xl font-bold">ابدأ مشروعك مع أسطى</h1>
        <p className="mt-2 max-w-2xl leading-7 text-muted">قول لنا بتجهّز إيه وميزانيتك التقريبية، ونرتب لك المعاينة وعرض السعر ومراحل التنفيذ.</p>
      </header>

      <form onSubmit={submit} className="space-y-6">
        <section className="booking-panel">
          <h2 className="text-lg font-semibold">ما الذي تريد تنفيذه؟</h2>
          <p className="mt-1 text-sm text-muted">اختار أقرب وصف للمشروع، وتقدر توضح الباقي تحت.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {PROJECT_TYPES.map((type) => {
              const selected = projectType === type.value;
              return (
                <button
                  key={type.value}
                  type="button"
                  onClick={() => setProjectType(type.value)}
                  className={`booking-option text-start ${selected ? 'booking-option-selected' : ''}`}
                  aria-pressed={selected}
                >
                  <span className="flex items-center justify-between gap-3">
                    <span className="font-semibold">{type.label}</span>
                    <span className={`flex h-6 w-6 items-center justify-center rounded-full border ${selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border'}`}>
                      {selected ? '✓' : ''}
                    </span>
                  </span>
                  <span className="mt-1 block text-sm text-muted">{type.description}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="booking-panel space-y-5">
          <div>
            <h2 className="text-lg font-semibold">تفاصيل المشروع</h2>
            <p className="mt-1 text-sm text-muted">معلومات بسيطة تساعدنا نفهم المطلوب قبل التواصل.</p>
          </div>
          <label className="block">
            <span className="text-sm font-medium">اسم المشروع *</span>
            <input value={name} onChange={(event) => setName(event.target.value)} required maxLength={160} placeholder="مثلاً: تشطيب شقة التجمع" className="booking-control mt-2" />
          </label>
          <label className="block">
            <span className="text-sm font-medium">وصف بسيط</span>
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4} maxLength={2000} placeholder="احكي لنا المساحة، الحالة الحالية، وأهم حاجة محتاجها…" className="booking-control mt-2 resize-y" />
          </label>
          <label className="block">
            <span className="text-sm font-medium">الميزانية التقريبية بالجنيه</span>
            <input value={budget} onChange={(event) => setBudget(event.target.value)} type="number" inputMode="numeric" min="1" step="1" placeholder="اختياري" className="booking-control mt-2" />
          </label>
        </section>

        <section className="booking-panel">
          <h2 className="text-lg font-semibold">مكان المشروع</h2>
          <p className="mt-1 text-sm text-muted">اختار عنوانًا محفوظًا عشان نرتب المعاينة في المكان الصحيح.</p>
          {addresses === null ? (
            <div className="mt-4 h-14 animate-pulse rounded-xl bg-surface-variant" />
          ) : addresses.length > 0 ? (
            <div className="mt-4 grid gap-3">
              {addresses.map((address) => {
                const selected = addressId === address.id;
                return (
                  <button key={address.id} type="button" onClick={() => setAddressId(address.id)} className={`booking-option flex items-center justify-between gap-4 text-start ${selected ? 'booking-option-selected' : ''}`} aria-pressed={selected}>
                    <span>
                      <span className="block font-semibold">{address.label || 'عنوان محفوظ'}</span>
                      <span className="mt-1 block text-sm text-muted">{addressLabel(address)}</span>
                    </span>
                    <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border'}`}>{selected ? '✓' : ''}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="mt-4 rounded-2xl border border-warning/40 bg-warning/10 p-4 text-sm leading-6">
              محتاج يكون عندك عنوان محفوظ قبل إرسال المشروع. أضف عنوانًا أثناء حجز أي خدمة، وبعدها ارجع هنا.
            </div>
          )}
        </section>

        {error && <p className="rounded-2xl border border-danger/30 bg-danger/10 p-4 text-sm text-danger">{error}</p>}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <button type="submit" disabled={busy || !name.trim() || !addressId} className="motion-press rounded-xl bg-primary px-7 py-3.5 font-semibold text-primary-foreground transition-opacity disabled:cursor-not-allowed disabled:opacity-50">
            {busy ? 'جاري إرسال المشروع…' : 'ابدأ المشروع واطلب معاينة'}
          </button>
          <Link href="/projects" className="rounded-xl px-5 py-3 text-center text-sm font-medium text-muted hover:text-foreground">رجوع لمشاريعي</Link>
        </div>
      </form>
    </main>
  );
}

function NextStep({ number, text }: { number: string; text: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">{number}</span>
      <p className="pt-1 leading-6">{text}</p>
    </div>
  );
}
