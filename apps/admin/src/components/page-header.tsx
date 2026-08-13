import { cn } from '@/lib/utils';

// عنوان صفحة موحّد (docs/12، نظام التصميم المشترك) — كانت كل صفحة بتكتب <h1> بحجم/تباعد مختلف
// شويّة عن التانية (h1 أحيانًا mb-6، أحيانًا flex justify-between يدوي). العنصر ده بيثبّت التسلسل
// الهرمي (عنوان + وصف اختياري + مكان أفعال يمين الصف) عبر كل الصفحات دفعة واحدة.
function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-6 flex flex-wrap items-start justify-between gap-3', className)}>
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export { PageHeader };
