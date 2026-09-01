'use client';

import type { InputHTMLAttributes, ReactNode } from 'react';
import { Check, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

const TONE_STYLES = {
  blue: {
    shell: 'border-blue-200/70 bg-gradient-to-br from-blue-50/80 via-background to-background',
    icon: 'bg-blue-600 text-white shadow-blue-200',
  },
  amber: {
    shell: 'border-amber-200/80 bg-gradient-to-br from-amber-50/80 via-background to-background',
    icon: 'bg-amber-500 text-white shadow-amber-200',
  },
  green: {
    shell: 'border-emerald-200/80 bg-gradient-to-br from-emerald-50/80 via-background to-background',
    icon: 'bg-emerald-600 text-white shadow-emerald-200',
  },
} as const;

export function CatalogConfigSection({
  title,
  description,
  icon: Icon,
  tone = 'blue',
  children,
  className,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
  tone?: keyof typeof TONE_STYLES;
  children: ReactNode;
  className?: string;
}) {
  const styles = TONE_STYLES[tone];
  return (
    <section className={cn('rounded-2xl border p-4 sm:p-5', styles.shell, className)}>
      <div className="mb-5 flex items-start gap-3">
        <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl shadow-lg', styles.icon)}>
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <div>
          <h3 className="font-semibold text-foreground">{title}</h3>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

type CatalogToggleProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'className'> & {
  title: string;
  description: string;
  icon?: LucideIcon;
};

export function CatalogToggle({ title, description, icon: Icon, ...inputProps }: CatalogToggleProps) {
  return (
    <label className="group relative flex min-h-28 cursor-pointer items-start gap-3 rounded-xl border border-border/80 bg-background/85 p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-md has-[:checked]:border-primary/55 has-[:checked]:bg-primary/[0.045] has-[:checked]:shadow-md">
      <input type="checkbox" className="sr-only" {...inputProps} />
      {Icon && (
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground transition group-has-[:checked]:bg-primary group-has-[:checked]:text-primary-foreground">
          <Icon className="size-4" aria-hidden="true" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block pe-7 text-sm font-semibold text-foreground">{title}</span>
        <span className="mt-1 block text-xs leading-5 text-muted-foreground">{description}</span>
      </span>
      <span className="absolute end-3 top-3 flex size-6 items-center justify-center rounded-full border border-border bg-background text-transparent transition group-has-[:checked]:border-primary group-has-[:checked]:bg-primary group-has-[:checked]:text-primary-foreground">
        <Check className="size-3.5" strokeWidth={3} aria-hidden="true" />
      </span>
    </label>
  );
}
