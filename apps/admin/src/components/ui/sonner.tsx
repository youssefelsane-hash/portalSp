'use client';

import type { CSSProperties } from 'react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

// إشعارات فورية موحّدة (نجاح/خطأ) بدل alert()/رسائل نصية متفرقة داخل كل صفحة — عنصر نظام تصميم
// مطلوب صراحة (docs/12). rtl صريح لأن المكتبة مش بتكتشفه تلقائيًا من الصفحة.
function Toaster(props: ToasterProps) {
  return (
    <Sonner
      dir="rtl"
      position="top-center"
      className="toaster group"
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
        } as CSSProperties
      }
      {...props}
    />
  );
}

export { Toaster };
