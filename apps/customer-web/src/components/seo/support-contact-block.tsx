import { fetchSupportContact } from '@/lib/support-contact';

/**
 * **بيانات التواصل فوق الطية** — طلب المالك: «في أي صفحة من دول من أولها من فوق كده، بيكون ظهر
 * فيها بيانات التواصل».
 *
 * **مكوّن سيرفر** مش عميل: بيتعرض في الـHTML نفسه، فالزاحف يشوف الأرقام والزائر يلاقيها في أول
 * رسم بلا انتظار جافاسكريبت.
 */
export async function SupportContactBlock() {
  const contact = await fetchSupportContact();
  if (!contact) return null;

  const items: { label: string; value: string; href: string }[] = [];
  if (contact.phone_number) {
    items.push({ label: 'اتصل بينا', value: contact.phone_number, href: `tel:${contact.phone_number}` });
  }
  if (contact.whatsapp_url && contact.whatsapp_number) {
    items.push({ label: 'واتساب', value: contact.whatsapp_number, href: contact.whatsapp_url });
  }
  if (items.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2" data-testid="seo-support-contact">
      {items.map((item) => (
        <a
          key={item.href}
          href={item.href}
          className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-primary hover:text-primary"
        >
          <span>{item.label}</span>
          <span dir="ltr" className="text-muted">
            {item.value}
          </span>
        </a>
      ))}
    </div>
  );
}
