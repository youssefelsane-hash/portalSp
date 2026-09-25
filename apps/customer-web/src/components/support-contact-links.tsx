'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api-client';

interface SupportContact {
  enabled: boolean;
  phone_number: string | null;
  whatsapp_number: string | null;
  whatsapp_url: string | null;
  email: string | null;
  help_url: string | null;
}

/**
 * **روابط تواصل الدعم** — من `GET /settings/support-contact` (مسار عام).
 *
 * موجود عشان أي شاشة **قبل الدخول** تقدر تعرض بيانات تواصل حقيقية. أهم استخدام: صفحة استرجاع
 * رمز الدخول — بتطلب من العميل كود من الدعم، والعميل المقفول برّه حسابه مايقدرش يوصل لصفحة
 * الدعم الداخلية عشان يجيب الرقم (ADR-0111 §6).
 *
 * **بيختفي بهدوء** لو الدعم مقفول أو الجلب فشل — الاسترجاع نفسه شغّال من غيره، ومفيش داعي
 * نعرض خطأ على حاجة مساعدة.
 */
export function SupportContactLinks() {
  const [contact, setContact] = useState<SupportContact | null>(null);

  useEffect(() => {
    apiFetch<SupportContact>('/settings/support-contact', null)
      .then((data) => setContact(data.enabled ? data : null))
      .catch(() => setContact(null));
  }, []);

  if (!contact) return null;
  const links: { label: string; href: string }[] = [];
  if (contact.phone_number) links.push({ label: `اتصل: ${contact.phone_number}`, href: `tel:${contact.phone_number}` });
  if (contact.whatsapp_url) links.push({ label: `واتساب: ${contact.whatsapp_number}`, href: contact.whatsapp_url });
  if (links.length === 0) return null;

  return (
    <div className="mb-6 flex flex-wrap justify-center gap-2" data-testid="support-contact-links">
      {links.map((link) => (
        <a
          key={link.href}
          href={link.href}
          className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted/10"
          dir="ltr"
        >
          {link.label}
        </a>
      ))}
    </div>
  );
}
