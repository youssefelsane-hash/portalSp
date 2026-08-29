import type { Metadata } from 'next';
import { LegalDocumentView } from '@/components/legal-document';
import { PRIVACY_DOCUMENT, fetchLegalEntity } from '@/lib/legal-content';

export const metadata: Metadata = {
  title: 'سياسة الخصوصية — أسطى',
  description: 'سياسة الخصوصية وحماية البيانات لمنصة أسطى (OSTA)، المُدارة بواسطة الصانع جروب — ELSANE Group.',
};

export default async function PrivacyPage() {
  const entity = await fetchLegalEntity();
  return <LegalDocumentView document={PRIVACY_DOCUMENT} entity={entity} />;
}
