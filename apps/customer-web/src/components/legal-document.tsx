import type { LegalDocument, LegalEntityInfo } from '@/lib/legal-content';
import { LEGAL_LAST_UPDATED_AR } from '@/lib/legal-content';
import { LegalContactBlock } from './legal-contact-block';

/**
 * عارض واحد لكل المستندات القانونية (docs/08 §99) — الشروط والخصوصية بيتعرضوا بنفس الشكل من نفس
 * المكوّن، فمفيش احتمال إن واحد منهم يتنسى وقت أي تعديل على التنسيق.
 *
 * كل بند له `id` ثابت مبني على رقمه — عشان ينفع نحيل عليه بلينك مباشر (`/legal/terms#section-6`)
 * من داخل التطبيقات أو من رد على شكوى، وده مطلوب عمليًا في أي مراجعة قانونية أو مراجعة متجر.
 */
export function LegalDocumentView({ document, entity }: { document: LegalDocument; entity: LegalEntityInfo }) {
  return (
    <article className="mx-auto w-full max-w-3xl px-4 py-10">
      <header className="mb-8 border-b pb-6">
        <h1 className="text-2xl font-bold sm:text-3xl">{document.titleAr}</h1>
        <p className="mt-1 text-sm text-muted-foreground" dir="ltr">
          {document.titleEn}
        </p>
        <p className="mt-4 text-sm text-muted-foreground">
          الجهة المشغّلة: {entity.company_name_ar} — <span dir="ltr">{entity.company_name_en}</span>
        </p>
        <p className="mt-1 text-sm text-muted-foreground">آخر تحديث: {LEGAL_LAST_UPDATED_AR}</p>
      </header>

      {document.intro.map((paragraph, i) => (
        <p key={i} className="mb-4 leading-8 text-foreground/90">
          {paragraph}
        </p>
      ))}

      <div className="mt-8 space-y-8">
        {document.sections.map((section) => (
          <section key={section.number} id={`section-${section.number}`} className="scroll-mt-20">
            <h2 className="mb-3 text-lg font-bold">
              {section.number}. {section.title}
            </h2>
            {section.paragraphs.map((paragraph, i) => (
              <p key={i} className="mb-3 leading-8 text-foreground/90">
                {paragraph}
              </p>
            ))}
          </section>
        ))}
      </div>

      <LegalContactBlock entity={entity} />
    </article>
  );
}
