import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

// شريحة حالة دلالية (docs/12، نظام التصميم المشترك) — الفرق عن Badge العادي: بتربط الحالة بلون
// معنى واحد ثابت عبر كل الصفحات (نجاح=أخضر، تحذير=كهرماني، خطر=أحمر، معلومة=أزرق، محايد=رمادي)،
// بدل ما كل صفحة تختار ألوان Badge افتراضية عشوائيًا (كان معظم الحالات بتظهر بنفس لون primary
// الأزرق بغض النظر عن معناها — "ملغي" و"مكتمل" بنفس اللون بالظبط).
const statusChipVariants = cva('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium w-fit whitespace-nowrap transition-colors', {
  variants: {
    tone: {
      success: 'bg-success-bg text-success',
      warning: 'bg-warning-bg text-warning',
      danger: 'bg-danger-bg text-danger',
      info: 'bg-info-bg text-info',
      neutral: 'bg-muted text-muted-foreground',
    },
  },
  defaultVariants: { tone: 'neutral' },
});

function StatusDot({ tone }: { tone: VariantProps<typeof statusChipVariants>['tone'] }) {
  return (
    <span
      className={cn('size-1.5 rounded-full', {
        'bg-success': tone === 'success',
        'bg-warning': tone === 'warning',
        'bg-danger': tone === 'danger',
        'bg-info': tone === 'info',
        'bg-muted-foreground': tone === 'neutral' || !tone,
      })}
    />
  );
}

function StatusChip({
  className,
  tone,
  children,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof statusChipVariants>) {
  return (
    <span data-slot="status-chip" className={cn(statusChipVariants({ tone }), className)} {...props}>
      <StatusDot tone={tone} />
      {children}
    </span>
  );
}

export { StatusChip, statusChipVariants };
