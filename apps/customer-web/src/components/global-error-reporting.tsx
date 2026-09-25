'use client';

import { useEffect } from 'react';
import { installGlobalErrorReporting } from '@/lib/error-reporter';

/** بيثبّت مستمعي `error`/`unhandledrejection` مرة واحدة لكل تحميل صفحة (ADR-0114). */
export function GlobalErrorReporting() {
  useEffect(() => installGlobalErrorReporting(), []);
  return null;
}
