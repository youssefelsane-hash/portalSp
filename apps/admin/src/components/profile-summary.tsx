import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ProfileSummaryItem {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon: LucideIcon;
  tone?: 'primary' | 'success' | 'warning' | 'neutral';
}

const toneClasses: Record<NonNullable<ProfileSummaryItem['tone']>, string> = {
  primary: 'bg-primary/10 text-primary',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  neutral: 'bg-muted text-muted-foreground',
};

export function ProfileSummary({ items }: { items: ProfileSummaryItem[] }) {
  return (
    <section className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="ملخص الملف">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <div
            key={item.label}
            className="flex min-h-28 items-start gap-3 rounded-2xl border border-border/70 bg-card/95 p-4 shadow-sm"
          >
            <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl', toneClasses[item.tone ?? 'neutral'])}>
              <Icon className="size-5" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-muted-foreground">{item.label}</p>
              <div className="mt-1 truncate text-xl font-semibold tracking-tight">{item.value}</div>
              {item.hint && <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.hint}</p>}
            </div>
          </div>
        );
      })}
    </section>
  );
}
