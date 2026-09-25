'use client';

import { useEffect } from 'react';

/**
 * **آخر شبكة أمان** (ADR-0114): عطل في الـlayout نفسه، قبل ما أي CSS أو خط يتحمّل.
 *
 * ليه مكتوب بستايل inline ومن غير أي import من `@/components`: الملف ده بيحل مكان
 * `<html>`/`<body>` بالكامل، يعني `globals.css` والخط والـ`AuthProvider` **مش موجودين**. أي
 * اعتماد على مكوّن مشترك هنا بيتحول لشاشة بيضاء — وهي بالظبط الحالة اللي المكوّن ده اتعمل
 * عشانها. النسخة المكرّرة من الستايل هنا مقصودة ومحدودة.
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    // نداء مباشر بلا أي helper: `error-reporter` بيستورد إعدادات ممكن تكون هي نفسها سبب العطل.
    const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1';
    void fetch(`${API_URL}/telemetry/client-errors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        app: 'customer-web',
        kind: 'render',
        page_path: '/__global_error',
        error_name: error.name || 'GlobalError',
        error_message: (error.message || '').slice(0, 500),
      }),
    }).catch(() => {});
  }, [error]);

  return (
    <html lang="ar" dir="rtl">
      {/* `metadata` مش مدعومة في global-error (الملف بيحل مكان الـlayout) — العنوان من React. */}
      <title>حصلت مشكلة — أسطى</title>
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, -apple-system, Segoe UI, Tahoma, sans-serif',
          background: '#ffffff',
          color: '#111827',
        }}
      >
        <div style={{ maxWidth: '32rem', padding: '1.5rem', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.25rem', margin: 0 }}>حصلت مشكلة مؤقتة</h1>
          <p style={{ marginTop: '0.75rem', fontSize: '0.95rem', lineHeight: 1.8, color: '#4b5563' }}>
            مقدرناش نفتح الموقع دلوقتي. جرّب تحدّث الصفحة بعد لحظة.
          </p>
          <button
            type="button"
            onClick={retry}
            style={{
              marginTop: '1.5rem',
              minHeight: '2.75rem',
              padding: '0 1.5rem',
              borderRadius: '0.75rem',
              border: 'none',
              background: '#123b69',
              color: '#ffffff',
              fontSize: '0.9rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            حاول تاني
          </button>
        </div>
      </body>
    </html>
  );
}
