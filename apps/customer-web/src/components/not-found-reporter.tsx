'use client';

import { useEffect } from 'react';
import { reportClientError } from '@/lib/error-reporter';

/**
 * **٤٠٤ إشارة مش بس شاشة** (ADR-0114): ٤٠٤ بيتكرر على نفس المسار معناه لينك مكسور إحنا نشرناه
 * (إعلان، فوتر، حملة) — وده بيضيع فلوس إعلانات بالسكوت. مكوّن صغير منفصل عشان صفحة الـ٤٠٤ نفسها
 * تفضل server-rendered وخفيفة.
 */
export function NotFoundReporter() {
  useEffect(() => {
    reportClientError({ kind: 'not_found', errorName: 'NotFound', errorMessage: 'الصفحة مش موجودة' });
  }, []);
  return null;
}
