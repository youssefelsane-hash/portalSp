import type { Metadata } from 'next';
import { LegalDocumentView } from '@/components/legal-document';
import { PRIVACY_DOCUMENT } from '@/lib/legal-content';

export const metadata: Metadata = {
  title: 'سياسة الخصوصية — أسطى',
  description: 'سياسة الخصوصية وحماية البيانات لمنصة أسطى (OSTA)، المُدارة بواسطة الصانع جروب — ELSANE Group.',
};

export default function PrivacyPage() {
  return <LegalDocumentView document={PRIVACY_DOCUMENT} />;
}
