import type { LegalEntityInfo } from '@/lib/legal-content';

/**
 * بيانات التواصل الرسمية (docs/08 §100) — **مصدر عرض واحد** بيتستخدم في الصفحات القانونية
 * الثلاثة. المالك طلب صراحةً: «لو أي بيانات لسه فاضية، ما تظهرش كسطر فاضي في الصفحة».
 *
 * فكل سطر بيتبني بس لو قيمته موجودة فعلاً، والقسم كله بيختفي لو مفيش ولا قيمة — سطر عنوانه
 * «العنوان القانوني:» وبعده فراغ في مستند قانوني أوحش من غياب القسم كله.
 */
export function LegalContactBlock({ entity, title = 'بيانات التواصل الرسمية' }: { entity: LegalEntityInfo; title?: string }) {
  const rows: { label: string; value: string; href?: string; ltr?: boolean }[] = [];
  if (entity.support_email) {
    rows.push({ label: 'بريد الدعم', value: entity.support_email, href: `mailto:${entity.support_email}`, ltr: true });
  }
  if (entity.privacy_email && entity.privacy_email !== entity.support_email) {
    rows.push({ label: 'بريد طلبات الخصوصية', value: entity.privacy_email, href: `mailto:${entity.privacy_email}`, ltr: true });
  }
  if (entity.support_phone) rows.push({ label: 'رقم التواصل', value: entity.support_phone, ltr: true });
  if (entity.website_url) rows.push({ label: 'الموقع الرسمي', value: entity.website_url, href: entity.website_url, ltr: true });
  if (entity.legal_address) rows.push({ label: 'العنوان القانوني', value: entity.legal_address });
  if (entity.commercial_register) rows.push({ label: 'السجل التجاري', value: entity.commercial_register, ltr: true });
  if (entity.tax_id) rows.push({ label: 'الرقم الضريبي', value: entity.tax_id, ltr: true });

  if (rows.length === 0) return null;

  return (
    <section className="mt-10 rounded-lg border bg-muted/30 p-5 text-sm">
      <h2 className="mb-3 font-bold">{title}</h2>
      <dl className="space-y-1.5">
        {rows.map((row) => (
          <div key={row.label} className="flex flex-wrap gap-x-2">
            <dt className="text-muted-foreground">{row.label}:</dt>
            <dd dir={row.ltr ? 'ltr' : undefined}>
              {row.href ? (
                <a className="underline" href={row.href} rel="noopener noreferrer">
                  {row.value}
                </a>
              ) : (
                row.value
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
