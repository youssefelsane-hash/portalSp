'use client';

import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * **تقويم حِمل التشغيل** (docs/08 §157) — «فين الأيام الفاضية وفين المكدسة».
 *
 * ### ليه شبكة شهر حقيقية مش قايمة أيام
 *
 * أول نسخة كانت بتعرض **الأيام اللي فيها طلبات بس** في شبكة مسطّحة. ودي **مستحيل** تجاوب على
 * سؤال المالك: اليوم الفاضي مش راجع من الـAPI أصلاً، فمش موجود في الشبكة — و«١ مارس» كان بيقع
 * جنب «١٨ أغسطس» مباشرةً، فحتى الأيام الظاهرة مكانش لها أي معنى نسبي.
 *
 * دلوقتي الشبكة بتتولّد من **التقويم نفسه** (كل أيام الشهر)، والبيانات بتتحطّ عليها. فاليوم
 * اللي مفيهوش طلبات بيبان **مكانه الصح** كخانة فاضية — وده بالظبط اللي المالك عايز يشوفه.
 *
 * الأسبوع بيبدأ **السبت** (تقويم مصر)، وشهر واحد بيتعرض في المرة من شريط شرائح الشهور.
 */

export interface CalendarDay {
  /** YYYY-MM-DD */
  day: string;
  total: number;
  unassigned: number;
  in_progress: number;
  completed: number;
  overdue: number;
}

/** أسماء أيام الأسبوع بترتيب التقويم المصري (السبت أول). */
const WEEKDAYS_AR = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];

/** `getDay()` بيرجّع الأحد=0؛ بنزحزحه عشان السبت يبقى العمود الأول. */
const columnOf = (date: Date) => (date.getDay() + 1) % 7;

