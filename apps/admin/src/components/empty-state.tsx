import { Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';

// حالة فراغ موحّدة (docs/12، نظام التصميم المشترك) — كانت كل صفحة بتكتب نص "مفيش ..." مختلف
// شكلاً (بعضها <p> عادي وسط الصفحة، بعضها جوّه الجدول). بديل بصري متّسق بدل النص الجاف.
function EmptyState({
  title,
  description,
  icon: Icon = Inbox,
  action,
  className,
}: {
  title: string;
  description?: string;
  icon?: React.ComponentType<{ className?: string }>;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-12 text-center', className)}>
      <Icon className="size-8 text-muted-foreground/60" />
      <p className="font-medium">{title}</p>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export { EmptyState };
