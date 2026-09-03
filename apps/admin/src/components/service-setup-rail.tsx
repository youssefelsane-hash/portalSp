'use client';

import { AlertTriangle, Check, CircleDashed, MinusCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * شريط مراحل إعداد الخدمة (docs/08 §123).
 *
 * **المشكلة اللي بيحلّها**: صفحة الخدمة فيها ١١ كتلة إعدادات مرصوصة تحت بعض في سكرول طويل.
 * الأدمن لازم يكون حافظ إن «تسعير المناطق» تحت الإضافات، وإن «رسوم المعاينة» جوّه سياسة السعر،
 * وإن بانِي المعادلة أصلاً مش بيظهر غير لو الخدمة `formula`. يعني الواجهة بتعتمد على ذاكرته.
 *
 * **ليه شريط مراحل مش تبويبات (Tabs)**: الخمس أقسام الأولى كلهم جوّه `<form>` **واحد** بزرار
 * حفظ واحد. لو اتحطّوا في تبويبات، حقول التبويب المقفول بتتشال من الـDOM، وبالتالي بتختفي من
 * `FormData` وقت الحفظ — الأدمن يحفظ والقيم اللي مش ظاهرة تتمسح في صمت. دي بالظبط نفس فئة
 * البَقّة اللي اتصلحت في §122 (القسم المكرر). الشريط بيدّي نفس التوجيه بلا الخطر ده: كل حاجة
 * بتفضل في الـDOM، والحفظ زي ما هو بالحرف.
 *
 * **بلا قفل**: كل مرحلة قابلة للفتح في أي وقت. الترتيب توصية مش إجبار — المالك طلب صراحة
 * «مش عايز Wizard يقفل الأدمن... لو خطوتين مستقلين فعلًا، خليه يدخل عليهم بأي ترتيب».
 */
export type ServiceStageStatus =
  /** خلصت، ومفيش حاجة مطلوبة فيها. */
  | 'ready'
  /** فيها حاجة **بتمنع** الخدمة تشتغل صح، أو ناقصها إعداد أساسي. */
  | 'needs_setup'
  /** مش مطلوبة لنوع الخدمة ده أصلاً — مش «ناقصة». */
  | 'not_applicable'
  /** تحسين اختياري، الخدمة شغّالة من غيره. */
  | 'optional';

export interface ServiceStage {
  /** الـid اللي الشريط بيلف عنده في الصفحة (anchor). */
  id: string;
  label: string;
  status: ServiceStageStatus;
  /** سطر بيشرح **ليه** الحالة دي — أهم من الحالة نفسها. */
  hint: string;
  /** true لو المرحلة دي بتمنع الخدمة تبقى قابلة للحجز فعليًا. */
  blocking?: boolean;
}

const STATUS_META: Record<
  ServiceStageStatus,
  { label: string; icon: typeof Check; dot: string; text: string }
> = {
  ready: { label: 'مكتمل', icon: Check, dot: 'bg-success-bg text-success', text: 'text-success' },
  needs_setup: {
    label: 'يحتاج إعداد',
    icon: AlertTriangle,
    dot: 'bg-warning-bg text-warning',
    text: 'text-warning',
  },
  not_applicable: {
    label: 'غير مطلوب',
    icon: MinusCircle,
    dot: 'bg-muted text-muted-foreground',
    text: 'text-muted-foreground',
  },
  optional: {
    label: 'اختياري',
    icon: CircleDashed,
    dot: 'bg-muted text-muted-foreground',
    text: 'text-muted-foreground',
  },
};

export function ServiceSetupRail({ stages, className }: { stages: ServiceStage[]; className?: string }) {
  const blockers = stages.filter((s) => s.blocking && s.status === 'needs_setup');

  function goTo(id: string) {
    const el = document.getElementById(id);
    if (!el) return;
    // `smooth` بيحترم prefers-reduced-motion تلقائيًا عن طريق الـCSS في globals.css
    // (`scroll-behavior: auto !important` جوّه الـmedia query).
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <nav className={cn('flex flex-col gap-3', className)} aria-label="مراحل إعداد الخدمة">
      {/* الخلاصة الأول: «إيه اللي ناقص قبل ما تبقى جاهزة؟» — السؤال اللي المالك سأله بالحرف.
          بيجاوب عليه من نفس الشروط اللي الباك-إند بيرفض بيها الحجز، مش من قواعد مخترعة. */}
      <div
        className={cn(
          'rounded-xl border border-s-4 p-3',
          blockers.length === 0 ? 'border-s-success' : 'border-s-warning',
        )}
      >
        <p className="text-sm font-semibold">{blockers.length === 0 ? 'الخدمة جاهزة للحجز' : 'ناقص قبل التفعيل'}</p>
        {blockers.length === 0 ? (
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            مفيش إعداد ناقص بيمنع العميل يحجز الخدمة دي.
          </p>
        ) : (
          <ul className="mt-1.5 flex flex-col gap-1">
            {blockers.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => goTo(s.id)}
                  className="text-start text-xs leading-5 text-warning hover:underline"
                >
                  {s.label} — {s.hint}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ol className="flex flex-col">
        {stages.map((stage, index) => {
          const meta = STATUS_META[stage.status];
          const Icon = meta.icon;
          const isLast = index === stages.length - 1;
          return (
            <li key={stage.id} className="flex gap-2.5">
              {/* العمود ده هو اللي بيدّي إحساس «مراحل متتابعة» — دايرة + خط واصل لللي بعدها. */}
              <div className="flex flex-col items-center">
                <span className={cn('flex size-6 shrink-0 items-center justify-center rounded-full', meta.dot)}>
                  <Icon className="size-3.5" aria-hidden="true" />
                </span>
                {!isLast && <span className="w-px flex-1 bg-border" aria-hidden="true" />}
              </div>
              <button
                type="button"
                onClick={() => goTo(stage.id)}
                className="motion-press mb-3 flex-1 rounded-lg p-1.5 text-start transition-colors hover:bg-accent/50"
              >
                <span className="flex flex-wrap items-center gap-x-2 text-sm font-medium">
                  {stage.label}
                  <span className={cn('text-[11px] font-normal', meta.text)}>{meta.label}</span>
                </span>
                <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{stage.hint}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
