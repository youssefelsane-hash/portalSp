import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * **تنبيهات على مستوى الصفحة** — إطار واحد لكل رسالة خطأ/نجاح/معلومة.
 *
 * ### ليه عنصر مشترك
 *
 * كل صفحة كانت بتعرض خطأها كـ`<ErrorNotice>{error}</ErrorNotice>` — **نص أحمر
 * سايب في الهوا** بلا إطار ولا أيقونة ولا أي فرق بصري بينه وبين أي كلام تاني في الصفحة
 * (بلاغ مالك 2026-09-17: «كلام كله كده… متلخبط على بعضه»). في لقطة حقيقية لصفحة الإعدادات،
 * رسالة «ماعندكش صلاحية» كانت بتبان كسطر أحمر رفيع فوق الصفحة الفاضية — مفيش حاجة تقول إن
 * ده **تنبيه** مش عنوان.
 *
 * التنبيه دلوقتي: إطار + خلفية خفيفة + أيقونة + نص يلتف عادي. الرسالة نفسها ما اتغيّرتش —
 * اللي اتغيّر إن الأدمن بيعرف إنها تنبيه من نظرة واحدة.
 */

const TONES = {
  error: {
    icon: AlertTriangle,
    box: 'border-destructive/35 bg-destructive/[0.06] text-destructive',
  },
  warning: {
    icon: AlertTriangle,
    box: 'border-amber-300 bg-amber-50 text-amber-900',
  },
  success: {
    icon: CheckCircle2,
    box: 'border-emerald-300 bg-emerald-50 text-emerald-900',
  },
  info: {
    icon: Info,
    box: 'border-border/70 bg-muted/40 text-foreground',
  },
} as const;

export type NoticeTone = keyof typeof TONES;

function Notice({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: NoticeTone;
  title?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  const { icon: Icon, box } = TONES[tone];
  return (
    <div role={tone === 'error' ? 'alert' : undefined} className={cn('mb-4 flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm leading-6', box, className)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn('min-w-0 break-words', title && 'mt-0.5')}>{children}</div>}
      </div>
    </div>
  );
}

/** اختصار الحالة الأشهر: خطأ على مستوى الصفحة. */
function ErrorNotice({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <Notice tone="error" className={className}>
      {children}
    </Notice>
  );
}

export { Notice, ErrorNotice };
