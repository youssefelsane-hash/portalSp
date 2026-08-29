import type { Metadata } from 'next';
import { LegalDocumentView } from '@/components/legal-document';
import { TERMS_DOCUMENT, fetchLegalEntity } from '@/lib/legal-content';

export const metadata: Metadata = {
  title: 'شروط وأحكام الاستخدام — أسطى',
  description: 'شروط وأحكام استخدام منصة أسطى (OSTA)، المُدارة بواسطة الصانع جروب — ELSANE Group.',
};

export default async function TermsPage() {
  const entity = await fetchLegalEntity();
  return <LegalDocumentView document={TERMS_DOCUMENT} entity={entity} />;
}
