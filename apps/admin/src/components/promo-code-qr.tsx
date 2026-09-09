'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Button } from '@/components/ui/button';

interface PromoCodeQrProps {
  value: string;
  label: string;
  caption?: string;
}

/** QR لرابط ذكي: يفتح الرحلة، بينما التحقق المالي يظل دائمًا داخل API عند الحجز. */
export function PromoCodeQr({ value, label, caption }: PromoCodeQrProps) {
  const [visible, setVisible] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!visible || imageUrl) return;
    let active = true;
    QRCode.toDataURL(value, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 180,
      color: { dark: '#111827', light: '#FFFFFF' },
    }).then((url) => {
      if (active) setImageUrl(url);
    }).catch(() => {
      if (active) setImageUrl(null);
    });
    return () => {
      active = false;
    };
  }, [value, imageUrl, visible]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap justify-end gap-1">
        <Button type="button" size="sm" variant="ghost" onClick={() => setVisible((current) => !current)}>
        {visible ? 'إخفاء QR' : 'عرض QR'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => void copyLink()}>
          {copied ? 'تم النسخ' : 'نسخ الرابط'}
        </Button>
      </div>
      {visible && (
        <div className="rounded-md border bg-white p-2 text-center shadow-sm">
          {imageUrl ? (
            // الصورة `data:` مولّدة في المتصفح لحظتها — `next/image` بيحسّن ملفات جاية من
            // الشبكة، ومالوش أي فايدة هنا (مفيش طلب أصلاً يتحسّن)، فالتحذير مش منطبق.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageUrl} alt={`رمز QR لـ ${label}`} width={180} height={180} />
          ) : (
            <p className="w-[180px] py-8 text-xs text-muted-foreground">جاري إنشاء الرمز…</p>
          )}
          <p className="mt-1 text-xs font-medium text-slate-800">{label}</p>
          {caption && <p dir="ltr" className="mt-1 max-w-[180px] break-all text-[10px] text-slate-500">{caption}</p>}
        </div>
      )}
    </div>
  );
}
