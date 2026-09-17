'use client';

import { cn } from '@/lib/utils';

/**
 * **شريط ملخّص الطلبات** (docs/08 §157) — بيتحدّث مع الفلاتر السارية.
 *
 * ### ليه بلاطات مش سطر نص
 *
 * بلاغ المالك: «ما يبقاش شايف كلام كله كده، كلام مش معروف الكلام ده يعني متلخبط على بعضه».
 * النسخة الأولى كانت سطر واحد: «٥٨ طلب ٤ اليوم ٤ تحت التنفيذ ٣٠ متأخرة ٢٥ غير معيّنة ١١ الطاقم
 * ناقص» — الأرقام والكلام ملزوقين، ومفيش حد يقدر يقراهم بنظرة.
 *
 * كل رقم بقى في بلاطة ليها **الرقم كبير فوق والاسم تحته**، فالعين بتمسك الأرقام الأول. والبلاطة
 * اللي فيها مشكلة (متأخر/بلا فني/طاقم ناقص) بتتلوّن **بس لما قيمتها > صفر** — التلوين الدائم
 * بيخلّي «صفر متأخر» شكله إنذار.
 */

export interface OrdersSummary {
  total: number;
  today: number;
  in_progress: number;
  overdue: number;
  unassigned: number;
  crew_incomplete: number;
}

interface Tile {
  key: keyof OrdersSummary;
  label: string;
  /** البلاطة دي تنبيه لما قيمتها فوق الصفر. */
  alerting?: boolean;
}

const TILES: Tile[] = [
  { key: 'total', label: 'إجمالي' },
  { key: 'today', label: 'اليوم' },
  { key: 'in_progress', label: 'تحت التنفيذ' },
  { key: 'overdue', label: 'متأخرة', alerting: true },
  { key: 'unassigned', label: 'بلا فني', alerting: true },
  { key: 'crew_incomplete', label: 'الطاقم ناقص', alerting: true },
];

export function OrdersSummaryBar({
  summary,
  onPickBucket,
  activeBucket,
}: {
  summary: OrdersSummary;
  /** البلاطة اللي ليها اختصار بتبقى قابلة للدوس — الرقم والفلتر لازم يوصّلوا لنفس المكان. */
  onPickBucket?: (bucket: 'today' | 'overdue' | 'unassigned') => void;
  activeBucket?: string;
}) {
  const bucketFor = (key: keyof OrdersSummary) =>
    key === 'today' || key === 'overdue' || key === 'unassigned' ? key : null;

  return (
    <div className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
      {TILES.map((tile) => {
        const value = summary[tile.key];
        const alert = Boolean(tile.alerting) && value > 0;
        const bucket = bucketFor(tile.key);
        const isActive = bucket !== null && activeBucket === bucket;
        const Wrapper = bucket && onPickBucket ? 'button' : 'div';
        return (
          <Wrapper
            key={tile.key}
            {...(bucket && onPickBucket
              ? { type: 'button' as const, onClick: () => onPickBucket(bucket) }
              : {})}
            className={cn(
              'rounded-xl border px-3 py-2 text-start',
              bucket && onPickBucket && 'transition hover:border-primary/60 hover:bg-muted/50',
              alert ? 'border-destructive/40 bg-destructive/5' : 'bg-muted/30',
              isActive && 'ring-2 ring-primary',
            )}
          >
            <div className={cn('text-xl font-semibold leading-tight', alert && 'text-destructive')}>{value}</div>
            <div className="text-xs text-muted-foreground">{tile.label}</div>
          </Wrapper>
        );
      })}
    </div>
  );
}
