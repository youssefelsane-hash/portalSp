import { cn } from '@/lib/utils';

// حالات تحميل (docs/12، الطلب الأول — عناصر نظام تصميم مطلوبة صراحة) — بديل عن "جاري التحميل…"
// نصي في كل الصفحات، بيدّي إحساس فوري بشكل المحتوى الجاي بدل ومضة فراغ.
function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="skeleton" className={cn('bg-muted animate-pulse rounded-md', className)} {...props} />;
}

export { Skeleton };
