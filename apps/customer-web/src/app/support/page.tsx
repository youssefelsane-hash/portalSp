'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { SupportContactDto } from '@/lib/api-types';
import { fetchSupportContact } from '@/lib/settings';

/**
 * «تواصل معنا» — نظير `SupportContactScreen` في `apps/customer-app`.
 *
 * **فجوة حقيقية اتلقطت بمسح الصفحات (2026-09-10)**: `/categories/[id]` بتوجّه لـ`/support`
 * لما الفئة تبقى فاضية («مشكلتك مش من ضمن اللي فوق؟ كلّمنا») — والصفحة دي **مكانتش موجودة
 * أصلاً**، فالعميل كان بياخد 404. الشاشة موجودة في تطبيق الموبايل من زمان، فدي كانت فجوة
 * تكافؤ صريحة مش بس لينك مكسور.
 *
 * نفس قاعدة البساطة الصارمة اللي في الموبايل (docs/08 §22 بند 20-30): خيارين كبار واضحين
 * (اتصال/واتساب) لو الإدارة مفعّلاهم، وشكوى مكتوبة كمسار دايم لأي حالة.
 */
export default function SupportPage() {
  const [contact, setContact] = useState<SupportContactDto | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetchSupportContact()
      .then(setContact)
      // بيانات التواصل إعداد إداري اختياري — فشل جلبها مايمنعش باقي مسارات الدعم.
      .catch(() => setContact(null))
      .finally(() => setLoaded(true));
  }, []);

  const hasDirect = Boolean(contact?.enabled && (contact.phone_number || contact.whatsapp_url));

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-bold">تواصل معنا</h1>
      <p className="mt-2 text-muted">محتاج مساعدة؟ اختار الطريقة اللي تناسبك.</p>

      {!loaded ? (
        <div className="mt-8 space-y-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-surface-variant" />
          ))}
        </div>
      ) : (
        <div className="mt-8 space-y-4">
          {hasDirect && (
            <div className="grid gap-3 sm:grid-cols-2">
              {contact?.phone_number && (
                <a
                  href={`tel:${contact.phone_number}`}
                  className="flex items-center justify-center gap-2 rounded-2xl bg-primary px-6 py-5 text-base font-semibold text-primary-foreground transition-opacity hover:opacity-90"
                >
                  <span>اتصل بينا</span>
                  <span dir="ltr" className="opacity-80">{contact.phone_number}</span>
                </a>
              )}
              {contact?.whatsapp_url && (
                <a
                  href={contact.whatsapp_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center rounded-2xl bg-[#25D366] px-6 py-5 text-base font-semibold text-white transition-opacity hover:opacity-90"
                >
                  واتساب
                </a>
              )}
            </div>
          )}

          <div className="rounded-2xl border border-border bg-surface p-6">
            <h2 className="font-semibold">ابعتلنا شكوى مكتوبة</h2>
            <p className="mt-1 text-sm text-muted">
              هنراجعها ونرد عليك، وتقدر تتابع حالتها في أي وقت من صفحة الشكاوى.
            </p>
            <Link
              href="/account/complaints"
              className="mt-4 inline-block rounded-xl border border-border px-5 py-3 text-sm font-medium text-primary hover:border-primary"
            >
              الشكاوى
            </Link>
          </div>

          <div className="rounded-2xl border border-border bg-surface p-6">
            <h2 className="font-semibold">مشكلتك في طلب معيّن؟</h2>
            <p className="mt-1 text-sm text-muted">
              افتح الطلب من «طلباتي» — هتلاقي جواه تواصل مباشر مع الفني وزرار الشكوى الخاصة بالطلب.
            </p>
            <Link
              href="/orders"
              className="mt-4 inline-block rounded-xl border border-border px-5 py-3 text-sm font-medium text-primary hover:border-primary"
            >
              طلباتي
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
