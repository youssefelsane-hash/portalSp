import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * **الشكل الموحّد لكل حالة «مفيش نتيجة / فيه مشكلة»** في الموقع العام (ADR-0114، طلب اتساق
 * المالك 2026-09-25: «ميبقاش login معمول بطريقة وcheckout بطريقة مختلفة تمامًا»).
 *
 * قبل ده كل شاشة كانت بتكتب حالة الخطأ بنفسها: نصوص مختلفة، أماكن مختلفة، وأهم حاجة — **بلا أي
 * طريق للخروج**. المستخدم بيقف على رسالة ومفيش زرار.
 *
 * القواعد اللي المكوّن ده بيفرضها على كل حالة:
 * - **عنوان بلغة المستخدم، مش لغة النظام**: أبداً `TypeError` ولا `undefined` ولا `API Error 500`.
 *   التفاصيل التقنية بتروح للسيرفر (`reportClientError`)، والمستخدم بيشوف سبب وحل.
 * - **دايمًا فيه خطوة تالية واحدة على الأقل**: «حاول تاني» أو «الرئيسية». شاشة بلا زرار = طريق
 *   مسدود.
 * - **نفس المقاسات والمسافات في كل الحالات** — فالانتقال بين ٤٠٤ و«مفيش إنترنت» مايحسّش
 *   المستخدم إنه دخل تطبيق تاني.
 */

export interface ErrorStateAction {
  label: string;
  href?: string;
  onClick?: () => void;
}

export function ErrorState({
  title,
  description,
  hint,
  primary,
  secondary,
  children,
  testId = 'error-state',
}: {
  title: string;
  description: string;
  /** سطر صغير تحت الزراير — للإجراء اللي مش زرار (رقم تواصل، كود مرجعي). */
  hint?: ReactNode;
  primary?: ErrorStateAction;
  secondary?: ErrorStateAction;
  children?: ReactNode;
  testId?: string;
}) {
  return (
    <div
      className="mx-auto flex min-h-[60vh] w-full max-w-xl flex-col items-center justify-center px-4 py-12 text-center"
      data-testid={testId}
    >
      <h1 className="text-xl font-bold sm:text-2xl">{title}</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted sm:text-base">{description}</p>
      {children}
      {(primary || secondary) && (
        <div className="mt-7 flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:justify-center">
          {primary && <ErrorAction action={primary} variant="primary" />}
          {secondary && <ErrorAction action={secondary} variant="secondary" />}
        </div>
      )}
      {hint && <div className="mt-6 text-xs text-muted">{hint}</div>}
    </div>
  );
}

function ErrorAction({ action, variant }: { action: ErrorStateAction; variant: 'primary' | 'secondary' }) {
  // نفس مقاس ونفس زمن الانتقال للزرارين في كل شاشة — الاتساق اللي المالك طلبه بيتفرض من هنا،
  // مش بالاعتماد على إن كل صفحة تفتكر تكتب نفس الكلاسات.
  const className =
    variant === 'primary'
      ? 'inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-transform duration-150 active:scale-[0.99]'
      : 'inline-flex min-h-11 items-center justify-center rounded-xl border border-border px-6 text-sm font-medium transition-colors duration-150 hover:bg-muted/10';

  if (action.href) {
    return (
      <Link href={action.href} className={className} data-testid={`error-action-${variant}`}>
        {action.label}
      </Link>
    );
  }
  return (
    <button type="button" onClick={action.onClick} className={className} data-testid={`error-action-${variant}`}>
      {action.label}
    </button>
  );
}
