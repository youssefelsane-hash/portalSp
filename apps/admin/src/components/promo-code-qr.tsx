'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Button } from '@/components/ui/button';

interface PromoCodeQrProps {
  code: string;
}

/** QR محلي للنص فقط؛ تطبيق العميل يمسحه ثم يمرره لنفس تحقق الـAPI المعتاد. */
export function PromoCodeQr({ code }: PromoCodeQrProps) {
  const [visible, setVisible] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || imageUrl) return;
    let active = true;
    QRCode.toDataURL(code, {
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
  }, [code, imageUrl, visible]);

  return (
    <div className="flex flex-col items-end gap-2">
      <Button type="button" size="sm" variant="ghost" onClick={() => setVisible((value) => !value)}>
        {visible ? 'إخفاء QR' : 'عرض QR'}
      </Button>
      {visible && (
        <div className="rounded-md border bg-white p-2 text-center shadow-sm">
          {imageUrl ? (
            // الصورة `data:` مولّدة في المتصفح لحظتها — `next/image` بيحسّن ملفات جاية من
            // الشبكة، ومالوش أي فايدة هنا (مفيش طلب أصلاً يتحسّن)، فالتحذير مش منطبق.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageUrl} alt={`رمز QR لكود الخصم ${code}`} width={180} height={180} />
          ) : (
            <p className="w-[180px] py-8 text-xs text-muted-foreground">جاري إنشاء الرمز…</p>
          )}
          <p dir="ltr" className="mt-1 text-xs font-medium text-slate-800">{code}</p>
        </div>
      )}
    </div>
  );
}
