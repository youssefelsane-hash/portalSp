'use client';

import { useState } from 'react';

/// نظير `apps/customer-app/lib/design/network_image_box.dart` على الويب.
///
/// **ليه ودجت مشتركة مش `<img>` في كل صفحة؟** لأن ده بالظبط اللي وقع قبل كده: كل صفحة كتبت
/// صورتها بنفسها، فالصفحة الرئيسية بقت بتعرض **حرف أول الاسم في دايرة ملوّنة** والفئة بتعرض
/// مربّع رمادي فاضي والأندرويد بيعرض صورة — تلات أشكال لنفس الحاجة. بلاغ المالك 2026-09-11:
/// «الفئات مفيهاش صور، بيظهر اللوجو… شيله من الكاتالوج وخلي الصور تطلع في كل الأماكن».
///
/// الحالات التلاتة نفس الأندرويد بالحرف: مفيش رابط ⇒ placeholder فورًا بلا محاولة تحميل،
/// تحميل جاري ⇒ نفس الـplaceholder، فشل حقيقي (404/شبكة) ⇒ نفس الـplaceholder.
/// **أبدًا أيقونة الصورة المكسورة** بتاعة المتصفح، وأبدًا حرف.
export function CatalogImage({
  src,
  aspect,
  rounded = 'rounded-xl',
  fit = 'cover',
  sizeHint,
  icon = 'category',
}: {
  src: string | null | undefined;
  /** نسبة العرض للارتفاع كـ CSS (`1 / 1`، `3 / 1`) — نفس ثوابت الأندرويد. */
  aspect: string;
  rounded?: string;
  fit?: 'cover' | 'contain';
  /** قيمة `sizes` للمتصفح عشان ما ينزّلش صورة 2000px لخانة 116px. */
  sizeHint?: string;
  icon?: 'category' | 'service';
}) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const showImage = Boolean(src) && !failed;

  return (
    <div
      className={`relative w-full overflow-hidden bg-surface-variant ${rounded}`}
      style={{ aspectRatio: aspect }}
    >
      {/* الـplaceholder تحت الصورة دايمًا — فمفيش فراغ أبيض أثناء التحميل ولا «وميض» لما
          الصورة تخلص. نفس مبدأ `gaplessPlayback` في الأندرويد. */}
      <div
        className="absolute inset-0 flex items-center justify-center text-muted"
        aria-hidden="true"
      >
        <PlaceholderIcon kind={icon} />
      </div>
      {showImage && (
        // eslint-disable-next-line @next/next/no-img-element -- رابط يحدده الأدمن وقت التشغيل، مش أصل معروف وقت البناء
        <img
          src={src ?? ''}
          alt=""
          loading="lazy"
          decoding="async"
          sizes={sizeHint}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={`absolute inset-0 h-full w-full transition-opacity duration-300 ${
            fit === 'cover' ? 'object-cover' : 'object-contain'
          } ${loaded ? 'opacity-100' : 'opacity-0'}`}
        />
      )}
    </div>
  );
}

function PlaceholderIcon({ kind }: { kind: 'category' | 'service' }) {
  const common = {
    width: 28,
    height: 28,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  // نفس أيقونتي الأندرويد: `category_outlined` للفئة و`build_outlined` للخدمة.
  return kind === 'category' ? (
    <svg {...common} aria-hidden="true">
      <path d="M12 3 6 9h12z" />
      <circle cx="17.5" cy="17.5" r="3.5" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
    </svg>
  ) : (
    <svg {...common} aria-hidden="true">
      <path d="M14.7 6.3a4 4 0 0 0 5 5l-9.6 9.6a2.1 2.1 0 0 1-3-3z" />
      <path d="M14.7 6.3 18 3l3 3-3.3 3.3" />
    </svg>
  );
}