const iso = (date: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

interface MonthBlock {
  key: string;
  label: string;
  /** خانات الشبكة: `null` = حشو قبل أول الشهر أو بعد آخره. */
  cells: (Date | null)[];
}

/**
 * بيبني شبكات الشهور — **الشهور اللي فيها طلبات فعلاً، والشهر الحالي دايمًا**.
 *
 * ### ليه مش كل الشهور بين أول وآخر طلب
 *
 * أول نسخة كانت بتمشي من أول شهر لآخر شهر في البيانات. على نطاق «كل الطلبات» ده طلّع **٨ شبكات
 * شهر** أغلبها فاضي تمامًا (اتشاف في لقطة حقيقية)، والأدمن لازم يلفّ جوّه شهور مالهاش أي طلب
 * عشان يوصل للي فيه شغل.
 *
 * القاعدة دلوقتي: الشهر بيتعرض لو فيه طلب واحد على الأقل، **أو** لو هو الشهر الحالي (الأدمن
 * محتاج يشوف شهره حتى لو فاضي). الأيام الفاضية **جوّه** الشهور المعروضة بتفضل ظاهرة — وده
 * المطلوب الأصلي: «٢٣ سبتمبر — 0».
 *
 * **الحد الأقصى ١٢ شهر** حاجز أمان لو البيانات متفرّقة على سنين.
 */
function buildMonths(days: CalendarDay[]): MonthBlock[] {
  const monthsWithData = new Set(days.map((d) => d.day.slice(0, 7)));
  const now = new Date();
  const currentKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  monthsWithData.add(currentKey);
  if (monthsWithData.size === 0) return [];

  const keys = [...monthsWithData].sort();
  const first = new Date(`${keys[0]}-01T00:00:00`);
  const last = new Date(`${keys[keys.length - 1]}-01T00:00:00`);

  const months: MonthBlock[] = [];
  const cursor = new Date(first.getFullYear(), first.getMonth(), 1);
  while (cursor <= last && months.length < 12) {
    const cursorKey = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
    if (!monthsWithData.has(cursorKey)) {
      cursor.setMonth(cursor.getMonth() + 1);
      continue;
    }
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstColumn = columnOf(new Date(year, month, 1));
    const cells: (Date | null)[] = Array.from({ length: firstColumn }, () => null);
    for (let d = 1; d <= daysInMonth; d += 1) cells.push(new Date(year, month, d));
    while (cells.length % 7 !== 0) cells.push(null);
    months.push({
      key: `${year}-${month}`,
      label: new Date(year, month, 1).toLocaleDateString('ar-EG-u-nu-latn', { month: 'long', year: 'numeric' }),
      cells,
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return months;
}

export function OrdersCalendar({
  days,
  onPickDay,
  selectedDay,
}: {
  days: CalendarDay[];
  onPickDay: (day: string) => void;
  selectedDay?: string | null;
}) {
  const byDay = new Map(days.map((d) => [d.day, d]));
  const months = buildMonths(days);
  const busiest = Math.max(1, ...days.map((d) => d.total));
  const today = iso(new Date());

  /** إجمالي طلبات كل شهر — بيتعرض على شريحة الشهر عشان الأدمن يعرف فين الشغل قبل ما يفتح. */
  const totalOfMonth = (key: string) => {
    const [year, month] = key.split('-').map(Number);
    const prefix = `${year}-${String(month + 1).padStart(2, '0')}`;
    return days.filter((d) => d.day.startsWith(prefix)).reduce((sum, d) => sum + d.total, 0);
  };

  /**
   * **شهر واحد معروض في المرة** (بلاغ مالك 2026-09-17: «الواجهة مش منظمة»).
   *
   * قبل كده كل الشهور كانت بتترندر تحت بعض. على نطاق «كل الطلبات» ده طلّع في لقطة حقيقية
   * **سبع شبكات شهر مرصوصة**، وأول حاجة الأدمن بيشوفها كانت مارس — والشهر الحالي محتاج تمرير
   * طويل لحد آخر الصفحة. دلوقتي شريط شرائح بالشهور (ومعاها إجمالي كل شهر) وشبكة واحدة تحته،
   * والافتراضي الشهر الحالي.
   */
  const currentKey = `${new Date().getFullYear()}-${new Date().getMonth()}`;
  const [activeKey, setActiveKey] = useState(currentKey);
  const active = months.find((m) => m.key === activeKey) ?? months.find((m) => m.key === currentKey) ?? months[0];

  if (!active) return null;

  return (
    <div className="flex flex-col gap-3">
      {months.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {months.map((month) => {
            const total = totalOfMonth(month.key);
            return (
              <button
                key={month.key}
                type="button"
                onClick={() => setActiveKey(month.key)}
                className={cn(
                  'rounded-lg border px-2.5 py-1 text-xs transition',
                  month.key === active.key
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:border-primary/60 hover:text-foreground',
                )}
              >
                {month.label}
                <span className={cn('ms-1.5 tabular-nums', month.key === active.key ? 'opacity-80' : 'opacity-70')}>
                  {total}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {[active].map((month) => (
        <section key={month.key}>
          <h3 className="mb-2 text-sm font-semibold">{month.label}</h3>
          <div className="grid grid-cols-7 gap-1">
            {WEEKDAYS_AR.map((name) => (
              <div key={name} className="pb-1 text-center text-xs font-medium text-muted-foreground">
                {name}
              </div>
            ))}
            {month.cells.map((date, index) => {
              if (!date) return <div key={`pad-${index}`} />;
              const key = iso(date);
              const data = byDay.get(key);
              const total = data?.total ?? 0;
              const isToday = key === today;
              const isSelected = selectedDay === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onPickDay(key)}
                  aria-label={`${date.getDate()} — ${total} طلب`}
                  className={cn(
                    'flex min-h-[74px] flex-col gap-1 rounded-lg border p-1.5 text-start transition hover:border-primary/60 hover:bg-muted/60',
                    total === 0 && 'bg-muted/20',
                    isToday && 'border-primary',
                    isSelected && 'ring-2 ring-primary',
                  )}
                >
                  <div className="flex items-baseline justify-between gap-1">
                    <span className={cn('text-xs', isToday ? 'font-bold text-primary' : 'text-muted-foreground')}>
                      {date.getDate()}
                    </span>
                    {/* **الرقم ظاهر دايمًا مش لون بس** — طلب المالك الصريح. */}
                    <span className={cn('text-sm font-semibold', total === 0 && 'font-normal text-muted-foreground/40')}>
                      {total}
                    </span>
                  </div>
                  {total > 0 && (
                    <div className="h-0.5 w-full rounded bg-muted">
                      <div
                        className="h-0.5 rounded bg-primary"
                        style={{ width: `${Math.round((total / busiest) * 100)}%` }}
                      />
                    </div>
                  )}
                  {/* التفصيل بيظهر **بس** لو فيه حاجة تستحق انتباه — وإلا الخانة تبقى زحمة بلا سبب. */}
                  {data && (data.unassigned > 0 || data.overdue > 0) && (
                    <div className="mt-auto flex flex-wrap gap-0.5">
                      {data.overdue > 0 && (
                        <Badge variant="destructive" className="px-1 py-0 text-[10px] leading-4">
                          {data.overdue} متأخر
                        </Badge>
                      )}
                      {data.unassigned > 0 && (
                        <Badge variant="outline" className="px-1 py-0 text-[10px] leading-4">
                          {data.unassigned} بلا فني
                        </Badge>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      ))}
      {/* دليل الخانة — الأرقام لوحدها مش بتقول هي بتعدّ إيه. */}
      <p className="text-xs leading-5 text-muted-foreground">
        الرقم في كل خانة = عدد الطلبات في اليوم ده حسب الفلاتر الحالية (والصفر ظاهر عن قصد عشان
        تبان الأيام الفاضية). دوس على أي يوم عشان تفتح طلباته في الجدول.
        {months.length === 12 && ' العرض محدود بـ١٢ شهر — ضيّق نطاق التاريخ لو محتاج فترة أبعد.'}
      </p>
    </div>
  );
}
